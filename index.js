#!/usr/bin/env node

/**
 * Instagram 视频下载工具
 * 用法: node index.js <instagram-url>
 *
 * 示例:
 *   node index.js https://www.instagram.com/reel/ABC123/
 *   node index.js https://www.instagram.com/p/ABC123/
 */

const { igdl } = require("btch-downloader");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ─── 配置 ───────────────────────────────────────────────
const DOWNLOADS_DIR = path.join(__dirname, "downloads");

// ─── 工具函数 ────────────────────────────────────────────

const log = {
  info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[32m[OK]\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
};

/** 验证 Instagram URL 格式 */
function validateInstagramUrl(url) {
  const patterns = [
    /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/reel\/[\w-]+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/stories\/[\w.-]+\/\d+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/tv\/[\w-]+\/?/,
  ];
  return patterns.some((p) => p.test(url));
}

/** 格式化文件大小 */
function formatSize(bytes) {
  if (!bytes) return "未知";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(2)} KB`;
}

/** 从 URL 生成安全的文件名 */
function fileNameFromUrl(url, index) {
  // 从 URL 路径提取文件名
  const urlPath = url.split("?")[0];
  const parts = urlPath.split("/");
  const lastPart = parts[parts.length - 1];
  // 如果最后一段看起来像文件名（包含扩展名）
  if (lastPart.includes(".")) {
    return lastPart;
  }
  // 否则用索引生成
  const ext = urlPath.includes(".mp4") ? "mp4" : urlPath.includes(".jpg") ? "jpg" : "mp4";
  return `instagram_${index + 1}.${ext}`;
}

/** 下载单个文件（支持 http/https） */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);

    const req = protocol.get(url, { timeout: 60000 }, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const total = parseInt(res.headers["content-length"] || 0, 10);
      let downloaded = 0;
      let lastPct = -1;

      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.floor((downloaded / total) * 100);
          if (pct !== lastPct && pct % 2 === 0) {
            lastPct = pct;
            const bar = "█".repeat(Math.floor(pct / 2)) + "░".repeat(50 - Math.floor(pct / 2));
            process.stdout.write(
              `\r  下载进度: [${bar}] ${pct}% (${formatSize(downloaded)} / ${formatSize(total)})    `,
            );
          }
        } else {
          process.stdout.write(`\r  已下载: ${formatSize(downloaded)}    `);
        }
      });

      res.pipe(file);
      file.on("finish", () => {
        file.close();
        process.stdout.write("\n");
        resolve();
      });
    });

    req.on("timeout", () => {
      req.destroy();
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(new Error("下载超时"));
    });

    req.on("error", (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

/** 解析命令行参数 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { url: null, help: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "-h":
      case "--help":
        result.help = true;
        break;
      default:
        if (!result.url && !args[i].startsWith("-")) {
          result.url = args[i];
        }
    }
  }

  return result;
}

/** 打印帮助信息 */
function printHelp() {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║       Instagram 视频下载工具  v1.0.0             ║
  ╠══════════════════════════════════════════════════╣
  ║  用法:                                          ║
  ║    node index.js <instagram-url>                 ║
  ║                                                  ║
  ║  支持的链接类型:                                ║
  ║    - Reel (短视频)                               ║
  ║    - Post (帖子中的视频)                         ║
  ║    - Story (快拍)                                ║
  ║    - IGTV                                        ║
  ║                                                  ║
  ║  示例:                                          ║
  ║    node index.js https://www.instagram.com/reel/ABC123/
  ║    node index.js https://www.instagram.com/p/ABC123/
  ║                                                  ║
  ║  视频将下载到 ./downloads/ 目录                  ║
  ╚══════════════════════════════════════════════════╝
  `);
}

// ─── 主流程 ──────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.url) {
    log.error("请提供 Instagram 视频链接");
    console.log("  用法: node index.js <instagram-url>");
    console.log("  更多: node index.js --help");
    process.exit(1);
  }

  // 清理 URL（去掉 query string 中的跟踪参数）
  const cleanUrl = args.url.split("?")[0];

  if (!validateInstagramUrl(cleanUrl)) {
    log.error("无效的 Instagram 链接格式");
    log.info("支持的格式:");
    log.info("  - https://www.instagram.com/p/<shortcode>/");
    log.info("  - https://www.instagram.com/reel/<shortcode>/");
    log.info("  - https://www.instagram.com/stories/<username>/<id>/");
    log.info("  - https://www.instagram.com/tv/<shortcode>/");
    process.exit(1);
  }

  // 确保下载目录存在
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  log.info(`目标: ${cleanUrl}`);
  log.info("正在解析视频信息...");

  // 第一步：提取视频 URL
  let result;
  try {
    result = await igdl(cleanUrl);
  } catch (err) {
    log.error("解析视频信息失败: " + (err.message || err));
    log.info("可能原因:");
    log.info("  1. 链接不存在或已被删除");
    log.info("  2. 需要登录才能查看（私密账号）");
    log.info("  3. 网络连接问题");
    process.exit(1);
  }

  if (!result || !result.status || !result.result || result.result.length === 0) {
    log.error("未能获取到视频信息");
    log.info("该链接可能不包含视频，或需要登录查看");
    process.exit(1);
  }

  const mediaList = result.result;
  log.success(`找到 ${mediaList.length} 个媒体文件`);
  console.log("");

  // 第二步：下载所有媒体文件
  for (let i = 0; i < mediaList.length; i++) {
    const media = mediaList[i];
    const videoUrl = media.url;

    if (!videoUrl) {
      log.warn(`媒体 [${i + 1}/${mediaList.length}] 没有下载链接，跳过`);
      continue;
    }

    const fileName = fileNameFromUrl(videoUrl, i);
    const filePath = path.join(DOWNLOADS_DIR, fileName);

    // 避免覆盖已存在的文件
    let finalPath = filePath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      finalPath = path.join(DOWNLOADS_DIR, `${base}_${counter}${ext}`);
      counter++;
    }

    log.info(`[${i + 1}/${mediaList.length}] 下载: ${path.basename(finalPath)}`);

    try {
      await downloadFile(videoUrl, finalPath);
      const stats = fs.statSync(finalPath);
      log.success(`完成! 大小: ${formatSize(stats.size)} | 路径: ${finalPath}`);
      console.log("");
    } catch (err) {
      log.error(`下载失败: ${err.message}`);
      log.info("尝试重新下载中...");

      // 重试一次
      try {
        await downloadFile(videoUrl, finalPath);
        const stats = fs.statSync(finalPath);
        log.success(`重试成功! 大小: ${formatSize(stats.size)}`);
        console.log("");
      } catch (retryErr) {
        log.error(`重试仍然失败: ${retryErr.message}`);
        console.log("");
      }
    }
  }

  log.success("全部完成!");
  log.info(`文件保存在: ${DOWNLOADS_DIR}`);
}

main().catch((err) => {
  log.error("程序异常: " + (err.message || err));
  process.exit(1);
});
