/**
 * Playwright 浏览器引擎（单例模式）
 * 用于绕过严格反爬的网站（新片场等），复用浏览器实例避免重复启动开销
 */

const { chromium } = require("playwright");

class PlaywrightEngine {
  constructor() {
    this._browser = null;
    this._initPromise = null;
  }

  /** 懒加载单例浏览器（带并发保护） */
  async _getBrowser() {
    if (this._browser?.isConnected()) return this._browser;
    if (this._initPromise) return this._initPromise;

    this._initPromise = chromium
      .launch({
        headless: true,
        args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"],
      })
      .then((browser) => {
        this._browser = browser;
        this._browser.on("disconnected", () => {
          this._browser = null;
          this._initPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        this._initPromise = null;
        throw err;
      });

    return this._initPromise;
  }

  /** 显式关闭浏览器（应用退出时调用） */
  async close() {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
      this._initPromise = null;
    }
  }

  async parse(url) {
    const browser = await this._getBrowser();
    const isTikTok = /tiktok\.com/i.test(url);
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "zh-CN",
      extraHTTPHeaders: isTikTok
        ? {
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          }
        : undefined,
    });

    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
      });

      const capturedVideoUrls = [];
      const capturedAudioUrls = [];
      const apiBodies = [];

      const tryAddVideo = (u) => {
        if (!u || typeof u !== "string") return;
        if (!/^https?:\/\//i.test(u)) return;
        if (capturedVideoUrls.includes(u)) return;
        if (/^blob:/i.test(u)) return;
        const isExt = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u);
        const isCdn = /(tiktokv\.com|tiktokcdn\.com|bytecdn\.cn|douyinvod\.com|byteimg\.com|snssdk\.com)\/(?!monitor|mcs|collect|settings|login|webid|captcha|verify|register|signin|check|user|policy|static\/obj\/tiktok_web_login)/i.test(u);
        const hasBadPath = /\/(monitor_web|monitor_browser|mcs|collect|settings|webid|captcha|verify|register|signin|check|user|policy)/i.test(u);
        if (isExt || (isCdn && !hasBadPath)) {
          capturedVideoUrls.push(u);
        }
      };
      const tryAddAudio = (u) => {
        if (!u || typeof u !== "string") return;
        if (!/^https?:\/\//i.test(u)) return;
        if (capturedAudioUrls.includes(u)) return;
        if (/\.(mp3|m4a|aac)(\?|$)/i.test(u) || /\/(music|audio)\/.+?\.(mp3|m4a)/i.test(u)) {
          capturedAudioUrls.push(u);
        }
      };
      const tryExtractFromObject = (obj) => {
        if (!obj || typeof obj !== "object") return;
        const seen = new WeakSet();
        const walk = (o) => {
          if (!o || typeof o !== "object" || seen.has(o)) return;
          seen.add(o);
          if (Array.isArray(o)) {
            o.forEach(walk);
            return;
          }
          for (const [k, v] of Object.entries(o)) {
            if (typeof v === "string") {
              if (
                /playAddr|downloadAddr|videoUrl|play_url|url_list|bit_rate|src|download_url|main_url/i.test(k)
              ) {
                try {
                  let decoded = v;
                  try {
                    decoded = decodeURIComponent(v);
                  } catch {}
                  tryAddVideo(decoded);
                } catch {}
              }
              tryAddVideo(v);
              tryAddAudio(v);
            } else if (typeof v === "object") {
              walk(v);
            }
          }
        };
        walk(obj);
      };

      page.on("request", (req) => {
        const u = req.url();
        tryAddVideo(u);
        tryAddAudio(u);
      });
      page.on("response", async (res) => {
        const u = res.url();
        tryAddVideo(u);
        tryAddAudio(u);
        const ct = res.headers()["content-type"] || "";
        if (/^video\//i.test(ct)) tryAddVideo(u);
        if (/^audio\//i.test(ct)) tryAddAudio(u);
        if (isTikTok && /application\/json/i.test(ct)) {
          if (/\/api\/|item|detail|aweme|post|recommend/i.test(u)) {
            try {
              const ok = res.ok();
              if (ok) {
                const body = await res.json().catch(() => null);
                if (body) {
                  apiBodies.push(body);
                  tryExtractFromObject(body);
                }
              }
            } catch {}
          }
        }
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(isTikTok ? 6000 : 3000);

      for (let i = 0; i < (isTikTok ? 3 : 1) && capturedVideoUrls.length === 0; i++) {
        await page.waitForTimeout(2000);
      }

      const videoData = await page.evaluate(({ pageUrl, isTikTok }) => {
        let extractedUrl = "";
        let title = document.title || "";
        let thumbnail = "";

        const tryMatch = (text) => {
          if (!text) return "";
          const mp4Match = text.match(/https?:\/\/[^"'\s)\]}]+?\.(mp4|webm|mov)(\?[^"'\s)\]]*)?/gi);
          if (mp4Match && mp4Match.length > 0) return mp4Match[0];
          const videoHostMatch = text.match(
            /https?:\/\/[^"'\s)\]]*(tiktokv\.com|tiktokcdn\.com|bytecdn\.cn|douyinvod\.com)[^"'\s)\]]*/gi,
          );
          if (videoHostMatch && videoHostMatch.length > 0) return videoHostMatch[0];
          return "";
        };

        const videoEl = document.querySelector("video");
        if (videoEl) {
          extractedUrl = videoEl.src || videoEl.querySelector("source")?.src || "";
          if (!extractedUrl) {
            try {
              extractedUrl = videoEl.getAttribute("src") || "";
            } catch {}
          }
        }

        if (!extractedUrl) {
          const scripts = document.querySelectorAll("script");
          for (const s of scripts) {
            const text = s.textContent || "";
            const m = tryMatch(text);
            if (m) {
              extractedUrl = m;
              break;
            }
          }
        }

        if (!extractedUrl) {
          extractedUrl = document.querySelector('meta[property="og:video"]')?.getAttribute("content") || "";
        }
        if (!extractedUrl) {
          extractedUrl = document.querySelector('meta[property="og:video:url"]')?.getAttribute("content") || "";
        }
        if (!extractedUrl) {
          extractedUrl = document.querySelector('meta[property="og:video:secure_url"]')?.getAttribute("content") || "";
        }

        if (!extractedUrl) {
          try {
            const pageText = document.body?.innerText || "";
            const m = tryMatch(pageText);
            if (m) extractedUrl = m;
          } catch {}
        }

        if (!extractedUrl) {
          try {
            const jsonRe = /"playAddr"|downloadAddr|"videoUrl"|"play_url"|"url_list"/;
            const scripts = document.querySelectorAll("script");
            for (const s of scripts) {
              const text = s.textContent || "";
              if (!jsonRe.test(text)) continue;
              const candidate = text.match(/https?:\/\/[^"\\]{10,}\.mp4[^"\\]{0,60}/i);
              if (candidate) {
                extractedUrl = candidate[0];
                break;
              }
            }
          } catch {}
        }

        if (isTikTok) {
          try {
            const w = window;
            if (w.SIGI_STATE) {
              const text = JSON.stringify(w.SIGI_STATE);
              const m = tryMatch(text);
              if (m && !extractedUrl) extractedUrl = m;
            }
            if (w.__INITIAL_STATE__ || w.__NEXT_DATA__) {
              const text = JSON.stringify(w.__INITIAL_STATE__ || w.__NEXT_DATA__);
              const m = tryMatch(text);
              if (m && !extractedUrl) extractedUrl = m;
            }
          } catch {}
        }

        thumbnail =
          document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
          document.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ||
          thumbnail;

        if (!title) {
          title =
            document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
            document.querySelector('meta[name="description"]')?.getAttribute("content") ||
            pageUrl;
        }

        return { url: extractedUrl, title, thumbnail };
      }, { pageUrl: url, isTikTok });

      let finalUrl = videoData.url;
      if (finalUrl && /^blob:/i.test(finalUrl)) finalUrl = "";

      // 最后处理一次 apiBodies（异步 response handler 可能延迟填充）
      for (const b of apiBodies) tryExtractFromObject(b);

      // 排序：优先真实视频扩展名的 URL，再是 CDN 资源 URL
      const scoreUrl = (u) => {
        let s = 0;
        if (/\.(mp4|webm|mov)(\?|#|$)/i.test(u)) s += 1000;
        if (/\?/.test(u)) s += 100;
        if (/(bit_rate|ratio=|play=|download|video_id=|item_id=|u0026)/i.test(u)) s += 300;
        if (/tiktokcdn\.com.+?(tos-useast|tos-useast2|tos-useast5|obj\/)/i.test(u)) s += 400;
        if (/(douyinvod\.com|bytecdn\.cn|snssdk\.com|byteimg\.com)/i.test(u)) s += 300;
        if (/(aligo|aweme|cdn\d*\.|media\.|vod)/i.test(u)) s += 150;
        if (hasBadPathTest(u)) s -= 5000;
        if (/(login|static|playback|settings|collect|monitor)/i.test(u)) s -= 200;
        return s;
      };
      const hasBadPathTest = (u) =>
        /\/(monitor_web|monitor_browser|mcs|collect|settings|webid|captcha|verify|register|signin|check|user|policy)/i.test(u);

      capturedVideoUrls.sort((a, b) => scoreUrl(b) - scoreUrl(a));

      if (!finalUrl && capturedVideoUrls.length > 0) {
        finalUrl = capturedVideoUrls[0];
      }
      const allUrls = capturedVideoUrls.filter((u) => u && !/^blob:/i.test(u) && !hasBadPathTest(u));
      if (finalUrl && !/^blob:/i.test(finalUrl) && !allUrls.includes(finalUrl)) allUrls.unshift(finalUrl);

      if (!finalUrl) throw new Error("未在页面中找到视频地址（视频可能为私密或需要登录）");

      const formats = allUrls.map((u, j) => ({
        id: `q${j}`,
        resolution: j === 0 ? "最佳" : `备选 ${j}`,
        quality: "",
        ext: "mp4",
      }));

      return {
        success: true,
        engine: "playwright",
        media: [
          {
            index: 0,
            url: finalUrl,
            thumbnail: videoData.thumbnail || "",
            fileName: `${(videoData.title || "video").replace(/[<>:"/\\|?*]/g, "_").substring(0, 50)}.mp4`,
            type: "video",
            width: 0,
            height: 0,
            aspectRatio: "未知",
            resolution: formats[0]?.resolution || "未知",
            quality: "",
            formats,
            bestFormatId: "q0",
            isBtch: true,
            _links: allUrls.map((u) => ({ url: u })),
          },
        ],
      };
    } finally {
      await context.close().catch(() => {});
    }
  }
}

module.exports = { PlaywrightEngine };
