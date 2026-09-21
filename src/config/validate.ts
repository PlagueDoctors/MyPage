/**
 * 开发期配置校验器。
 *
 * 存在的意义就是让「三处真相源」这个病根无法复发：
 * 任何区间断裂、hold 越界、末章淡出踩到终点、模型文件缺失，都在启动瞬间抛错并指名道姓，
 * 而不是变成"滚到某处感觉怪怪的"这种需要肉眼排查的现象。
 *
 * 生产构建里 validateConfig() 不执行 —— 桩代码会被 tree-shake 掉。
 */

import { CHAPTERS, CAMERA_TRACK } from "./chapters.config";

export interface ValidationIssue {
  where: string;
  message: string;
}

export function collectIssues(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (where: string, message: string) => issues.push({ where, message });

  if (CHAPTERS.length === 0) {
    add("CHAPTERS", "至少需要一章");
    return issues;
  }

  // ── 区间连续性 ─────────────────────────────────────────────
  if (Math.abs(CHAPTERS[0].range[0]) > 1e-6) {
    add(CHAPTERS[0].id, `首章 range[0] 必须是 0，当前为 ${CHAPTERS[0].range[0]}`);
  }
  const last = CHAPTERS[CHAPTERS.length - 1];
  if (Math.abs(last.range[1] - 1) > 1e-6) {
    add(last.id, `末章 range[1] 必须是 1，当前为 ${last.range[1]}`);
  }

  CHAPTERS.forEach((chapter, i) => {
    const [start, end] = chapter.range;
    const [holdStart, holdEnd] = chapter.hold;

    if (end <= start) add(chapter.id, `range 必须递增：[${start}, ${end}]`);

    // 与上一章首尾相接
    if (i > 0) {
      const prevEnd = CHAPTERS[i - 1].range[1];
      if (Math.abs(prevEnd - start) > 1e-6) {
        add(
          chapter.id,
          `range 未能与上一章衔接：上一章结束于 ${prevEnd}，本章开始于 ${start}（差值 ${(start - prevEnd).toFixed(4)}）`
        );
      }
    }

    // hold 必须被 range 包含
    if (holdStart < start || holdEnd > end) {
      add(chapter.id, `hold [${holdStart}, ${holdEnd}] 超出 range [${start}, ${end}]`);
    }
    if (holdEnd <= holdStart) {
      add(chapter.id, `hold 必须递增：[${holdStart}, ${holdEnd}]`);
    }

    // 淡入必须在 hold 开始前完成，否则文案还没稳定就进入停留
    if (chapter.fadeIn > 0 && start + chapter.fadeIn > holdStart + 1e-6) {
      add(
        chapter.id,
        `fadeIn(${chapter.fadeIn}) 太长：应在 hold 起点 ${holdStart} 之前完成，实际到 ${(
          start + chapter.fadeIn
        ).toFixed(4)}`
      );
    }

    // 淡出必须在 hold 结束后才开始。
    // fadeOut = 0 视为「永不淡出」，跳过检查（末章用这个，避免最后一屏是空的）
    if (chapter.fadeOut > 0) {
      if (end - chapter.fadeOut < holdEnd - 1e-6) {
        add(
          chapter.id,
          `fadeOut(${chapter.fadeOut}) 太长：hold 结束于 ${holdEnd}，淡出却从 ${(
            end - chapter.fadeOut
          ).toFixed(4)} 就开始了`
        );
      }
      if (i === CHAPTERS.length - 1) {
        add(
          chapter.id,
          "末章不应有 fadeOut —— 否则 progress = 1 时文案 opacity 为 0，最后一屏是空的"
        );
      }
    }

    if (chapter.aperture < 0 || chapter.aperture > 1) {
      add(chapter.id, `aperture 应在 0–1，当前 ${chapter.aperture}`);
    }

    if (chapter.shape) {
      if (!chapter.shape.src) add(chapter.id, "shape.src 不能为空");
      if (chapter.shape.scale <= 0) add(chapter.id, `shape.scale 必须为正，当前 ${chapter.shape.scale}`);
      if (chapter.shape.accentMix < 0 || chapter.shape.accentMix > 1) {
        add(chapter.id, `shape.accentMix 应在 0–1，当前 ${chapter.shape.accentMix}`);
      }
    }
  });

  // ── 相机轨道 ───────────────────────────────────────────────
  if (CAMERA_TRACK.length < 2) {
    add("CAMERA_TRACK", "至少需要 2 个关键帧");
  } else {
    if (Math.abs(CAMERA_TRACK[0].at) > 1e-6) add("CAMERA_TRACK", "首个关键帧 at 必须是 0");
    const tail = CAMERA_TRACK[CAMERA_TRACK.length - 1];
    if (Math.abs(tail.at - 1) > 1e-6) add("CAMERA_TRACK", "末尾关键帧 at 必须是 1");
    for (let i = 1; i < CAMERA_TRACK.length; i++) {
      if (CAMERA_TRACK[i].at <= CAMERA_TRACK[i - 1].at) {
        add("CAMERA_TRACK", `关键帧 at 必须严格递增，第 ${i} 项 ${CAMERA_TRACK[i].at} 未大于前一项`);
      }
    }
    for (const key of CAMERA_TRACK) {
      if (key.fov <= 0 || key.fov >= 180) add("CAMERA_TRACK", `at=${key.at} 的 fov 非法：${key.fov}`);
    }
  }

  return issues;
}

/** 开发期调用：有问题就直接炸，并打印完整清单 */
export function validateConfig(): void {
  const issues = collectIssues();
  if (issues.length === 0) return;

  const lines = issues.map((issue) => `  ✗ [${issue.where}] ${issue.message}`).join("\n");
  throw new Error(`chapters.config.ts 配置校验失败（${issues.length} 项）：\n${lines}\n`);
}
