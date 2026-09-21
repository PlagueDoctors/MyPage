/**
 * 点云对象 —— 本次重构性能上最大的改动。
 *
 * 旧实现每帧在 CPU 上循环 4000 个粒子做变形：
 *   · rotateTarget() 每次返回一个新的对象字面量 {x,y,z} → 每秒约 24 万个临时对象
 *   · 之后 attributes.position.needsUpdate = true → 整块顶点缓冲重传（48 KB/帧）
 * 结果是每帧开销与粒子数**线性绑定**，想从 4k 提到 80k 直接跪。
 *
 * 现在：
 *   · 自由隧道与形状目标是两份**静态**缓冲，变形在顶点着色器里 mix
 *   · 每帧 CPU 只写几个 uniform —— 复杂度 O(1)，与粒子数完全无关
 *   · 没有任何 bufferSubData，没有任何顶点数据上传
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import vertexShader from "./shaders/point.vert.glsl?raw";
import fragmentShader from "./shaders/point.frag.glsl?raw";
import { PARTICLE_PALETTE } from "../config/palette";
import type { PointCloudData } from "../data/pointcloud";

/** 不参与聚合、永远留在环境里的粒子比例 */
const AMBIENT_RATIO = 0.3;

export interface PointCloudOptions {
  data: PointCloudData;
  /** 起始绘制数量，由质量档位决定 */
  drawCount: number;
  pointSize: number;
  maxPointSize: number;
}

export class PointCloud {
  readonly points: Points;
  readonly material: ShaderMaterial;
  private readonly geometry: BufferGeometry;
  private readonly capacity: number;
  /**
   * 形状名 → 目标属性。
   *
   * 存 BufferAttribute 而不是裸 Float32Array 是有意的：否则每次切回同一形状都会
   * 新建一个 BufferAttribute，进而分配一块新的 GPU 缓冲（80k 点约 960 KB）。
   * 来回滚几趟就积起来了 —— 而这里只需要把已建好的属性重新挂上去。
   */
  private readonly targets = new Map<string, BufferAttribute>();
  private currentTarget: string | null = null;
  private readonly tempColor = new Color();
  private readonly tempVec = new Vector3();

  constructor(options: PointCloudOptions) {
    const { data, drawCount, pointSize, maxPointSize } = options;
    this.capacity = data.count;

    this.geometry = new BufferGeometry();

    // ① 自由隧道位置（静态，永不变）
    this.geometry.setAttribute("position", new BufferAttribute(data.positions.slice(), 3));

    // ② 形状目标（静态，切换章节时整体换掉这个 attribute 的引用即可）
    //    初值与隧道重合，保证第一个形状加载完成前画面不会跳变
    this.geometry.setAttribute("aTarget", new BufferAttribute(data.positions.slice(), 3));

    // ③ 每点随机种子：驱动过渡期的扰动相位，让粒子不要同步抖动
    const seeds = new Float32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) seeds[i] = Math.random();
    this.geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));

    // ④ 聚合权重：约三成粒子恒为 0，永远留在环境里。
    //    没有它的话，形状一成形背景就全空了，飞行感消失。
    const weights = new Float32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) weights[i] = Math.random() < AMBIENT_RATIO ? 0 : 1;
    this.geometry.setAttribute("aMorphWeight", new BufferAttribute(weights, 1));

    // ⑤ 颜色：从色板随机取，一次性写入
    const colors = new Float32Array(this.capacity * 3);
    for (let i = 0; i < this.capacity; i++) {
      this.tempColor.setHex(PARTICLE_PALETTE[(Math.random() * PARTICLE_PALETTE.length) | 0]);
      colors[i * 3] = this.tempColor.r;
      colors[i * 3 + 1] = this.tempColor.g;
      colors[i * 3 + 2] = this.tempColor.b;
    }
    this.geometry.setAttribute("aColor", new BufferAttribute(colors, 3));

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMorph: { value: 0 },
        uSpin: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: pointSize },
        uSizeScale: { value: 800 },
        uFocal: { value: 80 },
        uAperture: { value: 0.3 },
        uJitter: { value: 7 },
        uMaxPointSize: { value: maxPointSize },
        // 单点亮度。加色混合下密度即亮度，所以这里给的偏低，
        // 真正的明暗对比由着色器里的「越虚化越透明 / 越聚合越透明」两项调节。
        uAlpha: { value: 0.7 },
        uShapeOrigin: { value: new Vector3(0, 0, -112) },
        uShapeScale: { value: 26 },
        uAccent: { value: new Color(0xffffff) },
        uAccentMix: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // 加色混合 = 与顺序无关，因此**不需要**按深度排序，
      // 省掉每帧 CPU 排序或 OIT 的整套开销。
      blending: AdditiveBlending,
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false; // 点云铺满整条航线，包围盒剔除只会帮倒忙
    this.geometry.setDrawRange(0, Math.min(drawCount, this.capacity));
  }

  /** 注册一个形状的目标坐标（已归一化到半径 1） */
  registerShape(name: string, positions: Float32Array): void {
    if (positions.length !== this.capacity * 3) {
      throw new Error(
        `形状 ${name} 的点数（${positions.length / 3}）与隧道场（${this.capacity}）不一致。` +
          `它们在着色器里按下标一一配对做 mix，必须完全相同。`
      );
    }
    this.targets.set(name, new BufferAttribute(positions, 3));
  }

  /** 切换当前目标形状。morph ≈ 0 时调用是看不见的，章节切换正好满足这一点 */
  setShape(name: string | null): boolean {
    if (name === this.currentTarget) return false;
    this.currentTarget = name;

    if (name === null) return true;
    const target = this.targets.get(name);
    if (!target) {
      console.warn(`[pointcloud] 形状 "${name}" 尚未加载，保持当前形态`);
      return false;
    }

    // 只把已经建好的属性挂上去 —— 零拷贝、零分配、零 GPU 缓冲重建
    this.geometry.setAttribute("aTarget", target);
    return true;
  }

  /** 改变实际绘制数量（质量降档） */
  setDrawCount(count: number): void {
    this.geometry.setDrawRange(0, Math.max(1, Math.min(count, this.capacity)));
  }

  get targetCount(): number {
    return this.geometry.drawRange.count;
  }

  /** 每帧只写 uniform。这是整个渲染循环里唯一与点云相关的 CPU 工作。 */
  update(state: {
    morph: number;
    spin: number;
    time: number;
    aperture: number;
    accent: number;
    accentMix: number;
    shapeOrigin: readonly [number, number, number];
    shapeScale: number;
    /** 相机到对焦点的距离，由 CameraRig 提供 */
    focal: number;
    /** 透视缩放系数 = drawingBufferHeight / (2·tan(fov/2)) */
    sizeScale: number;
  }): void {
    const u = this.material.uniforms;
    u.uMorph.value = state.morph;
    u.uSpin.value = state.spin;
    u.uTime.value = state.time;
    u.uAperture.value = state.aperture;
    u.uAccentMix.value = state.accentMix;
    u.uFocal.value = state.focal;
    u.uSizeScale.value = state.sizeScale;
    u.uShapeScale.value = state.shapeScale;

    this.tempVec.set(state.shapeOrigin[0], state.shapeOrigin[1], state.shapeOrigin[2]);
    (u.uShapeOrigin.value as Vector3).copy(this.tempVec);
    (u.uAccent.value as Color).setHex(state.accent);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.targets.clear();
  }
}
