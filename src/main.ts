/**
 * 引导与主循环。
 *
 * 启动顺序刻意设计成「先确保内容可读，再决定要不要上 3D」：
 *   1. 无条件把章节文案渲染进 DOM（无论后面发生什么，内容都在）
 *   2. 探测能力。不达标 → 停在静态模式，什么都不用回滚
 *   3. 达标 → 显示预加载器，拉数据，建场景，切到体验模式
 *
 * 这样"降级"不是一条额外的兜底分支，而是**什么都不做**的结果。
 */

import "./styles/main.css";

import { CAMERA_TRACK, CHAPTERS, chapterAt } from "./config/chapters.config";
import { CSS_TOKENS } from "./config/palette";
import { validateConfig } from "./config/validate";
import { ChapterMachine } from "./core/chapters";
import {
  AdaptiveQuality,
  PRESETS,
  pickInitialTier,
  prefersReducedMotion,
  probe,
  type Tier,
} from "./core/device";
import { ScrollTimeline } from "./core/timeline";
import { Ticker } from "./core/ticker";
import { loadAll, loadManifest } from "./data/pointcloud";
import { CameraRig } from "./gl/camerarig";
import { PointCloud } from "./gl/pointcloud";
import { Stage } from "./gl/renderer";
import { enterExperienceMode, enterStaticMode } from "./ui/fallback";
import { Instrument } from "./ui/instrument";
import { OrbitNav } from "./ui/nav";
import { ChapterOverlay } from "./ui/overlay";
import { Preloader } from "./ui/preloader";

declare global {
  interface Window {
    /** index.html 的引导看门狗读取这个标志 */
    __mypageBooted?: boolean;
  }
}

// 模块一旦开始执行就立刻置位。
// 只要这一行跑到了，就说明构建产物本身是好的 —— 页面若仍然是黑屏，
// 问题在渲染或数据，而不在"脚本根本没被加载"。
// 反过来，这行没跑到，index.html 里的看门狗就会把那份排查说明显示出来。
window.__mypageBooted = true;

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`index.html 缺少 #${id} 容器`);
  return node;
}

/** 深链与跳章都落在停留窗口的正中 —— 那里形状最稳定、文案最清晰 */
function chapterMidpoint(index: number): number {
  const chapter = CHAPTERS[index];
  return (chapter.hold[0] + chapter.hold[1]) / 2;
}

function main(): void {
  // 开发期配置断言。生产构建里这段会被 tree-shake 掉。
  if (import.meta.env.DEV) validateConfig();

  const root = document.documentElement;
  for (const [key, value] of Object.entries(CSS_TOKENS)) root.style.setProperty(key, value);
  root.style.setProperty("--chapter-count", String(CHAPTERS.length));

  // ── 1. 内容先行 ─────────────────────────────────────────────
  const overlay = new ChapterOverlay(el("chapters"));
  const preloader = new Preloader(el("preloader"));
  const instrument = new Instrument(el("instrument"));
  const hint = el("hint");

  let timeline: ScrollTimeline | null = null;

  const jumpTo = (index: number, smooth = true) => {
    const clamped = Math.max(0, Math.min(index, CHAPTERS.length - 1));
    if (timeline) {
      timeline.scrollToProgress(chapterMidpoint(clamped), smooth);
    } else {
      // 静态模式下章节在正常文档流里，原生滚动就够了
      overlay.elementFor(clamped)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  };

  const nav = new OrbitNav(el("orbit"), (index) => {
    history.replaceState(null, "", `#chapter-${CHAPTERS[index].id}`);
    jumpTo(index);
  });

  // ── 2. 能力探测 ─────────────────────────────────────────────
  const probeResult = probe();
  if (!probeResult.webgl2) {
    enterStaticMode("no-webgl2");
    return;
  }
  if (prefersReducedMotion()) {
    enterStaticMode("reduced-motion");
    return;
  }

  // ── 3. 进入体验 ─────────────────────────────────────────────
  root.dataset.mode = "loading";
  void startExperience();

  async function startExperience(): Promise<void> {
    const initialTier = pickInitialTier(probeResult);
    let preset = PRESETS[initialTier];

    const shapeNames = [
      ...new Set(
        CHAPTERS.map((chapter) => chapter.shape?.src).filter((src): src is string => typeof src === "string")
      ),
    ];
    const names = ["field", ...shapeNames];

    let loaded;
    try {
      preloader.setStatus("正在载入粒子场");
      const manifest = await loadManifest();
      loaded = await loadAll(names, manifest, (bytesLoaded, total) => {
        preloader.setProgress(bytesLoaded, total);
      });
    } catch (error) {
      console.error("[mypage] 点云加载失败：", error);
      preloader.showFailure("粒子资源加载失败", "已切换到精简版，全部内容仍然可读。");
      enterStaticMode("load-failed");
      await preloader.dismiss();
      return;
    }

    const field = loaded.get("field");
    if (!field) {
      preloader.showFailure("粒子场数据缺失", "已切换到精简版。");
      enterStaticMode("load-failed");
      await preloader.dismiss();
      return;
    }

    // ── 场景装配 ──────────────────────────────────────────────
    const canvas = el("stage") as HTMLCanvasElement;
    const stage = new Stage({ canvas, preset, fov: CAMERA_TRACK[0].fov });

    const cloud = new PointCloud({
      data: field,
      drawCount: preset.points,
      pointSize: preset.pointSize,
      // 运行时查询到的硬件点尺寸上限 —— 移动端常被钳在 63/64，必须如实传给着色器
      maxPointSize: probeResult.pointSizeLimit,
    });
    stage.scene.add(cloud.points);

    for (const name of shapeNames) {
      const shape = loaded.get(name);
      if (shape) cloud.registerShape(name, shape.positions);
    }

    const rig = new CameraRig();
    const machine = new ChapterMachine((src) => {
      // 只在 morph ≈ 0（章节交界处）触发，所以换目标点看不到跳变
      cloud.setShape(src);
    });
    timeline = new ScrollTimeline(() => hint.classList.add("is-hidden"));

    const applyTier = (tier: Tier) => {
      preset = PRESETS[tier];
      stage.applyPreset(preset);
      cloud.setDrawCount(preset.points);
      cloud.material.uniforms.uSize.value = preset.pointSize;
      cloud.material.uniforms.uJitter.value = preset.jitter;
      console.info(`[mypage] 质量降档 → ${preset.label}（${preset.points.toLocaleString()} 点）`);
    };

    const adaptive = new AdaptiveQuality(initialTier);

    // ── 主循环 ────────────────────────────────────────────────
    let elapsed = 0;
    let firstFrame = true;

    const ticker = new Ticker((dt, now) => {
      elapsed += dt;
      const progress = timeline!.update(dt);
      const state = machine.evaluate(progress, elapsed);

      rig.update(stage.cameraLike, progress, elapsed, preset.cameraNoise);

      const shape = state.shape;
      cloud.update({
        morph: state.morph,
        spin: state.spin,
        time: elapsed,
        aperture: preset.dof ? state.aperture : 0,
        accent: state.accent,
        accentMix: state.accentMix,
        shapeOrigin: shape ? shape.position : [0, 0, -112],
        shapeScale: shape ? shape.scale : 1,
        // 对焦距离直接取自相机到注视点的距离 —— 不需要手工配对焦点，
        // 每一章形状停在哪里，焦平面就自动落在哪里。
        focal: rig.focalDistance,
        sizeScale: stage.sizeScale(rig.currentFov),
      });

      overlay.update(state.visuals);
      nav.setActive(state.activeIndex);
      instrument.update(rig.traveled(progress), rig.totalLength, progress, state.activeIndex + 1);
      stage.render();

      if (adaptive.update(ticker.current.frameMs, now)) applyTier(adaptive.current);
    });

    // ── 收尾 ──────────────────────────────────────────────────
    timeline.prime();
    enterExperienceMode();
    nav.setVisible(true);
    instrument.setVisible(true);
    hint.classList.toggle("is-hidden", window.scrollY > 8);

    window.addEventListener("resize", () => stage.resize());
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const current = CHAPTERS.indexOf(chapterAt(timeline!.value));
        if (event.key === "ArrowRight" || event.key === "PageDown") {
          event.preventDefault();
          jumpTo(current + 1);
        } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
          event.preventDefault();
          jumpTo(current - 1);
        }
      },
      { passive: false }
    );

    ticker.start();

    if (firstFrame) {
      firstFrame = false;
      // 首帧渲染完成再撤预加载器，避免中间露出空场景
      await preloader.dismiss();
    }

    // ── 深链 ──────────────────────────────────────────────────
    const applyHash = (smooth: boolean) => {
      const match = /^#chapter-(.+)$/.exec(window.location.hash);
      if (!match) return;
      const index = CHAPTERS.findIndex((chapter) => chapter.id === match[1]);
      if (index >= 0) jumpTo(index, smooth);
    };
    applyHash(false);
    window.addEventListener("hashchange", () => applyHash(true));

    // 静态模式提示（若用户在体验中途切换了系统设置）
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (event) => {
      if (event.matches) {
        ticker.stop();
        enterStaticMode("reduced-motion");
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
