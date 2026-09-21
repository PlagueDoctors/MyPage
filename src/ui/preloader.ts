/**
 * 预加载器。
 *
 * 旧实现在加载期间只把一行提示文字改成 "Loading 3D models…"，
 * 没有任何进度反馈，失败也只留一句英文。
 *
 * 这里显示**真实字节进度** —— 这只有在用 fetch + ReadableStream
 * 而不是 loadAsync 的情况下才做得到。同时它是"永不黑屏"这条底线的第一道防线：
 * 无论加载成功还是失败，屏上都有东西。
 */

export class Preloader {
  private readonly valueEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private hideTimer = 0;

  constructor(private readonly root: HTMLElement) {
    root.classList.add("preloader");
    root.innerHTML = "";

    const panel = document.createElement("div");
    panel.className = "preloader__panel";

    const title = document.createElement("p");
    title.className = "preloader__title";
    title.textContent = "Blue Toaster";

    this.valueEl = document.createElement("p");
    this.valueEl.className = "preloader__value";
    this.valueEl.textContent = "0%";

    const track = document.createElement("div");
    track.className = "preloader__track";
    this.fillEl = document.createElement("div");
    this.fillEl.className = "preloader__fill";
    track.append(this.fillEl);

    this.statusEl = document.createElement("p");
    this.statusEl.className = "preloader__status";
    this.statusEl.textContent = "正在载入粒子场";

    // 进度值对读屏器意义不大，用 role=status 播报状态文字即可
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");

    panel.append(title, this.valueEl, track, this.statusEl);
    root.append(panel);
  }

  setProgress(loaded: number, total: number): void {
    if (total <= 0) {
      // 拿不到 Content-Length，退化为不定进度
      this.valueEl.textContent = "—";
      this.fillEl.style.width = "100%";
      this.fillEl.classList.add("is-indeterminate");
      return;
    }
    const ratio = Math.min(loaded / total, 1);
    this.valueEl.textContent = `${Math.round(ratio * 100)}%`;
    this.fillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  async dismiss(): Promise<void> {
    window.clearTimeout(this.hideTimer);
    this.root.classList.add("is-done");
    await new Promise<void>((resolve) => {
      this.hideTimer = window.setTimeout(() => {
        this.root.hidden = true;
        resolve();
      }, 620);
    });
  }

  /** 失败时不留黑屏：说清楚发生了什么，并把静态内容放出来 */
  showFailure(message: string, hint: string): void {
    this.statusEl.textContent = message;
    this.valueEl.textContent = "!";
    this.fillEl.style.width = "100%";
    this.fillEl.classList.add("is-error");

    const detail = document.createElement("p");
    detail.className = "preloader__hint";
    detail.textContent = hint;
    this.root.querySelector(".preloader__panel")?.append(detail);
  }
}
