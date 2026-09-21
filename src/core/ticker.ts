/**
 * 渲染循环。
 *
 * 两个要点：
 *   1. 页面不可见时暂停 rAF —— 后台标签页不该继续烧 GPU
 *   2. 维护滚动平均帧时间，用于自适应降档（见 quality tier）
 */

export type FrameCallback = (dt: number, now: number) => void;

export interface TickerStats {
  /** 最近若干帧的平均帧时间（毫秒） */
  frameMs: number;
  fps: number;
}

export class Ticker {
  private handle = 0;
  private running = false;
  private lastTime = 0;
  private samples: number[] = [];
  private readonly sampleSize = 45;
  private pausedAt = 0;

  private stats: TickerStats = { frameMs: 16.7, fps: 60 };
  private onVisibilityChange = () => {
    if (document.hidden) {
      this.pausedAt = performance.now();
    } else if (this.running) {
      // 恢复时重置时间基准，否则 dt 会是一个巨大的值
      this.lastTime = performance.now();
      void this.pausedAt;
    }
  };

  constructor(private readonly onFrame: FrameCallback) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.samples = [];
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.handle = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  get current(): TickerStats {
    return this.stats;
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.loop);

    const rawMs = now - this.lastTime;
    this.lastTime = now;

    // 采样（排除切标签页后那种荒谬的间隔）
    if (rawMs > 0 && rawMs < 500) {
      this.samples.push(rawMs);
      if (this.samples.length > this.sampleSize) this.samples.shift();
      if (this.samples.length === this.sampleSize) {
        const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        this.stats = { frameMs: avg, fps: avg > 0 ? 1000 / avg : 0 };
      }
    }

    const dt = Math.min(rawMs / 1000, 1 / 20);
    this.onFrame(dt, now);
  };
}
