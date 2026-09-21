# MyPage 全盘重构方案

> 参考目标：`https://experience.staratlas.com/`
> 现状：`index.html` + `js/particle-experience.js`（432 行）+ `css/experience.css`（128 行）
> 文档日期：2026-09-21

---

## 实施进度（2026-09-21 更新）

**Phase 0–4 已完成并通过构建**。旧实现已删除，可在 `git tag pre-refactor` 找回。

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 脚手架 | ✅ | Vite 5 + TypeScript + Three.js（npm 锁定）；`base: "./"` 免仓库名配置 |
| Phase 1 配置源 + 原生滚动 | ✅ | `chapters.config.ts` 单一真相源 + `validate.ts` 断言；`warp()` 取代 `SENSITIVITY_*` |
| Phase 2 GPU 点云着色器 | ✅ | `mix()` 变形 + 伪景深；每帧只写 uniform，零顶点上传 |
| Phase 3 相机 + 状态机 | ✅ | Catmull-Rom 飞行轨道；`enter / hold / exit` 三段式 |
| Phase 4 UI / 导航 / 仪表盘 | ✅ | 轨道导航、叙事读数、真实进度预加载、深链与键盘 |
| Phase 5 降级与无障碍 | 🟡 部分 | 无 WebGL2 / reduce-motion / 加载失败 / 无 JS 四条路径已就绪；noscript 完整正文待补 |
| Phase 6 内容与上线 | 🟡 部分 | 离线点云管线已就绪并验证；文案仍为占位，Duck/Fox 未替换 |

**实际产物体积**（优于本文档第七部分的预算）：

| 项 | 预算 | 实际 |
|---|---|---|
| JS（gzip） | < 200 KB | **130 KB**（app 12.7 KB + three 117.5 KB） |
| CSS（gzip） | — | 2.4 KB |
| 点云资源 | < 60 KB | 1.83 MB（4 × 80,000 点；按点数换算约 23 字节/点，符合预期） |

three 从旧版全量约 330 KB gzip 降到 117.5 KB gzip —— 具名导入的 tree-shaking 生效。

**实测修正的两处设计错误**（静态验算无法发现，落地时必须重新配对）：

1. **形状尺寸与观察距离未配对**：初稿 `scale: 26` 配 42 单位的观察距离，
   形状角半径 38° 超过 fov 半角 29° —— 形状会溢出整个画面。已改为 `scale: 15`。
   规律：`scale ≤ 观察距离 × tan(fov/2) × 0.7`。
2. **平躺盘状图形被相机侧切成一条线**：星系盘在 XZ 平面，相机若也在盘面内就只能看到边。
   末章相机已抬到盘面上方（y ≈ 24，俯角约 25°）才读得出椭圆。

其余内容为设计阶段的原始分析，保留以便对照。

---


## 摘要

当前项目**方向是对的，实现是脆的**。

「单一进度值驱动章节化 3D 叙事」这个核心构思，恰好就是参考站点的做法，不需要推翻。真正的问题在三处：

1. **帧率耦合**——`progress += velocity` 没有任何 `dt` 归一化，144Hz 显示器上整段旅程比 60Hz 快 2.4 倍。这是"手感说不出的别扭"的根源。
2. **变形在 CPU 上逐帧算**——每帧 4000 次对象分配 + 整块顶点缓冲重传，等效 24 万个临时对象/秒。这正是参考站点用**自定义点云着色器**解决掉的事。
3. **三处真相源互相不同步**——章节配置散落在 HTML、`MODEL_CHAPTERS`、`CHAPTER_BOUNDARIES`，改一处必须记得改另两处。

另外有两个缺陷直接造成"结尾感缺失"：`progress === 1` 时变形函数返回 0，粒子会**突然炸开**；而末章的淡出区间正好落在 `progress=1`，**最后一屏是空的**。README 里"已知局限"写的三条，本质都是这两个数字问题的表象。

重构路线：**保留叙事模型，替换运行时**——原生滚动 + 单一配置源 + GPU 点云着色器 + 相机路径 + 章节状态机。全程 7 个阶段，每阶段可独立验收、可随时停在上线状态。

---

## 第一部分：参考站点拆解

### 1.1 事实来源与可信度

| 结论 | 来源 | 可信度 |
|---|---|---|
| 制作方：Hello Monday（DEPT® 旗下创意工作室） | DEPT 官方 case study | 一手 |
| 技术栈：WebGL / Three.js / GSAP / Draco / Cinema4D / Figma | Webby Awards "Crafted with Code" 官方访谈 | 一手 |
| 核心手法：**自定义点云着色器 + 伪景深** | 同上，制作方原话 | 一手 |
| 模型由「光线投射到真实游戏模型表面」生成，经自定义 Draco 压缩管线预处理 | 同上 | 一手 |
| 色彩刻意**明快化**，反传统暗黑科幻 | 同上 | 一手 |
| 导航结构**取材太阳系**；首页是「星系传送门」 | DEPT case study | 一手 |
| 用户**滚动穿越章节**，与飞船/星球 3D 可视化交互 | DEPT case study | 一手 |
| 奖项：Awwwards 2021 Site of the Day + Users' Choice Site of the Year；FWA 2021 Site of the Day；Webby 2022 People's Voice（娱乐类） | DEPT case study | 一手 |
| 菜单：`01 Experience / 02 Roadmap / 03 News & Info / 04 Team / 05 Support` | 站点实测 DOM | 一手 |
| 交互动词：`#prev` / `#next` / `#close` 哈希导航 | 站点实测 DOM | 一手 |
| 读数 `622107.238 LIGHTYEAR`（叙事化里程计） | 站点实测 DOM | 一手 |
| `menu_circles.svg` + `menu_circles_mobile.svg`（轨道式菜单图形，有移动端变体） | 站点实测 DOM | 一手 |
| 预告片视频浮层 + `#close` 关闭 | 站点实测 DOM | 一手 |
| LCP ≈1.4s / 2.0s、AVIF 精灵图、分阶段纹理流、`prefers-reduced-motion` 回退静帧、键盘方向键跳章 | 第三方设计画廊评述 | **二手，仅作参考** |

制作方原话（Webby 访谈）值得单独摘出来，它就是这个项目的技术北极星：

> "The 3D Visuals are rendered as point clouds alluring to stars in the universe. To achieve this look we wrote a **custom WebGL point cloud shader that has a faked but very performant, animated depth-of-field effect**."

> "The 3D models are made from **projecting light rays onto the surface of actual game models**, and pre-processed in a custom **Draco-based compression pipeline**."

### 1.2 六个可复用的设计决策

**① 单画布常驻，相机领着走**
一张 canvas 从进站到离开不卸载，"换页"是**相机运动 + 内容互换**，不是路由跳转。章节之间零加载、零白屏。站点用 `#next`/`#prev` 表达这一点——它是**幻灯片语义**，不是路由语义。

**② 点云作为唯一视觉基元**
所有物体都是同一个粒子系统的**密度场**，不是网格。这是"飞船能溶解、能重组，且看起来浑然一体"的根本原因。当前项目已经有这个想法，方向正确——但缺了第 ③ 条，所以只做到了"尘埃"，没做到"星舰"。

**③ 景深在着色器里伪造**
深度感来自**按对焦距离决定每个粒子的弥散圆**（尺寸放大 + 亮度衰减 + 核形状），而不是雾。这是"高级感"最大的单一来源，且开销极低。
当前项目只有 `FogExp2(0x000008, 0.012)`：黑场景 + 0.012 密度 + 240 单位纵深 ≈ 肉眼不可见。所以粒子**没有前后关系**，模型轮廓糊成一团——README 里"模型轮廓不清晰"就是这么来的。

**④ 滚动 = 带章节停顿的叙事推进**
一个标量驱动全部。当前项目这一点做对了。

**⑤ 离散章节动词 + 可深链**
`#next` / `#prev` / `#close` 是**可逆、可分享、可键盘操作**的显式动作。纯滚轮惯性飞轮是最不accessible的方案，而站点用哈希动词补上了这个缺口。当前项目**完全没有这层**。

**⑥ 叙事化的仪表盘**
`622107.238 LIGHTYEAR` 不是进度条，是**仪器读数**——它把"我滚到哪了"翻译成世界内的量（航行了多少光年）。这比一根进度条有意思一个量级，而且**完全由配置推导**，改章节就自动改读数。

### 1.3 值得借鉴但不要照搬

| 站点做法 | 是否照搬 | 理由 |
|---|---|---|
| 太阳系轨道式导航 | ✅ 借鉴形态 | 用 SVG 画轨道环 + 当前章节高亮，DOM 实现，别进 WebGL |
| 点数万级的高密度云 | ⚠️ 降规模 | 站点是营销站 + 好设备。个人站要照顾中端笔记本和手机，10 万点起步、按档位降级 |
| 自研 Draco 压缩管线 | ⚠️ 换方案 | 点云**不需要** Draco。离屏把位置量化成 Uint16 存裸 buffer，体积更小、解析更快、还省掉 WASM 解码器 |
| GSAP | ❌ 可不引入 | 我们的时间轴是**被滚动 scrub 的**，不是自播放 tween。20 行阻尼插值足够；除非选 ScrollTrigger 路线 |
| 预告片视频浮层 | ⚠️ 视内容 | 个人站没有预告片。但这层「浮层 +`#close`」结构可以用来放 About / 联系表单 |

---

## 第二部分：现状诊断

### 2.1 代码地图

| 文件 | 行数 | 职责 | 重构后 |
|---|---|---|---|
| `index.html` | 57 | 章节文案 + importmap + 挂载点 | 拆分：骨架 + 配置驱动 |
| `js/particle-experience.js` | 432 | 输入 / 粒子 / 变形 / 相机 / 文案，全部耦合 | 拆成 12 个模块 |
| `css/experience.css` | 128 | 首页样式 | 保留思路，重写 |
| `css/style.css` | 94 | 代码雨页样式 | 并入统一样式体系 |
| `js/code-rain.js` | 140 | 2D 代码雨（独立，无耦合） | 保留，作为独立彩蛋页 |
| `models/Duck.glb` | 120 KB | Khronos 官方示例模型 | **替换** |
| `models/Fox.glb` | 163 KB | Khronos 官方示例模型 | **替换** |

环境：Node v22.22.2 ✅、Python 3.14.5 ✅、已有 git 仓库（origin/main）。

> ⚠️ **内容层面的问题，可能比代码更影响观感**
> `Duck.glb` 和 `Fox.glb` 是 three.js / Khronos 仓库里最经典的**示例模型**（那只橡皮鸭和低多边形狐狸，几乎出现在每个 three.js 教程里）。
> 把它们当作个人主页的叙事主角，读者会立刻识别出"这是教程 demo"，而不是"这是某人的作品"。这大概是你"不满意"的重要来源之一。
> 第 6 阶段专门处理内容替换。

### 2.2 缺陷清单（按严重度分级）

#### P0 — 阻塞级（功能性错误）

| # | 缺陷 | 位置 | 说明 |
|---|---|---|---|
| 1 | **帧率耦合** | `particle-experience.js:379` | `progress += velocity` 无 `dt`。144Hz 跑 2.4 倍速，30fps 跑 0.5 倍速。而隧道位移却写了硬编码 `* 0.016`（`:391`），说明作者知道要按 60fps 算，但只修了一半。这是"手感怪"的第一元凶。 |
| 2 | **`deltaMode` 未归一化** | `:304-307` | Firefox 的 `wheel` 事件 `deltaMode === 1`（按行，每格 ≈3），Chrome 是 `0`（按像素，每格 ≈100）。同一份 `SENSITIVITY` 在两大浏览器上相差约 30 倍。触控板的连续小 delta 与鼠标的离散大 delta 也没有区分。 |
| 3 | **三处真相源** | `index.html:22-44`、`:19-23`、`:17` | 章节文案区间在 HTML 的 `data-start/data-end`，变形区间在 `MODEL_CHAPTERS`，灵敏度窗口在 `CHAPTER_BOUNDARIES`。三者无任何校验。README 把它列为"已知局限"，本质是架构问题。 |
| 4 | **JS 失败 = 全黑屏** | `css/experience.css:9-17`、`:96` | `overflow:hidden` + `wheel.preventDefault()` + `.chapter{opacity:0}`。只要模块加载失败（CDN 被墙 / 模块不支持 / WebGL 不可用），用户看到的是**一张空的黑页，一个字都没有**。对一个个人主页来说这是最糟的失败模式。 |
| 5 | **CDN 单点依赖** | `index.html:47-54` | 运行时从 `unpkg.com` 拉 three 0.170。无 lockfile、无 SRI、无本地回退。unpkg 抖动或企业网络拦截即站点全挂。且 `import * as THREE` 让 tree-shaking 完全失效，整个 `three.module.js`（约 1.2 MB 未压缩）全量下载。 |

#### P1 — 性能级

| # | 缺陷 | 位置 | 说明 |
|---|---|---|---|
| 6 | **变形在 CPU 上逐帧算** | `:355-374`、`:163-176` | 每帧循环 4000 粒子，每次调用 `rotateTarget()` 都 `return { x, y, z }`——**每帧 4000 次对象字面量分配**，60fps 下 ≈ **24 万临时对象/秒**，持续触发 GC。随后 `attributes.position.needsUpdate = true` 触发**整块缓冲重传**（48 KB/帧 ≈ 2.8 MB/s）。应全部搬到顶点着色器：**每帧 CPU 开销归零、缓冲零重传**。 |
| 7 | **冗余全量拷贝** | `:400-408` | `else if (direction !== 0 \|\| morph <= 0.001)` 分支把 `freePositions` 整块复制到 `positions`，即使什么都没变。静止时也在白跑一遍 4000 次循环。 |
| 8 | **逐帧解析 DOM** | `:278-291` | `updateChapters()` 每帧执行，内部对每个章节做 2 次 `Number(chapter.dataset.start)` 字符串→数字转换，再写 2 个 style 属性 + `classList.toggle`。60fps × 4 章 = 每秒 480 次字符串解析。配置应在初始化时解析一次。 |
| 9 | **CSS transition 与逐帧写入打架** | `css/experience.css:98` | `.chapter` 声明了 `transition: opacity .05s linear, transform .05s linear`，而 JS 每帧写同两个属性。两个写入者互相覆盖，产生额外样式重算与合成抖动。必须二选一。 |
| 10 | **无景深、无深度线索** | `:179`、`:237-247` | 只有 `FogExp2` 与 `sizeAttenuation`。黑底 + 0.012 密度 = 雾不可见。结果粒子无前后关系，呈"平的尘埃"感——这就是"轮廓不清晰"。 |
| 11 | **采样按顶点而非按面积** | `:104-127`、`:129-161` | `extractVertices` 收集 `position` 属性的**全部顶点**，`buildModelTargets` 再从中**均匀随机**取点。于是**密度正比于网格细分程度，而不是表面积**：一个立方体的 8 个角会分到和精细曲面同样多的点，大片平面上点却稀疏。模型轮廓因此必然破碎发毛。正确做法是按三角形**面积加权 + 重心坐标采样**。 |

#### P2 — 架构与体验级

| # | 缺陷 | 位置 | 说明 |
|---|---|---|---|
| 12 | **无状态机** | 全局 | 一切是 `progress` 的纯函数，因此无法表达：章节**停留**、相机 dolly 路径、按设备区分章节、浮层/菜单、进出场用不同缓动。README 自陈此局限。 |
| 13 | **`sin(local×π)` 造成"脉冲式"聚合** | `:90-102` | 曲线两端都是 0 → **每到一个章节边界，模型必然完全溶解回隧道**。你从来没能"持住"一个成形的物体，只看到一次闪烁。搭配 `modelRotation` 是全局单调累加、从不按章节重置，重入同一模型时朝向也不一致。 |
| 14 | **`progress === 1` 时变形突变归零** | `:92` | `if (value < chapter.start \|\| value >= chapter.end) continue;`。末章 `end = 1`，而 `progress` 会被 `Math.min(1, …)` 恰好钳到 1 → 末章被判为区间外 → `morph` 从接近 1 **瞬间跳到 0**，末端粒子炸开。 |
| 15 | **末章文案在终点淡出为 0** | `:83-88` + `index.html:40-44` | 淡出区间 `[end-0.07, end] = [0.93, 1]`，`progress = 1` 时 `opacity = 0`。**整段体验的最后一屏是空的**——结尾感彻底消失。 |
| 16 | **相机永不动** | `:187` | `camera.position.set(0, 0, 0)` 之后再未改变。隧道感 100% 来自粒子位移。没有 dolly、没有视差、没有焦点迁移，只有 `camera.rotation.z` 摆 ±0.02 rad。参考站点的核心手感是**相机引领**，这一点完全没做到，所以更像屏保而非穿越。 |
| 17 | **无障碍缺失** | 全局 | 无键盘导航（`wheel.preventDefault` 把原生滚动也废了）、无 `prefers-reduced-motion`、无 `<h1>`、`section` 无 `aria-label`、无 `aria-live`、无 focus 管理。`.hint` 消失后，唯一的操作提示也消失了。 |
| 18 | **模型串行加载、无进度** | `:259-276` | `for` 循环内 `await` 逐个加载（应 `Promise.all`），283 KB 无预加载、无进度条，失败只把 `hint` 文本改成一行英文。 |
| 19 | **无构建** | 全局 | 无打包、无压缩、无文件名哈希（GitHub Pages 无法自定义 Cache-Control，哈希是唯一的缓存失效手段）。 |

### 2.3 一句话总结

> 这不是"代码写得丑"，而是**运行时架构选错了**：把本该在 GPU 上做的每帧变形放到了 CPU，把本该由数据驱动的章节时序硬编码进了三个文件，把本该归一化的时间轴直接绑到了帧率。
> 叙事模型保留，运行时重建。

---

## 第三部分：目标架构

### 3.1 技术选型

| 维度 | 选择 | 理由 | 备选 |
|---|---|---|---|
| 构建 | **Vite 5+** | Node 22 已就绪；dev HMR + 生产哈希产物；`base` 一行配好 GitHub Pages 子路径 | 无（rollup 手配不值得） |
| 语言 | **TypeScript** | 本方案的核心是"一份配置驱动全站"，类型正是**强制这份契约**的手段 | 纯 ESM + JSDoc。若不想引入 TS，仅改扩展名与类型标注，逻辑不变 |
| 3D | **Three.js（npm 锁定版本）** | GLTFLoader、数学库、成熟生态 | 手写 WebGL2（见 3.6，体积可降到约 15 KB） |
| 滚动 | **原生滚动 + sticky/fixed 画布 + 阻尼插值** | 免费获得键盘、滚动条、PageDown/Home/End、读屏器语义。彻底消除缺陷 #4/#17 | 虚拟飞轮（即当前方案，需自行补齐全部 a11y，不推荐） |
| 时间轴 | **自研 scrubber（约 40 行）** | 时间轴是被滚动 scrub 的，不是自播放 tween | GSAP ScrollTrigger（若你想要开箱即用的 pin/snap） |
| 动画帧 | **自研 `dt` 归一化循环** | 必须修掉帧率耦合 | GSAP ticker / three 的 `setAnimationLoop` |
| 点云变形 | **自定义 `ShaderMaterial`** | 缺陷 #6/#10/#11 的统一解法，也是参考站点的做法 | CPU 变形（即现状，不可接受） |

### 3.2 目标文件结构

```
MyPage/
├─ index.html                  # 骨架 + <noscript> + 挂载点（不含任何文案）
├─ src/
│  ├─ main.ts                  # 引导：特性检测 → 预加载 → 挂载 → 启动
│  ├─ config/
│  │  ├─ chapters.config.ts    # ★ 唯一真相源
│  │  ├─ palette.ts            # 色彩令牌
│  │  └─ validate.ts           # 开发期配置断言（生产静默钳制）
│  ├─ core/
│  │  ├─ Clock.ts              # dt 归一化 + 钳制
│  │  ├─ Ticker.ts             # rAF 循环 + 可见性暂停
│  │  ├─ ScrollTimeline.ts     # 滚动 → raw → 章节映射 warp → 阻尼 progress
│  │  ├─ ChapterMachine.ts     # 章节状态机：enter / hold / exit
│  │  ├─ FeatureDetect.ts      # WebGL2 / reduced-motion / 指针类型 / 设备档位
│  │  └─ QualityTier.ts        # 高/中/低档位 + 自适应降级
│  ├─ gl/
│  │  ├─ Renderer.ts           # 渲染器、DPR、resize、dispose
│  │  ├─ PointCloud.ts         # BufferGeometry + 属性装配
│  │  ├─ shaders/
│  │  │  ├─ point.vert.glsl
│  │  │  └─ point.frag.glsl
│  │  └─ CameraRig.ts          # 关键帧飞行路径 + 手持噪声
│  ├─ data/
│  │  ├─ loadPointCloud.ts     # 并行加载 .bin 点数据 + 进度事件
│  │  └─ sampleSurface.ts      # （构建期/离线）面积加权表面采样
│  ├─ ui/
│  │  ├─ ChapterOverlay.ts     # 文案层（由配置生成）
│  │  ├─ OrbitNav.ts           # 轨道式导航（SVG/DOM）
│  │  ├─ Instrument.ts         # 叙事化读数（LIGHTYEAR 式）
│  │  ├─ Preloader.ts          # 真实进度，永不黑屏
│  │  └─ StaticFallback.ts     # 无 WebGL / reduced-motion 路径
│  └─ styles/
│     ├─ tokens.css            # 设计令牌（CSS 变量）
│     ├─ base.css
│     └─ ui.css
├─ tools/
│  └─ build-pointcloud.mjs     # 模型 → 点云 .bin 离线管线
├─ public/
│  └─ pointcloud/              # 量化后的点数据产物
├─ .github/workflows/deploy.yml
├─ vite.config.ts
├─ REFACTOR-PLAN.md            # 本文档
└─ README.md                   # 重构后更新
```

### 3.3 单一配置源

所有内容、时序、镜头、UI 全部由 `chapters.config.ts` 派生。**改这一个文件，全站同步。**

```ts
// src/config/chapters.config.ts
export type Shape = { src: string; spin: number; scale: number; settleAt: number };

export type Chapter = {
  id: string;                       // 用于 #anchor 深链与 DOM id
  index: string;                    // "01"
  navLabel: string;                 // 导航短名
  title: string;
  body: string;
  range: [number, number];          // 在时间轴上的区间（连续、无缝、首尾闭合）
  hold: [number, number];           // 停留窗口：此间形状保持成形
  shape: Shape | null;              // null = 纯隧道
  camera: { pos: [number, number, number]; look: [number, number, number]; fov: number };
  nav: { seeded: boolean };         // 是否允许点导航直达
};

export const CHAPTERS: Chapter[] = [
  {
    id: "void", index: "01", navLabel: "Enter", title: "Enter the void",
    body: "…",
    range: [0.00, 0.24], hold: [0.03, 0.21],
    shape: null,
    camera: { pos: [0, 0, 0], look: [0, 0, -60], fov: 70 },
  },
  {
    id: "origins", index: "02", navLabel: "Origins", title: "…", body: "…",
    range: [0.24, 0.52], hold: [0.30, 0.46],
    shape: { src: "/pointcloud/stream.bin", spin: 0.18, scale: 28, settleAt: 0.32 },
    camera: { pos: [0, 2, -26], look: [0, 0, -46], fov: 62 },
  },
  // …后续章节
];

export const TOTAL_DURATION = 1;    // 归一化时间轴长度
```

**开发期校验器**（`validate.ts`，仅在 `import.meta.env.DEV` 执行）：

- `range[0]` 必须衔接上一章的 `range[1]`，无缝隙无重叠
- 首章 `range[0] === 0`，末章 `range[1] === 1`
- 每章 `hold` 必须被 `range` 包含，且 `hold[0] < hold[1]`
- 末章的淡出区间**必须早于** `range[1]`，防止缺陷 #15 复现
- `shape.src` 引用的文件必须存在
- 导航项数量与章节数一致

任何一条不满足 → 开发环境**直接抛错并指出是哪一章哪一条**。这是把"三处真相源"这个病根一次性切断的关键。

### 3.4 滚动模型：原生滚动 + 时间轴 warp

```ts
// src/core/ScrollTimeline.ts（核心逻辑，约 40 行）
const damp = (a: number, b: number, lambda: number, dt: number) =>
  a + (b - a) * (1 - Math.exp(-lambda * dt));   // 帧率无关的指数阻尼

/** 把物理滚动位置重映射到时间轴，使 hold 段"吃掉"更多滚动距离 */
function warp(raw: number): number {
  let acc = 0;
  for (const ch of CHAPTERS) {
    const [s, e] = ch.range;
    const [hs, he] = ch.hold;
    const span = e - s;
    const holdSpan = he - hs;
    // 停留段占 70% 的滚动距离，过渡段只占 30%
    const holdWeight = 0.7, moveWeight = 0.3;
    const scrollShare = holdSpan / span * holdWeight + (1 - holdSpan / span) * moveWeight;
    // …按 scrollShare 累积，落在哪一段就在该段内线性插值
    acc += scrollShare;
  }
  return /* 归一化后的时间轴位置 */;
}

export function update(dt: number) {
  const raw = window.scrollY / (document.documentElement.scrollHeight - innerHeight);
  target = warp(clamp(raw, 0, 1));
  progress = damp(progress, target, 6.0, dt);
}
```

**为什么这样设计：**

| 收益 | 说明 |
|---|---|
| 消灭缺陷 #1 #4 #17 | `dt` 归一化修掉帧率耦合；原生滚动让键盘、滚动条、`PageDown`、读屏器语义**自动可用**；JS 失败时页面仍是一份可正常滚动的长文档 |
| 消灭 `SENSITIVITY_IN_*` 那套 hack | 当前代码用「边界附近灵敏度 ×8」来模拟停顿，本质是在飞轮模型里硬凑停滞感。**warp 映射是从时间轴结构自然长出来的**——停留段自动占更多滚动距离 |
| 方向天然可逆 | 上下滚动即前进后退，无需额外逻辑 |
| 移动端免费 | 原生滚动 = 原生惯性、原生橡皮筋、原生地址栏收起行为 |

**关于 `scroll-snap`**：**不要用 CSS snap**，它会和阻尼插值互相打架（浏览器吸附动画与你的 lerp 争夺同一个 `scrollY`）。停顿感由 `warp()` 提供，不靠吸附。

**关于"磁吸到章节中心"**（README 第四步提到的需求）：如果需要，实现方式是在滚动空闲 300ms 后，用 `window.scrollTo({ behavior: 'smooth' })` 把 `scrollY` 带到最近的章节中心。这是显式、可控、可关的，不与 lerp 冲突。

### 3.5 GPU 点云着色器（本次重构的核心）

只保留两个属性缓冲：`position`（自由隧道位置）和 `aTarget`（模型采样位置），变形在顶点着色器里 `mix`。**每帧 CPU 不碰顶点数据。**

```glsl
// src/gl/shaders/point.vert.glsl
uniform float uMorph;         // 0 = 纯隧道, 1 = 完全聚合
uniform float uSpin;          // 模型自转角（弧度）
uniform float uTime;          // 秒
uniform float uSize;          // 基础点尺寸
uniform float uPixelRatio;
uniform float uFocal;         // 对焦距离（相机前方正距离）
uniform float uAperture;      // 光圈强度：虚化幅度
uniform float uJitter;        // 过渡期扰动强度
uniform float uMaxPointSize;  // 运行时从驱动查询的硬件上限

attribute vec3  aTarget;
attribute float aSeed;        // 每点随机种子 [0,1)
attribute vec3  aColor;

varying vec3  vColor;
varying float vAlpha;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  // 1) 过渡缓动：中段加速、首尾平缓，避免机械的线性插值
  float m = smoothstep(0.0, 1.0, uMorph);

  // 2) 目标点在模型空间绕 Y 轴自转
  vec3 tgt = aTarget;
  tgt.xz = rot(uSpin) * tgt.xz;

  // 3) 过渡期扰动：在 m 的中段（0.5 附近）最强，做成"星尘重排"的层次
  float burst = m * (1.0 - m) * 4.0;                  // 0 → 1 → 0
  vec3 swirl = vec3(
    sin(uTime * 0.90 + aSeed * 62.83),
    cos(uTime * 0.70 + aSeed * 41.31),
    sin(uTime * 1.10 + aSeed * 27.18)
  );
  vec3 p = mix(position, tgt, m) + swirl * burst * uJitter;

  vec4 mv    = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;                                 // 相机前方的正距离

  // 4) 伪景深：弥散圆正比于 到对焦面的距离
  float coc  = clamp(abs(depth - uFocal) / max(uFocal, 0.001), 0.0, 1.0);
  float blur = coc * uAperture;

  // 5) 点尺寸 = 透视衰减 × 虚化放大，并尊重硬件上限
  float size = uSize * uPixelRatio * (300.0 / max(depth, 0.001));
  size *= 1.0 + blur * 2.5;
  gl_PointSize = clamp(size, 1.0, uMaxPointSize);

  // 6) 虚化越强越透明，避免加色混合下糊成一片白光
  vAlpha = mix(1.0, 0.25, blur);
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}
```

```glsl
// src/gl/shaders/point.frag.glsl
varying vec3  vColor;
varying float vAlpha;

void main() {
  // 解析式软圆盘：无需纹理采样，省一次 fetch 和一张 texture
  vec2  uv = gl_PointCoord - 0.5;
  float d  = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d);
  a *= a;                                              // 更接近高斯核
  gl_FragColor = vec4(vColor, a * vAlpha);
}
```

**装配（`PointCloud.ts` 关键部分）：**

```ts
const material = new THREE.ShaderMaterial({
  vertexShader, fragmentShader,
  uniforms: {
    uMorph: { value: 0 }, uSpin: { value: 0 }, uTime: { value: 0 },
    uSize: { value: 2.4 }, uPixelRatio: { value: renderer.getPixelRatio() },
    uFocal: { value: 60 }, uAperture: { value: 0.55 }, uJitter: { value: 6.0 },
    uMaxPointSize: { value: maxPointSize },
  },
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
});

// 只写 uniform，不碰 attribute —— 每帧 CPU 开销与顶点数无关
function tick(dt: number, morph: number, spin: number) {
  uniforms.uMorph.value = morph;
  uniforms.uSpin.value  = spin;
  uniforms.uTime.value += dt;
}
```

**实现思路**
- 变形的两个端点各是一份静态缓冲，GPU 用 `mix` 插值。每帧 CPU 只写 4 个 uniform，复杂度 O(1)，与粒子数无关。
- 景深用「尺寸放大 + 亮度衰减」伪造弥散圆。视觉上足以读出前后关系，代价几乎为零——这正是参考站点的原话（"faked but very performant"）。
- 加色混合 + `depthWrite: false` → **无需深度排序**，省掉每帧 CPU 排序或 OIT。

**注意事项**
- **`gl_PointSize` 有硬件上限，且移动端远低于桌面端。** 必须运行时查询：
  ```ts
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); // [min, max]
  const maxPointSize = Math.min(range[1], 64); // 桌面常见 1024，ANGLE/移动端常被钳到 63/64
  ```
  许多移动 GPU 与 ANGLE 后端把上限钳在 **63 或 64**，超出的会被**静默截断**——景深模糊在大尺寸下会失效且看不出原因。这是个很容易踩进去且难定位的坑。
- `gl_FragColor` 在 three 的 `ShaderMaterial` 默认 GLSL1 下可用；若将来切到 `glslVersion: GLSL3` 需改成 `out` 变量并注意内置 attribute 声明方式的变化。
- 单个大点是**实心圆盘**，不是真正的散景核。若想更接近真实 bokeh，可给每个粒子按种子放射状铺 2–3 个子点，或把 fragment 里的核形状换成六边形掩膜。属于第 5 阶段的打磨项。
- 加色混合下大量重叠会过曝发白。所以 `vAlpha` 必须随 `blur` 衰减（已在着色器里处理）；若仍偏亮，调低 `uAperture` 或改用 `NormalBlending` + 深度排序。

**潜在坑点**
- **可选的量化瘦身**：位置完全不需要 32 位浮点。离线把目标点归一化到 `[-1,1]` 后存为 **Int16**，运行时 `attribute.setNormalized(true)`，GPU 自动还原到 `[-1,1]`，再用一个 `uTargetScale` uniform 放大。**内存与显存直接减半**，精度对点云绰绰有余。
- **不要用 Draco 压点云。** Draco 是给三角网格设计的；位置数组本身就是裸 float 序列，直接量化 + gzip 更小更快，还省掉一个 WASM 解码器。
- 设备像素比（DPR）是移动端头号杀手。低档位必须把 DPR 钳到 1.0–1.5。
- 景深放大会让**填充率**暴涨：点尺寸 ×3.5 → 面积 ×12。除尺寸上限外，还要给 `uAperture` 设档位上限，并监控帧时间。

### 3.6 采样质量：面积加权 + 重心坐标

修掉缺陷 #11 的具体算法：

```ts
// src/data/sampleSurface.ts
export function sampleSurface(mesh: THREE.Mesh, count: number): Float32Array {
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  // 1) 累积三角形面积 → 前缀和数组
  const cdf = new Float32Array(triCount);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    total += cross.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).length() * 0.5;
    cdf[t] = total;
  }

  // 2) 二分查找面积区间 + 3) 重心坐标均匀采样
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = lowerBound(cdf, Math.random() * total);
    // 重心坐标均匀采样：r1 = sqrt(rand) 保证在三角形内均匀
    const r1 = Math.sqrt(Math.random()), r2 = Math.random();
    const w0 = 1 - r1, w1 = r1 * (1 - r2), w2 = r1 * r2;
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    out[i * 3]     = a.x * w0 + b.x * w1 + c.x * w2;
    out[i * 3 + 1] = a.y * w0 + b.y * w1 + c.y * w2;
    out[i * 3 + 2] = a.z * w0 + b.z * w1 + c.z * w2;
  }
  return out;
}
```

这一步在**离线构建期**跑（`tools/build-pointcloud.mjs`），产物是对齐的裸位置数组 `.bin`。运行时只需 `fetch` + `new Float32Array(buffer)`，无需 GLTFLoader，也无需在浏览器里解析网格。

> 副作用：`three` 的运行时依赖可能因此只剩「数学 + 渲染器封装」。**第 5 阶段可以重新评估是否还需要 Three.js**——一个只渲染点云的自研 WebGL2 渲染器约 15 KB，而 three 全量约 330 KB（gzip）。用 300 KB 的依赖只为了画点，性价比不高。建议先按 Three.js 推进（第 1–3 阶段快），到第 5 阶段再决策。

### 3.7 场景结构：分层

```
┌─ DOM 层（原生滚动，可访问、可搜索、可读屏）──────────────┐
│  章节文案 / 导航 / 读数  ← 全部由 chapters.config 派生     │
├─ 浮层（z-index 高，pointer-events 可控）────────────────┤
│  预加载器（真实进度）· 深链浮层（#close 关闭）· 降级静帧    │
├─ 画布层（position: fixed; inset: 0; pointer-events: none）│
│  PointCloud（点云 + 伪景深）→ CameraRig（关键帧 + 手持噪声）│
└─ 排版层：排版令牌（tokens.css）· GPU 是合成常客，DOM 是主人 ─┘
```

### 3.8 质量分级与自适应降级

```ts
// src/core/QualityTier.ts
export type Tier = "high" | "medium" | "low";

export function detectTier(): Tier {
  const gl = document.createElement("canvas").getContext("webgl2");
  const dpr = window.devicePixelRatio;
  const mem = (navigator as any).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const touch = matchMedia("(pointer: coarse)").matches;
  if (!gl) return "low";
  if (touch || mem <= 4 || cores <= 4 || dpr > 2.5) return "medium";
  return "high";
}

export const PRESETS = {
  high:   { points: 120_000, dpr: 2.0, dof: true,  noise: true,  jitter: 6.0 },
  medium: { points:  40_000, dpr: 1.5, dof: true,  noise: false, jitter: 4.0 },
  low:    { points:  12_000, dpr: 1.0, dof: false, noise: false, jitter: 0.0 },
} as const;
```

外加**滚动帧时间自适应**：维护最近 60 帧的移动平均帧时间，连续 2 秒超出 20 ms 就降一档（`high → medium → low`），只降不升，避免抖动。

### 3.9 降级与无障碍（个人主页的底线）

| 场景 | 行为 |
|---|---|
| **无 WebGL2** | 渲染静态 HTML/CSS 版本的全部章节——**用同一份 `chapters.config`** 生成。渐变星空底 + 正常排版。绝不留黑屏 |
| **`prefers-reduced-motion: reduce`** | 关闭飞轮/视差/相机运动；`uMorph` 直接跳变而非插值；章节改为交叉淡入。内容一字不少 |
| **JS 完全失败** | `<noscript>` 内嵌完整内容 + 样式。`<html>` 不加 `overflow: hidden` |
| **键盘** | 原生滚动已覆盖 `↑↓/PgUp/PgDn/Space/Home/End`；`←/→` 额外绑定上一章/下一章 |
| **深链** | 每个章节 `id` 可锚点直达（`#chapter-origins`）；同时支持 `#next` / `#prev` / `#close` 显式动词 |
| **读屏器** | 唯一的 `<h1>`；章节用 `<section aria-labelledby>`；文案层 `aria-live="polite"`；导航是真实 `<nav><a>`；skip-link |
| **焦点** | 可见 focus ring；浮层打开时焦点陷阱，`Esc` 关闭（即 `#close` 语义） |

---

## 第四部分：分期实施计划

每阶段结束都可发布上线，不存在"重构到一半站点是坏的"。

### Phase 0 — 基线与脚手架
**目标**：在不改变任何视觉的前提下，把工程底子搭好。

- 当前状态打 tag（`git tag pre-refactor`）并录一段基线视频
- 跑一次基线 Lighthouse，记录 LCP / TBT / 包体积 / 帧率
- `npm create vite@latest`，引入 `three` + `@types/three`（npm 锁定版本）
- 配置 `vite.config.ts` 的 `base` 为仓库子路径（GitHub Pages 项目页需要）
- ESLint + Prettier + `.nvmrc`（Node 22）
- `.github/workflows/deploy.yml`：build → 发布到 Pages

**验收**：页面从 Vite 本地跑起来，视觉与现状**逐像素一致**，但已不再引用任何 CDN。

---

### Phase 1 — 单一配置源 + 原生滚动
**目标**：切断"三处真相源"，把飞轮换成原生滚动。

- 写 `chapters.config.ts`，把现有 4 章的文案与区间迁进去
- 写 `validate.ts` 并在 `main.ts` 里 dev-only 调用
- 章节文案、导航、进度读数全部改为**从配置生成**（`index.html` 里删掉硬编码 section）
- `ScrollTimeline.ts`：原生滚动 → `warp()` → 阻尼 `progress`
- 删除 `wheel` / `touchstart` / `touchmove` 三套事件处理与 `SENSITIVITY_*` 常量
- 修掉缺陷 #1（`dt` 归一化）、#2（随事件一起消失）、#3、#8、#9、#15

**验收**：改 `chapters.config.ts` 里任意一章的标题，页面、导航、读数**同时**更新，无需碰第二个文件。Firefox / Chrome 手感一致。键盘可完整遍历。

---

### Phase 2 — GPU 点云着色器
**目标**：把变形从 CPU 搬到 GPU，并第一次做出真正的景深。

- `PointCloud.ts` + `point.vert.glsl` / `point.frag.glsl`
- 属性装配：`position`（隧道）+ `aTarget`（模型）+ `aSeed` + `aColor`
- 运行时查询 `ALIASED_POINT_SIZE_RANGE` 并写入 `uMaxPointSize`
- `uFocal` 由 `progress` 驱动；`uAperture` 按档位
- 修掉缺陷 #6、#7、#10

**验收**：Chrome DevTools Performance 里，每帧**没有**任何 `bufferSubData` 调用；脚本耗时与粒子数解耦。10 万点 60fps。

---

### Phase 3 — 相机路径与章节状态机
**目标**：让相机真正飞起来，让模型真正**停住**。

- `CameraRig.ts`：按配置的 `camera` 关键帧做 `CatmullRomCurve3` 位置插值 + `lookAt` 目标插值 + `fov` 插值，叠加极弱的多频噪声（避免机械感）
- `ChapterMachine.ts`：`enter → hold → exit`，`uMorph` 在 `hold` 段**保持 1.0**，进出场用不同曲线
- 修掉缺陷 #12、#13、#14、#16

**验收**：每个章节都有明确的"成形—停留—离场"三段式，模型在停留段内是**稳定的**（不再闪烁）；相机有可感知的前进与视差；`progress = 1` 时最后一帧是完整的、有终止感的画面。

---

### Phase 4 — UI / 导航 / 仪表盘
**目标**：把"页面"做成"仪表"。

- `OrbitNav.ts`：轨道式导航（SVG 轨道环 + 当前章节高亮 + hover 光晕），移动端换竖向列表
- `Instrument.ts`：叙事化读数（把 `progress` 映射成一个世界内的量），数字用等宽字体 + 单调滚动
- `Preloader.ts`：真实进度（`fetch` 的 `onprogress`），永不留黑屏
- 排版令牌 `tokens.css`：字号阶梯、色板、间距、缓动曲线统一收口
- 深链 + `#next/#prev/#close` 动词 + `Esc` 关闭浮层

**验收**：**全程无需鼠标**即可遍历所有章节；每个章节都能深链直达；读数随滚动连续变化且不抖动。

---

### Phase 5 — 降级、无障碍与性能加固
**目标**：把这些失败模式逐一消灭：无 WebGL / reduced-motion / 无 JS / 低端设备。

- `StaticFallback.ts`：从同一份配置生成静态版本
- `prefers-reduced-motion` 全链路
- `<noscript>` 内嵌内容
- 质量档位 + 滚动帧时间自适应降级
- 页面不可见时暂停 rAF；卸载时 `dispose()` 几何体/材质/纹理
- **决策点**：评估是否把 Three.js 替换为自研 WebGL2 渲染器（见 3.6 副作用）
- 跑完整 Lighthouse / Web Vitals，对比 Phase 0 基线

**验收**：禁用 JS、禁用 WebGL、开启 reduce-motion、CPU 节流 4× —— 四种极端条件下**都能读到全部内容**。Lighthouse Accessibility ≥ 95。

---

### Phase 6 — 内容替换与上线
**目标**：把"教程 demo"变成"个人品牌"。

- 离线点云管线 `tools/build-pointcloud.mjs`：面积加权采样 → 归一化 → Int16 量化 → 写 `.bin`
- 用**自己的内容**替换 Duck / Fox（见下方选题建议），保持 283 KB → 目标 < 60 KB
- OG 图、favicon、`<meta>`、`sitemap.xml`、`robots.txt`
- CI 自动部署、文件名哈希、README 重写

**验收**：线上站点在 GitHub Pages 可访问；首屏 LCP < 2.0s；模型资源总量 < 60 KB。

#### 内容选题建议（这是"不满意"的另一半原因）
选题原则：**点云适合表现"有体积感、有清晰轮廓、可在空中自转"的东西**。

| 方向 | 具体建议 | 为什么适合点云 |
|---|---|---|
| 个人标识 | 姓名首字母的 3D 立体字 / 个人 logo 标记 | 轮廓清晰，点云下可读性最好；天然属于"个人主页"语义 |
| 代码与工具 | 机械键盘、笔记本电脑、终端窗口的 3D 造型 | 与"开发者主页"叙事直接对应，比橡皮鸭有信息量 |
| 抽象意象 | 低多边形地球 / 星图 / 网格地形 | 呼应"隧道穿梭"的太空语境，且模型易获得 |
| 作品集 | 你自己项目里的核心物件或 UI 立体化 | 唯一能真正表达"你是谁"的方向 |

**最不推荐**：任何 Khronos / three.js 示例库里的现成模型。

---

## 第五部分：需要你确认的决策点

计划里这几处，你的选择会显著改变实现路径：

| # | 决策 | 选项 A（推荐） | 选项 B | 影响 |
|---|---|---|---|---|
| 1 | **滚动模型** | 原生滚动 + 阻尼 | 保留虚拟飞轮（改良版） | 选 B 需自行补齐键盘/读屏器/降级，工作量 +30% |
| 2 | **语言** | TypeScript | 纯 ESM + JSDoc | 配置校验的强制力；选 B 靠运行时报错 |
| 3 | **粒子主角** | 换成你自己的内容 | 先沿用 Duck/Fox，只重做技术 | 决定 Phase 6 是否需要 3D 建模/找模型 |
| 4 | **是否引入 GSAP** | 不引入，自研 40 行 scrubber | 引入 GSAP ScrollTrigger | 包体积 +约 30 KB gz vs 省掉自研时间轴 |
| 5 | **Three.js 去留** | 保留（第 5 阶段再评估） | 现在就换自研 WebGL2 | 包体积 330 KB vs 15 KB（gz），但开发慢 |

---

## 第六部分：风险与坑点清单

| 风险 | 影响 | 规避 |
|---|---|---|
| **`gl_PointSize` 硬件上限被静默钳制** | 移动端景深失效，且难定位原因 | 运行时查 `ALIASED_POINT_SIZE_RANGE`，取 `min(max, 64)` 写入 uniform |
| 景深放大导致填充率暴涨 | 中端设备掉帧 | 尺寸上限 + `uAperture` 按档位 + 帧时间自适应降级 |
| 加色混合过曝 | 高密度区域糊成白块 | `vAlpha` 随 blur 衰减；必要时切 `NormalBlending` + 深度排序 |
| 点云在 iOS Safari 上被系统降频 | 低电量模式下 rAF 暂停 | 监听 `visibilitychange`，恢复时重置 `Clock` 的 `lastTime`，避免 `dt` 巨大跳变 |
| 阻尼插值在大 `dt` 下过冲 | 切回标签页时画面瞬移 | `dt` 钳制上限（如 `Math.min(dt, 1/20)`） |
| 离线采样对高模过慢 | 构建期超时 | 采样前先用 `gltf-transform` 的 `simplify` 降面；或限制采样三角形数 |
| 配置与资源不同步（新增章节忘了放 `.bin`） | 运行时 404 | `validate.ts` 在 dev 断言文件存在；CI 里跑一次构建 + 冒烟测试 |
| GitHub Pages 无法自定义响应头 | 缓存策略受限 | 文件名哈希 + `index.html` 设 `cache-control: no-cache`（meta 层能做到的部分） |
| 旧版本浏览器不支持 WebGL2 | 白屏 | 特性检测 + `StaticFallback`（Phase 5） |

---

## 第七部分：性能预算与度量方法

| 指标 | 现状（基线待测） | 目标 | 度量方式 |
|---|---|---|---|
| 帧率（中端笔记本） | 待测 | 稳定 60 fps | Chrome DevTools Performance 录制 |
| 帧率（中端手机） | 待测 | ≥ 30 fps | 真机 + 远程调试 |
| 每帧 JS 脚本耗时 | 待测（随粒子数线性增长） | < 4 ms 且与粒子数解耦 | Performance 面板 Scripting 轨道 |
| 每帧 GPU 缓冲上传 | 约 48 KB/帧 | **0** | 搜索 Performance 里的 `bufferSubData` |
| LCP | 待测（当前是黑页起手） | < 2.0 s | Lighthouse |
| JS 包体积（gzip） | 约 330 KB（全量 three，无 tree-shaking） | < 200 KB | `vite build` + `source-map-explorer` |
| 模型资源总量 | 283 KB | < 60 KB | 构建产物统计 |
| Lighthouse Accessibility | 待测（预计很低） | ≥ 95 | Lighthouse |
| 极端条件可读性 | 全部失败 | 4/4 通过 | 禁用 JS / 禁用 WebGL / reduce-motion / 4× CPU 节流 |

**度量纪律**：Phase 0 必须先测基线并记录，否则 Phase 5 的"优化成果"没有对照。基线数据写进 `README.md`，每次阶段验收后更新。

---

## 附：改造前后架构对照

```
【现状】
滚轮事件 → velocity（帧率相关，deltaMode 未归一化）
                ↓
        progress += velocity  ← 三处配置各自为政
                ↓
   ┌────────────┬──────────────┬──────────────┐
   │ HTML 区间   │ MODEL_CHAPTERS│ BOUNDARIES   │
   │ data-start  │ start/end     │ 灵敏度窗口    │
   └────────────┴──────────────┴──────────────┘
                ↓
   每帧：4000 次对象分配 + 整块缓冲重传 → GPU
   相机：静止不动

【目标】
原生滚动 → raw → warp(时间轴) → 阻尼 progress  ← chapters.config.ts（唯一真相源）
                ↓
   ┌────────────┬──────────────┬──────────────┐
   │ ChapterMachine│ CameraRig   │ 所有 DOM 层   │
   │ enter/hold/exit│ 关键帧+噪声  │ 导航/读数/文案 │
   └────────────┴──────────────┴──────────────┘
                ↓
   每帧：只写 4 个 uniform（O(1)） → GPU 顶点着色器做变形 + 伪景深
   相机：沿 CatmullRom 路径飞行
```

---

**下一步**：确认第五部分的 5 个决策点，我按 Phase 0 开脚手架。若想先看效果，也可以跳过确认，直接进 Phase 1（配置源 + 原生滚动）——这一阶段不改视觉，风险最低，且能立刻验证"改一个文件全站同步"这个核心假设。
