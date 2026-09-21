# Blue Toaster

个人 GitHub Pages 主页。一次滚轮驱动的点云空间体验：四章叙事，粒子场在穿行中聚合为形状。

> 重构方案与背景分析见 [`REFACTOR-PLAN.md`](./REFACTOR-PLAN.md)。
> 旧版本（滚轮飞轮 + CPU 逐帧变形）保留在 git tag `pre-refactor`。

---

## 快速开始

```bash
npm install
npm run dev        # 开发服务器 → http://127.0.0.1:5173
npm run build      # 生产构建 → dist/
npm run preview    # 预览构建产物 → http://127.0.0.1:4173
npm run typecheck  # 类型检查
npm run pointcloud # 重新生成点云数据
```

需要 Node 18+（本机为 22.22.2）。

## 项目结构

```
MyPage/
├── index.html                     # 骨架。不含任何正文，章节由配置渲染
├── src/
│   ├── main.ts                    # 引导 + 主循环
│   ├── config/
│   │   ├── chapters.config.ts     # ★ 唯一真相源
│   │   ├── validate.ts            # 开发期配置断言
│   │   └── palette.ts             # 色彩令牌（WebGL 与 DOM 共用）
│   ├── core/
│   │   ├── clock.ts               # 帧率无关阻尼、Catmull-Rom、噪声
│   │   ├── ticker.ts              # rAF 循环 + 帧时间统计
│   │   ├── device.ts              # 能力探测 + 质量档位 + 自适应降档
│   │   ├── timeline.ts            # 原生滚动 → warp 映射 → 阻尼 progress
│   │   └── chapters.ts            # enter / hold / exit 状态机
│   ├── data/pointcloud.ts         # 点云加载（带真实字节进度）
│   ├── gl/
│   │   ├── renderer.ts            # 渲染器 / 尺寸换算
│   │   ├── pointcloud.ts          # 几何装配 + uniform 驱动
│   │   ├── camerarig.ts           # 关键帧飞行轨道
│   │   └── shaders/               # point.vert.glsl / point.frag.glsl
│   ├── ui/
│   │   ├── overlay.ts             # 章节文案层
│   │   ├── nav.ts                 # 轨道导航
│   │   ├── instrument.ts          # 叙事读数
│   │   ├── preloader.ts           # 真实进度预加载
│   │   └── fallback.ts            # 静态降级
│   └── styles/main.css
├── tools/build-pointcloud.mjs     # 离线点云构建管线
├── public/pointcloud/             # 量化后的点数据 + manifest
├── test.html  css/style.css  js/code-rain.js   # 代码雨彩蛋页（独立，未改动）
└── models/                        # 仅作 --glb 管线示例，运行时不再使用
```

## 改内容只需要动一个文件

`src/config/chapters.config.ts` 是**唯一真相源**。页面文案、导航、读数、粒子行为、相机运动
全部由它派生 —— 改这里，全站同步。

```ts
{
  id: "field",                       // 深链锚点 #chapter-field
  index: "02", navLabel: "Field",
  title: "The field", body: "……",
  range: [0.2, 0.48],                // 在 progress 0→1 上的区间
  hold:  [0.26, 0.42],               // 停留窗口：此间形状保持成形
  fadeIn: 0.035, fadeOut: 0.035,     // 文案淡入淡出时长（fadeOut: 0 = 永不淡出）
  aperture: 0.62,                    // 景深光圈：越大越虚化
  dissolve: true,                    // 离场时是否溶解回隧道
  shape: {
    src: "sphere", scale: 26, spin: 1.15,
    position: [0, 0, -112],
    accent: 0x58e0c8, accentMix: 0.55,
  },
}
```

**改完不用怕写错**：`validate.ts` 会在开发环境启动瞬间断言 —— 区间是否首尾相接、
`hold` 是否被 `range` 包含、`fadeIn` 是否在 `hold` 之前完成、末章是否误设了 `fadeOut`
（会导致最后一屏空白）、相机关键帧是否覆盖 `[0, 1]`。任何一条不满足直接抛错并指出是哪一章。

相机轨道是同文件里的 `CAMERA_TRACK`，用非均匀节点的 Catmull-Rom 插值，
一阶导连续、严格过点、不过冲。

## 三处关键实现

### 1. 滚动模型：原生滚动 + warp 映射

```
滚动 → raw ∈ [0,1] → warp() → dt 归一化阻尼 → progress
```

- **用原生滚动**，于是键盘、滚动条、`PageDown` / `Home` / `End`、读屏器语义全部免费获得。
- **`warp()`** 把「停留窗口占更多滚动距离」表达成时间轴结构自身的属性。
  主旋钮是 `timeline.ts` 里的 `HOLD_SCROLL_BOOST`：
  `1.0` 完全线性无停顿感，`1.45` 停留段吃掉约 2/3 行程（当前值），`3.0` 几乎粘在每章上。
- **所有随时间推进的量都乘 `dt`**，阻尼用 `1 - exp(-λ·dt)` 而非「每帧衰减 x%」。
  这两条合起来保证手感不随帧率漂移。
- 每章占 `135vh` 滚动距离（`main.css` 的 `.scroll-track`），是另一个手感入口。

### 2. GPU 点云着色器

自由隧道与形状目标是两份**静态**缓冲，变形在顶点着色器里 `mix`：

```glsl
vec3 p = mix(position, tgt, m) + swirl * (burst * uJitter + ambient * 0.55);
```

每帧 CPU 只写几个 uniform —— 复杂度 O(1)，与粒子数无关，**零顶点数据上传**。

**伪景深**（`point.vert.glsl` 第 4 段）是整个视觉升级的核心：

```glsl
float coc  = clamp(abs(depth - uFocal) / max(uFocal, 0.001), 0.0, 1.0);
float blur = coc * uAperture;
size  *= 1.0 + blur * 2.6;
vAlpha = ... * mix(1.0, 0.22, blur);
```

弥散圆正比于「到焦平面的距离」，越远越模糊 → 放大 + 变淡。
`uFocal` 直接取相机到注视点的距离，所以**焦平面自动跟着每一章的形状走**，不需要手工配对。
没有任何后期处理、没有 render target。

### 3. 章节状态机：enter / hold / exit

```
morph
1 ┤        ┌────────────┐
  │      ╱                ╲
0 ┤────╱                    ╲────
  └──┬──────┬────────┬──────┬──→ progress
   range[0] hold[0]  hold[1] range[1]
    enter     hold      exit
```

`hold` 窗口内 `morph` 锁在 1，形状是**稳定**的（旧实现用 `sin(local × π)`，
两端都归零，于是每个边界必然溶解，模型只闪一下）。

## 点云管线

```bash
node tools/build-pointcloud.mjs                    # 生成 4 个形状（默认，程序化）
node tools/build-pointcloud.mjs --count 120000     # 改点数
node tools/build-pointcloud.mjs --glb models/Fox.glb --dry-run    # 校验自有模型
node tools/build-pointcloud.mjs --glb 你的模型.glb --out myshape  # 采样并写出
```

- **面积加权 + 重心坐标采样**：累积三角形面积 → 前缀和 CDF → 二分查找 → 重心坐标。
  这样每个三角形分到的点数正比于它的**面积**，而不是顶点数。
  （旧实现从顶点数组里均匀随机取点，密度正比于网格细分程度 —— 大片平面上点稀疏、
  密集网格处点扎堆，轮廓必然破碎发毛。）
- **量化**：写成 `Int16` 归一化坐标，加载时反量化回 `Float32`。
  文件体积减半、gzip 压缩率远好于裸浮点；而反量化只做一次，着色器里不需要任何解码逻辑。
- **格式**：32 字节定长头（`PTC1` + count + 每轴 scale/offset）+ `Int16` 载荷。
- 隧道场与所有形状**点数必须一致**（着色器里按下标一一配对），`registerShape()` 会校验。
- 产物同时写 `manifest.json`，让预加载器在下载**之前**就知道总字节数，
  于是可以并行拉取、同时显示准确百分比。

> 换成自己的模型：走 `--glb` 那条路，然后改 `chapters.config.ts` 里的 `shape.src` 即可。

## 降级路径

「静态可读」是 CSS 的**默认状态**，只有 JS 成功启动并确认能渲染，才主动切到体验模式。
于是降级不是一条额外分支，而是**什么都不做**的结果。

| 场景 | 行为 |
|---|---|
| 无 WebGL2 | 静态模式：全部章节以正常文档流呈现 + CSS 星空底 |
| `prefers-reduced-motion: reduce` | 同上；运行中切换系统设置会即时降级 |
| 点云加载失败 | 预加载器说明原因，内容不受影响 |
| 完全禁用 JS | `<noscript>` 精简说明（正文由 JS 渲染，见下方待办） |

其他可访问性：真实的 `<nav>` + `<button>` 导航（可 Tab、可读屏、带 `aria-current`）、
每章可深链（`#chapter-craft`）、方向键跳章、唯一的 `<h1>`、
章节不可见时移出无障碍树、可见的 focus ring。

## 已知待办

- **无 JS 时的完整正文**：章节由 `chapters.config.ts` 在运行时渲染，禁用 JS 只能看到
  `<noscript>` 精简说明。正解是加一个 build-time 插件把配置注入 `index.html`；
  属于 `REFACTOR-PLAN.md` Phase 5 的收尾项。
- **`prefers-reduced-motion` 的中间档**：现在是直接降级为静态文档。更好的做法是保留
  形状静帧 + 交叉淡入 —— 内容一字不少，但仍有画面。
- **首屏优化**：OG 图、favicon、`sitemap.xml` 尚未补。
- **内容**：`chapters.config.ts` 里的文案是占位；`models/` 下的
  `Duck.glb` / `Fox.glb` 是 Khronos 官方示例模型，仅供管线示例，运行时不再引用。

## 部署到 GitHub Pages

**必须走构建流程。** 本项目的 `index.html` 是 Vite 的**源码入口**（引用 `/src/main.ts`），
不是可以直接发布的静态页面。如果让 GitHub Pages 发布 `main` 分支的根目录，浏览器会
因为 `/src/main.ts` 的 MIME 类型不是 JavaScript 而拒绝执行模块脚本 —— JS 从不运行，
而章节内容由 JS 从配置渲染，结果就是**一片空白**。

`.github/workflows/deploy.yml` 已经处理好这条链路：`npm ci → typecheck → build → 部署 dist/`。

### 首次启用（只需一次）

把 **Settings → Pages → Build and deployment → Source** 改为 **GitHub Actions**。

> ⚠️ 这一步必须手动做。`actions/configure-pages` 的 `enablement` 默认为 `false`，
> 且需要 PAT 才能启用 Pages（`GITHUB_TOKEN` 不够），所以它**不会**替你切换。
> 如果 Source 停留在 "Deploy from a branch"，deploy 作业会失败并提示。

等效的命令行做法：

```bash
gh api -X PUT repos/PlagueDoctors/MyPage/pages -f build_type=workflow
```

### 日常发布

```bash
git push origin main      # 推送即触发构建与部署
```

`vite.config.ts` 里 `base: "./"` 用的是相对路径，所以**仓库名与自定义域名都无需改配置**。

### 页面仍然是空白时怎么排查

页面内置了引导看门狗：如果模块脚本在 3 秒内没有执行，会直接把原因和修复方式显示在页面上，
而不是留一张没有任何信息的黑页。看到那个面板就说明**构建产物没有被正确发布**。

也可以用 curl 快速判断线上到底是源码还是产物：

```bash
curl -s https://plaguedoctors.github.io/MyPage/ | grep -o 'src="[^"]*"'
```

- 出现 `./assets/index-xxxx.js` → 正常，发布的是构建产物
- 出现 `/src/main.ts` → 发布的是源码目录，Source 没切成 GitHub Actions

## 技术栈

- Vite 5 + TypeScript
- Three.js 0.170（npm 锁定版本，具名导入以便 tree-shaking）
- 自定义 WebGL 点云着色器（变形 + 伪景深）
- 产物：JS 约 130 KB gzip（其中 three 117.5 KB）、CSS 2.4 KB gzip
