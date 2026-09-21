/**
 * 章节文案层。
 *
 * 全部由 chapters.config.ts 生成 —— HTML 里不再有任何硬编码文案。
 * 旧实现把文案写在 index.html 的 4 个 <section> 里、把时序写在 data-start/data-end 上，
 * 于是改一句话要同时改 HTML 与 JS，漏改就静默不一致。
 *
 * 性能上注意：每帧只写 opacity 与 transform 两个合成属性，
 * 并且**不在 rAF 里读任何布局信息**（不触发强制同步布局）。
 * 旧实现每帧都做 Number(chapter.dataset.start) 字符串解析，属于白烧。
 */

import { CHAPTERS } from "../config/chapters.config";
import type { ChapterVisual } from "../core/chapters";

interface CachedChapter {
  root: HTMLElement;
  inner: HTMLElement;
  lastOpacity: number;
}

export class ChapterOverlay {
  private readonly cached: CachedChapter[] = [];

  constructor(private readonly root: HTMLElement) {
    this.build();
  }

  private build(): void {
    this.root.textContent = "";
    CHAPTERS.forEach((chapter, i) => {
      const section = document.createElement("section");
      section.className = "chapter";
      section.id = `chapter-${chapter.id}`;
      section.setAttribute("aria-labelledby", `chapter-${chapter.id}-title`);
      // 首章标题是页面唯一的 h1，其余为 h2 —— 标题层级必须成立
      section.dataset.level = i === 0 ? "1" : "2";

      const inner = document.createElement("div");
      inner.className = "chapter__inner";

      const index = document.createElement("p");
      index.className = "chapter__index";
      index.textContent = chapter.index;

      const title = document.createElement(i === 0 ? "h1" : "h2");
      title.className = "chapter__title";
      title.id = `chapter-${chapter.id}-title`;
      title.textContent = chapter.title;

      const body = document.createElement("p");
      body.className = "chapter__body";
      body.textContent = chapter.body;

      inner.append(index, title, body);
      section.append(inner);
      this.root.append(section);

      this.cached.push({ root: section, inner, lastOpacity: -1 });
    });
  }

  /** 每帧调用。只在数值真正变化时写 DOM。 */
  update(visuals: readonly ChapterVisual[]): void {
    for (let i = 0; i < this.cached.length; i++) {
      const entry = this.cached[i];
      const visual = visuals[i];
      if (!visual) continue;

      const opacity = visual.opacity;
      // 变化小于 0.002 就跳过写入 —— 停留段里这个判断几乎每帧都命中，
      // 省掉的样式重算远比那点比较开销值钱
      if (Math.abs(opacity - entry.lastOpacity) < 0.002) continue;
      entry.lastOpacity = opacity;

      const near = 1 - opacity;
      entry.root.style.opacity = opacity.toFixed(3);
      entry.root.style.transform = `translate3d(0, ${(near * 26).toFixed(2)}px, 0)`;
      // 不可见时移出无障碍树，避免读屏器念到四章之外的内容
      entry.root.setAttribute("aria-hidden", opacity < 0.05 ? "true" : "false");
    }
  }

  /** 滚到某一章时把它带进视口（深链与键盘跳章用） */
  elementFor(index: number): HTMLElement | null {
    return this.cached[index]?.root ?? null;
  }
}
