/**
 * yt-dlp 引擎封装
 * 负责解析和下载，完全本地运行，无第三方 API 依赖
 */

const { spawn } = require("child_process");
const fs = require("fs");

class YtDlpEngine {
  constructor(binaryPath) {
    this.binaryPath = binaryPath;
    this._activeProcess = null;
  }

  isAvailable() {
    return fs.existsSync(this.binaryPath);
  }

  cancel() {
    if (this._activeProcess) {
      try {
        this._activeProcess.kill("SIGKILL");
      } catch {}
      this._activeProcess = null;
    }
  }

  // ─── URL 解析 ────────────────────────────────────────

  parse(url, opts = {}) {
    const args = ["--dump-json", "--no-playlist", "--js-runtimes", "node"];
    if (opts.cookiesBrowser) args.push("--cookies-from-browser", opts.cookiesBrowser);
    if (opts.cookiesFile) args.push("--cookies", opts.cookiesFile);
    if (opts.proxy) args.push("--proxy", opts.proxy);
    const extractorArgs = ["player_client=web_embedded"];
    const poToken = this._normalizePoToken(opts.poToken);
    if (poToken) extractorArgs.push(`po_token=${poToken}`);
    args.push("--extractor-args", `youtube:${extractorArgs.join(";")}`);
    args.push(url);

    return new Promise((resolve, reject) => {
      const yt = spawn(this.binaryPath, args, {
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
          // 从格式列表中提取所有可用的视频格式（音频轨不应混入画质列表）
          const formats = (info.formats || [])
            .filter((f) => f.vcodec !== "none")
            .map((f) => ({
              id: f.format_id,
              resolution: f.width && f.height ? `${f.width}×${f.height}` : f.format_note || "未知",
              width: f.width || 0,
              height: f.height || 0,
              aspectRatio: this._calcAspectRatio(f.width, f.height),
              quality: this._qualityLabel(f.width, f.height),
              ext: f.ext,
              filesize: f.filesize || 0,
              filesizeFormatted: this._formatSize(f.filesize),
              vcodec: f.vcodec,
              acodec: f.acodec,
            }))
            .sort((a, b) => b.width * b.height + b.filesize / 1000000 - (a.width * a.height + a.filesize / 1000000));

          // 去重（同分辨率保留最大的）
          const seen = new Set();
          const uniqueFormats = formats.filter((f) => {
            const key = f.resolution;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          resolve({
            success: true,
            engine: "yt-dlp",
            title: info.title || "",
            thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails[0]?.url) || "",
            duration: info.duration || 0,
            width: info.width || 0,
            height: info.height || 0,
            aspectRatio: this._calcAspectRatio(info.width, info.height),
            resolution: info.width && info.height ? `${info.width}×${info.height}` : "未知",
            quality: this._qualityLabel(info.width, info.height),
            formats: uniqueFormats,
            bestFormatId: uniqueFormats.length > 0 ? uniqueFormats[0].id : null,
            // 返回单个 media 项，兼容前端
            media: [
              {
                index: 0,
                url,
                thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails[0]?.url) || "",
                fileName: this._fileName(info),
                type: "video",
                width: info.width || 0,
                height: info.height || 0,
                aspectRatio: this._calcAspectRatio(info.width, info.height),
                resolution: info.width && info.height ? `${info.width}×${info.height}` : "未知",
                quality: this._qualityLabel(info.width, info.height),
                duration: info.duration || 0,
                formats: uniqueFormats,
                bestFormatId: uniqueFormats.length > 0 ? uniqueFormats[0].id : null,
              },
            ],
          });
        } catch (e) {
          reject(new Error("解析失败: " + e.message));
        }
      });

      yt.on("error", reject);
    });
  }

  // ─── 下载 ───────────────────────────────────────────

  download(url, formatId, filePath, onProgress, opts = {}) {
    return new Promise((resolve, reject) => {
      const args = ["-o", filePath, "--no-playlist", "--progress", "--newline", "--no-mtime", "--js-runtimes", "node"];
      if (opts.ffmpegPath) args.push("--ffmpeg-location", opts.ffmpegPath);
      if (opts.extractAudio) {
        // 提取音频为 MP3（-x 自动选最佳音频轨，忽略 formatId）
        args.push("-x", "--audio-format", "mp3");
      } else if (formatId) {
        // 合并所选画质视频 + 最佳音频（YouTube 高清是分离的 DASH 流，单独 -f 会没声音）
        // 优先 m4a 音频，保证与 mp4 视频合并后仍是 .mp4（webm 音频会迫使 ffmpeg 转成 .mkv）
        args.push("-f", `${formatId}+bestaudio[ext=m4a]/bestaudio/${formatId}/best`);
      } else {
        // 默认选最高画质视频+最佳音频合并
        args.push("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best");
      }
      if (opts.cookiesBrowser) args.push("--cookies-from-browser", opts.cookiesBrowser);
      if (opts.cookiesFile) args.push("--cookies", opts.cookiesFile);
      if (opts.proxy) args.push("--proxy", opts.proxy);
      const extractorArgs = ["player_client=web_embedded"];
      const poToken = this._normalizePoToken(opts.poToken);
      if (poToken) extractorArgs.push(`po_token=${poToken}`);
      args.push("--extractor-args", `youtube:${extractorArgs.join(";")}`);
      if (opts.writeSubs) {
        // 下载独立字幕文件（不嵌入视频）
        args.push("--write-subs", "--write-auto-subs", "--sub-lang", opts.subLang || "zh-Hans,en");
      }
      args.push(url);

      const yt = spawn(this.binaryPath, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 600000 });
      this._activeProcess = yt;
      let lastPct = 0;
      let stderr = "";

      yt.stdout.on("data", (d) => {
        const lines = d.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          // [download]  45.0% of 3.88MiB at 1.2MiB/s ETA 00:02
          const m = line.match(
            /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+(\S+)/i,
          );
          if (m && parseFloat(m[1]) >= lastPct) {
            lastPct = parseFloat(m[1]);
            if (typeof onProgress === "function") {
              onProgress({
                percent: parseFloat(m[1]),
                totalSize: m[2].trim(),
                speed: m[3].trim(),
                eta: m[4].trim(),
              });
            }
          }
        }
      });

      yt.stderr.on("data", (d) => (stderr += d.toString()));

      yt.on("close", (code) => {
        this._activeProcess = null;
        if (code === 0) resolve();
        else {
          let msg = stderr.split("\n").slice(-3).join(" ") || `退出码 ${code}`;
          // YouTube 高清下载 403 = 缺少 PO Token（Proof of Origin），给出明确指引
          if (/403|Forbidden/i.test(msg)) {
            msg +=
              "\n\n💡 YouTube 高清下载需 PO Token：\n" +
              "  1. 运行 bgutil-ytdlp-pot-provider（推荐，自动获取，无需手动填写）\n" +
              "  2. 或在「设置 → PO Token」粘贴 token（格式 web.gvs+…）";
          }
          reject(new Error(msg));
        }
      });

      yt.on("error", reject);
    });
  }

  // ─── 工具方法 ─────────────────────────────────────

  /**
   * 规范化 PO Token：用户可能粘贴完整 "web_embedded.gvs+XXX"，也可能只粘贴 token 本体。
   * 完整格式为 <client>.<type>+<token>，否则默认补 "web_embedded.gvs+" 前缀
   * （引擎强制 web_embedded 客户端，因为它提供直接 DASH 流且用 GVS PO Token）。
   */
  _normalizePoToken(t) {
    if (!t) return "";
    t = String(t).trim();
    if (/^[a-zA-Z_]+\.[a-zA-Z_+]+[+:]/.test(t)) return t;
    return `web_embedded.gvs+${t}`;
  }

  _fileName(info) {
    const ext = info.ext || "mp4";
    const title = (info.title || "video").replace(/[<>:"/\\|?*]/g, "_").substring(0, 60);
    return `${title}.${ext}`;
  }

  _formatSize(bytes) {
    if (!bytes) return "未知";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(2)} KB`;
  }

  _gcd(a, b) {
    return b === 0 ? a : this._gcd(b, a % b);
  }

  _calcAspectRatio(w, h) {
    if (!w || !h) return "未知";
    const d = this._gcd(w, h);
    const rw = w / d,
      rh = h / d;
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

  _qualityLabel(w, h) {
    if (!w || !h) return "";
    // 短边才是清晰度等级（1920×1080 → 1080p，竖屏 1080×1920 也是 1080p）
    const p = Math.min(w, h);
    if (p >= 2160) return "2160p";
    if (p >= 1440) return "1440p";
    if (p >= 1080) return "1080p";
    if (p >= 720) return "720p";
    if (p >= 480) return "480p";
    return `${p}p`;
  }
}

module.exports = { YtDlpEngine };
