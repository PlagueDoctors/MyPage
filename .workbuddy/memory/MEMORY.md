# MyPage 项目长期备忘

## 项目定位

个人 GitHub Pages 主页（用户名主题 "Blue Toaster"）。首页是滚轮驱动的粒子空间体验，
另有 `test.html` 作为 2D 代码雨彩蛋页。仓库已连 origin/main。

## 当前状态（2026-09-21）

**重构方案已产出，尚未开始任何代码改动。**

- 方案文档：`REFACTOR-PLAN.md`（详细，含缺陷清单、着色器代码、7 阶段计划、风险表）
- 当日记录：`.workbuddy/memory/2026-09-21.md`

## 已确定的重构方向（待用户最终确认）

| 项 | 决定 |
|---|---|
| 构建 | Vite 5+（Node 22 已就绪），产物部署 GitHub Pages |
| 依赖 | Three.js 走 npm 锁定版本，**废弃 unpkg importmap** |
| 滚动 | **原生滚动 + warp 映射 + dt 归一化阻尼**，废弃虚拟飞轮与 `SENSITIVITY_*` |
| 配置 | `src/config/chapters.config.ts` 单一真相源 + dev-only 校验器 |
| 变形 | 自定义 `ShaderMaterial`，GPU 端 `mix`，每帧只写 uniform（O(1)） |
| 景深 | 着色器内伪景深：`coc = |depth − uFocal| / uFocal` |
| 章节 | `enter / hold / exit` 三段式（取代 `sin(local×π)` 脉冲） |
| 采样 | 面积加权 + 重心坐标（`r1 = sqrt(rand)`），离线构建成量化 `.bin` |

## 待用户确认的决策点

1. 原生滚动 vs 改良飞轮
2. TypeScript vs 纯 ESM + JSDoc
3. 粒子主角是否换成自己的内容（现为 Khronos 官方示例模型 Duck/Fox）
4. 是否引入 GSAP ScrollTrigger
5. Three.js 去留（是否换自研 WebGL2 渲染器，约 15 KB vs 330 KB gz）

## 项目约定

- **不要动 `js/code-rain.js`**：它是独立无耦合的彩蛋页，重构范围之外
- 重构期间保持"每阶段可上线"——不允许出现重构到一半站点不可用的状态
- 任何改动前先在测试环境验证；生产变更（构建配置、依赖升级、部署方式）先备份
- `models/Duck.glb`、`models/Fox.glb` 是 Khronos 示例模型，计划在 Phase 6 替换

## 本机环境限制（每次操作前须知）

- **`Bash` 工具不可用**：shim 报 `dirname: command not found`，PATH 被破坏
- **`PowerShell` 工具不回传 stdout**：需 `... | Out-File X -Encoding UTF8` 落盘后
  用 `Read` 工具读取；仅 `Invoke-CommandInDesktopApp` 启动的子进程输出可被捕获
- 文件检索/读取一律用 `Glob` / `Grep` / `Read`
- Maven 相关：`mvn` 不在 PATH；`mvn clean` 会删掉 `target/` 下的 `-l` 日志文件
