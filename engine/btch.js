/**
 * btch-downloader 引擎封装（后备引擎）
 * 用于 yt-dlp 无法处理的平台（如抖音、B站等）
 */

const path = require("path");
const { douyin, igdl, ttdl, twitter, youtube, fbdown } = require("btch-downloader");
const platforms = require("../shared/platforms.json");

// btch 函数名 → 实际函数映射
const BTCH_FN_MAP = { douyin, igdl, ttdl, twitter, youtube, fbdown };

// 构建有 btch 函数的平台映射
const BTCH_PLATFORMS = platforms
  .filter((p) => p.btchFn && BTCH_FN_MAP[p.btchFn])
  .map((p) => ({ test: new RegExp(p.test, "i"), fn: BTCH_FN_MAP[p.btchFn], name: p.name }));

class BtchEngine {
  detectPlatform(url) {
    for (const p of BTCH_PLATFORMS) {
      if (p.test.test(url)) return p;
    }
    return null;
  }

  async parse(url) {
    const platform = this.detectPlatform(url);
    if (!platform) throw new Error("不支持的平台");

    const result = await platform.fn(url);
    if (!result || !result.status) throw new Error("解析失败");

    const media = this._extractMedia(result);
    if (media.length === 0) throw new Error("未找到媒体文件");

    return {
      success: true,
      engine: `btch-${platform.name}`,
      media,
    };
  }

  _extractMedia(result) {
    const items = [];
    const data = result.result || result;

    if (Array.isArray(data)) {
      // Instagram 格式: [{ thumbnail, url }]
      data.forEach((item, i) => {
        if (item.url) {
          items.push({
            index: i,
            url: item.url,
            thumbnail: item.thumbnail || "",
            fileName: `video_${i + 1}.mp4`,
            type: "video",
            width: 0,
            height: 0,
            aspectRatio: "未知",
            resolution: "未知",
            quality: "",
            formats: [],
            bestFormatId: null,
            isBtch: true,
          });
        }
      });
    } else if (data?.data?.links) {
      // 抖音格式: 多条 links = 同一视频的不同画质
      const d = data.data;
      const links = d.links || [];
      const formats = links.map((l, j) => ({
        id: `q${j}`,
        resolution: l.quality || `画质 ${j + 1}`,
        quality: l.quality || "",
        ext: "mp4",
      }));
      if (links.length > 0) {
        items.push({
          index: 0,
          url: links[0].url,
          thumbnail: d.thumbnail || "",
          fileName: `${(d.title || "douyin").replace(/[<>:"/\\|?*]/g, "_").substring(0, 40)}.mp4`,
          type: "video",
          width: 0,
          height: 0,
          aspectRatio: "未知",
          resolution: links[0].quality || "未知",
          quality: links[0].quality || "",
          formats,
          bestFormatId: "q0",
          isBtch: true,
          _links: links,
        });
      }
    } else if (data?.mp4 || data?.mp3) {
      // YouTube 格式: { status, title, thumbnail, mp3, mp4 }
      if (data.mp4) {
        const thumb = (data.thumbnail || "").replace(/hqdefault|sddefault|mqdefault|default/, "maxresdefault");
        items.push({
          index: 0,
          url: data.mp4,
          thumbnail: thumb || "",
          fileName: `${(data.title || "youtube").replace(/[<>:"/\\|?*]/g, "_").substring(0, 50)}.mp4`,
          type: "video",
          width: 0,
          height: 0,
          aspectRatio: "16:9 (横屏)",
          resolution: "未知",
          quality: "",
          formats: [],
          bestFormatId: null,
          isBtch: true,
        });
      }
    } else if (data?.data) {
      // 通用格式
      const d = data.data;
      if (d.url || d.video || d.mp4) {
        items.push({
          index: 0,
          url: d.url || d.video || d.mp4,
          thumbnail: d.thumbnail || "",
          fileName: `${(d.title || "video").replace(/[<>:"/\\|?*]/g, "_").substring(0, 40)}.mp4`,
          type: "video",
          width: 0,
          height: 0,
          aspectRatio: "未知",
          resolution: "未知",
          quality: "",
          formats: [],
          bestFormatId: null,
          isBtch: true,
        });
      }
    }

    return items;
  }
}

module.exports = { BtchEngine };
