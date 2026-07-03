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

// ─── 配置 ───────────────────────────────────────────────
const USER_DATA = app.getPath("userData");
const SETTINGS_FILE = path.join(USER_DATA, "settings.json");
const HISTORY_FILE = path.join(USER_DATA, "history.json");
const YTDLP_EXE = path.join(process.resourcesPath, "yt-dlp.exe");
const YTDLP_DEV = path.join(__dirname, "assets", "yt-dlp.exe");
const isDev = !app.isPackaged;
const ytDlpPath = isDev ? YTDLP_DEV : YTDLP_EXE;

let mainWindow = null;
let engine = null;
let btchEngine = null;
let biliEngine = null;
let pwEngine = null;
let activeDownloads = new Map(); // track active download processes for cancellation

// ─── 持久化存储 ─────────────────────────────────────────

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* ignore */
  }
  return fallback;
}
function saveJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getSettings() {
  return loadJSON(SETTINGS_FILE, { downloadPath: path.join(USER_DATA, "downloads") });
}
function saveSettings(s) {
  saveJSON(SETTINGS_FILE, s);
}

function getHistory() {
  return loadJSON(HISTORY_FILE, []);
}
function saveHistory(h) {
  saveJSON(HISTORY_FILE, h);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ─── 窗口 ────────────────────────────────────────────────

function createWindow() {
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
    mainWindow.loadURL("http://localhost:5173");
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
  ipcMain.handle("get-settings", () => getSettings());
  ipcMain.handle("save-settings", (e, s) => {
    saveSettings(s);
    return { ok: true };
  });
  ipcMain.handle("select-dir", async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "选择下载目录" });
    return { path: r.canceled ? null : r.filePaths[0] };
  });

  // ── 引擎 ──
  ipcMain.handle("get-engine-info", async () => ({
    engine: engine && engine.isAvailable() ? "yt-dlp" : "none",
    ytDlpExists: fs.existsSync(ytDlpPath),
    downloadPath: getSettings().downloadPath,
  }));

  ipcMain.handle("parse-url", async (event, url, opts) => {
    // B站: 专用引擎
    if (/bilibili\.com|b23\.tv/i.test(url) && biliEngine) {
      try {
        return await biliEngine.parse(url);
      } catch (biliErr) {
        /* fall through */
      }
    }

    // Instagram / 抖音: btch 优先（不需要 cookies）
    const btchFirst = /instagram\.com|douyin\.com|v\.douyin/i.test(url);
    if (btchFirst && btchEngine) {
      try {
        return await btchEngine.parse(url);
      } catch (btchErr) {
        /* fall through */
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
            /* fall through */
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
        /* fall through */
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
      { url, formatId, index, cookiesBrowser, cookiesFile, isBtch, _bvid, _cid, originalUrl, downloadId },
    ) => {
      const settings = getSettings();
      ensureDir(settings.downloadPath);

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
  ipcMain.handle("get-history", () => getHistory());
  ipcMain.handle("add-history", (e, record) => {
    const hist = getHistory();
    hist.unshift({
      ...record,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time: new Date().toISOString(),
    });
    if (hist.length > 500) hist.length = 500;
    saveHistory(hist);
    return { ok: true, id: hist[0].id };
  });
  ipcMain.handle("update-history", (e, id, updates) => {
    const hist = getHistory();
    const idx = hist.findIndex((r) => r.id === id);
    if (idx >= 0) {
      Object.assign(hist[idx], updates);
      saveHistory(hist);
    }
    return { ok: true };
  });
  ipcMain.handle("delete-history", (e, id) => {
    const hist = getHistory().filter((r) => r.id !== id);
    saveHistory(hist);
    return { ok: true };
  });
  ipcMain.handle("clear-history", () => {
    saveHistory([]);
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
    shell.openPath(getSettings().downloadPath);
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
      const dir = getSettings().downloadPath;
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
    const fp = path.join(getSettings().downloadPath, fileName);
    return fs.existsSync(fp) ? { exists: true, path: fp, size: fs.statSync(fp).size } : { exists: false };
  });

  // ── 缩略图缓存（解决抖音等平台防盗链） ──
  const CACHE_DIR = path.join(USER_DATA, "thumb_cache");
  ensureDir(CACHE_DIR);

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
        mod
          .get(url, { headers: { Referer: ref } }, (res) => {
            // 跟随重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              doFetch(res.headers.location).then(resolve).catch(reject);
              return;
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
          })
          .on("error", reject);
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

// ─── HTTP 下载 ──────────────────────────────────────────

function downloadHttp(url, destPath, onProgress, retries = 3, headers = {}) {
  return new Promise((resolve, reject) => {
    let file = null,
      lastDl = 0,
      stallTimer = null;
    const defaultHeaders = {
      Accept: "*/*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    const mergedHeaders = { ...defaultHeaders, ...headers };

    const doReq = (reqUrl, n) => {
      if (n > 5) return reject(new Error("重定向过多"));
      if (file) {
        try {
          file.close();
        } catch {}
      }
      if (stallTimer) clearTimeout(stallTimer);
      file = fs.createWriteStream(destPath, { flags: n === 0 ? "w" : "w" });
      const proto = reqUrl.startsWith("https") ? https : http;
      const req = proto.get(reqUrl, { headers: mergedHeaders }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          file = null;
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          return doReq(res.headers.location, n + 1);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let dl = 0;
        lastDl = 0;

        // 超时检测：30 秒无数据则重试
        const resetStall = () => {
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = setTimeout(() => {
            if (dl === lastDl && retries > 0) {
              file.close();
              file = null;
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              retries--;
              doReq(reqUrl, n);
            }
          }, 30000);
        };
        resetStall();

        res.on("data", (chunk) => {
          dl += chunk.length;
          lastDl = dl;
          resetStall();
          onProgress({
            percent: total > 0 ? Math.round((dl / total) * 100) : 0,
            totalSize: (total / 1048576).toFixed(1) + " MiB",
          });
        });
        res.on("error", (err) => {
          if (file) file.close();
          if (retries > 0) {
            retries--;
            doReq(reqUrl, n);
          } else reject(err);
        });
        res.pipe(file);
        file.on("finish", () => {
          if (stallTimer) clearTimeout(stallTimer);
          file.close();
          resolve();
        });
        file.on("error", (err) => {
          if (retries > 0) {
            retries--;
            doReq(reqUrl, n);
          } else reject(err);
        });
      });
      req.setTimeout(60000, () => {
        req.destroy();
        if (retries > 0) {
          retries--;
          doReq(reqUrl, n);
        } else reject(new Error("请求超时"));
      });
      req.on("error", (err) => {
        if (file) file.close();
        if (retries > 0) {
          retries--;
          doReq(reqUrl, n);
        } else reject(err);
      });
    };
    doReq(url, 0);
  });
}

// ─── 启动 ────────────────────────────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  engine = new YtDlpEngine(ytDlpPath);
  btchEngine = new BtchEngine();
  biliEngine = new BilibiliEngine();
  pwEngine = new PlaywrightEngine();
  ensureDir(getSettings().downloadPath);
  setupIPC();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
