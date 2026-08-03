/**
 * 在线激活码验证模块
 * 对接验证接口 POST https://license.speedstory.cn/api/verify
 */

const https = require("https");
const crypto = require("crypto");
const os = require("os");

// ─── 配置 ───────────────────────────────────────────────
const API_URL = "https://license.speedstory.cn/api/verify";
const API_KEY = "ak-e4d25505a9ee4ddc8c7558f013f8267c";
const REQUEST_TIMEOUT = 10000;
const CLIENT_VERSION = "1.0.0";
const USER_AGENT = "VideoDL-Pro/1.0.0 (Electron; " + os.platform() + " " + os.arch() + ")";

/** 格式化激活码: VIDEO-XXXX-XXXX-XXXX-XXXX */
function formatCode(code) {
  const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // 去掉可能存在的 VIDEO 前缀
  const hex = raw.startsWith("VIDEO") ? raw.slice(5) : raw;
  // 必须有 16 位十六进制字符
  if (hex.length !== 16 || !/^[0-9A-F]{16}$/.test(hex)) return null;
  return `VIDEO-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

/** 生成设备唯一标识 */
function getDeviceId() {
  const info = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model || "", os.totalmem()].join(":");
  return crypto.createHash("sha256").update(info).digest("hex");
}

/** 向远程 API 发起验证请求 */
async function verifyOnline(code, deviceId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      code,
      deviceId,
      extra: JSON.stringify({ platform: os.platform(), arch: os.arch(), hostname: os.hostname() }),
    });

    const url = new URL(API_URL);

    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "User-Agent": USER_AGENT,
          "x-client-version": CLIENT_VERSION,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode === 200) {
            if (!data.trim()) {
              return reject(new Error("服务器返回空响应"));
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`响应解析失败: ${data.slice(0, 200)}`));
            }
          } else {
            try {
              const json = JSON.parse(data);
              reject(new Error(json.error || json.reason || `HTTP ${res.statusCode}`));
            } catch {
              reject(new Error(`服务器返回 ${res.statusCode}`));
            }
          }
        });
      },
    );

    req.on("error", () => reject(new Error("网络连接失败，请检查网络后重试")));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("请求超时，请稍后重试"));
    });
    req.write(body);
    req.end();
  });
}

/**
 * 验证激活码
 * @returns {{ valid: boolean, formatted?: string, error?: string }}
 */
async function validateCode(rawCode) {
  // 1. 格式校验
  const formatted = formatCode(rawCode);
  if (!formatted) {
    return { valid: false, error: "激活码格式不正确，应为 VIDEO-XXXX-XXXX-XXXX-XXXX" };
  }

  // 2. 生成设备 ID
  const deviceId = getDeviceId();

  // 3. 在线验证
  try {
    const response = await verifyOnline(formatted, deviceId);

    if (response.valid) {
      return {
        valid: true,
        formatted,
        expiresAt: response.expiresAt || null,
      };
    }

    // 失败原因映射（与文档一致）
    const reasonMap = {
      invalid: "激活码无效，请检查后重试",
      already_activated: "此激活码已在其他设备上使用",
      revoked: "此激活码已被撤销",
      expired: "此激活码已过期",
    };
    const errorMsg = reasonMap[response.reason] || response.reason || "验证失败";
    return { valid: false, error: errorMsg };
  } catch (err) {
    return { valid: false, error: `验证失败: ${err.message}` };
  }
}

module.exports = { validateCode, getDeviceId, formatCode };
