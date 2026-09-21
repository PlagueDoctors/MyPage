/**
 * 色彩令牌 —— 单一真相源，同时供 WebGL 层与 DOM 层使用。
 *
 * 方向参考 experience.staratlas.com：刻意远离传统「暗黑科幻」，
 * 用明快的青 / 紫 / 珊瑚色，只在背景保留极深的冷调底色（加色混合需要暗底）。
 */

export const BACKGROUND = 0x01020a;

/** 粒子基础色板。加载时随机分配给每个粒子，写在 aColor 属性里。 */
export const PARTICLE_PALETTE = [
  0x9ecbff, // 冷蓝
  0xc9b6ff, // 淡紫
  0x7fe3d4, // 青绿
  0xe6ecff, // 近白
  0x9fb4ff, // 靛蓝
  0xd6c2ff, // 藕紫
  0x86d8ff, // 天青
] as const;

/** 环境尘埃（不参与聚合的那部分粒子）的额外压暗系数 */
export const AMBIENT_DIM = 0.55;

/** DOM 层用到的设计令牌，由 main.ts 注入到 :root */
export const CSS_TOKENS: Record<string, string> = {
  "--bg": "#01020a",
  "--ink": "#eaf0ff",
  "--ink-dim": "#9aa7c4",
  "--ink-faint": "#5b6684",
  "--line": "rgba(154, 167, 196, 0.22)",
  "--line-strong": "rgba(154, 167, 196, 0.42)",
  "--accent": "#9ecbff",
};
