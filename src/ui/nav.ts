/**
 * 轨道式导航。
 *
 * 取自参考站点「导航结构取材太阳系」的做法：章节是轨道上的节点，
 * 圆心显示当前序号。用 DOM + SVG 而不是画进 WebGL —— 这样它天然可聚焦、
 * 可读屏、可被 CSS 主题化，也完全不参与渲染循环。
 *
 * 这层补上的是旧实现最大的体验缺口：纯滚轮惯性飞轮没有任何
 * 可访问的替代路径；现在每一章都是可点击、可 Tab、可深链的真实按钮。
 */

import { CHAPTERS } from "../config/chapters.config";

const SIZE = 104;
const CENTER = SIZE / 2;
const RADIUS = 38;
const NODE = 18;

export class OrbitNav {
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly readout: HTMLElement;
  private activeIndex = -1;

  constructor(
    private readonly root: HTMLElement,
    onSelect: (index: number) => void
  ) {
    root.classList.add("orbit");

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
    svg.setAttribute("class", "orbit__graphic");
    svg.setAttribute("aria-hidden", "true");

    for (const r of [RADIUS, RADIUS * 0.66]) {
      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("cx", String(CENTER));
      circle.setAttribute("cy", String(CENTER));
      circle.setAttribute("r", r.toFixed(1));
      circle.setAttribute("class", "orbit__ring");
      svg.append(circle);
    }
    root.append(svg);

    // 把整圈包成真的 <nav>，读屏器与键盘才会正常对待它
    const nav = document.createElement("nav");
    nav.className = "orbit__nav";
    nav.setAttribute("aria-label", "章节导航");

    CHAPTERS.forEach((chapter, i) => {
      const angle = (-90 + (i * 360) / CHAPTERS.length) * (Math.PI / 180);
      const x = CENTER + Math.cos(angle) * RADIUS;
      const y = CENTER + Math.sin(angle) * RADIUS;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "orbit__node";
      button.style.left = `${(x - NODE / 2).toFixed(2)}px`;
      button.style.top = `${(y - NODE / 2).toFixed(2)}px`;
      button.style.width = `${NODE}px`;
      button.style.height = `${NODE}px`;
      button.setAttribute("aria-label", `第 ${chapter.index} 章 · ${chapter.title}`);
      button.setAttribute("aria-current", "false");

      const dot = document.createElement("span");
      dot.className = "orbit__dot";
      const label = document.createElement("span");
      label.className = "orbit__label";
      label.textContent = `${chapter.index} ${chapter.navLabel}`;
      button.append(dot, label);

      button.addEventListener("click", () => onSelect(i));
      this.buttons.push(button);
      nav.append(button);
    });
    root.append(nav);

    this.readout = document.createElement("p");
    this.readout.className = "orbit__readout";
    this.readout.setAttribute("aria-hidden", "true");
    root.append(this.readout);

    this.setActive(0);
  }

  setActive(index: number): void {
    if (index === this.activeIndex) return;
    this.activeIndex = index;
    this.buttons.forEach((button, i) => {
      const on = i === index;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-current", on ? "true" : "false");
    });
    const chapter = CHAPTERS[index];
    if (chapter) {
      this.readout.innerHTML =
        `<span class="orbit__current">${chapter.index}</span>` +
        `<span class="orbit__total">/${String(CHAPTERS.length).padStart(2, "0")}</span>`;
    }
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("is-visible", visible);
  }
}
