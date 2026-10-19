/**
 * 快手引擎封装 —— 无水印 · 高清
 * 快手网页端详情走 GraphQL（POST /graphql，请求头带 `kww` 反爬签名，且无头浏览器
 * 会触发滑块验证码），无法稳定解析。但用「移动端 UA」访问短链会 302 到服务端渲染的
 * m.gifshow.com/fw/photo/{id} 页面，视频直链（photoUrl）、标题（caption）、封面
 * （coverUrl）、时长（duration）都明文内嵌在 HTML 里，无需浏览器、无需签名。
 *
 * 关键点：
 *  - kwaicdn.com/upic/*.mp4（provider=self）  = 无水印原始视频
 *  - kwaicdn.com/bs2/photo-video-mz/*.mp4     = 无水印 H265 版本（更小）
 *  - kwimgs.com/*.mp4                          = 带水印（不用）
 *  - caption = 文案标题，yximgs.com/upic/*.jpg = 封面，duration 单位为毫秒
 */

const fs = require("fs");
const http = require("http");
const https = require("https");

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

class KuaishouEngine {
  constructor() {
    this._activeReq = null; // 当前下载请求，用于取消
  }

  isAvailable() {
    return true; // 纯 HTTP 方案，无外部依赖
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
    // 无浏览器资源需要释放；保留 close 接口以便主进程统一调用
  }

  // ─── URL 解析 ────────────────────────────────────────

  /**
   * 用移动端 UA 跟随重定向抓取页面：短链 /f/{token}、/short-video/{id}、
   * v.kuaishou.com/{token} 等最终都会落到 m.gifshow.com/fw/photo/{id}。
   */
  _fetchHtml(url, redirects = 0) {
    return new Promise((resolve, reject) => {
      if (redirects > 6) return reject(new Error("重定向次数过多"));
      const mod = url.startsWith("https") ? https : http;
      const req = mod.get(
        url,
        {
          headers: {
            "User-Agent": UA_MOBILE,
            Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, url).toString();
            return resolve(this._fetchHtml(next, redirects + 1));
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`请求失败 HTTP ${res.statusCode}`));
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ finalUrl: url, body: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.setTimeout(20000, () => {
        req.destroy();
        reject(new Error("请求超时"));
      });
    });
  }

  async parse(url, opts = {}) {
    // 短链 /f/{token}、v.kuaishou.com/{token} 会 302 到 www.kuaishou.com/short-video/{id}，
    // 但 PC 站对无头请求返回反爬 JSON（result:2）。好在 photoId 就在重定向后的 URL 里，
    // 提取后直接抓服务端渲染的移动页 m.gifshow.com/fw/photo/{id}（无验证码）。
    const photoId = this._photoId(url) || (await this._resolvePhotoId(url));
    if (!photoId) {
      throw new Error("无法解析快手作品 ID");
    }
    const { body } = await this._fetchHtml(`https://m.gifshow.com/fw/photo/${photoId}`);
    const ex = this._extract(body);
    if (!ex.videoUrl) {
      throw new Error("未找到视频地址（可能是图文作品、已删除或需要登录）");
    }
    return this._toResult(ex, url, photoId);
  }

  async _resolvePhotoId(url) {
    const { finalUrl } = await this._fetchHtml(url);
    return this._photoId(finalUrl);
  }

  _extract(html) {
    const unescape = (s) =>
      String(s || "")
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&");

    // JSON 明文字段：caption / duration / width / height / qualityLabel / userName
    const str = (key) => {
      const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
      return m ? m[1] : "";
    };
    const num = (key) => {
      const m = html.match(new RegExp('"' + key + '"\\s*:\\s*(-?\\d+)'));
      return m ? parseInt(m[1], 10) : 0;
    };

    const caption = str("caption");
    const author = str("userName") || str("name");
    const duration = num("duration");
    const width = num("width");
    const height = num("height");
    const qualityLabel = str("qualityLabel");

    // 无水印原始视频（kwaicdn.com/upic），优先 provider=self
    const mp4s = [...html.matchAll(/https:\/\/[^"\\\s]*kwaicdn\.com\/upic\/[^"\\\s]*?\.mp4[^"\\\s]*/g)].map((m) =>
      unescape(m[0]),
    );
    const videoUrl = mp4s.find((x) => x.includes("provider=self")) || mp4s[0] || "";

    // 无水印 H265 版本（更小）
    const h265 = [...html.matchAll(/https:\/\/[^"\\\s]*kwaicdn\.com\/bs2\/photo-video-mz\/[^"\\\s]*?\.mp4[^"\\\s]*/g)].map((m) =>
      unescape(m[0]),
    );

    // 封面（yximgs.com/upic/*.jpg，与视频同 base 路径）
    const coverM = html.match(/https:\/\/[^"\\\s]*yximgs\.com\/upic\/[^"\\\s]*?\.jpg[^"\\\s]*/);
    const cover = unescape(coverM ? coverM[0] : "");

    return { caption, author, duration, width, height, qualityLabel, videoUrl, h265Url: h265[0] || "", cover };
  }

  _toResult(ex, url, photoId) {
    const id = photoId;
    const duration = Math.round((ex.duration || 0) / 1000);
    const title = (ex.caption || "").trim();

    const formats = [];
    const push = (u, quality, tbr) => {
      if (!u) return;
      formats.push({
        id: u, // 直链即 formatId：下载时直接取该地址
        resolution: ex.width && ex.height ? `${ex.width}×${ex.height}` : ex.qualityLabel || "未知",
        width: ex.width || 0,
        height: ex.height || 0,
        quality: quality || this._qualityLabel(ex.width, ex.height) || ex.qualityLabel || "",
        ext: "mp4",
        filesize: 0,
        filesizeFormatted: "未知",
        vcodec: "",
        acodec: "",
        tbr: tbr || 0,
      });
    };
    push(ex.videoUrl, "", 0);
    // H265 版本作为第二选项（同清晰度、体积更小），排在原始视频之后
    if (ex.h265Url && ex.h265Url.split("?")[0] !== ex.videoUrl.split("?")[0]) {
      push(ex.h265Url, "H265", -1);
    }
    formats.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));

    const top = formats[0] || { width: 0, height: 0 };
    const fileName = this._fileName(title, ex.author || id);

    const media = {
      index: 0,
      url,
      thumbnail: ex.cover,
      fileName,
      type: "video",
      width: top.width,
      height: top.height,
      aspectRatio: this._calcAspectRatio(top.width, top.height),
      resolution: top.width && top.height ? `${top.width}×${top.height}` : "未知",
      quality: top.quality,
      duration,
      title,
      formats,
      bestFormatId: formats.length ? formats[0].id : null,
    };

    return {
      success: true,
      engine: "kuaishou",
      title,
      thumbnail: ex.cover,
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
   * 快手的 formatId 就是直链（kwaicdn.com 等 CDN），url 是页面链接。
   * 直链无需 cookies，直接 HTTP GET 流式写入即可。
   */
  download(url, formatId, filePath, onProgress, opts = {}) {
    const target = formatId;
    if (!target || !/^https?:\/\//i.test(target)) {
      return Promise.reject(new Error("无效的快手下载地址"));
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
          { headers: { "User-Agent": UA_DESKTOP, Referer: "https://www.kuaishou.com/", Accept: "*/*" } },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              doFetch(new URL(res.headers.location, u).toString(), redirects + 1);
              return;
            }
            if (res.statusCode !== 200 && res.statusCode !== 206) {
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

  _photoId(finalUrl) {
    const m = String(finalUrl || "").match(/\/(?:short-video|fw\/photo|photo)\/([\w-]+)/);
    return m ? m[1] : "";
  }

  _fileName(caption, authorOrId) {
    const name = String(caption || "")
      .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 120)
      .trim();
    return (name || `kuaishou_${authorOrId || ""}`) + ".mp4";
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

module.exports = { KuaishouEngine };
