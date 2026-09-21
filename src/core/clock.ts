/**
 * 时间与插值工具。
 *
 * 这里修掉的是旧代码最隐蔽的一个 bug：`progress += velocity` 完全没有 dt 归一化，
 * 于是 144Hz 显示器上整段旅程比 60Hz 快 2.4 倍，30fps 设备上又慢一半。
 * 所有随时间推进的量现在都必须显式乘 dt，或者用下面的帧率无关阻尼。
 */

export const clamp = (x: number, min: number, max: number): number => (x < min ? min : x > max ? max : x);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 三次平滑插值，首尾导数为 0 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * 帧率无关的指数阻尼。
 *
 * 常见错误写法是 `a += (b - a) * 0.1` —— 那是「每帧」衰减 10%，
 * 于是帧率越高追得越快，手感随设备漂移。
 * 用 1 - exp(-λ·dt) 才是真正的「每秒」衰减，λ 的单位是 1/秒。
 *
 * @param lambda 越大追得越快。约 6 时约 0.17 秒收敛到 63%，是有惯性但不拖沓的手感。
 */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

/**
 * 单调时钟。
 * 关键是 dt 上界钳制：切回标签页、系统休眠唤醒时 rAF 的相邻时间戳可能差好几秒，
 * 不钳制的话所有插值会瞬间跳变（画面"闪一下"）。
 */
export class Clock {
  private last = 0;
  private elapsed = 0;
  /** 单帧 dt 上限（秒）。20fps 对应的值，低于此值的卡顿会被如实反映，高于此值的会被裁掉 */
  readonly maxDelta = 1 / 20;

  start(now: number): void {
    this.last = now;
    this.elapsed = 0;
  }

  /** 返回本帧 dt（秒），已钳制且非负 */
  tick(now: number): number {
    if (this.last === 0) {
      this.last = now;
      return 0;
    }
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = clamp(raw, 0, this.maxDelta);
    this.elapsed += dt;
    return dt;
  }

  get seconds(): number {
    return this.elapsed;
  }

  /** 页面从后台恢复时调用，丢弃这段"黑洞时间" */
  resync(now: number): void {
    this.last = now;
  }
}

/**
 * 一维 Catmull-Rom 插值（非均匀节点）。
 *
 * 用它而不是线性插值的原因：线性插值在每个关键帧处速度突变，相机看起来会"顿一下"。
 * Catmull-Rom 保证一阶导连续，穿过所有关键帧且不会像三次样条那样过冲。
 *
 * @param times 关键帧位置，严格递增
 * @param values 与 times 等长的数值序列
 */
export function catmullRom(times: readonly number[], values: readonly number[], t: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1 || t <= times[0]) return values[0];
  if (t >= times[n - 1]) return values[n - 1];

  // 找到 t 所在的区间
  let i = 0;
  while (i < n - 2 && t >= times[i + 1]) i++;

  const t0 = times[i];
  const t1 = times[i + 1];
  const span = t1 - t0 || 1;
  const s = (t - t0) / span;

  // 端点用单侧差分代替中心差分，避免越界
  const v0 = values[i];
  const v1 = values[i + 1];
  const vPrev = i > 0 ? values[i - 1] : v0;
  const vNext = i < n - 2 ? values[i + 2] : v1;
  const tPrev = i > 0 ? times[i - 1] : t0 - span;
  const tNext = i < n - 2 ? times[i + 2] : t1 + span;

  const m0 = ((v1 - vPrev) / (t1 - tPrev || 1)) * span;
  const m1 = ((vNext - v0) / (tNext - t0 || 1)) * span;

  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;

  return h00 * v0 + h10 * m0 + h01 * v1 + h11 * m1;
}

/** 低频漂浮噪声，给相机加一点手持感。三层不同频率的正弦叠加。 */
export function driftNoise(t: number, phase: number): number {
  return (
    Math.sin(t * 0.31 + phase) * 0.55 +
    Math.sin(t * 0.73 + phase * 1.7) * 0.3 +
    Math.sin(t * 1.19 + phase * 0.4) * 0.15
  );
}
