/**
 * Bilibili (B站) 专用提取器
 * 绕过 yt-dlp 的 WBI 签名问题，直接用 B 站 API
 */

const https = require("https");
const crypto = require("crypto");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0";

// WBI 签名常量（B站公开的混肴表，基本不变）
const MIXIN_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
];

class BilibiliEngine {
  constructor() {
    this._wbiKeys = null;
  }

  // ─── 公共 API ─────────────────────────────────────

  async parse(url) {
    const bv = this._extractBV(url);
    if (!bv) throw new Error("无效的 B 站链接");

    const info = await this._apiView(bv);
    const playData = await this._apiPlayUrl(bv, info.cid);

    // 构建画质列表
    const acceptDesc = playData.accept_description || [];
    const acceptQn = playData.accept_quality || [];
    const videoStreams = playData.dash?.video || [];
    const audioStreams = playData.dash?.audio || [];

    const formats = acceptDesc.map((desc, i) => {
      const qn = acceptQn[i] || 0;
      const stream = videoStreams.find((v) => v.id === qn) || videoStreams[0];
      return {
        id: `qn${qn}`,
        resolution: desc,
        quality: desc,
        ext: "mp4",
        width: stream?.width || info.width,
        height: stream?.height || info.height,
        qn,
        needLogin: !stream || stream.id !== qn,
      };
    });

    // 找到实际可用的最佳画质
    const bestStream = videoStreams[0];
    const bestQn = bestStream?.id || 32;

    return {
      success: true,
      engine: "bilibili",
      media: [
        {
          index: 0,
          url: bv, // 存 BV 号，下载时再解析
          thumbnail: info.thumbnail,
          fileName: `${(info.title || "bilibili").replace(/[<>:"/\\|?*]/g, "_").substring(0, 50)}.mp4`,
          type: "video",
          width: info.width || 1920,
          height: info.height || 1080,
          aspectRatio: this._calcAspectRatio(info.width, info.height),
          resolution: info.width && info.height ? `${info.width}×${info.height}` : "1920×1080",
          quality: acceptDesc[0] || "高清",
          duration: info.duration,
          formats,
          bestFormatId: `qn${bestQn}`,
          // B站专用
          _bvid: bv,
          _cid: info.cid,
          _aid: info.aid,
        },
      ],
    };
  }

  // ─── 内部 ─────────────────────────────────────────

  _extractBV(url) {
    const m = url.match(/BV[\w]+/i);
    return m ? m[0] : null;
  }

  async _apiView(bv) {
    return this._get(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`).then((j) => {
      if (j.code !== 0) throw new Error(j.message || "B站 API 错误");
      const d = j.data;
      const pages = d.pages || [{ cid: d.cid, page: 1, part: d.title }];
      return {
        title: d.title,
        thumbnail: (d.pic || "").replace("http://", "https://"),
        duration: d.duration,
        width: d.width || d.dimension?.width || 0,
        height: d.height || d.dimension?.height || 0,
        bvid: d.bvid,
        aid: d.aid,
        cid: pages[0].cid,
      };
    });
  }

  /** 获取视频流下载地址（供下载时调用） */
  async getStreamUrl(bv, cid, formatId) {
    await this._ensureWbiKeys();
    const qn = formatId ? parseInt(formatId.replace("qn", "")) : 80;
    const params = {
      bvid: bv,
      cid: String(cid),
      qn: String(qn),
      fnval: "1", // fnval=1 = FLV (音视频合并)
      wts: Math.floor(Date.now() / 1000),
    };
    const query = this._wbiSign(params);
    const data = await this._get(`https://api.bilibili.com/x/player/playurl?${query}`);
    if (data.code !== 0) throw new Error(data.message || "获取视频流失败");

    const durl = data.data?.durl;
    if (!durl || durl.length === 0) throw new Error("没有可用的视频流");
    return durl[0].url;
  }

  async _apiPlayUrl(bv, cid) {
    await this._ensureWbiKeys();
    const params = {
      bvid: bv,
      cid: String(cid),
      qn: "127",
      fnval: "4048",
      fourk: "1",
      wts: Math.floor(Date.now() / 1000),
    };
    const query = this._wbiSign(params);
    return this._get(`https://api.bilibili.com/x/player/playurl?${query}`).then((j) => {
      if (j.code !== 0) throw new Error(j.message || "获取视频流失败");
      return j.data;
    });
  }

  async _ensureWbiKeys() {
    if (this._wbiKeys) return;
    const j = await this._get("https://api.bilibili.com/x/web-interface/nav");
    const wbi = j.data?.wbi_img || {};
    this._wbiKeys = {
      img: (wbi.img_url || "").split("/").pop()?.split(".")[0] || "",
      sub: (wbi.sub_url || "").split("/").pop()?.split(".")[0] || "",
    };
  }

  _wbiSign(params) {
    const keys = Object.keys(params).sort();
    let query = keys.map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");
    const mixin = this._getMixinKey(this._wbiKeys.img + this._wbiKeys.sub);
    const sign = crypto
      .createHash("md5")
      .update(query + mixin)
      .digest("hex");
    return `${query}&w_rid=${sign}`;
  }

  _getMixinKey(orig) {
    let temp = "";
    MIXIN_ENC_TAB.forEach((n) => {
      if (n < orig.length) temp += orig[n];
    });
    return temp.substring(0, 32);
  }

  _get(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, { headers: { "User-Agent": UA, Referer: "https://www.bilibili.com" } }, (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(d));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });
  }

  _calcAspectRatio(w, h) {
    if (!w || !h) return "16:9 (横屏)";
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(w, h),
      rw = w / d,
      rh = h / d;
    const ratio = rw / rh;
    if (Math.abs(ratio - 16 / 9) < 0.03) return "16:9 (横屏)";
    if (Math.abs(ratio - 9 / 16) < 0.03) return "9:16 (竖屏)";
    if (Math.abs(ratio - 4 / 3) < 0.03) return "4:3";
    if (Math.abs(ratio - 1) < 0.03) return "1:1 (正方形)";
    return `${rw}:${rh}`;
  }
}

module.exports = { BilibiliEngine };
