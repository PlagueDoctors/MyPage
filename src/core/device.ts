/**
 * 能力探测与质量档位。
 *
 * 这两件事放一起，因为档位完全由探测结果决定。
 * 其中 pointSizeLimit 是最容易被忽略、也最难排查的一项 —— 见下面的注释。
 */

export type Tier = "high" | "medium" | "low";

export interface ProbeResult {
  webgl2: boolean;
  renderer: string;
  maxTextureSize: number;
  /**
   * gl_PointSize 的硬件上限。
   *
   * 这是本方案里最容易踩的坑：桌面 GL 常见上限 1024，但 ANGLE 后端（Windows 上
   * Chrome/Edge 默认走 ANGLE D3D11）和大量移动 GPU 会把它钳在 **63 或 64**。
   * 超过上限的点尺寸会被**静默截断**，于是"景深模糊在大尺寸下失效"，
   * 而且没有任何报错 —— 你在桌面开发一切正常，一上手机就废了。
   * 所以必须运行时查询，并把它写进着色器的 uniform。
   */
  pointSizeLimit: number;
}

let cached: ProbeResult | null = null;

export function probe(): ProbeResult {
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) {
    cached = { webgl2: false, renderer: "none", maxTextureSize: 0, pointSizeLimit: 1 };
    return cached;
  }

  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;

  cached = {
    webgl2: true,
    renderer,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    pointSizeLimit: range ? Math.max(1, Math.min(range[1], 64)) : 64,
  };

  // 探测用的 context 要主动释放，否则会占用一个 WebGL 上下文名额
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return cached;
}

/** 是否开启「减少动态效果」 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 触屏 / 粗指针设备 */
export function isCoarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

export interface QualityPreset {
  label: string;
  /** 实际绘制的粒子数（通过 setDrawRange 控制，不必生成多份数据） */
  points: number;
  /** 设备像素比上限。移动端头号性能杀手就是 dpr = 3 */
  maxPixelRatio: number;
  dof: boolean;
  cameraNoise: boolean;
  /** 过渡期扰动强度 */
  jitter: number;
  /** 点的基础世界尺寸 */
  pointSize: number;
}

export const PRESETS: Record<Tier, QualityPreset> = {
  high: {
    label: "高",
    points: 80000,
    maxPixelRatio: 2,
    dof: true,
    cameraNoise: true,
    jitter: 7,
    pointSize: 0.14,
  },
  medium: {
    label: "中",
    points: 34000,
    maxPixelRatio: 1.5,
    dof: true,
    cameraNoise: false,
    jitter: 5,
    pointSize: 0.19,
  },
  low: {
    label: "低",
    points: 12000,
    maxPixelRatio: 1,
    dof: false,
    cameraNoise: false,
    jitter: 0,
    pointSize: 0.3,
  },
};

/** 启动时按静态特征选一个初始档位 */
export function pickInitialTier(p: ProbeResult): Tier {
  if (!p.webgl2) return "low";
  const dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const coarse = isCoarsePointer();

  if (coarse || cores <= 4 || mem <= 4 || dpr > 2.5) return "medium";
  return "high";
}

/**
 * 运行期自适应降档。
 * 只降不升 —— 反复升降会造成画质闪烁，比一直用低档更糟。
 */
export class AdaptiveQuality {
  private degradedAt = 0;
  private readonly thresholdMs = 21; // 约 47fps 以下视为不达标
  private readonly holdMs = 2500;

  constructor(private tier: Tier) {}

  get current(): Tier {
    return this.tier;
  }

  /** 每帧调用，返回 true 表示刚刚发生了降档 */
  update(frameMs: number, now: number): boolean {
    if (this.tier === "low") return false;
    if (frameMs < this.thresholdMs) {
      this.degradedAt = 0;
      return false;
    }
    if (this.degradedAt === 0) {
      this.degradedAt = now;
      return false;
    }
    if (now - this.degradedAt < this.holdMs) return false;

    this.tier = this.tier === "high" ? "medium" : "low";
    this.degradedAt = 0;
    return true;
  }
}
