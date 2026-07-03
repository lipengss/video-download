import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { PLATFORMS as UI_PLATFORMS } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function meta(url = ""): { name: string; label: string; short: string; bg: string; icon: string } {
  const p = detectPlatform(url);
  return (
    UI_PLATFORMS.find((x) => x.name === p.name) || {
      name: p.name,
      label: p.label,
      short: p.label,
      bg: "#334155",
      icon: "",
    }
  );
}

export function duration(sec?: number) {
  if (!sec || sec <= 0) return "";
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export function videoSrc(path: string) {
  return `file:///${path.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")}`;
}

export function fmtSize(bytes: number): string {
  if (!bytes) return "?";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function cleanUrl(u: string): string {
  const m = (u || "").match(/https?:\/\/[^\s]+/i);
  return m ? m[0].split("?")[0].replace(/\/+$/, "") : "";
}

export function esc(s: string): string {
  return (s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export const PLATFORMS = [
  {
    name: "bilibili",
    label: "B站",
    cls: "text-sky-400 bg-sky-400/10",
    dot: "bg-sky-400",
    test: /bilibili\.com|b23\.tv/i,
  },
  { name: "douyin", label: "抖音", cls: "text-white bg-white/10", dot: "bg-white", test: /douyin\.com|v\.douyin/i },
  {
    name: "instagram",
    label: "Instagram",
    cls: "text-pink-400 bg-pink-400/10",
    dot: "bg-pink-400",
    test: /instagram\.com/i,
  },
  {
    name: "youtube",
    label: "YouTube",
    cls: "text-red-400 bg-red-400/10",
    dot: "bg-red-400",
    test: /youtube\.com|youtu\.be/i,
  },
  { name: "tiktok", label: "TikTok", cls: "text-rose-400 bg-rose-400/10", dot: "bg-rose-400", test: /tiktok\.com/i },
];

export function detectPlatform(url: string) {
  return PLATFORMS.find((p) => p.test.test(url)) || { name: "other", label: "未知", cls: "", dot: "bg-zinc-600" };
}
