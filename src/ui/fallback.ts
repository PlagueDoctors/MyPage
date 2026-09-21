/**
 * 静态降级路径。
 *
 * 旧实现里 `html, body { overflow: hidden }` + `wheel.preventDefault()` + `.chapter { opacity: 0 }`
 * 意味着只要 JS 模块没跑起来（CDN 被拦、模块不支持、WebGL 不可用），
 * 用户看到的是一张**空的黑页，一个字都没有**。
 * 对一个个人主页来说这是最糟的失败模式 —— 你的门面在别人公司网络里是黑的。
 *
 * 这里的做法是把「静态可读」当作 CSS 的**默认状态**，
 * 只有 JS 成功启动并确认能渲染，才主动切到体验模式。
 * 于是"降级"不是额外的分支，而是什么都不做。
 */

export type StaticReason = "no-webgl2" | "reduced-motion" | "load-failed";

const MESSAGES: Record<StaticReason, string> = {
  "no-webgl2": "当前浏览器不支持 WebGL2，已切换到精简版",
  "reduced-motion": "检测到系统开启了「减少动态效果」，已切换到精简版",
  "load-failed": "粒子资源加载失败，已切换到精简版",
};

export function enterStaticMode(reason: StaticReason): void {
  const html = document.documentElement;
  if (html.dataset.mode === "static") return;
  html.dataset.mode = "static";
  html.dataset.staticReason = reason;
  console.info(`[mypage] ${MESSAGES[reason]}`);
  window.dispatchEvent(new CustomEvent("mypage:static", { detail: { reason } }));
}

/** 体验是否已经就绪 —— 控制 CSS 从默认文档流切到固定画布布局 */
export function enterExperienceMode(): void {
  document.documentElement.dataset.mode = "experience";
  document.documentElement.dataset.staticReason = "";
}

export function isStaticMode(): boolean {
  return document.documentElement.dataset.mode === "static";
}
