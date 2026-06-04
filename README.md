# Blue Toaster

个人 GitHub Pages 主页，黑色背景搭配 Canvas 实现的灰白色代码雨动画。

## 项目结构

```
MyPage/
├── index.html          # 主页面
├── css/
│   └── style.css       # 页面样式
├── js/
│   └── code-rain.js    # 代码雨动画逻辑
└── README.md
```

所有资源均通过相对路径引用，可直接部署到 GitHub Pages。

## 功能特性

- 全屏黑色背景
- Canvas 代码雨效果：字符自上而下流动
- 每列头部字符最亮，向上依次衰减形成拖尾
- 响应式布局，窗口缩放时自动适配

## 本地预览

在项目根目录启动本地服务器：

```powershell
python -m http.server 8765
```

浏览器访问 [http://127.0.0.1:8765](http://127.0.0.1:8765)

## 部署到 GitHub Pages

1. 将项目推送到 GitHub 仓库
2. 进入仓库 **Settings → Pages**
3. 在 **Build and deployment** 中选择 **Deploy from a branch**
4. 分支选择 `main`，目录选择 `/ (root)`
5. 保存后等待部署完成，即可通过 `https://<username>.github.io/<repo>/` 访问

## 自定义

| 文件 | 说明 |
|------|------|
| `index.html` | 修改页面标题与正文内容 |
| `css/style.css` | 调整字体、颜色、布局 |
| `js/code-rain.js` | 调整 `fallSpeed`（速度）、`trailLength`（拖尾长度）、`fontSize`（字符大小）等参数 |

## 技术栈

- HTML5
- CSS3
- JavaScript (Canvas API)
