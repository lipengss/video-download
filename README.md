# VideoDL Pro

全平台视频下载工具，基于 Electron + Vite + React + TypeScript 构建。

## 支持平台

- **Instagram** — 帖子、Reels、Stories、TV
- **抖音 / TikTok** — 短视频、合集
- **Bilibili (B站)** — 视频、番剧
- **YouTube** — 视频、播放列表
- 以及 yt-dlp 支持的数百个站点

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron |
| 前端 | React 18 + TypeScript |
| 构建 | Vite + electron-builder |
| 样式 | Tailwind CSS 4 + Radix UI |
| 下载引擎 | yt-dlp / btch-downloader / Playwright |
| 图标 | Lucide React |

## 项目结构

```
├── main.js              # Electron 主进程
├── preload.js           # 预加载脚本 (IPC 桥接)
├── server.js            # Instagram Web 服务器 (Express)
├── index.js             # Instagram CLI 下载工具
├── engine/              # 下载引擎
│   ├── ytdlp.js         # yt-dlp 引擎 (本地)
│   ├── btch.js          # btch-downloader 引擎 (远程 API)
│   ├── bilibili.js      # B站引擎
│   ├── playwright.js    # Playwright 浏览器自动化引擎
│   └── license.js       # 许可证管理
├── src/                 # React 渲染进程源码
│   ├── App.tsx          # 应用主组件
│   ├── components/      # UI 组件
│   ├── hooks/           # 自定义 Hooks
│   ├── lib/             # 工具函数 & 类型定义
│   └── public/          # 静态资源
├── assets/              # 应用图标 & 二进制资源
├── downloads/           # 默认下载目录
└── dist/                # electron-builder 打包输出
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- (可选) yt-dlp.exe 放入 `assets/` 目录以启用本地引擎

### 安装

```bash
npm install
```

### 开发

```bash
# 同时启动 Vite 开发服务器 + Electron
npm run dev

# 或分别启动
npm run dev:vite     # 仅 Vite (http://localhost:5173)
npm run dev:electron # 仅 Electron
```

### 构建

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# 当前平台
npm run build
```

构建产物输出到 `dist/` 目录。

## 使用方式

### 桌面应用 (Electron)

启动应用后粘贴视频链接即可解析下载，支持：
- 批量下载队列
- 画质选择
- Cookie 管理（登录平台）
- 代理设置
- 下载历史记录

### CLI 工具 (Instagram)

```bash
node index.js <instagram-url>

# 示例
node index.js https://www.instagram.com/reel/ABC123/
node index.js https://www.instagram.com/p/ABC123/
```

### Web 服务器 (Instagram)

```bash
node server.js
# 访问 http://localhost:3000
```

## 下载引擎

| 引擎 | 类型 | 说明 |
|------|------|------|
| **yt-dlp** | 本地 | 全功能引擎，支持数百站点，需 `assets/yt-dlp.exe` |
| **btch-downloader** | 远程 API | 后端引擎，主要用于 Instagram 等平台 |
| **Bilibili** | 本地 | B站专用引擎 |
| **Playwright** | 浏览器自动化 | 处理需要浏览器渲染的平台 |

应用启动时自动检测可用引擎，优先使用本地 yt-dlp。

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发环境 |
| `npm run build` | 构建生产版本 |
| `npm run build:win` | 构建 Windows 安装包 |
| `npm run build:mac` | 构建 macOS DMG |
| `npm run lint` | ESLint 检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run format` | Prettier 格式化 |
| `npm run format:check` | Prettier 格式检查 |

## License

SEE LICENSE IN LICENSE.txt
