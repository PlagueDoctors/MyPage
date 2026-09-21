/**
 * 点云数据加载。
 *
 * 文件格式（32 字节定长头 + Int16 载荷）：
 *   0  …  3    magic  'PTC1'
 *   4  …  7    uint32 count
 *   8  … 19    float32 scaleX, scaleY, scaleZ     （每轴半幅）
 *  20  … 31    float32 offsetX, offsetY, offsetZ   （每轴中心）
 *  32  …      int16 × count × 3                    （归一化到 [-32767, 32767]）
 *
 * 为什么文件里存 Int16 而上传 GPU 用 Float32：
 *   体积减半、gzip 压缩率远好于裸浮点 —— 这是**下载**上的收益；
 *   而反量化只在加载时做一次，之后 GPU 上就是普通浮点属性，
 *   着色器里不需要任何解码逻辑，也就没有额外的 uniform 或算术开销。
 */

export interface PointCloudData {
  name: string;
  count: number;
  /** 反量化后的世界坐标 */
  positions: Float32Array;
}

const HEADER_BYTES = 32;
const MAGIC = "PTC1";

export function decodePointCloud(buffer: ArrayBuffer, name: string): PointCloudData {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error(`${name}: 文件太小，不是合法的点云`);
  }
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== MAGIC) {
    throw new Error(`${name}: magic 不匹配（读到 "${magic}"，期望 "${MAGIC}"）`);
  }

  const count = view.getUint32(4, true);
  const expected = HEADER_BYTES + count * 3 * 2;
  if (buffer.byteLength !== expected) {
    throw new Error(`${name}: 长度不符（收到 ${buffer.byteLength}，按 count=${count} 应为 ${expected}）`);
  }

  const scale = [view.getFloat32(8, true), view.getFloat32(12, true), view.getFloat32(16, true)];
  const offset = [view.getFloat32(20, true), view.getFloat32(24, true), view.getFloat32(28, true)];

  const source = new Int16Array(buffer, HEADER_BYTES, count * 3);
  const positions = new Float32Array(count * 3);
  const inv = 1 / 32767;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    positions[i3] = (source[i3] * inv) * scale[0] + offset[0];
    positions[i3 + 1] = (source[i3 + 1] * inv) * scale[1] + offset[1];
    positions[i3 + 2] = (source[i3 + 2] * inv) * scale[2] + offset[2];
  }

  return { name, count, positions };
}

export interface FetchProgress {
  loaded: number;
  total: number;
}

/**
 * 带字节级进度的 fetch。
 * 用 response.body 的 reader 而不是 await response.arrayBuffer()，
 * 否则预加载器只能显示"转圈"而不是真实百分比。
 * 拿不到 Content-Length 时（少见）退化为不定进度。
 */
async function fetchWithProgress(
  url: string,
  onProgress?: (p: FetchProgress) => void
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} 加载失败：HTTP ${response.status}`);

  const declared = Number(response.headers.get("content-length") ?? 0);

  if (!response.body || !onProgress) {
    const buffer = await response.arrayBuffer();
    onProgress?.({ loaded: buffer.byteLength, total: declared || buffer.byteLength });
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ loaded, total: declared || 0 });
  }

  const merged = new Uint8Array(loaded);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return merged.buffer;
}

export const pointCloudUrl = (name: string): string => `./pointcloud/${name}.bin`;

export interface PointCloudManifest {
  count: number;
  generatedAt?: string;
  /** 文件名 → 字节数 */
  files: Record<string, number>;
}

export async function loadManifest(): Promise<PointCloudManifest> {
  const response = await fetch("./pointcloud/manifest.json");
  if (!response.ok) throw new Error(`manifest.json 加载失败：HTTP ${response.status}`);
  return (await response.json()) as PointCloudManifest;
}

export async function loadPointCloud(
  name: string,
  onProgress?: (p: FetchProgress) => void
): Promise<PointCloudData> {
  const buffer = await fetchWithProgress(pointCloudUrl(name), onProgress);
  return decodePointCloud(buffer, name);
}

/**
 * 按 manifest 声明的字节数，并行拉取全部点云，并汇报**整体的**字节进度。
 *
 * 先读 manifest 再并行下载，是为了同时拿到两件事：
 * 准确的百分比（不需要 Content-Length，也不受 gzip 传输长度影响），
 * 以及并行带来的速度。旧实现是 `for` 循环里逐个 await，串行且无进度。
 */
export async function loadAll(
  names: readonly string[],
  manifest: PointCloudManifest,
  onProgress?: (loaded: number, total: number) => void
): Promise<Map<string, PointCloudData>> {
  const total = names.reduce((sum, name) => sum + (manifest.files[name] ?? 0), 0);
  const loadedPerFile = new Map<string, number>();
  const report = () => {
    let loaded = 0;
    for (const value of loadedPerFile.values()) loaded += value;
    onProgress?.(loaded, total);
  };

  report();
  const results = await Promise.all(
    names.map(async (name) => {
      const data = await loadPointCloud(name, ({ loaded }) => {
        loadedPerFile.set(name, loaded);
        report();
      });
      loadedPerFile.set(name, manifest.files[name] ?? 0);
      report();
      return [name, data] as const;
    })
  );
  return new Map(results);
}
