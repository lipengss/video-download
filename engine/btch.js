/**
 * btch-downloader 引擎封装（后备引擎）
 * 用于 yt-dlp 无法处理的平台（如抖音、B站等）
 */

const { douyin, igdl, ttdl, twitter, youtube, fbdown } = require("btch-downloader");

// 平台 → btch 函数映射
const PLATFORM_MAP = [
  { test: /douyin\.com|v\.douyin/i, fn: douyin, name: "douyin" },
  { test: /tiktok\.com/i, fn: ttdl, name: "tiktok" },
  { test: /instagram\.com/i, fn: igdl, name: "instagram" },
  { test: /twitter\.com|x\.com/i, fn: twitter, name: "twitter" },
  { test: /youtube\.com|youtu\.be/i, fn: youtube, name: "youtube" },
  { test: /facebook\.com|fb\.watch/i, fn: fbdown, name: "facebook" },
  { test: /youtube\.com|youtu\.be/i, fn: youtube, name: "youtube" },
];

class BtchEngine {
  detectPlatform(url) {
    for (const p of PLATFORM_MAP) {
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
    // YouTube 等直接返回数据，Instagram/Douyin 用 .result 包裹
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
            isBtch: true, // 标记：下载时走 CDN 直链
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
      // 只创建一条记录，多条画质作为 formats
      if (links.length > 0) {
        items.push({
          index: 0,
          url: links[0].url, // 默认最高画质
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
          // 把所有链接存下来，下载时可选
          _links: links,
        });
      }
    } else if (data?.mp4 || data?.mp3) {
      // YouTube 格式: { status, title, thumbnail, mp3, mp4 }
      if (data.mp4) {
        // 升级缩略图到最高分辨率
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
