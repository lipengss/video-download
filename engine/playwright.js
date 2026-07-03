/**
 * Playwright 浏览器引擎
 * 用于绕过严格反爬的网站（新片场等）
 */

const { chromium } = require("playwright");

class PlaywrightEngine {
  async parse(url) {
    let browser, context;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"],
      });
      context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0",
        viewport: { width: 1920, height: 1080 },
        locale: "zh-CN",
      });
      const page = await context.newPage();
      // 隐藏自动化痕迹
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      // 等待关键元素加载
      await page.waitForTimeout(3000);

      // 等待页面加载完成，提取视频相关数据
      const videoData = await page.evaluate(() => {
        let extractedUrl = "";
        let title = document.title || "";
        let thumbnail = "";
        const pageText = document.body?.innerText || "";

        // 方式1: <video> 标签
        const videoEl = document.querySelector("video");
        extractedUrl = videoEl?.src || videoEl?.querySelector("source")?.src || "";

        // 方式2: 从所有 script 标签中提取
        if (!extractedUrl) {
          const scripts = document.querySelectorAll("script");
          for (const s of scripts) {
            const text = s.textContent || "";
            // mp4 URL
            const mp4Match = text.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
            if (mp4Match) {
              extractedUrl = mp4Match[0];
              break;
            }
            // m3u8 URL
            const m3u8Match = text.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
            if (m3u8Match) {
              extractedUrl = m3u8Match[0];
              break;
            }
          }
        }

        // 方式3: og:video
        if (!extractedUrl) {
          extractedUrl = document.querySelector('meta[property="og:video"]')?.getAttribute("content") || "";
        }

        // 方式4: 从页面JSON数据提取
        if (!extractedUrl) {
          try {
            const jsonMatch = pageText.match(/"url"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/);
            if (jsonMatch) extractedUrl = jsonMatch[1];
          } catch {}
        }

        // 缩略图
        thumbnail = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";

        return { url: extractedUrl, title, thumbnail };
      });

      await context.close();
      await browser.close();
      browser = null;

      if (!videoData.url) throw new Error("未在页面中找到视频地址");

      return {
        success: true,
        engine: "playwright",
        media: [
          {
            index: 0,
            url: videoData.url,
            thumbnail: videoData.thumbnail || "",
            fileName: `${(videoData.title || "video").replace(/[<>:"/\\|?*]/g, "_").substring(0, 50)}.mp4`,
            type: "video",
            width: 0,
            height: 0,
            aspectRatio: "未知",
            resolution: "未知",
            quality: "",
            formats: [],
            bestFormatId: null,
            isBtch: true, // 用 HTTP 下载
          },
        ],
      };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
}

module.exports = { PlaywrightEngine };
