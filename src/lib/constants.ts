export const PLATFORMS = [
  { name: "bilibili", label: "Bilibili", short: "B站", bg: "#fb7299", icon: "Bilibili.svg" },
  { name: "douyin", label: "抖音 / TikTok", short: "抖音", bg: "#170B1A", icon: "抖音.svg" },
  {
    name: "instagram",
    label: "Instagram",
    short: "IG",
    bg: "linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#833ab4)",
    icon: "instgram.svg",
  },
  { name: "youtube", label: "YouTube", short: "YT", bg: "#d31616", icon: "youtube.svg" },
];

export const QUALITIES = ["4K 超清", "1080P 高清", "720P 标清", "480P 流畅"] as const;
export const STATUSES = ["全部", "已下载", "未下载"] as const;
