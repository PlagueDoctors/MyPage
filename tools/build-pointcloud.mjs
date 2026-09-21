/**
 * 离线点云构建管线
 * ==================
 * 把「三角网格」或「程序化生成器」转换成运行时直接可用的量化点云文件。
 *
 * 为什么离线做：
 *   1. 运行时不再需要 GLTFLoader / 网格解析 —— three 的网格相关代码可被 tree-shake 掉
 *   2. 面积加权采样是 O(三角形数) 的，放在鼠标点击到首屏之间太贵
 *   3. 量化后文件体积减半，且 gzip 压缩率远好于裸浮点
 *
 * 采样质量（这是旧代码最大的视觉缺陷）：
 *   旧实现从 `position` 属性的顶点里均匀随机取点 → 密度正比于**网格细分程度**而非**表面积**，
 *   大片平面上点稀疏、密集网格处点扎堆，轮廓必然破碎发毛。
 *   这里改为：累积三角形面积 → 前缀和 CDF → 二分查找 → 重心坐标均匀采样。
 *
 * 用法：
 *   node tools/build-pointcloud.mjs                 # 生成默认的程序化形状 + 隧道场
 *   node tools/build-pointcloud.mjs --count 80000   # 指定点数
 *   node tools/build-pointcloud.mjs --glb models/Duck.glb --dry-run   # 校验 GLB 采样（不写文件）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "public/pointcloud");

// ─────────────────────────────────────────────────────────────── 参数

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

/** 生成点数。必须是所有形状与隧道场的**统一点数** —— 它们在着色器里按下标配对做 mix。 */
const COUNT = Number(flag("count", 80000));
const DRY_RUN = has("dry-run");

// 隧道场几何（世界单位），与 chapters.config.ts 里的相机路径保持一致
const FIELD_RADIUS = 46;
const FIELD_Z_NEAR = 70;
const FIELD_Z_FAR = -540;

// ─────────────────────────────────────────────────────────────── 数学小工具

const gauss = () => {
  // Box–Muller，用于星系的柔和散开
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** 低频伪噪声：几层正弦叠加，用来给球体加"小行星"式的起伏 */
function ridge(x, y, z) {
  return (
    0.55 * Math.sin(2.1 * x + 1.3 * z) * Math.cos(1.7 * y - 0.6 * z) +
    0.28 * Math.sin(4.3 * y + 2.2 * x) * Math.cos(3.1 * z + 1.1 * y) +
    0.17 * Math.sin(7.1 * z - 1.9 * x) * Math.cos(5.7 * x + 0.4 * y)
  );
}

// ─────────────────────────────────────────────────────────────── 程序化生成器
// 产出 Float32Array，长度 count*3。全部以原点为中心、半径约 1，后续统一归一化。

/** 斐波那契球 + 低频起伏 —— 读起来像一颗有地形的星球 */
function genSphere(count) {
  const out = new Float32Array(count * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i;
    let x = Math.cos(th) * r;
    let z = Math.sin(th) * r;
    const amp = 0.085 * ridge(x * 2.4, y * 2.4, z * 2.4);
    const k = 1 + amp;
    out[i * 3] = x * k;
    out[i * 3 + 1] = y * k;
    out[i * 3 + 2] = z * k;
  }
  return out;
}

/** (p,q) 环面纽结的管状表面采样 */
function genKnot(count, p = 2, q = 3, tube = 0.30) {
  const out = new Float32Array(count * 3);
  const curve = (t) => {
    const cq = Math.cos(q * t), sq = Math.sin(q * t);
    const rr = 2 + cq;
    return [rr * Math.cos(p * t), rr * Math.sin(p * t), sq];
  };
  const dt = 1e-3;
  for (let i = 0; i < count; i++) {
    const t = Math.random() * Math.PI * 2;
    const c = curve(t);
    const a = curve(t + dt), b = curve(t - dt);
    // 切线
    let tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // 任取一个与切线不平行的参考轴构造法平面
    const ux = Math.abs(tx) < 0.9 ? 1 : 0;
    const uy = Math.abs(tx) < 0.9 ? 0 : 1;
    let nx = ty * 0 - tz * uy, ny = tz * ux - tx * 0, nz = tx * uy - ty * ux;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // 副法线
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const phi = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * tube;
    const cp = Math.cos(phi) * rr, sp = Math.sin(phi) * rr;
    // 缩放回单位量级（原始曲线半径约 3）
    out[i * 3] = (c[0] + nx * cp + bx * sp) / 3.3;
    out[i * 3 + 1] = (c[1] + ny * cp + by * sp) / 3.3;
    out[i * 3 + 2] = (c[2] + nz * cp + bz * sp) / 3.3;
  }
  return out;
}

/** 双旋臂盘状星系：对数螺线 + 随半径收敛的角向散布 + 薄盘厚 */
function genGalaxy(count, arms = 2) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const k = Math.sqrt(Math.random());            // 径向密度偏向外围
    const r = 0.12 + k * 0.88;
    const arm = Math.floor(Math.random() * arms);
    const base = (arm * Math.PI * 2) / arms + Math.log(r + 0.1) * 2.3;
    const spread = 0.62 * (1 - k * 0.55);
    const th = base + gauss() * spread;
    const thick = 0.055 * (1 - k * 0.65) + 0.012;
    out[i * 3] = Math.cos(th) * r;
    out[i * 3 + 1] = gauss() * thick;
    out[i * 3 + 2] = Math.sin(th) * r;
  }
  return out;
}

/**
 * 隧道场：相机穿行的那团静态点云。
 * 60% 落在柱壳（隧道的"壁"），40% 是稀疏尘埃 —— 这样既读得出隧道，又不会像一堵墙。
 */
function genTunnelField(count) {
  const out = new Float32Array(count * 3);
  const shellCount = Math.floor(count * 0.6);
  const zLen = FIELD_Z_NEAR - FIELD_Z_FAR;
  for (let i = 0; i < count; i++) {
    const inShell = i < shellCount;
    const angle = Math.random() * Math.PI * 2;
    let radius;
    if (inShell) {
      const inner = FIELD_RADIUS * 0.32;
      radius = Math.sqrt(inner * inner + Math.random() * (FIELD_RADIUS * FIELD_RADIUS - inner * inner));
    } else {
      radius = Math.sqrt(Math.random()) * FIELD_RADIUS;
    }
    out[i * 3] = Math.cos(angle) * radius;
    out[i * 3 + 1] = Math.sin(angle) * radius;
    out[i * 3 + 2] = FIELD_Z_NEAR - Math.random() * zLen;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── GLB 读取（最小实现）
// 只支持 glTF 2.0 / TRIANGLES / FLOAT POSITION。几十行，换取运行时零解析成本。

function readGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("不是 GLB：magic 不匹配");
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`不支持的 glTF 版本 ${version}`);
  const total = Math.min(dv.getUint32(8, true), buf.byteLength);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.buffer, buf.byteOffset + start, len)));
    } else if (type === 0x004e4942) {
      bin = new Uint8Array(buf.buffer, buf.byteOffset + start, len);
    }
    off = start + len;
  }
  if (!json) throw new Error("GLB 缺少 JSON 块");
  return { json, bin };
}

const COMPONENT = {
  5120: { bytes: 1, read: (dv, o) => dv.getInt8(o) },
  5121: { bytes: 1, read: (dv, o) => dv.getUint8(o) },
  5122: { bytes: 2, read: (dv, o) => dv.getInt16(o, true) },
  5123: { bytes: 2, read: (dv, o) => dv.getUint16(o, true) },
  5125: { bytes: 4, read: (dv, o) => dv.getUint32(o, true) },
  5126: { bytes: 4, read: (dv, o) => dv.getFloat32(o, true) },
};
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const comp = COMPONENT[acc.componentType];
  if (!comp) throw new Error(`不支持的 componentType ${acc.componentType}`);
  const comps = NUM_COMPONENTS[acc.type];
  const view = gltf.bufferViews[acc.bufferView];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? comps * comp.bytes;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float64Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      out[i * comps + c] = comp.read(dv, base + i * stride + c * comp.bytes);
    }
  }
  return { data: out, count: acc.count, comps };
}

/** 4x4 列主序矩阵乘法（glTF 约定） */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** 遍历场景图，收集所有三角形（已应用世界变换） */
function collectTriangles(gltf, bin) {
  const scenes = gltf.scenes ?? [];
  const roots = (scenes[gltf.scene ?? 0] ?? scenes[0])?.nodes ?? [];
  const tris = [];
  const stack = roots.map((n) => ({ index: n, mat: null }));

  while (stack.length) {
    const { index, mat } = stack.pop();
    const node = gltf.nodes[index];
    const world = mat ? mul(mat, nodeMatrix(node)) : nodeMatrix(node);
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue; // 只要 TRIANGLES
        if (prim.attributes?.POSITION === undefined) continue;
        const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
        const idx = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices) : null;
        const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
        for (let t = 0; t < triCount; t++) {
          const corners = [];
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.data[t * 3 + k] : t * 3 + k;
            const x = pos.data[vi * 3], y = pos.data[vi * 3 + 1], z = pos.data[vi * 3 + 2];
            corners.push([
              world[0] * x + world[4] * y + world[8] * z + world[12],
              world[1] * x + world[5] * y + world[9] * z + world[13],
              world[2] * x + world[6] * y + world[10] * z + world[14],
            ]);
          }
          tris.push(corners);
        }
      }
    }
    for (const child of node.children ?? []) stack.push({ index: child, mat: world });
  }
  return tris;
}

/**
 * 面积加权 + 重心坐标均匀采样。
 * 等价于在网格表面上做**均匀**撒点：每个三角形分到的点数正比于它的面积。
 * 重心坐标取 r1 = sqrt(rand) 才是三角形内均匀分布（直接 r1 = rand 会在一个角堆积）。
 */
function sampleTriangles(tris, count, radiusTarget = 1) {
  const n = tris.length;
  const cdf = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [a, b, c] = tris[i];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += Math.hypot(cx, cy, cz) * 0.5;
    cdf[i] = total;
  }
  if (total <= 0) throw new Error("网格表面积为 0");

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // 二分查找面积区间
    const target = Math.random() * total;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1; else hi = mid;
    }
    const [a, b, c] = tris[lo];
    const r1 = Math.sqrt(Math.random()), r2 = Math.random();
    const w0 = 1 - r1, w1 = r1 * (1 - r2), w2 = r1 * r2;
    out[i * 3] = a[0] * w0 + b[0] * w1 + c[0] * w2;
    out[i * 3 + 1] = a[1] * w0 + b[1] * w1 + c[1] * w2;
    out[i * 3 + 2] = a[2] * w0 + b[2] * w1 + c[2] * w2;
  }
  return normalizeToRadius(out, radiusTarget);
}

// ─────────────────────────────────────────────────────────────── 归一化与写出

/** 把点云平移到包围盒中心，并等比缩放到「最大半轴 = radius」。返回包围盒信息 */
function normalizeToRadius(points, radius) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
    minZ = Math.min(minZ, points[i + 2]); maxZ = Math.max(maxZ, points[i + 2]);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const half = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 || 1;
  const k = radius / half;
  for (let i = 0; i < points.length; i += 3) {
    points[i] = (points[i] - cx) * k;
    points[i + 1] = (points[i + 1] - cy) * k;
    points[i + 2] = (points[i + 2] - cz) * k;
  }
  return points;
}

/**
 * 写出 .bin。
 * 32 字节定长头 + Int16 归一化坐标，比裸 Float32 小一半且 gzip 压缩率高得多。
 * 解码头由运行时用 Float32 完成一次，之后 GPU 上就是普通浮点属性 —— 着色器里不需要任何解码逻辑。
 */
function writePointCloud(name, points) {
  const count = points.length / 3;
  const header = 32;
  const buf = Buffer.alloc(header + count * 3 * 2);

  buf.write("PTC1", 0, "ascii");
  buf.writeUInt32LE(count, 4);

  // 逐轴求包围盒，量化到 [-32767, 32767]
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
    minZ = Math.min(minZ, points[i + 2]); maxZ = Math.max(maxZ, points[i + 2]);
  }
  const scale = [(maxX - minX) / 2 || 1, (maxY - minY) / 2 || 1, (maxZ - minZ) / 2 || 1];
  const offset = [(maxX + minX) / 2, (maxY + minY) / 2, (maxZ + minZ) / 2];
  for (let a = 0; a < 3; a++) {
    buf.writeFloatLE(scale[a], 8 + a * 4);
    buf.writeFloatLE(offset[a], 20 + a * 4);
  }

  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = (points[i * 3 + a] - offset[a]) / scale[a];
      buf.writeInt16LE(clamp(Math.round(v * 32767), -32767, 32767), header + (i * 3 + a) * 2);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, `${name}.bin`), buf);
  return { name, count, bytes: buf.length };
}

// ─────────────────────────────────────────────────────────────── 主流程

function main() {
  console.log(`点数：${COUNT}（隧道场与所有形状必须一致）\n`);

  // --glb 模式：校验「自有模型 → 点云」这条链路
  const glbPath = flag("glb", null);
  if (glbPath) {
    const abs = resolve(ROOT, glbPath);
    if (!existsSync(abs)) throw new Error(`找不到 ${abs}`);
    const buf = readFileSync(abs);
    const { json, bin } = readGLB(buf);
    const tris = collectTriangles(json, bin);
    if (!tris.length) throw new Error("GLB 中没有找到三角形");
    const sampled = sampleTriangles(tris, COUNT, 1);
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < sampled.length; i += 3) { lo = Math.min(lo, sampled[i]); hi = Math.max(hi, sampled[i]); }
    console.log(`GLB 采样校验：${basename(abs)}`);
    console.log(`  三角形数      ${tris.length.toLocaleString()}`);
    console.log(`  采样点数      ${sampled.length / 3}`);
    console.log(`  归一化后 Y 范围  ${lo.toFixed(3)} … ${hi.toFixed(3)}`);
    if (DRY_RUN) { console.log("\n--dry-run：未写出文件"); return; }
    const info = writePointCloud(flag("out", basename(abs, ".glb")), sampled);
    console.log(`  已写出        public/pointcloud/${info.name}.bin  ${(info.bytes / 1024).toFixed(0)} KB`);
    return;
  }

  const jobs = [
    { name: "field", label: "隧道场", points: genTunnelField(COUNT) },
    { name: "sphere", label: "星球", points: normalizeToRadius(genSphere(COUNT), 1) },
    { name: "knot", label: "纽结", points: normalizeToRadius(genKnot(COUNT), 1) },
    { name: "disc", label: "星盘", points: normalizeToRadius(genGalaxy(COUNT), 1) },
  ];

  let total = 0;
  const results = [];
  for (const job of jobs) {
    const info = writePointCloud(job.name, job.points);
    results.push(info);
    total += info.bytes;
    console.log(
      `${job.label.padEnd(6, "　")} ${info.name.padEnd(8)} ${info.count.toLocaleString().padStart(9)} 点  ${(info.bytes / 1024).toFixed(0).padStart(5)} KB`
    );
  }

  // manifest：让预加载器在开始下载**之前**就知道总字节数，
  // 于是可以并行拉取所有文件，同时仍然显示准确的完成百分比。
  const manifest = {
    count: COUNT,
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(results.map((r) => [r.name, r.bytes])),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\n合计 ${(total / 1024 / 1024).toFixed(2)} MB → public/pointcloud/`);
  console.log("已写出 manifest.json");
}

main();
