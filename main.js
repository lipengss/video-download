/**
 * VideoDL Pro - Electron 主进程
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const { YtDlpEngine } = require("./engine/ytdlp");
const { BtchEngine } = require("./engine/btch");
const { BilibiliEngine } = require("./engine/bilibili");
const { PlaywrightEngine } = require("./engine/playwright");
const { Storage } = require("./main/storage");
const { downloadHttp } = require("./main/download-http");
const { validateCode } = require("./main/activation");
const platforms = require("./shared/platforms.json");

// 预编译平台正则
const PLATFORM_REGEX = platforms.map((p) => ({ ...p, test: new RegExp(p.test, "i") }));

// ─── 配置 ───────────────────────────────────────────────
const USER_DATA = app.getPath("userData");
const YTDLP_EXE = path.join(process.resourcesPath, "yt-dlp.exe");
const YTDLP_DEV = path.join(__dirname, "assets", "yt-dlp.exe");
const PORT_FILE = path.join(__dirname, ".vite-port");
const isDev = !app.isPackaged;
const ytDlpPath = isDev ? YTDLP_DEV : YTDLP_EXE;
const store = new Storage(USER_DATA);

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
let btchEngine = null;
let biliEngine = null;
let pwEngine = null;
let activeDownloads = new Map(); // track active download processes for cancellation

// ─── 窗口 ────────────────────────────────────────────────

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 820,
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
  mainWindow.once("ready-to-show", () => mainWindow.show());
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

  /** 根据共享平台配置检测某个 URL 是否应优先用 btch 引擎 */
  function isBtchFirst(url) {
    const matched = PLATFORM_REGEX.find((p) => p.test.test(url));
    return matched?.btchFirst ?? false;
  }

  ipcMain.handle("parse-url", async (event, url, opts) => {
    // B站: 专用引擎
    if (PLATFORM_REGEX.find((p) => p.name === "bilibili")?.test.test(url) && biliEngine) {
      try {
        return await biliEngine.parse(url);
      } catch (biliErr) {
        console.error("[parse-url] bilibili fallback:", biliErr.message);
      }
    }

    // btch 优先的平台（Instagram / 抖音 / TikTok 等不需要 cookies）
    const btchFirst = isBtchFirst(url);
    if (btchFirst && btchEngine) {
      try {
        return await btchEngine.parse(url);
      } catch (btchErr) {
        console.error("[parse-url] btch-first fallback:", btchErr.message);
      }
    }

    // yt-dlp (YouTube 推荐用 cookies 获取高清画质)
    if (engine && engine.isAvailable()) {
      try {
        return await engine.parse(url, opts || {});
      } catch (ytErr) {
        if (btchFirst) return { error: `解析失败: ${ytErr.message}\n\n💡 试试勾选「cookies.txt 文件」并导入登录信息` };
        // YouTube/其他: yt-dlp 失败 → btch 后备
        if (btchEngine) {
          try {
            const r = await btchEngine.parse(url);
            r._fallback = true;
            r._ytError = ytErr.message;
            return r;
          } catch (btchErr) {
            console.error("[parse-url] yt-dlp→btch fallback:", btchErr.message);
          }
        }
        if (pwEngine) {
          try {
            const r = await pwEngine.parse(url);
            r._fallback = true;
            r._ytError = ytErr.message;
            return r;
          } catch (pwErr) {
            return { error: `${ytErr.message}\n${pwErr.message}` };
          }
        }
        return { error: ytErr.message };
      }
    }
    if (btchEngine) {
      try {
        return await btchEngine.parse(url);
      } catch (err) {
        console.error("[parse-url] btch fallback:", err.message);
      }
    }
    // Playwright 兜底（处理强反爬站点）
    if (pwEngine) {
      try {
        return await pwEngine.parse(url);
      } catch (err) {
        return { error: err.message };
      }
    }
    return { error: "下载引擎不可用" };
  });

  // 取消下载
  ipcMain.handle("cancel-download", () => {
    if (engine) engine.cancel();
    if (btchEngine) btchEngine.cancel?.();
    return { ok: true };
  });

  ipcMain.handle(
    "start-download",
    async (
      event,
      { url, formatId, index, cookiesBrowser, cookiesFile, proxy, isBtch, _bvid, _cid, originalUrl, downloadId },
    ) => {
      const settings = store.getSettings();

      // 激活码校验（防御层）
      if (!settings.activated) {
        return { error: "软件未激活，请先输入激活码" };
      }

      fs.mkdirSync(settings.downloadPath, { recursive: true });

      const ts = Date.now();
      const fileName = `video_${ts}.mp4`;
      let filePath = path.join(settings.downloadPath, fileName);
      let c = 1;
      while (fs.existsSync(filePath)) {
        filePath = path.join(settings.downloadPath, `video_${ts}_${c}.mp4`);
        c++;
      }

      const send = (ch, data) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(ch, { index, fileName: path.basename(filePath), ...data });
      };

      try {
        // B站: 获取实时视频流再下载
        if (_bvid && _cid && biliEngine) {
          const streamUrl = await biliEngine.getStreamUrl(_bvid, _cid, formatId);
          await downloadHttp(streamUrl, filePath, (p) => send("download-progress", p), 3, {
            Referer: "https://www.bilibili.com",
          });
        } else if (isBtch) {
          await downloadHttp(url, filePath, (p) => send("download-progress", p));
        } else {
          await engine.download(url, formatId, filePath, (p) => send("download-progress", p), {
            cookiesBrowser,
            cookiesFile,
            proxy,
          });
        }
        const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
        send("download-complete", { filePath, size, originalUrl });
        return { success: true, filePath, size };
      } catch (err) {
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
  ipcMain.handle("select-cookies-file", async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "选择 cookies.txt",
      filters: [{ name: "Cookies", extensions: ["txt"] }],
      properties: ["openFile"],
    });
    return { path: r.canceled ? null : r.filePaths[0] };
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
  btchEngine = new BtchEngine();
  biliEngine = new BilibiliEngine();
  pwEngine = new PlaywrightEngine();
  fs.mkdirSync(store.getSettings().downloadPath, { recursive: true });
  setupIPC();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (pwEngine) pwEngine.close?.();
});
