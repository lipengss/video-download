import type { Media, VideoFormat } from "./types";
import { QUALITY_KEYWORDS } from "./constants";

/** 媒体在 UI 中的唯一键（队列、清晰度选择等） */
export function mediaKey(
  m: Pick<Media, "url" | "fileName" | "index" | "carouselId" | "carouselIndex">,
): string {
  if (m.carouselId && m.carouselIndex != null) {
    return `${m.carouselId}#${m.carouselIndex}`;
  }
  if (m.fileName && m.url) return `${m.url}::${m.fileName}`;
  return m.url || m.fileName || `media-${m.index ?? 0}`;
}

/** 按默认画质从格式列表中选取 format id */
export function resolveFormatForQuality(
  media: Media,
  defaultQuality: string,
): string | null {
  if (media.type === "image") {
    return media.bestFormatId || media.formats?.[0]?.id || "best";
  }
  const fmts = media.formats || [];
  let chosen = media.bestFormatId || fmts[0]?.id || null;
  const keywords = QUALITY_KEYWORDS[defaultQuality];
  if (!keywords?.length) return chosen;

  for (const kw of keywords) {
    const found = fmts.find(
      (f: VideoFormat) => f.resolution?.includes(kw) || f.quality?.includes(kw),
    );
    if (found) {
      chosen = found.id;
      break;
    }
  }
  return chosen;
}

export function resolveFormatsForList(
  list: Media[],
  defaultQuality: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of list) {
    const id = resolveFormatForQuality(m, defaultQuality);
    if (id) map[mediaKey(m)] = id;
  }
  return map;
}

const HOTLINK_THUMB =
  /douyin\.com|v\.douyin|tiktok\.com|kuaishou\.com/i;

export function needsThumbnailCache(media: Media): boolean {
  const mUrl = media.url || "";
  return (
    HOTLINK_THUMB.test(mUrl) &&
    !!media.thumbnail &&
    /^https?:\/\//i.test(media.thumbnail)
  );
}
