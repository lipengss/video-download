/**
 * VideoDL Pro - Electron 主进程
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const { spawn } = require("child_process");
const os = require("os");
const { YtDlpEngine } = require("./engine/ytdlp");
const { Storage } = require("./main/storage");
const { validateCode } = require("./main/activation");
const platforms = require("./shared/platforms.json");

// 预编译平台正则
const PLATFORM_REGEX = platforms.map((p) => ({ ...p, test: new RegExp(p.test, "i") }));

// ─── 配置 ───────────────────────────────────────────────
const USER_DATA = app.getPath("userData");
const YTDLP_EXE = path.join(process.resourcesPath, "yt-dlp.exe");
const YTDLP_DEV = path.join(__dirname, "assets", "yt-dlp.exe");
const FFMPEG_EXE = path.join(process.resourcesPath, "ffmpeg.exe");
const FFMPEG_DEV = path.join(__dirname, "assets", "ffmpeg.exe");
const PORT_FILE = path.join(__dirname, ".vite-port");
const isDev = !app.isPackaged;
const ytDlpPath = isDev ? YTDLP_DEV : YTDLP_EXE;
// ffmpeg 存在才传入（否则 yt-dlp 会尝试从系统 PATH 查找）
const ffmpegPath = fs.existsSync(isDev ? FFMPEG_DEV : FFMPEG_EXE) ? (isDev ? FFMPEG_DEV : FFMPEG_EXE) : null;
const store = new Storage(USER_DATA);

// ─── 价格开关 ───────────────────────────────────────────────
// true  = 收费模式（需输入激活码验证）
// false = 免费模式（跳过激活码验证，无需激活）
const PRICE_ENABLED = false;

/** 读取 Vite 实际端口（自动协商，避免端口冲突） */
function getVitePort() {
  try {
    if (fs.existsSync(PORT_FILE)) {
      const port = parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10);
      if (port > 0) return port;
    }
  } catch {}
  return 5173;
}

/** 检查 Vite 开发服务器是否在指定端口可用 */
function isViteRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

let mainWindow = null;
let engine = null;
let activeDownloads = new Map(); // track active download processes for cancellation
let currentCancelled = false; // 当前下载是否已被用户取消（取消时不再上报错误）
let currentFilePath = null; // 当前下载的目标文件，取消时清理

// ─── PO Token 服务（bgutil-ytdlp-pot-provider）────────────────
// YouTube 高清下载需 PO Token；bgutil 服务在本地 4416 端口生成 token，yt-dlp 插件自动调用。
const POT_SERVER_DIR = path.join(os.homedir(), "bgutil-ytdlp-pot-provider", "server");
const POT_SERVER_ENTRY = path.join(POT_SERVER_DIR, "build", "main.js");
const POT_SERVER_PORT = 4416;
const POT_SERVER_URL = `http://127.0.0.1:${POT_SERVER_PORT}`;
let potServerProcess = null;

function checkPotServer() {
  return new Promise((resolve) => {
    const req = http.get(`${POT_SERVER_URL}/ping`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          resolve({ running: true, version: j.version || null });
        } catch {
          resolve({ running: true, version: null });
        }
      });
    });
    req.on("error", () => resolve({ running: false, version: null }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ running: false, version: null });
    });
  });
}

async function startPotServer() {
  const st = await checkPotServer();
  if (st.running) return { ...st, started: false };
  if (!fs.existsSync(POT_SERVER_ENTRY)) {
    return { running: false, started: false, error: "未找到 PO Token 服务，请先安装 bgutil-ytdlp-pot-provider" };
  }
  try {
    potServerProcess = spawn("node", [POT_SERVER_ENTRY, "--port", String(POT_SERVER_PORT)], {
      cwd: POT_SERVER_DIR,
      stdio: "ignore",
      windowsHide: true,
    });
    potServerProcess.on("error", (e) => console.error("[pot] 启动 PO Token 服务失败:", e.message));
    // 轮询等待服务就绪（最多 ~6s）
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const s = await checkPotServer();
      if (s.running) return { running: true, started: true, version: s.version };
    }
    return { running: false, started: true, error: "PO Token 服务已启动但未就绪" };
  } catch (e) {
    return { running: false, started: false, error: e.message };
  }
}

/** 清理文件名：去除已有扩展名、替换非法字符、限制长度 */
function sanitizeFileName(name) {
  if (!name) return "";
  return String(name)
    .replace(/\.(mp4|mkv|webm|flv|mov|m4a|mp3)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 120);
}

// ─── 窗口 ────────────────────────────────────────────────

/** 读取并校验上次的窗口状态；显示器变化导致位置越界时回退居中 */
function restoreWindowState() {
  const st = store.getWindowState();
  if (!st || !Number.isFinite(st.width) || !Number.isFinite(st.height)) return null;
  if (Number.isFinite(st.x) && Number.isFinite(st.y)) {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return st.x < a.x + a.width && st.x + st.width > a.x && st.y < a.y + a.height && st.y + st.height > a.y;
    });
    if (!visible) {
      const { x, y, ...rest } = st;
      return rest;
    }
  }
  return st;
}

async function createWindow() {
  const winState = restoreWindowState();
  mainWindow = new BrowserWindow({
    width: winState?.width ?? 600,
    height: winState?.height ?? 820,
    x: winState?.x,
    y: winState?.y,
    minWidth: 480,
    minHeight: 640,
    title: "VideoDL Pro",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
    frame: false,
    backgroundColor: "#141d2e",
    show: false,
  });
  // Dev: Vite server / Prod: built files
  if (isDev) {
    const vitePort = getVitePort();
    console.log(`[main] Vite port file → ${vitePort}`);
    const running = await isViteRunning(vitePort);
    if (running) {
      console.log(`[main] Loading http://localhost:${vitePort}`);
      mainWindow.loadURL(`http://localhost:${vitePort}`);
    } else {
      console.error(`[main] Vite 未运行在端口 ${vitePort}，请先执行 npm run dev:vite`);
      // 加载内置错误提示页面
      mainWindow.loadURL(
        `data:text/html,<html><body style="background:#141d2e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Vite 开发服务器未启动</h2><p style="color:#7184a5">请先执行 <code style="background:#1d2a40;padding:2px 8px;border-radius:4px">npm run dev:vite</code> 然后重新启动 Electron</p></div></body></html>`,
      );
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, "dist-renderer", "index.html"));
  }
  // 恢复上次的最大化状态
  if (winState?.maximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // 关闭前记录窗口尺寸/位置，下次启动恢复
  mainWindow.on("close", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isMax = mainWindow.isMaximized();
    const b = mainWindow.getNormalBounds();
    store.saveWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: isMax });
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // ── 修复抖音等平台封面防盗链 ──
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "*://*.douyinpic.com/*",
        "*://*.douyinvod.com/*",
        "*://*.douyin.com/*",
        "*://*.tiktokcdn.com/*",
        "*://*.tiktokv.com/*",
        "*://*.ixigua.com/*",
        "*://*.snssdk.com/*",
        "*://*.byteimg.com/*",
        "*://*.bytecdn.cn/*",
      ],
    },
    (details, callback) => {
      details.requestHeaders["Referer"] = "https://www.douyin.com/";
      details.requestHeaders["Origin"] = "https://www.douyin.com/";
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

// ─── IPC ─────────────────────────────────────────────────

function setupIPC() {
  // ── 窗口控制 ──
  ipcMain.handle("window-minimize", () => mainWindow?.minimize());
  ipcMain.handle("window-maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle("window-close", () => mainWindow?.close());

  // ── 设置 ──
  ipcMain.handle("get-settings", () => store.getSettings());
  ipcMain.handle("save-settings", (e, s) => {
    store.saveSettings(s);
    return { ok: true };
  });
  ipcMain.handle("activate", async (e, code) => {
    const result = await validateCode(code);
    if (result.valid) {
      const settings = store.getSettings();
      settings.activated = true;
      settings.activatedAt = new Date().toISOString();
      settings.activatedCode = result.formatted;
      if (result.expiresAt) settings.activatedExpiresAt = result.expiresAt;
      store.saveSettings(settings);
      return { ok: true, expiresAt: result.expiresAt };
    }
    return { ok: false, error: result.error };
  });

  // 检查激活状态（启动时调用 API 实时验证）
  ipcMain.handle("check-activated", async () => {
    // 价格开关关闭 → 免费模式，直接放行
    if (!PRICE_ENABLED) return { activated: true };
    const settings = store.getSettings();
    if (!settings.activated) return { activated: false };

    // 有存储的激活码 → 调用 API 实时验证（检查是否被撤销等）
    if (settings.activatedCode) {
      try {
        const result = await validateCode(settings.activatedCode);
        if (result.valid) {
          // API 确认有效 → 更新本地到期时间
          if (result.expiresAt) {
            settings.activatedExpiresAt = result.expiresAt;
            store.saveSettings(settings);
          }
          return { activated: true, expiresAt: result.expiresAt || settings.activatedExpiresAt || null };
        }
        // API 返回无效 → 清除本地激活状态
        settings.activated = false;
        settings.activatedCode = "";
        store.saveSettings(settings);
        return { activated: false, reason: result.error || "invalid" };
      } catch {
        // API 不可达 → 回退到本地缓存判断
        console.error("[check-activated] API 不可达，使用本地缓存");
      }
    }

    // 无激活码或 API 离线 → 本地过期检测兜底
    if (settings.activatedExpiresAt) {
      const expiresAt = new Date(settings.activatedExpiresAt).getTime();
      if (Date.now() > expiresAt) {
        settings.activated = false;
        settings.activatedCode = "";
        store.saveSettings(settings);
        return { activated: false, reason: "expired" };
      }
    }
    return { activated: true, expiresAt: settings.activatedExpiresAt || null };
  });

  ipcMain.handle("select-dir", async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "选择下载目录" });
    return { path: r.canceled ? null : r.filePaths[0] };
  });

  // ── 引擎 ──
  ipcMain.handle("get-engine-info", async () => ({
    engine: engine && engine.isAvailable() ? "yt-dlp" : "none",
    ytDlpExists: fs.existsSync(ytDlpPath),
    downloadPath: store.getSettings().downloadPath,
  }));

  // PO Token 服务状态 / 启动（YouTube 高清下载必需）
  ipcMain.handle("get-pot-status", () => checkPotServer());
  ipcMain.handle("start-pot-server", () => startPotServer());

  ipcMain.handle("parse-url", async (event, url, opts) => {
    const pf = PLATFORM_REGEX.find((p) => p.test.test(url));
    console.log(`[parse-url] 开始 ${pf?.label || "未知平台"} · ${String(url).slice(0, 60)}`);

    if (!engine || !engine.isAvailable()) return { error: "yt-dlp 引擎不可用" };

    const t0 = Date.now();
    try {
      const r = await engine.parse(url, opts || {});
      console.log(`[parse-url] yt-dlp 成功 · ${Date.now() - t0}ms`);
      return r;
    } catch (err) {
      console.log(`[parse-url] yt-dlp 失败 · ${err.message}`);
      return { error: err.message };
    }
  });

  // 取消下载
  ipcMain.handle("cancel-download", () => {
    currentCancelled = true;
    if (engine) engine.cancel();
    return { ok: true };
  });

  ipcMain.handle(
    "start-download",
    async (
      event,
      { url, formatId, index, title, cookiesBrowser, cookiesFile, proxy, originalUrl, writeSubs, subLang, extractAudio, poToken },
    ) => {
      const settings = store.getSettings();

      // 激活码校验（防御层；价格开关关闭时跳过）
      if (PRICE_ENABLED && !settings.activated) {
        return { error: "软件未激活，请先输入激活码" };
      }

      fs.mkdirSync(settings.downloadPath, { recursive: true });

      const ts = Date.now();
      const ext = extractAudio ? ".mp3" : ".mp4";
      // 文件名优先使用解析出的视频标题，非法字符已清洗；无标题时回退时间戳
      const base = sanitizeFileName(title) || `video_${ts}`;
      let fileName = `${base}${ext}`;
      let filePath = path.join(settings.downloadPath, fileName);
      let c = 1;
      while (fs.existsSync(filePath)) {
        filePath = path.join(settings.downloadPath, `${base}_${c}${ext}`);
        c++;
      }

      const send = (ch, data) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(ch, { index, fileName: path.basename(filePath), ...data });
      };

      currentCancelled = false;
      currentFilePath = filePath;

      try {
        await engine.download(url, formatId, filePath, (p) => send("download-progress", p), {
          cookiesBrowser,
          cookiesFile,
          proxy,
          ffmpegPath,
          writeSubs,
          subLang,
          extractAudio,
          poToken,
        });
        const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
        send("download-complete", { filePath, size, originalUrl });
        return { success: true, filePath, size };
      } catch (err) {
        // 用户主动取消：清理残留文件、不上报错误（前端已自行标记为「取消」）
        if (currentCancelled) {
          try {
            if (currentFilePath && fs.existsSync(currentFilePath)) fs.unlinkSync(currentFilePath);
          } catch {}
          return { cancelled: true };
        }
        send("download-error", { error: err.message, filePath });
        return { error: err.message };
      }
    },
  );

  // ── 历史 ──
  ipcMain.handle("get-history", () => store.getHistory());
  ipcMain.handle("add-history", (e, record) => {
    const hist = store.getHistory();
    hist.unshift({
      ...record,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time: new Date().toISOString(),
    });
    if (hist.length > 500) hist.length = 500;
    store.saveHistory(hist);
    return { ok: true, id: hist[0].id };
  });
  ipcMain.handle("update-history", (e, id, updates) => {
    const hist = store.getHistory();
    const idx = hist.findIndex((r) => r.id === id);
    if (idx >= 0) {
      Object.assign(hist[idx], updates);
      store.saveHistory(hist);
    }
    return { ok: true };
  });
  ipcMain.handle("delete-history", (e, id) => {
    const hist = store.getHistory().filter((r) => r.id !== id);
    store.saveHistory(hist);
    return { ok: true };
  });
  ipcMain.handle("clear-history", () => {
    store.saveHistory([]);
    return { ok: true };
  });

  // ── 文件操作 ──
  ipcMain.handle("delete-file", (e, fp) => {
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("open-file", (e, fp) => {
    if (fs.existsSync(fp)) shell.openPath(fp);
    return { ok: true };
  });
  ipcMain.handle("open-folder", () => {
    shell.openPath(store.getSettings().downloadPath);
  });
  /** 校验 cookies.txt：检查是否包含 YouTube 登录所需的会话 Cookie */
  function validateCookiesFile(fp) {
    const CRITICAL = [
      "SID", "HSID", "SSID",
      "SAPISID", "APISID",
      "__Secure-1PSID", "__Secure-3PSID",
      "__Secure-1PAPISID", "__Secure-3PAPISID",
      "LOGIN_INFO",
    ];
    try {
      const text = fs.readFileSync(fp, "utf8");
      const cookies = new Map(); // name -> { domain, expiry }
      for (const raw of text.split(/\r?\n/)) {
        const t = raw.trim();
        if (!t || (t.startsWith("#") && !t.startsWith("#HttpOnly_"))) continue;
        // HttpOnly cookie 在域名前带 #HttpOnly_ 前缀，去掉后仍是 tab 分隔的 7 列
        const parts = t.replace(/^#HttpOnly_/, "").split("\t");
        if (parts.length < 7) continue;
        const name = parts[5];
        const domain = parts[0];
        const expiry = parseInt(parts[4], 10) || 0;
        cookies.set(name, { domain, expiry });
      }

      const now = Math.floor(Date.now() / 1000);
      const present = CRITICAL.filter((c) => cookies.has(c));
      const missing = CRITICAL.filter((c) => !cookies.has(c));
      const expired = CRITICAL.filter((c) => {
        const ck = cookies.get(c);
        return ck && ck.expiry > 0 && ck.expiry < now;
      });

      const hasLoginInfo = cookies.has("LOGIN_INFO");
      const hasSidTrio = ["SID", "HSID", "SSID"].every((c) => cookies.has(c));
      // 关键：__Secure-3PSID 是 SameSite=None 的第三方变体，单独存在时 YouTube 仍会返回
      // LOGIN_REQUIRED；必须以 __Secure-1PSID / SID / LOGIN_INFO 这些「第一方会话」Cookie 为准。
      const hasSecure1PSID = cookies.has("__Secure-1PSID");

      if (cookies.size === 0) {
        return { ok: false, reason: "文件为空或不是有效的 cookies.txt", missing: CRITICAL, expired: [], total: 0 };
      }
      if (expired.length > 0) {
        return { ok: false, reason: `登录 Cookie 已过期：${expired.join("、")}`, missing, expired, total: cookies.size };
      }
      if (hasLoginInfo || hasSidTrio || hasSecure1PSID) {
        return { ok: true, reason: `登录态有效（关键 Cookie ${present.length}/${CRITICAL.length} 项）`, missing, expired, total: cookies.size };
      }
      return { ok: false, reason: `缺少登录 Cookie：${missing.join("、")}，YouTube 会返回 LOGIN_REQUIRED`, missing, expired, total: cookies.size };
    } catch (e) {
      return { ok: false, reason: "读取 cookies 文件失败：" + e.message, missing: [], expired: [], total: 0 };
    }
  }

  ipcMain.handle("select-cookies-file", async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "选择 cookies.txt",
      filters: [{ name: "Cookies", extensions: ["txt"] }],
      properties: ["openFile"],
    });
    if (r.canceled) return { path: null, check: null };
    const fp = r.filePaths[0];
    return { path: fp, check: validateCookiesFile(fp) };
  });

  // 本地文件列表
  ipcMain.handle("list-local-files", () => {
    try {
      const dir = store.getSettings().downloadPath;
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => /\.(mp4|mkv|webm|flv|avi|mov|m4a|mp3)$/i.test(f))
        .map((name) => {
          const fp = path.join(dir, name);
          const stat = fs.statSync(fp);
          return { name, path: fp, size: stat.size, time: stat.mtime.toISOString() };
        })
        .sort((a, b) => new Date(b.time) - new Date(a.time));
    } catch {
      return [];
    }
  });

  // 检查文件是否存在
  ipcMain.handle("file-exists", (e, fileName) => {
    const fp = path.join(store.getSettings().downloadPath, fileName);
    return fs.existsSync(fp) ? { exists: true, path: fp, size: fs.statSync(fp).size } : { exists: false };
  });

  // ── 缩略图缓存（解决抖音等平台防盗链） ──
  const CACHE_DIR = store.cacheDir;

  ipcMain.handle("cache-thumbnail", async (e, imageUrl) => {
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return { path: null };
    const hash = require("crypto").createHash("md5").update(imageUrl).digest("hex");
    const cachePath = path.join(CACHE_DIR, `${hash}.jpg`);
    if (fs.existsSync(cachePath)) return { path: cachePath };

    // 根据域名自动匹配 Referer
    const ref = /tiktok/i.test(imageUrl) ? "https://www.tiktok.com/" : "https://www.douyin.com/";

    const doFetch = (url) =>
      new Promise((resolve, reject) => {
        const mod = url.startsWith("https") ? https : http;
        const req = mod.get(url, { headers: { Referer: ref } }, (res) => {
          // 跟随重定向
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doFetch(res.headers.location).then(resolve).catch(reject);
            return;
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        });
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error("缩略图下载超时"));
        });
        req.on("error", reject);
      });

    try {
      const data = await doFetch(imageUrl);
      fs.writeFileSync(cachePath, data);
      return { path: cachePath };
    } catch {
      return { path: null };
    }
  });
}

// ─── 启动 ────────────────────────────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  engine = new YtDlpEngine(ytDlpPath);
  fs.mkdirSync(store.getSettings().downloadPath, { recursive: true });
  setupIPC();
  // 启动 PO Token 服务（YouTube 高清下载必需；已运行则跳过）
  startPotServer().then((st) => {
    if (st.running) console.log(`[pot] PO Token 服务就绪 v${st.version || "?"}${st.started ? "（本次启动）" : "（已在运行）"}`);
    else console.warn("[pot] PO Token 服务未就绪:", st.error || "未知错误");
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (potServerProcess) {
    try {
      potServerProcess.kill();
    } catch {}
    potServerProcess = null;
  }
});
