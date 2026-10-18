/**
 * 抖音引擎封装 —— 无水印 · 高清
 * 抖音详情接口 aweme/v1/web/aweme/detail 需要 a_bogus 签名，yt-dlp 无法直接解析。
 * 这里用 Playwright（playwright-core + 系统 Edge/Chrome，channel 方式，无需下载浏览器）
 * 加载真实页面、拦截 detail 接口响应，拿到各清晰度的无水印播放地址（play_addr）。
 *
 * 关键点：
 *  - play_addr          = 无水印（播放流）
 *  - download_addr / download_suffix_logo_addr = 带水印（不用）
 *  - video.bit_rate[] 按 bit_rate 从高到低 = 清晰度从高到低
 */

const fs = require("fs");
const http = require("http");
const https = require("https");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

class DouyinEngine {
  constructor() {
    this._browser = null;
    this._context = null;
    this._launching = null; // 并发去重：避免多个 parse 同时启动浏览器
    this._activeReq = null; // 当前下载请求，用于取消
  }

  isAvailable() {
    try {
      require("playwright-core");
      return true;
    } catch {
      return false;
    }
  }

  cancel() {
    if (this._activeReq) {
      try {
        this._activeReq.destroy();
      } catch {}
      this._activeReq = null;
    }
  }

  async close() {
    try {
      if (this._context) await this._context.close();
    } catch {}
    try {
      if (this._browser) await this._browser.close();
    } catch {}
    this._context = null;
    this._browser = null;
  }

  async _ensureContext() {
    if (this._context) return this._context;
    if (!this._launching) {
      this._launching = this._doLaunch().finally(() => {
        this._launching = null;
      });
    }
    const { browser, context } = await this._launching;
    this._browser = browser;
    this._context = context;
    return this._context;
  }

  async _doLaunch() {
    const { chromium } = require("playwright-core");
    const channels = ["msedge", "chrome", null];
    let lastErr = null;
    let browser = null;
    for (const channel of channels) {
      try {
        const opts = {
          headless: true,
          args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        };
        if (channel) opts.channel = channel;
        browser = await chromium.launch(opts);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!browser) {
      throw new Error(
        "无法启动浏览器（需已安装 Edge 或 Chrome）：" + (lastErr && lastErr.message ? lastErr.message : String(lastErr)),
      );
    }
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
      locale: "zh-CN",
    });
    await context.addInitScript("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});");
    return { browser, context };
  }

  // ─── URL 解析 ────────────────────────────────────────

  async parse(url, opts = {}) {
    let ctx;
    try {
      ctx = await this._ensureContext();
    } catch (e) {
      await this.close();
      throw e;
    }

    const page = await ctx.newPage();
    const captured = [];
    const onResponse = (resp) => {
      const u = resp.url();
      if (u.includes("aweme/v1/web/aweme/detail") || u.replace(/\/+$/, "").endsWith("/aweme/detail")) {
        captured.push(resp);
      }
    };
    page.on("response", onResponse);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      for (let i = 0; i < 15 && captured.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (captured.length === 0) {
        throw new Error("未解析出视频信息（可能触发验证，请重试）");
      }
      const body = await captured[0].text();
      const data = JSON.parse(body);
      const finalUrl = page.url();
      return this._toResult(data, url, finalUrl);
    } catch (e) {
      // 浏览器崩溃/断连等致命错误 → 重置，下次重新启动
      if (/closed|disconnected|target|browser/i.test(e.message)) await this.close();
      throw e;
    } finally {
      await page.close();
    }
  }

  _toResult(data, url, finalUrl) {
    const ad = data.aweme_detail || {};
    const video = ad.video || {};
    const author = ad.author || {};
    const desc = (ad.desc || "").trim();

    const formats = [];
    for (const b of video.bit_rate || []) {
      const pa = b.play_addr || {};
      const urls = pa.url_list || [];
      // 优先 douyinvod.com 直链，其次取第一个
      const direct = urls.find((u) => u.includes("douyinvod.com")) || urls[0] || null;
      if (!direct) continue;
      const w = pa.width || 0;
      const h = pa.height || 0;
      formats.push({
        id: direct, // 直链即 formatId：下载时无需再解析，直接取该地址
        resolution: w && h ? `${w}×${h}` : "未知",
        width: w,
        height: h,
        quality: this._qualityLabel(w, h),
        ext: "mp4",
        filesize: 0,
        filesizeFormatted: "未知",
        vcodec: b.is_h265 || b.is_bytevc1 ? "h265" : "h264",
        acodec: "aac",
        tbr: b.bit_rate || 0,
      });
    }
    formats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));

    const top = formats[0] || { width: 0, height: 0 };
    const cover =
      (video.cover && video.cover.url_list && video.cover.url_list[0]) ||
      (video.origin_cover && video.origin_cover.url_list && video.origin_cover.url_list[0]) ||
      (video.dynamic_cover && video.dynamic_cover.url_list && video.dynamic_cover.url_list[0]) ||
      "";
    const duration = Math.round((video.duration || ad.duration || 0) / 1000);
    const title = desc;
    const fileName = this._fileName(title, ad.aweme_id);

    const media = {
      index: 0,
      url,
      thumbnail: cover,
      fileName,
      type: "video",
      width: top.width,
      height: top.height,
      aspectRatio: this._calcAspectRatio(top.width, top.height),
      resolution: top.width && top.height ? `${top.width}×${top.height}` : "未知",
      quality: this._qualityLabel(top.width, top.height),
      duration,
      title,
      formats,
      bestFormatId: formats.length ? formats[0].id : null,
    };

    return {
      success: true,
      engine: "douyin",
      title,
      thumbnail: cover,
      duration,
      width: top.width,
      height: top.height,
      aspectRatio: media.aspectRatio,
      resolution: media.resolution,
      quality: media.quality,
      formats,
      bestFormatId: media.bestFormatId,
      media: [media],
    };
  }

  // ─── 下载 ───────────────────────────────────────────

  /**
   * 抖音的 formatId 就是直链（douyinvod.com），url 是页面链接。
   * 兼容两种传法：优先取带 douyinvod 的地址。
   */
  download(url, formatId, filePath, onProgress, opts = {}) {
    const target = [formatId, url].find((u) => u && u.includes("douyinvod.com"));
    if (!target || !/^https?:\/\//i.test(target)) {
      return Promise.reject(new Error("无效的抖音下载地址"));
    }
    return new Promise((resolve, reject) => {
      const doFetch = (u, redirects) => {
        if (redirects > 5) {
          reject(new Error("下载重定向次数过多"));
          return;
        }
        const mod = u.startsWith("https") ? https : http;
        const req = mod.get(
          u,
          { headers: { "User-Agent": UA, Referer: "https://www.douyin.com/", Accept: "*/*" } },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              doFetch(new URL(res.headers.location, u).toString(), redirects + 1);
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error(`下载失败 HTTP ${res.statusCode}（链接可能已过期，请重新解析）`));
              return;
            }
            const total = parseInt(res.headers["content-length"] || "0", 10);
            let done = 0;
            const ws = fs.createWriteStream(filePath);
            res.on("data", (chunk) => {
              done += chunk.length;
              if (typeof onProgress === "function") {
                onProgress({
                  percent: total ? Math.round((done * 100) / total) : 0,
                  totalSize: total ? this._formatSize(total) : "",
                  speed: "",
                  eta: "",
                });
              }
            });
            res.on("error", (e) => {
              ws.destroy();
              reject(e);
            });
            ws.on("finish", () => {
              this._activeReq = null;
              resolve();
            });
            ws.on("error", (e) => reject(e));
            res.pipe(ws);
          },
        );
        this._activeReq = req;
        req.on("error", (e) => reject(e));
        req.setTimeout(30000, () => {
          req.destroy();
          reject(new Error("下载超时"));
        });
      };
      doFetch(target, 0);
    });
  }

  // ─── 工具方法 ─────────────────────────────────────

  _fileName(desc, awemeId) {
    const name = String(desc || "")
      .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 120)
      .trim();
    return (name || `douyin_${awemeId || ""}`) + ".mp4";
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

  _qualityLabel(w, h) {
    if (!w || !h) return "";
    const p = Math.min(w, h);
    if (p >= 2160) return "2160p";
    if (p >= 1440) return "1440p";
    if (p >= 1080) return "1080p";
    if (p >= 720) return "720p";
    if (p >= 480) return "480p";
    return `${p}p`;
  }
}

module.exports = { DouyinEngine };
