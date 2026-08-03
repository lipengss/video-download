import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import rawPlatforms from "../../shared/platforms.json";

// 预编译正则表达式
const PLATFORMS = (rawPlatforms as typeof rawPlatforms).map((p) => ({
  ...p,
  test: new RegExp(p.test, "i"),
}));

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function meta(url = ""): { name: string; label: string; short: string; bg: string; icon: string } {
  const p = detectPlatform(url);
  const found = PLATFORMS.find((x) => x.name === p.name);
  return (
    found || {
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

export function detectPlatform(url: string) {
  return PLATFORMS.find((p) => p.test.test(url)) || { name: "other", label: "未知", cls: "", dot: "bg-zinc-600" };
}
