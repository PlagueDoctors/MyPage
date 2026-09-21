/**
 * 滚动时间轴 —— 本次重构替换掉旧「惯性飞轮」的地方。
 *
 * 旧实现的模型：
 *   wheel 事件 → velocity += deltaY * SENSITIVITY → 每帧 progress += velocity（无 dt 归一化）
 *   为了让章节边界「有停顿感」，又加了一个 hack：边界 ±4.5% 内灵敏度 ×8。
 *   结果：手感随帧率漂移、Firefox 与 Chrome 相差约 30 倍（deltaMode 未归一化）、
 *   键盘不可用、读屏器不可用、JS 一挂就是全黑屏。
 *
 * 现在的模型：
 *   原生滚动 → raw ∈ [0,1] → warp() 重映射 → dt 归一化阻尼 → progress
 *
 * warp() 是替代那个 hack 的正解：它把「停留窗口占更多滚动距离」这件事
 * 表达成时间轴结构自身的属性，而不是在边界附近硬调灵敏度。
 */

import { CHAPTERS } from "../config/chapters.config";
import { damp, clamp } from "./clock";

/**
 * 停留段的滚动权重倍率 —— 整个体验手感的主旋钮。
 *
 * 含义：hold 区间内每单位时间轴长度，分到 base 的多少倍滚动距离。
 *   1.0  → 完全线性的滚动，没有停顿感
 *   1.45 → 停留段吃掉约 2/3 的滚动行程，形状看得清、过渡又不拖沓（当前值）
 *   3.0  → 几乎"粘"在每一章上，过渡会很仓促
 */
const HOLD_SCROLL_BOOST = 1.45;

interface Segment {
  /** 时间轴上的起止 */
  pA: number;
  pB: number;
  /** 对应的滚动份额起止，均在 [0,1] */
  uA: number;
  uB: number;
}

/** 把章节配置展开成「时间轴 ↔ 滚动」的分段线性映射 */
function buildSegments(): Segment[] {
  const raw: Array<{ pA: number; pB: number; weight: number }> = [];

  for (const chapter of CHAPTERS) {
    const [start, end] = chapter.range;
    const [holdStart, holdEnd] = chapter.hold;
    // 章节结构可能退化成没有停留段，用 clamp 兜住
    const enterEnd = clamp(holdStart, start, end);
    const exitStart = clamp(holdEnd, enterEnd, end);

    if (enterEnd > start) raw.push({ pA: start, pB: enterEnd, weight: (enterEnd - start) * 1.0 });
    if (exitStart > enterEnd) {
      raw.push({ pA: enterEnd, pB: exitStart, weight: (exitStart - enterEnd) * HOLD_SCROLL_BOOST });
    }
    if (end > exitStart) raw.push({ pA: exitStart, pB: end, weight: (end - exitStart) * 1.0 });
  }

  const totalWeight = raw.reduce((sum, s) => sum + s.weight, 0) || 1;
  const segments: Segment[] = [];
  let u = 0;
  for (const s of raw) {
    const share = s.weight / totalWeight;
    segments.push({ pA: s.pA, pB: s.pB, uA: u, uB: u + share });
    u += share;
  }
  return segments;
}

export class ScrollTimeline {
  private readonly segments = buildSegments();
  private progress = 0;
  private target = 0;
  /** 是否已经收到过第一次滚动输入（用来决定是否隐藏提示） */
  private engaged = false;

  /** 阻尼系数，单位 1/秒。6 左右收敛约 0.17 秒 —— 有惯性，但不拖沓 */
  private readonly lambda = 6.2;

  constructor(private readonly onEngage?: () => void) {}

  /** 物理滚动位置，未做任何加工 */
  private rawScroll(): number {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 1) return 0;
    return clamp(window.scrollY / max, 0, 1);
  }

  /** 滚动空间 → 时间轴空间 */
  warp(u: number): number {
    const segs = this.segments;
    if (segs.length === 0) return 0;
    if (u <= 0) return segs[0].pA;
    if (u >= 1) return segs[segs.length - 1].pB;
    for (const s of segs) {
      if (u < s.uB || s === segs[segs.length - 1]) {
        const span = s.uB - s.uA || 1;
        const k = (u - s.uA) / span;
        return s.pA + k * (s.pB - s.pA);
      }
    }
    return 1;
  }

  /** 时间轴空间 → 滚动空间（导航点击、键盘跳章用） */
  unwarp(p: number): number {
    const segs = this.segments;
    if (segs.length === 0) return 0;
    const t = clamp(p, 0, 1);
    for (const s of segs) {
      if (t <= s.pB || s === segs[segs.length - 1]) {
        const span = s.pB - s.pA || 1;
        const k = (t - s.pA) / span;
        return clamp(s.uA + k * (s.uB - s.uA), 0, 1);
      }
    }
    return 1;
  }

  /** 把页面滚动到某个时间轴位置 */
  scrollToProgress(p: number, smooth = true): void {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 1) return;
    window.scrollTo({
      top: this.unwarp(p) * max,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  /** 每帧调用，返回当前（阻尼后的）progress */
  update(dt: number): number {
    const raw = this.rawScroll();
    this.target = this.warp(raw);

    if (!this.engaged && raw > 0.001) {
      this.engaged = true;
      this.onEngage?.();
    }

    this.progress = damp(this.progress, this.target, this.lambda, dt);
    return this.progress;
  }

  /**
   * 首帧对齐。
   * 刷新时浏览器会恢复滚动位置，如果从 0 慢慢阻尼过去，
   * 用户会看到一段莫名其妙的"从开头飞过来"。启动时直接吸附到当前位置。
   */
  prime(): void {
    this.target = this.warp(this.rawScroll());
    this.progress = this.target;
  }

  get value(): number {
    return this.progress;
  }

  get goal(): number {
    return this.target;
  }

  /** 用于读数与调试：当前滚动份额 */
  get raw(): number {
    return this.rawScroll();
  }

  /** 供开发期断言使用，暴露分段结构 */
  get debugSegments(): readonly Segment[] {
    return this.segments;
  }
}
