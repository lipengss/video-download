/**
 * Instagram 引擎 —— 轮播图（多图）帖子
 * 国内网络下 Node 直连易超时，优先用 Playwright（系统 Edge/Chrome）拉取页面与 GraphQL。
 * yt-dlp 对纯图片轮播仍会失败，Reel 单视频仍走 yt-dlp。
 */

const dns = require("dns");
const fs = require("fs");
const http = require("http");
const https = require("https");

dns.setDefaultResultOrder("ipv4first");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HTTPS_AGENT = new https.Agent({ family: 4, keepAlive: true });

const IG_COOKIE_NAMES = new Set([
  "sessionid",
  "csrftoken",
  "ds_user_id",
  "mid",
  "ig_did",
  "rur",
  "datr",
  "ps_l",
  "ps_n",
  "wd",
  "dpr",
]);

const IG_APP_ID = "936619743392459";

class InstagramEngine {
  constructor() {
    this._browser = null;
    this._context = null;
    this._ctxKey = null;
    this._launching = null;
    this._activeReq = null;
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
    this._ctxKey = null;
  }

  _shortcode(url) {
    const m = String(url || "").match(/instagram\.com\/(?:p|tv|reel)\/([A-Za-z0-9_-]+)/i);
    return m ? m[1] : "";
  }

  _normalizeProxy(proxy) {
    if (!proxy) return "";
    let p = String(proxy).trim();
    if (!p) return "";
    if (!/^https?:\/\//i.test(p)) p = `http://${p}`;
    return p;
  }

  _ctxCacheKey(opts) {
    const proxy = this._normalizeProxy(opts?.proxy);
    return `${proxy}|${opts?.cookiesFile || ""}`;
  }

  _parseNetscapeLine(raw) {
    const t = raw.trim();
    if (!t || (t.startsWith("#") && !t.startsWith("#HttpOnly_"))) return null;
    const cols = t.replace(/^#HttpOnly_/, "").split("\t");
    if (cols.length < 7) return null;
    return cols;
  }

  _netscapeCookies(cookiesFile) {
    if (!cookiesFile || !fs.existsSync(cookiesFile)) return [];
    const out = [];
    for (const line of fs.readFileSync(cookiesFile, "utf8").split(/\r?\n/)) {
      const cols = this._parseNetscapeLine(line);
      if (!cols) continue;
      const domainRaw = cols[0];
      const name = cols[5];
      const value = cols[6].trim();
      const isIgDomain = /instagram/i.test(domainRaw);
      const isIgName = IG_COOKIE_NAMES.has(name);
      if (!isIgDomain && !isIgName) continue;

      const httpOnly = /^TRUE$/i.test(cols[1]) || line.trim().startsWith("#HttpOnly_");
      const secure = /^TRUE$/i.test(cols[3]) || name === "sessionid" || name === "csrftoken";
      const expires = Number.parseInt(cols[4], 10);
      out.push({
        name,
        value,
        url: "https://www.instagram.com",
        path: cols[2] || "/",
        expires: expires > 0 ? expires : undefined,
        httpOnly,
        secure,
        sameSite: "Lax",
      });
    }
    return out;
  }

  _assertParseCookies(opts) {
    if (!opts.cookiesFile || !fs.existsSync(opts.cookiesFile)) {
      throw new Error("请先在设置 → Cookies → Instagram 中导入 cookies.txt（不是 YouTube 那份）");
    }
    const cookies = this._netscapeCookies(opts.cookiesFile);
    if (!cookies.length) {
      throw new Error(
        "cookies 里没有 Instagram 项。请打开 instagram.com 登录后，用插件导出 Netscape 格式 cookies.txt",
      );
    }
    if (!cookies.some((c) => c.name === "sessionid")) {
      throw new Error("cookies 缺少 sessionid，请确认导出的是 instagram.com 且浏览器仍处于登录状态");
    }
    if (!cookies.some((c) => c.name === "csrftoken")) {
      throw new Error("cookies 缺少 csrftoken，请重新导出 instagram cookies");
    }
    return cookies.length;
  }

  _cookieHeader(cookiesFile) {
    return this._netscapeCookies(cookiesFile)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  async _ensureContext(opts = {}) {
    const key = this._ctxCacheKey(opts);
    if (this._context && this._ctxKey === key) return this._context;
    await this.close();

    if (!this._launching) {
      this._launching = this._doLaunch(opts).finally(() => {
        this._launching = null;
      });
    }
    this._context = await this._launching;
    this._ctxKey = key;
    const cookies = this._netscapeCookies(opts.cookiesFile);
    if (cookies.length) {
      await this._context.addCookies(cookies);
    }
    try {
      await this._context.request.get("https://www.instagram.com/", { timeout: 30000 });
    } catch {
      /* 预热失败不阻断，后续 API 可能仍可用 */
    }
    return this._context;
  }

  async _apiHeaders(ctx) {
    const jar = await ctx.cookies("https://www.instagram.com");
    const csrf = jar.find((c) => c.name === "csrftoken")?.value;
    if (!csrf) throw new Error("浏览器上下文未加载 csrftoken，请重新导入 cookies");
    return {
      "X-CSRFToken": csrf,
      "X-IG-App-ID": IG_APP_ID,
      "X-ASBD-ID": "129477",
      "X-IG-WWW-Claim": "0",
      Referer: "https://www.instagram.com/",
      Accept: "*/*",
    };
  }

  async _tryWebInfoApi(ctx, shortcode, raw, seen) {
    const headers = await this._apiHeaders(ctx);
    const urls = [
      `https://www.instagram.com/api/v1/media/web_info/?shortcode=${shortcode}`,
      `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
    ];
    for (const apiUrl of urls) {
      try {
        const res = await ctx.request.get(apiUrl, { headers, timeout: 45000 });
        if (!res.ok()) continue;
        const data = await res.json();
        if (data?.items?.[0]?.carousel_media) {
          for (const node of data.items[0].carousel_media) this._pushNode(node, raw, seen);
        }
        if (data?.items?.[0] && !data.items[0].carousel_media) {
          this._pushNode(data.items[0], raw, seen);
        }
        this._walkGraph(data, raw, seen);
        if (raw.length) return true;
      } catch (e) {
        console.log("[instagram] API 尝试失败", apiUrl.slice(0, 60), e.message);
      }
    }
    return raw.length > 0;
  }

  async _doLaunch(opts) {
    const { chromium } = require("playwright-core");
    const channels = ["msedge", "chrome", null];
    const args = ["--no-sandbox", "--disable-blink-features=AutomationControlled"];
    const proxy = this._normalizeProxy(opts.proxy);
    if (proxy) args.push(`--proxy-server=${proxy}`);

    let browser = null;
    let lastErr = null;
    for (const channel of channels) {
      try {
        const launchOpts = { headless: true, args };
        if (channel) launchOpts.channel = channel;
        browser = await chromium.launch(launchOpts);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!browser) {
      throw new Error(
        "无法启动浏览器（需已安装 Edge 或 Chrome）：" + (lastErr?.message || String(lastErr)),
      );
    }
    this._browser = browser;

    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    await context.addInitScript("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});");
    return context;
  }

  _fetchHttp(url, cookiesFile, redirects = 0) {
    return new Promise((resolve, reject) => {
      if (redirects > 8) return reject(new Error("Instagram 重定向次数过多"));
      const mod = url.startsWith("https") ? https : http;
      const cookie = this._cookieHeader(cookiesFile);
      const headers = {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.instagram.com/",
      };
      if (cookie) headers.Cookie = cookie;

      const req = mod.get(url, { headers, agent: url.startsWith("https") ? HTTPS_AGENT : undefined }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(this._fetchHttp(new URL(res.headers.location, url).toString(), cookiesFile, redirects + 1));
        }
        if (res.statusCode === 403) {
          res.resume();
          return reject(new Error("Instagram 拒绝访问（403），请导入 instagram cookies"));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Instagram 页面请求失败 HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      });
      this._activeReq = req;
      req.on("error", reject);
      req.setTimeout(25000, () => {
        req.destroy();
        reject(new Error("Instagram 直连超时"));
      });
    });
  }

  async _fetchHtml(url, opts) {
    if (this.isAvailable()) {
      try {
        return await this._fetchHtmlPlaywright(url, opts);
      } catch (e) {
        console.log("[instagram] Playwright 拉取失败:", e.message);
      }
    }
    try {
      return await this._fetchHttp(url, opts.cookiesFile);
    } catch (e) {
      const hint = opts.proxy
        ? ""
        : "。若在国内网络，请在设置中开启代理并填写可访问 Instagram 的地址";
      throw new Error((e.message || "Instagram 请求失败") + hint);
    }
  }

  async _fetchHtmlPlaywright(url, opts) {
    const ctx = await this._ensureContext(opts);
    const page = await ctx.newPage();
    const gqlPayloads = [];

    const onResponse = async (resp) => {
      const u = resp.url();
      if (!/instagram\.com/i.test(u)) return;
      if (!/graphql|\/api\/v1\/media\//i.test(u)) return;
      try {
        const ct = resp.headers()["content-type"] || "";
        if (!/json/i.test(ct)) return;
        const text = await resp.text();
        if (!/display_url|edge_sidecar|carousel_media|image_versions/i.test(text)) return;
        gqlPayloads.push(JSON.parse(text));
      } catch {
        /* ignore */
      }
    };
    page.on("response", onResponse);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (gqlPayloads.length) break;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const html = await page.content();
      return { html, gqlPayloads };
    } catch (e) {
      if (/closed|disconnected|target|browser/i.test(e.message)) await this.close();
      throw e;
    } finally {
      page.off("response", onResponse);
      await page.close();
    }
  }

  _unescapeUrl(u) {
    return String(u || "")
      .replace(/\\\//g, "/")
      .replace(/\\u0026/g, "&");
  }

  _walkGraph(obj, out, seen, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 48) return;

    const sidecar = obj.edge_sidecar_to_children || obj.carousel_media;
    if (sidecar?.edges && Array.isArray(sidecar.edges)) {
      for (const edge of sidecar.edges) {
        if (edge?.node) this._pushNode(edge.node, out, seen);
      }
      return;
    }
    if (Array.isArray(sidecar)) {
      for (const node of sidecar) this._pushNode(node, out, seen);
      return;
    }

    if (obj.shortcode && (obj.display_url || obj.video_url || obj.video_versions || obj.is_video != null)) {
      this._pushNode(obj, out, seen);
    }

    if (Array.isArray(obj)) {
      for (const x of obj) this._walkGraph(x, out, seen, depth + 1);
      return;
    }
    for (const key of Object.keys(obj)) {
      if (key === "__proto__") continue;
      this._walkGraph(obj[key], out, seen, depth + 1);
    }
  }

  _pushNode(node, out, seen) {
    if (!node || typeof node !== "object") return;
    const isVideo =
      node.is_video === true ||
      node.media_type === 2 ||
      /video/i.test(String(node.__typename || node.product_type || ""));
    let downloadUrl = "";
    let thumb = "";
    let w = node.dimensions?.width || node.original_width || 0;
    let h = node.dimensions?.height || node.original_height || 0;

    if (isVideo) {
      downloadUrl =
        node.video_url ||
        (node.video_versions && [...node.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url) ||
        "";
      thumb = node.display_url || node.thumbnail_url || node.thumbnail_src || "";
    } else {
      const resources = node.display_resources || node.image_versions2?.candidates;
      if (Array.isArray(resources) && resources.length) {
        const best = [...resources].sort(
          (a, b) => (b.config_width || b.width || 0) - (a.config_width || a.width || 0),
        )[0];
        downloadUrl = best?.src || best?.url || node.display_url || "";
        w = best?.config_width || best?.width || w;
        h = best?.config_height || best?.height || h;
      } else {
        downloadUrl = node.display_url || node.thumbnail_src || "";
      }
      thumb = node.display_url || node.thumbnail_src || downloadUrl;
    }

    downloadUrl = this._unescapeUrl(downloadUrl);
    thumb = this._unescapeUrl(thumb);
    if (!downloadUrl || !/^https?:\/\//i.test(downloadUrl)) return;

    const key = downloadUrl.split("?")[0];
    if (seen.has(key)) return;
    seen.add(key);

    out.push({ isVideo, downloadUrl, thumb, width: w, height: h, shortcode: node.shortcode || "" });
  }

  _collectFromMarkup(html, gqlPayloads, raw, seen) {
    for (const payload of gqlPayloads || []) {
      this._walkGraph(payload, raw, seen);
    }
    const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      try {
        this._walkGraph(JSON.parse(m[1]), raw, seen);
      } catch {
        /* ignore */
      }
    }
    if (!raw.length) this._parseRegexFallback(html, raw, seen);
  }

  _parseRegexFallback(html, out, seen) {
    const videoUrls = [...html.matchAll(/"video_url"\s*:\s*"(https?:[^"]+)"/g)].map((x) =>
      this._unescapeUrl(x[1]),
    );
    const displayUrls = [...html.matchAll(/"display_url"\s*:\s*"(https?:[^"]+)"/g)].map((x) =>
      this._unescapeUrl(x[1]),
    );

    for (const u of videoUrls) {
      const key = u.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ isVideo: true, downloadUrl: u, thumb: "", width: 0, height: 0, shortcode: "" });
    }
    for (const u of displayUrls) {
      const key = u.split("?")[0];
      if (seen.has(key)) continue;
      if (videoUrls.some((v) => v.split("?")[0] === key)) continue;
      seen.add(key);
      out.push({ isVideo: false, downloadUrl: u, thumb: u, width: 0, height: 0, shortcode: "" });
    }
  }

  _titleFromHtml(html) {
    const og = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    if (og) return og[1].replace(/&quot;/g, '"').slice(0, 80);
    const desc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    if (desc) return desc[1].slice(0, 80);
    return "Instagram";
  }

  _thumbFromHtml(html) {
    const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    return m ? this._unescapeUrl(m[1]) : "";
  }

  _fileName(title, index, total, isVideo, extHint) {
    const base = String(title || "instagram")
      .replace(/[<>:"/\\|?*\r\n]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50);
    const suffix = total > 1 ? `_${index + 1}` : "";
    const ext = isVideo ? "mp4" : extHint || "jpg";
    return `${base}${suffix}.${ext}`;
  }

  _extFromUrl(u) {
    const m = String(u).match(/\.(jpe?g|png|webp|mp4|gif)(\?|$)/i);
    return m ? m[1].toLowerCase() : "jpg";
  }

  _buildMedia(pageUrl, title, playlistThumb, rawItems) {
    const total = rawItems.length;
    return rawItems.map((item, index) => {
      const isVideo = item.isVideo;
      const ext = isVideo ? "mp4" : this._extFromUrl(item.downloadUrl);
      const formats = [
        {
          id: item.downloadUrl,
          resolution: item.width && item.height ? `${item.width}×${item.height}` : isVideo ? "视频" : "原图",
          width: item.width || 0,
          height: item.height || 0,
          quality: isVideo ? "视频" : "原图",
          ext,
          filesize: 0,
          filesizeFormatted: "未知",
          vcodec: isVideo ? "h264" : "none",
          acodec: isVideo ? "aac" : "none",
        },
      ];
      return {
        index,
        url: pageUrl,
        thumbnail: item.thumb || playlistThumb,
        fileName: this._fileName(title, index, total, isVideo, ext),
        type: isVideo ? "video" : "image",
        width: item.width || 0,
        height: item.height || 0,
        resolution: item.width && item.height ? `${item.width}×${item.height}` : isVideo ? "视频" : "图片",
        quality: isVideo ? "视频" : "原图",
        duration: 0,
        formats,
        bestFormatId: item.downloadUrl,
        carouselId: total > 1 ? pageUrl : undefined,
        carouselIndex: total > 1 ? index + 1 : undefined,
        carouselTotal: total > 1 ? total : undefined,
      };
    });
  }

  async parse(url, opts = {}) {
    opts = { ...opts, proxy: this._normalizeProxy(opts.proxy) };
    const shortcode = this._shortcode(url);
    if (!shortcode) throw new Error("无效的 Instagram 链接");

    if (!this.isAvailable()) {
      throw new Error("需要本机安装 Edge 或 Chrome 才能解析 Instagram 轮播");
    }

    const cookieCount = this._assertParseCookies(opts);
    console.log(`[instagram] 已加载 ${cookieCount} 个 Cookie，shortcode=${shortcode}`);

    const pageUrl = `https://www.instagram.com/p/${shortcode}/`;
    let html = "";
    let gqlPayloads = [];
    const raw = [];
    const seen = new Set();

    const ctx = await this._ensureContext(opts);
    await this._tryWebInfoApi(ctx, shortcode, raw, seen);

    if (!raw.length) {
      try {
        const payload = await this._fetchHtmlPlaywright(pageUrl, opts);
        html = payload.html;
        gqlPayloads = payload.gqlPayloads;
        this._collectFromMarkup(html, gqlPayloads, raw, seen);
      } catch (e) {
        console.log("[instagram] 页面抓取失败", e.message);
      }
    }

    if (!raw.length) {
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      try {
        const payload = await this._fetchHtmlPlaywright(embedUrl, opts);
        html = payload.html || html;
        this._collectFromMarkup(payload.html, payload.gqlPayloads, raw, seen);
      } catch {
        /* ignore */
      }
    }

    if (!html && raw.length === 0) {
      try {
        const page = await ctx.newPage();
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
        html = await page.content();
        const evalJson = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('script[type="application/json"]')) {
            const t = el.textContent || "";
            if (!/carousel_media|display_url|xdt_shortcode_media/i.test(t)) continue;
            try {
              out.push(JSON.parse(t));
            } catch {
              /* ignore */
            }
          }
          return out;
        });
        for (const block of evalJson) this._walkGraph(block, raw, seen);
        await page.close();
      } catch (e) {
        console.log("[instagram] evaluate 失败", e.message);
      }
    }

    if (/login|Login/i.test(html) && /id="loginForm"|loginPage/i.test(html)) {
      throw new Error("Instagram 仍显示登录页：cookies 无效或过期，请重新导出");
    }

    if (!raw.length) {
      const proxyHint = opts.proxy ? "" : "请开启代理；";
      throw new Error(
        `${proxyHint}未解析到轮播内容。请确认：① Instagram 行已导入 cookies（含 sessionid）；② 代理能打开 instagram.com；③ 导入后点击保存设置`,
      );
    }

    const title = this._titleFromHtml(html);
    const playlistThumb = this._thumbFromHtml(html);
    const media = this._buildMedia(pageUrl, title, playlistThumb, raw);
    const primary = media[0];

    return {
      success: true,
      engine: "instagram",
      title,
      thumbnail: playlistThumb || primary.thumbnail,
      duration: 0,
      width: primary.width,
      height: primary.height,
      resolution: primary.resolution,
      quality: primary.quality,
      formats: primary.formats,
      bestFormatId: primary.bestFormatId,
      media,
    };
  }

  download(_pageUrl, formatId, filePath, onProgress, opts = {}) {
    const target = formatId;
    if (!target || !/^https?:\/\//i.test(target)) {
      return Promise.reject(new Error("无效的 Instagram 下载地址，请重新解析"));
    }
    return new Promise((resolve, reject) => {
      const doFetch = (u, redirects) => {
        if (redirects > 6) return reject(new Error("下载重定向次数过多"));
        const mod = u.startsWith("https") ? https : http;
        const cookie = this._cookieHeader(opts.cookiesFile);
        const headers = {
          "User-Agent": UA,
          Referer: "https://www.instagram.com/",
          Accept: "*/*",
        };
        if (cookie) headers.Cookie = cookie;

        const req = mod.get(
          u,
          { headers, agent: u.startsWith("https") ? HTTPS_AGENT : undefined },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              return doFetch(new URL(res.headers.location, u).toString(), redirects + 1);
            }
            if (res.statusCode !== 200 && res.statusCode !== 206) {
              res.resume();
              return reject(new Error(`下载失败 HTTP ${res.statusCode}（链接可能已过期，请重新解析）`));
            }
            const total = parseInt(res.headers["content-length"] || "0", 10);
            let done = 0;
            const ws = fs.createWriteStream(filePath);
            res.on("data", (chunk) => {
              done += chunk.length;
              if (typeof onProgress === "function") {
                onProgress({
                  percent: total ? Math.min(100, Math.round((done * 100) / total)) : done > 0 ? 50 : 0,
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
              if (typeof onProgress === "function") onProgress({ percent: 100, totalSize: "", speed: "", eta: "" });
              resolve();
            });
            ws.on("error", reject);
            res.pipe(ws);
          },
        );
        this._activeReq = req;
        req.on("error", reject);
        req.setTimeout(120000, () => {
          req.destroy();
          reject(new Error("下载超时"));
        });
      };
      doFetch(target, 0);
    });
  }

  _formatSize(bytes) {
    if (!bytes) return "未知";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(2)} KB`;
  }
}

module.exports = { InstagramEngine };
