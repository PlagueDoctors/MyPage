/**
 * 相机轨道。
 *
 * 旧实现里 camera.position 恒为 (0,0,0) —— 隧道感 100% 来自粒子位移，
 * 没有 dolly、没有视差、没有焦点迁移，只有 camera.rotation.z 摆 ±0.02 弧度。
 * 这就是它更像屏保而不像穿越的原因。参考站点的核心手感恰恰是"相机领着走"。
 *
 * 这里用非均匀节点的 Catmull-Rom 插值穿过所有关键帧：
 *   · 线性插值会在每个关键帧处速度突变，相机看起来会"顿一下"
 *   · 三次样条会过冲，可能把相机甩到隧道外面
 *   · Catmull-Rom 一阶导连续、严格过点、不过冲 —— 正合适
 */

import { CatmullRomCurve3, Vector3 } from "three";
import { CAMERA_TRACK } from "../config/chapters.config";
import { catmullRom, driftNoise } from "../core/clock";

/** 足迹表精度：用于累加相机实际飞过的弧长，喂给叙事读数 */
const ARC_SAMPLES = 720;

export interface CameraSample {
  position: Vector3;
  look: Vector3;
  fov: number;
}

export class CameraRig {
  private readonly times: number[] = CAMERA_TRACK.map((k) => k.at);
  private readonly pxX: number[] = CAMERA_TRACK.map((k) => k.pos[0]);
  private readonly pxY: number[] = CAMERA_TRACK.map((k) => k.pos[1]);
  private readonly pxZ: number[] = CAMERA_TRACK.map((k) => k.pos[2]);
  private readonly lookX: number[] = CAMERA_TRACK.map((k) => k.look[0]);
  private readonly lookY: number[] = CAMERA_TRACK.map((k) => k.look[1]);
  private readonly lookZ: number[] = CAMERA_TRACK.map((k) => k.look[2]);
  private readonly fovs: number[] = CAMERA_TRACK.map((k) => k.fov);

  /** 弧长累积表，arc[i] = 从起点到第 i 个采样的累计距离 */
  private readonly arc: Float64Array = new Float64Array(ARC_SAMPLES + 1);
  readonly totalLength: number;

  private readonly position = new Vector3();
  private readonly look = new Vector3();

  /** 供外部读取的上一次采样（用于算焦距） */
  readonly currentPosition = new Vector3();
  readonly currentLook = new Vector3();
  currentFov = 70;
  /** 相机到对焦点的距离 —— 直接喂给 uFocal，不需要手工配置对焦点 */
  focalDistance = 80;

  constructor() {
    // 预计算弧长。用一个临时曲线对象只是图方便，实际插值走 catmullRom()。
    const control = CAMERA_TRACK.map((k) => new Vector3(k.pos[0], k.pos[1], k.pos[2]));
    const curve = new CatmullRomCurve3(control, false, "catmullrom", 0.5);
    const scratch = new Vector3();
    let acc = 0;
    const samples = ARC_SAMPLES;
    for (let i = 0; i <= samples; i++) {
      // 注意：这里只用于"总里程"的粗略估计，参数化与实际关键帧时间不同步，
      // 所以下面 traveled() 用的仍是关键帧之间的真实距离。
      const p = curve.getPoint(i / samples, scratch);
      if (i > 0) acc += p.distanceTo(scratch);
      this.arc[i] = acc;
    }
    this.totalLength = Math.max(acc, 1);
    this.arcLengthTable();
  }

  /** 按关键帧时间重建弧长表，保证读数与实际 progress 严格对应 */
  private arcLengthTable(): void {
    this.arc[0] = 0;
    let acc = 0;
    let prevX = this.pxX[0];
    let prevY = this.pxY[0];
    let prevZ = this.pxZ[0];
    const step = 1 / ARC_SAMPLES;
    for (let i = 1; i <= ARC_SAMPLES; i++) {
      const t = i * step;
      const x = catmullRom(this.times, this.pxX, t);
      const y = catmullRom(this.times, this.pxY, t);
      const z = catmullRom(this.times, this.pxZ, t);
      acc += Math.hypot(x - prevX, y - prevY, z - prevZ);
      this.arc[i] = acc;
      prevX = x;
      prevY = y;
      prevZ = z;
    }
  }

  /** 到 progress 为止相机实际飞过的距离 */
  traveled(progress: number): number {
    const t = Math.min(Math.max(progress, 0), 1);
    const x = t * ARC_SAMPLES;
    const i = Math.floor(x);
    const frac = x - i;
    const a = this.arc[Math.min(i, ARC_SAMPLES)];
    const b = this.arc[Math.min(i + 1, ARC_SAMPLES)];
    return a + (b - a) * frac;
  }

  /** 纯插值，不含噪声 —— 结果写入 this.position / this.look */
  private interpolate(progress: number): void {
    const t = progress;
    this.position.set(
      catmullRom(this.times, this.pxX, t),
      catmullRom(this.times, this.pxY, t),
      catmullRom(this.times, this.pxZ, t)
    );
    this.look.set(
      catmullRom(this.times, this.lookX, t),
      catmullRom(this.times, this.lookY, t),
      catmullRom(this.times, this.lookZ, t)
    );
    this.currentFov = catmullRom(this.times, this.fovs, t);
  }

  /**
   * 更新相机。
   * @param noise 是否叠加手持噪声（低端设备关掉，省一点点算术也省掉视觉抖动）
   */
  update(camera: { position: Vector3; fov: number; lookAt: (v: Vector3) => void; rotateZ: (a: number) => void; updateProjectionMatrix: () => void }, progress: number, elapsed: number, noise: boolean): void {
    this.interpolate(progress);

    if (noise) {
      // 极低幅度（±0.4 世界单位）的多频漂移，只为消掉"轨道太完美"的机械感
      const a = 0.42;
      this.position.x += driftNoise(elapsed, 0.0) * a;
      this.position.y += driftNoise(elapsed, 2.3) * a;
      this.position.z += driftNoise(elapsed, 4.7) * a * 0.6;
    }

    camera.position.copy(this.position);
    camera.lookAt(this.look);

    // 轻微横滚：让"飞行"有一点倾斜姿态，幅度小到不会引起不适
    const roll = driftNoise(elapsed * 0.35, 1.1) * 0.022 * (noise ? 1 : 0);
    if (roll !== 0) camera.rotateZ(roll);

    if (Math.abs(camera.fov - this.currentFov) > 1e-4) {
      camera.fov = this.currentFov;
      camera.updateProjectionMatrix();
    }

    this.currentPosition.copy(this.position);
    this.currentLook.copy(this.look);
    this.focalDistance = this.position.distanceTo(this.look);
  }
}
