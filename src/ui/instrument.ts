/**
 * 叙事化读数（仪表盘）。
 *
 * 参考站点那行 `622107.238 LIGHTYEAR` 给了一个很好的示范：
 * 进度不该是一根进度条，而应该是**世界内的一个量**。
 *
 * 这里的数字不是装饰 —— 它是相机沿 Catmull-Rom 轨道实际飞过的弧长，
 * 按总里程归一化后换算成光年。所以停留段它会慢下来、过渡段它会加速，
 * 读数本身就在描述"你正在以什么速度穿越"。
 */

import { INSTRUMENT_TOTAL_LY } from "../config/chapters.config";

export class Instrument {
  private readonly valueEl: HTMLElement;
  private readonly chapterEl: HTMLElement;
  private readonly barEl: HTMLElement;
  private lastText = "";
  private lastChapter = -1;

  constructor(private readonly root: HTMLElement) {
    root.classList.add("instrument");

    const row = document.createElement("div");
    row.className = "instrument__row";

    this.valueEl = document.createElement("span");
    this.valueEl.className = "instrument__value";
    this.valueEl.textContent = "0.0000";

    const unit = document.createElement("span");
    unit.className = "instrument__unit";
    unit.textContent = "LY";

    this.chapterEl = document.createElement("span");
    this.chapterEl.className = "instrument__chapter";

    row.append(this.valueEl, unit, this.chapterEl);

    const track = document.createElement("div");
    track.className = "instrument__track";
    this.barEl = document.createElement("div");
    this.barEl.className = "instrument__fill";
    track.append(this.barEl);

    // 读数每秒变化很多次，但把它从无障碍树里摘出去：
    // 读屏器不需要念出一串跳动的数字，章节标题才是有效信息。
    root.setAttribute("aria-hidden", "true");
    root.append(row, track);
  }

  /**
   * @param traveled 相机已飞过的弧长
   * @param total 轨道总长
   * @param progress 归一化进度，用于进度条
   * @param chapterIndex 当前章节序号（1 起）
   */
  update(traveled: number, total: number, progress: number, chapterIndex: number): void {
    const ly = (traveled / Math.max(total, 1)) * INSTRUMENT_TOTAL_LY;
    const text = ly.toFixed(4);
    if (text !== this.lastText) {
      this.lastText = text;
      this.valueEl.textContent = text;
    }

    if (chapterIndex !== this.lastChapter) {
      this.lastChapter = chapterIndex;
      this.chapterEl.textContent = `CH ${String(chapterIndex).padStart(2, "0")}`;
    }

    const width = (progress * 100).toFixed(2);
    if (this.barEl.style.width !== `${width}%`) {
      this.barEl.style.width = `${width}%`;
    }
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("is-visible", visible);
  }
}
