import rawPlatforms from "../../shared/platforms.json";

export const PLATFORMS = (rawPlatforms as typeof rawPlatforms).map((p) => ({
  name: p.name,
  label: p.label,
  short: p.short,
  bg: p.bg,
  icon: p.icon,
}));

export const QUALITIES = ["4K 超清", "1080P 高清", "720P 标清", "480P 流畅"] as const;
export const STATUSES = ["全部", "已下载", "未下载"] as const;
