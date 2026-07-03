/**
 * Instagram 视频下载器 - Web 服务器 (双引擎版)
 * 用法: node server.js
 *
 * 引擎优先级:
 *   1. yt-dlp (本地) — 如果 yt-dlp.exe 存在于项目目录
 *   2. btch-downloader (远程 API) — 后备引擎
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const { spawn } = require("child_process");
const { exec } = require("child_process");
const { igdl } = require("btch-downloader");
const probe = require("probe-image-size");

// ─── 配置 ───────────────────────────────────────────────
const PORT = 3000;
const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const YTDLP_EXE = path.join(__dirname, "yt-dlp.exe");

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ─── 引擎检测 ───────────────────────────────────────────
const ENGINE = fs.existsSync(YTDLP_EXE) ? "yt-dlp" : "btch-downloader";
console.log(`  引擎: ${ENGINE} ${ENGINE === "yt-dlp" ? "(本地)" : "(远程 API)"}`);

const app = express();
app.use(express.json());
// 注意: API 路由在静态文件之前注册，避免被 index.html 拦截

// ─── 工具函数 ────────────────────────────────────────────

function validateInstagramUrl(url) {
  const patterns = [
    /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/reel\/[\w-]+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/stories\/[\w.-]+\/\d+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/tv\/[\w-]+\/?/,
  ];
  return patterns.some((p) => p.test(url));
}

function formatSize(bytes) {
  if (!bytes) return "未知";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(2)} KB`;
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function calcAspectRatio(w, h) {
  if (!w || !h) return "未知";
  const d = gcd(w, h);
  const rw = w / d;
  const rh = h / d;
  const ratio = rw / rh;
  if (Math.abs(ratio - 9 / 16) < 0.02) return "9:16 (竖屏)";
  if (Math.abs(ratio - 16 / 9) < 0.02) return "16:9 (横屏)";
  if (Math.abs(ratio - 1) < 0.02) return "1:1 (正方形)";
  if (Math.abs(ratio - 4 / 3) < 0.02) return "4:3";
  if (Math.abs(ratio - 3 / 4) < 0.02) return "3:4 (竖屏)";
  if (Math.abs(ratio - 4 / 5) < 0.02) return "4:5 (竖屏)";
  if (rw < 20 && rh < 20) return `${rw}:${rh}`;
  return `${ratio.toFixed(2)}:1`;
}

function qualityLabel(w, h) {
  if (!w || !h) return "";
  const longSide = Math.max(w, h);
  if (longSide >= 1920) return "1080p+";
  if (longSide >= 1080) return "1080p";
  if (longSide >= 720) return "720p";
  if (longSide >= 480) return "480p";
  return `${longSide}p`;
}

/** yt-dlp 进度解析 */
function parseYtDlpProgress(line) {
  // [download]  45.0% of 3.88MiB at 1.2MiB/s ETA 00:02
  const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+(\S+)/i);
  if (!m) return null;
  return { percent: parseFloat(m[1]), totalSize: m[2].trim(), speed: m[3].trim(), eta: m[4].trim() };
}

// ─── 引擎1: yt-dlp (本地) ──────────────────────────────────

async function ytDlpParse(url) {
  return new Promise((resolve, reject) => {
    const yt = spawn(YTDLP_EXE, ["--dump-json", "--no-playlist", url], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });

    let stdout = "",
      stderr = "";
    yt.stdout.on("data", (d) => (stdout += d.toString()));
    yt.stderr.on("data", (d) => (stderr += d.toString()));

    yt.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.split("\n").slice(-3).join(" ") || `退出码 ${code}`));
      }
      try {
        const info = JSON.parse(stdout);
        // 获取缩略图
        const thumb = info.thumbnail || (info.thumbnails && info.thumbnails[0]?.url) || "";
        // 构建格式列表
        const formats = (info.formats || [])
          .filter((f) => f.vcodec !== "none" && f.filesize > 0)
          .map((f) => ({
            id: f.format_id,
            resolution: f.width && f.height ? `${f.width}×${f.height}` : f.format_note || "未知",
            width: f.width || 0,
            height: f.height || 0,
            aspectRatio: calcAspectRatio(f.width, f.height),
            quality: qualityLabel(f.width, f.height),
            ext: f.ext,
            filesize: f.filesize || 0,
            filesizeFormatted: formatSize(f.filesize),
            vcodec: f.vcodec,
            acodec: f.acodec,
            tbr: f.tbr,
          }))
          .sort((a, b) => b.width * b.height - a.width * a.height); // 高分辨率排前面

        // 去重（相同分辨率保留最佳质量/最大文件的）
        const seen = new Set();
        const uniqueFormats = formats.filter((f) => {
          const key = f.resolution;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        resolve({
          title: info.title || info.description || "",
          thumbnail: thumb,
          duration: info.duration || 0,
          width: info.width || 0,
          height: info.height || 0,
          aspectRatio: calcAspectRatio(info.width, info.height),
          resolution: info.width && info.height ? `${info.width}×${info.height}` : "未知",
          quality: qualityLabel(info.width, info.height),
          formats: uniqueFormats,
          bestFormatId: uniqueFormats.length > 0 ? uniqueFormats[0].id : null,
        });
      } catch (e) {
        reject(new Error("解析 yt-dlp JSON 失败: " + e.message));
      }
    });

    yt.on("error", (err) => reject(err));
  });
}

function ytDlpDownload(url, formatId, filePath, onProgress, onComplete) {
  return new Promise((resolve, reject) => {
    const args = [url, "-o", filePath, "--no-playlist", "--progress", "--newline", "--no-mtime"];
    if (formatId) args.push("-f", formatId);

    const yt = spawn(YTDLP_EXE, args, { stdio: ["ignore", "pipe", "pipe"] });
    let lastPct = 0;
    let stderr = "";

    yt.stdout.on("data", (d) => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const prog = parseYtDlpProgress(line);
        if (prog && prog.percent >= lastPct) {
          lastPct = prog.percent;
          if (typeof onProgress === "function") {
            onProgress({
              percent: prog.percent,
              totalSize: prog.totalSize,
              speed: prog.speed,
              eta: prog.eta,
            });
          }
        }
        // 检测合并/完成
        if (line.includes("[Merger]") || line.includes("[MoveFiles]")) {
          if (typeof onComplete === "function") onComplete(line);
        }
      }
    });

    yt.stderr.on("data", (d) => (stderr += d.toString()));

    yt.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.split("\n").slice(-3).join(" ") || `退出码 ${code}`));
      }
    });

    yt.on("error", reject);
  });
}

// ─── 引擎2: btch-downloader (远程 API) ─────────────────────

async function btchParse(url) {
  const result = await igdl(url);
  if (!result || !result.status || !result.result || result.result.length === 0) {
    throw new Error("未能获取到媒体信息");
  }

  // 并行探测缩略图尺寸
  return Promise.all(
    result.result.map(async (item, i) => {
      let w = 0,
        h = 0,
        fileSize = 0;

      try {
        if (item.thumbnail) {
          const info = await probe(item.thumbnail);
          if (info) {
            w = info.width;
            h = info.height;
          }
        }
      } catch {}

      try {
        if (item.url) {
          fileSize = await new Promise((resolve) => {
            const protocol = item.url.startsWith("https") ? https : http;
            const req = protocol.request(item.url, { method: "HEAD", timeout: 8000 }, (res) => {
              if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const p2 = res.headers.location.startsWith("https") ? https : http;
                const r2 = p2.request(res.headers.location, { method: "HEAD", timeout: 8000 }, (r) => {
                  resolve(parseInt(r.headers["content-length"] || "0", 10));
                });
                r2.on("error", () => resolve(0));
                r2.end();
              } else {
                resolve(parseInt(res.headers["content-length"] || "0", 10));
              }
            });
            req.on("error", () => resolve(0));
            req.end();
          });
        }
      } catch {}

      const urlPath = (item.url || "").split("?")[0];
      const ext = urlPath.includes(".mp4")
        ? "mp4"
        : urlPath.includes(".jpg")
          ? "jpg"
          : urlPath.includes(".webp")
            ? "webp"
            : "mp4";
      const fileName = `instagram_${i + 1}.${ext}`;

      return {
        index: i,
        url: item.url,
        thumbnail: item.thumbnail || "",
        fileName,
        type: (item.url || "").includes(".mp4") ? "video" : "image",
        width: w,
        height: h,
        aspectRatio: calcAspectRatio(w, h),
        resolution: w && h ? `${w}×${h}` : "未知",
        quality: w && h ? qualityLabel(w, h) : fileSize ? formatSize(fileSize) : "标准",
        formats: [], // btch-downloader 不提供多清晰度
        bestFormatId: null,
        isBtchEngine: true,
      };
    }),
  );
}

function btchDownload(mediaUrl, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const protocol = mediaUrl.startsWith("https") ? https : http;
    const file = fs.createWriteStream(filePath);

    const doRequest = (url, redirects = 0) => {
      if (redirects > 5) return reject(new Error("重定向次数过多"));

      const req = protocol.get(url, { timeout: 120000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return doRequest(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          file.close();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (typeof onProgress === "function") {
            onProgress({
              percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
              downloaded,
              total,
            });
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve({ filePath, size: downloaded });
        });
      });

      req.on("timeout", () => {
        req.destroy();
        file.close();
        reject(new Error("下载超时"));
      });
      req.on("error", (err) => {
        file.close();
        reject(err);
      });
    };

    doRequest(mediaUrl);
  });
}

// ─── API 路由 ────────────────────────────────────────────

/** GET /api/engine — 返回当前使用的引擎信息 */
app.get("/api/engine", (req, res) => {
  res.json({
    engine: ENGINE,
    engines: {
      "yt-dlp": ENGINE === "yt-dlp",
      "btch-downloader": ENGINE === "btch-downloader",
    },
    ytDlpPath: YTDLP_EXE,
    ytDlpExists: fs.existsSync(YTDLP_EXE),
    hint:
      ENGINE !== "yt-dlp"
        ? "下载 yt-dlp.exe 放到项目目录可获得更多功能：https://github.com/yt-dlp/yt-dlp/releases/latest"
        : null,
  });
});

/** POST /api/parse — 解析 Instagram 链接 */
app.post("/api/parse", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "请提供 URL" });

  const cleanUrl = url.split("?")[0];
  if (!validateInstagramUrl(cleanUrl)) {
    return res.status(400).json({ error: "无效的 Instagram 链接格式" });
  }

  try {
    if (ENGINE === "yt-dlp") {
      // yt-dlp: 返回完整格式列表
      const info = await ytDlpParse(cleanUrl);
      const ext = info.formats.length > 0 ? info.formats[0].ext : "mp4";
      const fileName = `instagram_${ext === "jpg" || ext === "webp" ? "1" : "1"}.${ext}`;

      res.json({
        success: true,
        engine: "yt-dlp",
        media: [
          {
            index: 0,
            url: cleanUrl, // 给原始 URL，下载时 yt-dlp 自己解析
            thumbnail: info.thumbnail,
            fileName,
            type: info.formats.length > 0 ? "video" : "unknown",
            width: info.width,
            height: info.height,
            aspectRatio: info.aspectRatio,
            resolution: info.resolution,
            quality: info.quality,
            title: info.title,
            duration: info.duration,
            formats: info.formats,
            bestFormatId: info.bestFormatId,
          },
        ],
      });
    } else {
      // btch-downloader 后备
      const mediaList = await btchParse(cleanUrl);
      res.json({
        success: true,
        engine: "btch-downloader",
        media: mediaList,
      });
    }
  } catch (err) {
    res.status(500).json({ error: "解析失败: " + (err.message || String(err)) });
  }
});

/** GET /api/download — SSE 流式下载 */
app.get("/api/download", async (req, res) => {
  const { url, format, index } = req.query;
  if (!url) {
    res.status(400).json({ error: "缺少 URL 参数" });
    return;
  }

  const mediaUrl = decodeURIComponent(url);
  const mediaIndex = parseInt(index) || 0;
  const formatId = format || null;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 生成输出文件名
  let filePath = path.join(DOWNLOADS_DIR, `instagram_${mediaIndex + 1}.mp4`);
  let counter = 1;
  while (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    filePath = path.join(DOWNLOADS_DIR, `${base}_${counter}${ext}`);
    counter++;
  }

  try {
    if (ENGINE === "yt-dlp") {
      await ytDlpDownload(
        mediaUrl,
        formatId,
        filePath,
        (prog) => {
          send("progress", {
            index: mediaIndex,
            fileName: path.basename(filePath),
            percent: prog.percent,
            totalFormatted: prog.totalSize,
            speed: prog.speed,
            eta: prog.eta,
          });
        },
        (msg) => {
          // 合并/处理事件
        },
      );
    } else {
      // btch-downloader: 需要先把 mediaUrl 解析为 CDN URL
      // 但如果调用者是前端，传入的已经是 CDN URL
      await btchDownload(mediaUrl, filePath, (prog) => {
        send("progress", {
          index: mediaIndex,
          fileName: path.basename(filePath),
          percent: prog.percent,
          downloadedFormatted: formatSize(prog.downloaded),
          totalFormatted: formatSize(prog.total),
        });
      });
    }

    send("complete", {
      index: mediaIndex,
      fileName: path.basename(filePath),
      filePath: filePath,
      size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
      sizeFormatted: fs.existsSync(filePath) ? formatSize(fs.statSync(filePath).size) : "未知",
    });
  } catch (err) {
    send("error", {
      index: mediaIndex,
      fileName: path.basename(filePath),
      error: err.message || String(err),
    });
  }

  res.end();
});

/** GET /api/history — 获取已下载文件列表 */
app.get("/api/history", (req, res) => {
  try {
    const files = fs
      .readdirSync(DOWNLOADS_DIR)
      .map((name) => {
        const fullPath = path.join(DOWNLOADS_DIR, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          path: fullPath,
          size: stat.size,
          sizeFormatted: formatSize(stat.size),
          time: stat.mtime.toISOString(),
        };
      })
      .filter((f) => f.name !== ".gitkeep")
      .sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json({ success: true, files });
  } catch {
    res.json({ success: true, files: [] });
  }
});

/** POST /api/open — 打开文件 */
app.post("/api/open", (req, res) => {
  const { filePath } = req.body;
  if (filePath && fs.existsSync(filePath)) {
    const cmd =
      process.platform === "win32"
        ? `start "" "${filePath}"`
        : process.platform === "darwin"
          ? `open "${filePath}"`
          : `xdg-open "${filePath}"`;
    exec(cmd);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "文件不存在" });
  }
});

// ─── 静态文件（API 路由之后注册）──────────────────────
app.use(express.static(path.join(__dirname, "public")));
app.use("/files", express.static(DOWNLOADS_DIR));

// ─── 启动 ────────────────────────────────────────────────

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log("");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║   Instagram 视频下载器  v2.1.0      ║");
  console.log(`  ║   引擎: ${ENGINE.padEnd(28)}║`);
  console.log("  ╠══════════════════════════════════════╣");
  console.log(`  ║   服务地址: ${url}            ║`);
  console.log("  ║   按 Ctrl+C 停止服务                 ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("");

  const startCmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(startCmd, (err) => {
    if (err) console.log(`  请在浏览器中打开: ${url}`);
  });
});
