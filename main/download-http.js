/**
 * HTTP 下载模块（带超时和自动重试）
 */

const fs = require("fs");
const https = require("https");
const http = require("http");

/**
 * 通过 HTTP(S) 下载文件
 * @param {string} url - 下载地址
 * @param {string} destPath - 保存路径
 * @param {(p: {percent:number, totalSize:string}) => void} onProgress - 进度回调
 * @param {number} retries - 最大重试次数（默认为 3）
 * @param {object} headers - 自定义 HTTP 头
 */
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

module.exports = { downloadHttp };
