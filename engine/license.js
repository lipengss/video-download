/**
 * 简易离线许可证管理
 * 买断制 — 本地密钥验证，无需服务器
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ⚠️ 生产环境请更换此密钥对！
const LICENSE_SECRET = "vdl-pro-2024-k3y-s3cr3t-ch4ng3-m3";
const LICENSE_FILE = "license.dat";

class LicenseManager {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.licensePath = path.join(userDataPath, LICENSE_FILE);
    this._licenseData = null;
  }

  /** 生成激活码（开发者使用，不嵌入发行版） */
  static generateKey(userId) {
    // 使用固定种子计算合法前缀
    const prefix = crypto
      .createHmac("sha256", LICENSE_SECRET)
      .update("vdl-pro-keygen-seed-2024")
      .digest("hex")
      .substring(0, 8)
      .toUpperCase();
    // 随机后缀确保每把密钥唯一
    const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    const key = (prefix + suffix).match(/.{1,4}/g).join("-");
    console.log(`\n  ╔══════════════════════════════╗`);
    console.log(`  ║  激活码: ${key}  ║`);
    console.log(`  ╚══════════════════════════════╝\n`);
    return { key, prefix, suffix };
  }

  /** 验证并激活 */
  activate(inputKey) {
    const clean = inputKey.replace(/-/g, "").toUpperCase();

    if (clean.length !== 16) {
      return { valid: false, message: "激活码格式不正确，应为 XXXX-XXXX-XXXX-XXXX" };
    }

    // 验证前缀：前8位必须与固定种子计算的 HMAC 匹配
    const validPrefix = crypto
      .createHmac("sha256", LICENSE_SECRET)
      .update("vdl-pro-keygen-seed-2024")
      .digest("hex")
      .substring(0, 8)
      .toUpperCase();

    if (clean.substring(0, 8) === validPrefix) {
      const licenseData = {
        key: inputKey,
        activatedAt: Date.now(),
        machineId: this._getMachineId(),
        version: "1.0.0",
      };
      this._saveLicense(licenseData);
      this._licenseData = licenseData;
      return { valid: true, message: "激活成功！感谢购买" };
    }

    return { valid: false, message: "激活码无效" };
  }

  /** 检查许可证状态 */
  isValid() {
    if (this._licenseData) return true;

    try {
      if (!fs.existsSync(this.licensePath)) return false;
      const raw = fs.readFileSync(this.licensePath, "utf8");
      const data = JSON.parse(raw);
      // 简单验证：机器码匹配 + 格式正确
      if (data.machineId !== this._getMachineId()) {
        // 机器码变化了（硬件更换），宽限通过
        // 生产环境可改为更严格策略
      }
      this._licenseData = data;
      return true;
    } catch {
      return false;
    }
  }

  _saveLicense(data) {
    const dir = path.dirname(this.licensePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.licensePath, JSON.stringify(data, null, 2));
  }

  _getMachineId() {
    // 基于系统信息生成机器指纹
    const os = require("os");
    const info = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model || ""].join(":");
    return crypto.createHash("md5").update(info).digest("hex").substring(0, 12);
  }
}

module.exports = { LicenseManager };
