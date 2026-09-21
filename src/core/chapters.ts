/**
 * 章节状态机 —— enter / hold / exit 三段式。
 *
 * 旧实现用 `sin(local × π)` 算聚合强度，曲线两端都是 0，
 * 于是**每到一个章节边界，模型必然完全溶解回隧道**：
 * 你从来没能"持住"一个成形的物体，只看到一次闪烁。
 *
 * 现在每章有三段，morph 在 hold 窗口内锁死在 1：
 *
 *   morph
 *   1 ┤        ┌────────────┐
 *     │      ╱                ╲
 *   0 ┤────╱                    ╲────
 *     └──┬──────┬────────┬──────┬──→ progress
 *      range[0] hold[0]  hold[1] range[1]
 *       enter     hold      exit
 *
 * 另外两处修正：
 *   - 末章 dissolve: false，形态保持到 progress = 1（旧版此处 morph 会突跳归零）
 *   - 末章 fadeOut: 0，文案不会在终点淡成透明（旧版最后一屏是空的）
 */

import { CHAPTERS, chapterAt } from "../config/chapters.config";
import type { Chapter, ShapeSpec } from "../config/chapters.config";
import { clamp, lerp, smoothstep } from "./clock";

const TAU = Math.PI * 2;

/** 飞行途中（没有形状时）的光圈，深焦 —— 飞行阶段希望整片都看得清 */
const AMBIENT_APERTURE = 0.3;

export interface ChapterVisual {
  chapter: Chapter;
  index: number;
  /** 文案层不透明度 */
  opacity: number;
  /** 该章的聚合强度 */
  morph: number;
  /** 是否正处于停留窗口 */
  holding: boolean;
}

/** 单章的聚合强度曲线 */
function morphFor(chapter: Chapter, p: number): number {
  if (!chapter.shape) return 0;

  const [start, end] = chapter.range;
  const [holdStart, holdEnd] = chapter.hold;

  if (p <= start) return 0;
  if (p < holdStart) return smoothstep(start, holdStart, p);
  if (p <= holdEnd) return 1;
  if (!chapter.dissolve) return 1; // 末章：一直保持成形
  if (p >= end) return 0;
  return 1 - smoothstep(holdEnd, end, p);
}

/** 单章的文案不透明度。注意 fadeOut = 0 表示**永不淡出**，不是"立刻消失" */
function opacityFor(chapter: Chapter, p: number): number {
  const [start, end] = chapter.range;
  const fadeIn = chapter.fadeIn > 0 ? smoothstep(start, start + chapter.fadeIn, p) : p >= start ? 1 : 0;
  const fadeOut = chapter.fadeOut > 0 ? 1 - smoothstep(end - chapter.fadeOut, end, p) : 1;
  return clamp(fadeIn * fadeOut, 0, 1);
}

export interface SceneState {
  progress: number;
  /** 当前章节（用于读数、导航高亮） */
  active: Chapter;
  activeIndex: number;
  /** 当前生效的聚合强度（取所有章节中的最大者） */
  morph: number;
  /** 正在聚合的形状；隧道段为 null */
  shape: ShapeSpec | null;
  /** 景深光圈，随 morph 在「深焦」与「该章浅焦」之间过渡 */
  aperture: number;
  /** 强调色与混合强度 */
  accent: number;
  accentMix: number;
  /** 形状自转角（弧度）。依赖 progress 而非时间累加 —— 这样往回滚能精确复原 */
  spin: number;
  visuals: ChapterVisual[];
}

export class ChapterMachine {
  private readonly visuals: ChapterVisual[] = CHAPTERS.map((chapter, index) => ({
    chapter,
    index,
    opacity: 0,
    morph: 0,
    holding: false,
  }));

  /** 上一帧的形态标识，用来检测"形状换了"这件事 */
  private lastShapeSrc: string | null = null;

  constructor(private readonly onShapeChange?: (src: string | null) => void) {}

  evaluate(progress: number, elapsed: number): SceneState {
    let bestMorph = 0;
    let bestChapter: Chapter | null = null;

    for (const visual of this.visuals) {
      const { chapter } = visual;
      visual.opacity = opacityFor(chapter, progress);
      visual.morph = morphFor(chapter, progress);
      visual.holding = progress >= chapter.hold[0] && progress <= chapter.hold[1];
      if (visual.morph > bestMorph) {
        bestMorph = visual.morph;
        bestChapter = chapter;
      }
    }

    const active = chapterAt(progress);
    const shapeChapter = bestChapter ?? active;
    const shape = bestMorph > 0.001 ? shapeChapter.shape : null;

    const shapeSrc = shape?.src ?? null;
    if (shapeSrc !== this.lastShapeSrc) {
      this.lastShapeSrc = shapeSrc;
      this.onShapeChange?.(shapeSrc);
    }

    // 自转：以本章区间起点为基准，保证来回滚动时朝向一致。
    // 末尾那一小项是极慢的环境自转（约 21 秒一圈），给出"活着"的感觉，
    // 但幅度小到往回滚时察觉不到不可逆。
    const spinBase = shapeChapter.shape?.spin ?? 0;
    const spin =
      spinBase * TAU * (progress - shapeChapter.range[0]) + elapsed * 0.06 * bestMorph;

    return {
      progress,
      active,
      activeIndex: CHAPTERS.indexOf(active),
      morph: bestMorph,
      shape,
      aperture: lerp(AMBIENT_APERTURE, shapeChapter.aperture, bestMorph),
      accent: shapeChapter.shape?.accent ?? 0xffffff,
      accentMix: (shapeChapter.shape?.accentMix ?? 0) * bestMorph,
      spin,
      visuals: this.visuals,
    };
  }
}
