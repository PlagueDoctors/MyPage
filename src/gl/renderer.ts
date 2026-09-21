/**
 * 渲染舞台：渲染器 / 场景 / 相机 / resize。
 *
 * 与旧实现相比的几点差异：
 *   · DPR 按质量档位钳制 —— 移动端 dpr = 3 是头号性能杀手
 *   · 提供了 sizeScale()，把「点的世界尺寸」换算成像素，供着色器用
 *   · 显式 dispose，避免热重载时泄漏 WebGL 上下文
 */

import { PerspectiveCamera, Scene, WebGLRenderer, type Vector3 } from "three";
import { BACKGROUND } from "../config/palette";
import type { QualityPreset } from "../core/device";

export interface StageOptions {
  canvas: HTMLCanvasElement;
  preset: QualityPreset;
  /** 起始 fov，之后由 CameraRig 每帧驱动 */
  fov: number;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  private preset: QualityPreset;

  constructor(options: StageOptions) {
    const { canvas, preset, fov } = options;
    this.preset = preset;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // 点云是软圆盘，MSAA 收益极低而开销明显
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(BACKGROUND, 1);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(0, 0, 34);
  }

  /**
   * 世界空间尺寸 → 像素尺寸的换算系数。
   *
   * 对世界空间直径为 S、距离为 d 的点：
   *   像素直径 = S · H / (2·tan(fov/2)) / d
   * 于是 uSizeScale = H / (2·tan(fov/2))，uSize 就是纯粹的"世界尺寸"，
   * 与画布大小、DPR、fov 全部解耦 —— 换设备不用重新调参数。
   */
  sizeScale(fovDegrees: number): number {
    const heightPx = this.renderer.getContext().drawingBufferHeight;
    const halfFov = (fovDegrees * Math.PI) / 360;
    return heightPx / (2 * Math.tan(halfFov));
  }

  applyPreset(preset: QualityPreset): void {
    this.preset = preset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.resize();
  }

  get quality(): QualityPreset {
    return this.preset;
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // 第三个参数 false：不让 three 去写 canvas 的 style，尺寸完全交给 CSS
    this.renderer.setSize(width, height, false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 供相机机位使用的最小接口，避免 CameraRig 直接依赖 three 的完整 Camera 类型 */
  get cameraLike(): {
    position: Vector3;
    fov: number;
    lookAt: (v: Vector3) => void;
    rotateZ: (a: number) => void;
    updateProjectionMatrix: () => void;
  } {
    return this.camera;
  }

  dispose(): void {
    this.renderer.dispose();
    this.scene.clear();
    this.renderer.forceContextLoss();
  }
}
