# MyPage 项目长期备忘

## 项目定位

个人 GitHub Pages 主页（用户名主题 "Blue Toaster"）。首页是滚轮驱动的粒子空间体验，
另有 `test.html` 作为 2D 代码雨彩蛋页。仓库已连 origin/main。

## 当前状态（2026-09-21）

**重构已落地**：旧动画（`js/particle-experience.js` + `css/experience.css`）已删除，
新实现（Vite + TS + GPU 点云着色器）已提交。旧版在 `git tag pre-refactor`。

- 方案文档：`REFACTOR-PLAN.md`（顶部有实施进度表）
- 使用说明：`README.md`
- 当日记录：`.workbuddy/memory/2026-09-21.md`

**待办**：① 用户需 push 并设置 Pages Source（见下方「部署约定」）
② 线上渲染效果尚未肉眼校准（`uAlpha` / `pointSize` / `HOLD_SCROLL_BOOST` 等数值待调）
③ 章节文案仍是占位，粒子形状仍是程序化生成（sphere / knot / disc）

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

## 决策点（已由实现落地，不再是待定项）

| 决策 | 结果 |
|---|---|
| 原生滚动 vs 改良飞轮 | **原生滚动 + warp 映射**（已实现） |
| TypeScript vs 纯 ESM + JSDoc | **TypeScript**（已实现） |
| GSAP ScrollTrigger | **不引入**，自研 scrubber（已实现） |
| Three.js 去留 | **保留**，tree-shaking 后 117.5 KB gz（Phase 5 可再评估自研 WebGL2） |
| 粒子主角内容 | **仍是程序化占位形状**，待换成用户自己的内容 |

## 项目约定

- **不要动 `js/code-rain.js`**：它是独立无耦合的彩蛋页，重构范围之外
- 重构期间保持"每阶段可上线"——不允许出现重构到一半站点不可用的状态
- 任何改动前先在测试环境验证；生产变更（构建配置、依赖升级、部署方式）先备份
- `models/Duck.glb`、`models/Fox.glb` 是 Khronos 示例模型，计划在 Phase 6 替换

## 部署约定（重要）

- **站点必须走构建**。根 `index.html` 是 Vite 源码入口（引用 `/src/main.ts`），
  **不能**把仓库根目录当静态站点发布 —— 浏览器会因 MIME 类型不是 JavaScript
  而拒绝执行模块脚本，导致空白页（2026-09-21 实际发生过一次）。
- Pages 的 Source 必须是 **GitHub Actions**，由 `.github/workflows/deploy.yml`
  构建并部署 `dist/`。`actions/configure-pages` **不会**自动切换
  （`enablement` 默认 `false`，且文档要求 PAT，`GITHUB_TOKEN` 不够）。
  等效命令：`gh api -X PUT repos/PlagueDoctors/MyPage/pages -f build_type=workflow`
- 线上快速排查：
  `curl -s https://plaguedoctors.github.io/MyPage/ | grep -o 'src="[^"]*"'`
  —— `./assets/index-*.js` 是产物（正常），`/src/main.ts` 是源码目录发错了。
- 站点 URL：https://plaguedoctors.github.io/MyPage/ （账号 PlagueDoctors）
- 页面内置**引导看门狗**：模块脚本 3 秒内没执行就把排查面板显示出来，
  不会再出现"无声黑屏"。
- ⚠️ **`deploy-pages` 报成功 ≠ 站点已更新**。Source 仍是 legacy 时，
  GitHub 会同时跑一条 `pages build and deployment`，它最后落地、把站点覆盖回源码目录，
  于是「所有指示灯全绿，站点却是坏的」（2026-09-21 实际发生）。
  **旁证**：Actions 列表里出现 `pages build and deployment` 就说明 Source 还是 legacy。
- 部署后必须验证**线上真实内容**，不能只看 CI：
  `curl -s https://plaguedoctors.github.io/MyPage/ | grep -o 'src="[^"]*"'`
- `deploy` job 末尾已有**冒烟测试**（`e167a49`）：断言线上 HTML 含 `assets/index-`，
  不满足就报红并提示去改 Pages Source。用 PyYAML 校验过语法。

## 本机环境限制（每次操作前须知）

- **无法 `git push`**：报 `error: cannot spawn sh`，随后
  `fatal: could not read Username ... terminal prompts disabled`。
  已排除工具链问题（`sh.exe` 可执行、GCM v2.5.0 可执行、无 `core.hooksPath`、
  无活动 hook、凭据确实在 Windows 凭据管理器里），判断为沙箱阻止子进程/网络。
  → **本环境只能 commit，push 需用户自己在 IDE 或终端完成**
- **`Bash` 工具不可用**：shim 报 `dirname: command not found`，PATH 被破坏
- **`PowerShell` 工具不回传 stdout**：需 `... | Out-File X -Encoding UTF8` 落盘后
  用 `Read` 工具读取；仅 `Invoke-CommandInDesktopApp` 启动的子进程输出可被捕获
- 文件检索/读取一律用 `Glob` / `Grep` / `Read`
- Maven 相关：`mvn` 不在 PATH；`mvn clean` 会删掉 `target/` 下的 `-l` 日志文件
