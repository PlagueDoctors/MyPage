/**
 * ★ 唯一真相源 ★
 * ================
 * 章节文案、时间轴区间、停留窗口、镜头关键帧、粒子形状、景深、配色 —— 全部在这一个文件里。
 *
 * 改这里，页面文案、导航、读数、粒子行为、相机运动**同时**更新。
 * 这是对旧实现最核心的修复：旧版把同一份时序拆在
 *   index.html 的 data-start/data-end
 *   particle-experience.js 的 MODEL_CHAPTERS
 *   particle-experience.js 的 CHAPTER_BOUNDARIES
 * 三处，任何一处漏改都会静默不一致。现在由 config/validate.ts 在开发期直接断言。
 *
 * ── 时间轴约定 ────────────────────────────────────────────────
 * 所有位置都是 progress ∈ [0, 1] 上的归一化坐标，与像素和秒都无关。
 *   range  该章占据的区间，必须首尾相接、无缝隙、无重叠、整体覆盖 [0, 1]
 *   hold   停留窗口（必须被 range 包含）。这段时间里 uMorph 锁在 1，形状是**稳定的**，
 *          不像旧实现那样每个边界都溶解回隧道。
 *   fadeIn / fadeOut  文案淡入淡出的绝对时长。fadeOut = 0 表示永不淡出 ——
 *          末章用这个，避免出现「滚到底最后一屏是空的」。
 */

export type Vec3 = [number, number, number];

export interface ShapeSpec {
  /** public/pointcloud/<src>.bin */
  src: string;
  /** 形状在世界空间的整体缩放（局部坐标已被离线管线归一化到半径 1） */
  scale: number;
  /** 停留期内的自转速率，单位：弧度 / 整段 progress */
  spin: number;
  /** 形状在世界空间的位置 */
  position: Vec3;
  /** 聚合完成时粒子染上的强调色 */
  accent: number;
  /** 强调色混合强度 0–1 */
  accentMix: number;
}

export interface Chapter {
  /** 用于 #锚点深链与 DOM id */
  id: string;
  /** 章节序号，如 "01" */
  index: string;
  /** 导航上的短标签 */
  navLabel: string;
  /** 大标题 */
  title: string;
  /** 正文 */
  body: string;
  range: [number, number];
  hold: [number, number];
  fadeIn: number;
  fadeOut: number;
  /** 景深光圈强度：越大越虚化。隧道章用较小值（深焦），形状章用较大值（浅焦） */
  aperture: number;
  /**
   * 离开本章时是否溶解回自由隧道。
   * true  —— 形状在离场段散开（多数章节）
   * false —— 形状一直保持成形到区间末尾（末章用，让整段旅程停在一个稳定的画面上）
   *
   * 旧实现的 bug 就在这儿：判断写成 `value >= chapter.end` 就跳过，而末章 end = 1、
   * progress 又会被 Math.min(1, …) 恰好钳到 1，于是 morph 从接近 1 瞬间跳到 0，
   * 末端粒子突然炸开。
   */
  dissolve: boolean;
  /** null 表示该章只有自由隧道，不聚合任何形状 */
  shape: ShapeSpec | null;
}

export interface CameraKey {
  at: number;
  pos: Vec3;
  look: Vec3;
  fov: number;
}

/**
 * 四个章节。
 * 注意 range 首尾相接：0→0.20→0.48→0.72→1.00，末章 range[1] 必须是 1。
 */
export const CHAPTERS: readonly Chapter[] = [
  {
    id: "void",
    index: "01",
    navLabel: "Void",
    title: "Enter the void",
    body: "滚动穿过粒子空间。每一章会停在一个形状上 —— 那是我的某一面。",
    range: [0.0, 0.2],
    hold: [0.03, 0.15],
    fadeIn: 0.025,
    fadeOut: 0.03,
    aperture: 0.3,
    dissolve: true,
    shape: null,
  },
  {
    id: "field",
    index: "02",
    navLabel: "Field",
    title: "The field",
    body: "这里是自我介绍段落的占位文案。写下你是谁、在做什么，以及为什么做。",
    range: [0.2, 0.48],
    hold: [0.26, 0.42],
    fadeIn: 0.035,
    fadeOut: 0.035,
    aperture: 0.62,
    dissolve: true,
    shape: {
      src: "sphere",
      scale: 15,
      spin: 1.15,
      position: [0, 0, -112],
      accent: 0x58e0c8,
      accentMix: 0.55,
    },
  },
  {
    id: "craft",
    index: "03",
    navLabel: "Craft",
    title: "The craft",
    body: "这里是作品段落的占位文案。挑两三件真正想被看到的事，其余交给链接。",
    range: [0.48, 0.72],
    hold: [0.53, 0.67],
    fadeIn: 0.03,
    fadeOut: 0.03,
    aperture: 0.68,
    dissolve: true,
    shape: {
      src: "knot",
      scale: 15,
      spin: -0.95,
      position: [0, 0, -232],
      accent: 0xb48cff,
      accentMix: 0.6,
    },
  },
  {
    id: "signal",
    index: "04",
    navLabel: "Signal",
    title: "The signal",
    body: "这里是联系方式段落的占位文案。邮箱、GitHub、或者一个你想让人点进去的链接。",
    range: [0.72, 1.0],
    hold: [0.78, 0.94],
    fadeIn: 0.03,
    // 末章不淡出 —— 否则 progress 恰好等于 1 时最后一屏是空的
    fadeOut: 0,
    aperture: 0.42,
    // 末章不溶解：滚到底时形状依然成形，整段旅程停在一个稳定的画面上
    dissolve: false,
    shape: {
      src: "disc",
      scale: 20,
      spin: 0.5,
      position: [0, 0, -352],
      accent: 0xffb26b,
      accentMix: 0.5,
    },
  },
] as const;

/**
 * 相机飞行轨道。整段旅程从 z = +34 一路飞到 z ≈ -350，
 * 每一章在对应的形状附近减速、环绕、再加速离开。
 *
 * 这是旧实现最明显的缺失：旧版相机恒在原点，隧道感 100% 靠粒子位移，
 * 没有 dolly、没有视差、没有焦点迁移，所以更像屏保而不是穿越。
 */
export const CAMERA_TRACK: readonly CameraKey[] = [
  { at: 0.0, pos: [0, 0, 34], look: [0, 0, -60], fov: 76 },
  { at: 0.08, pos: [0, 1, 6], look: [0, 0, -80], fov: 72 },
  { at: 0.14, pos: [0, 0, -34], look: [0, 0, -100], fov: 70 },
  { at: 0.2, pos: [10, 6, -62], look: [0, 0, -112], fov: 62 },
  { at: 0.28, pos: [23, 10, -78], look: [0, 0, -112], fov: 58 },
  { at: 0.4, pos: [-16, -8, -66], look: [0, 0, -112], fov: 64 },
  { at: 0.48, pos: [-8, -4, -150], look: [0, 0, -232], fov: 68 },
  { at: 0.56, pos: [16, 9, -190], look: [0, 0, -232], fov: 58 },
  { at: 0.66, pos: [-14, 11, -196], look: [0, 0, -232], fov: 62 },
  { at: 0.72, pos: [4, 6, -276], look: [0, 0, -340], fov: 70 },
  // 末章是平躺的盘状星系：相机必须抬到盘面之上才看得到椭圆，
  // 否则从盘面内看过去只剩一条线。这也是"飞入 → 拉升俯视"这个 reveal 的来源。
  { at: 0.8, pos: [20, 26, -300], look: [0, 0, -352], fov: 60 },
  { at: 0.92, pos: [-17, 22, -306], look: [0, 0, -352], fov: 64 },
  { at: 1.0, pos: [0, 24, -302], look: [0, 0, -356], fov: 72 },
] as const;

/** 叙事读数的总量程（光年）。向参考站点的 622107.238 LIGHTYEAR 致意。 */
export const INSTRUMENT_TOTAL_LY = 6.221;

/** 读取某个 progress 落在哪一章 */
export function chapterAt(progress: number): Chapter {
  for (const chapter of CHAPTERS) {
    if (progress >= chapter.range[0] && progress < chapter.range[1]) return chapter;
  }
  return CHAPTERS[CHAPTERS.length - 1];
}

/** 该 progress 的章节序号（1 起） */
export function chapterNumberAt(progress: number): number {
  return CHAPTERS.indexOf(chapterAt(progress)) + 1;
}
