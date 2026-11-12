import { useCallback, useState } from "react";
import { cleanUrl, detectPlatform } from "../lib/utils";
import {
  mediaKey,
  needsThumbnailCache,
  resolveFormatsForList,
} from "../lib/media";
import type { AppSettings, Media } from "../lib/types";
import type { IPC } from "./useIPC";
import type { ToastType } from "./useToast";

interface UseUrlParserParams {
  ipc: IPC;
  defaultQuality: string;
  showToast: (msg: string, type: ToastType) => void;
  refreshAll: () => Promise<void>;
  getParseOpts: () => Pick<AppSettings, "cookies" | "useProxy" | "proxyUrl" | "poToken">;
}

export function useUrlParser({
  ipc,
  defaultQuality,
  showToast,
  refreshAll,
  getParseOpts,
}: UseUrlParserParams) {
  const [url, setUrl] = useState("");
  const [parsedList, setParsedList] = useState<Media[]>([]);
  const [activeMedia, setActiveMedia] = useState<Media | null>(null);
  const [formatMap, setFormatMap] = useState<Record<string, string>>({});

  const clearParseResults = useCallback(() => {
    setUrl("");
    setParsedList([]);
    setActiveMedia(null);
    setFormatMap({});
  }, []);

  const cacheHotlinkThumbnails = useCallback(
    async (list: Media[]) => {
      for (const m of list) {
        if (!needsThumbnailCache(m)) continue;
        m.thumbnailUrl = m.thumbnail;
        const cached = await ipc.cacheThumbnail(m.thumbnail);
        if (cached.path) {
          m.thumbnail = `file:///${cached.path.replace(/\\/g, "/")}`;
        }
      }
    },
    [ipc],
  );

  const doParse = useCallback(async () => {
    const lines = url.split("\n").map((x) => x.trim());
    const urlMap: { raw: string; clean: string }[] = [];
    for (const line of lines) {
      const c = cleanUrl(line);
      if (c) urlMap.push({ raw: line, clean: c });
    }
    if (!urlMap.length) {
      showToast("未找到有效链接", "error");
      return;
    }

    showToast(urlMap.length > 1 ? `批量解析 ${urlMap.length} 条链接` : "正在解析链接", "loading");
    const all: Media[] = [];
    const failedUrls: string[] = [];
    let first: Media | null = null;
    let ok = 0;
    const { cookies, useProxy, proxyUrl, poToken } = getParseOpts();

    for (let i = 0; i < urlMap.length; i++) {
      const { clean } = urlMap[i];
      const pf = detectPlatform(clean);
      if (urlMap.length > 1) showToast(`解析中 ${i + 1}/${urlMap.length} · ${pf.label}`, "loading");
      try {
        const opts: Record<string, unknown> = {};
        if (cookies?.[pf.name]) opts.cookiesFile = cookies[pf.name];
        if (useProxy && proxyUrl) opts.proxy = proxyUrl;
        if (poToken) opts.poToken = poToken;
        const r = await ipc.parseUrl(clean, opts);
        if (r.error) {
          failedUrls.push(pf.label);
          await ipc.addHistory({
            url: clean,
            title: String(r.error).slice(0, 80),
            platform: pf.name,
            status: "failed",
          });
          continue;
        }
        const items = (r.media || []).filter(Boolean);
        if (!items.length) {
          failedUrls.push(pf.label);
          continue;
        }
        ok++;
        for (const m of items) {
          m._parseUrl = clean;
          all.push(m);
          if (!first) first = m;
        }
        const head = items[0];
        const historyTitle =
          items.length > 1
            ? `${head.fileName.replace(/\.[^.]+$/, "")} · 轮播 ${items.length} 项`
            : head.fileName;
        await ipc.addHistory({
          url: clean,
          title: historyTitle,
          platform: pf.name,
          status: "parsed",
          resolution: head.resolution,
          thumbnail: head.thumbnail,
        });
      } catch {
        failedUrls.push(pf.label);
      }
      if (i < urlMap.length - 1) await new Promise((r) => window.setTimeout(r, 300));
    }

    await refreshAll();
    await cacheHotlinkThumbnails(all);

    if (!first) {
      const msg = failedUrls.length
        ? `全部解析失败（${failedUrls.join("、")}）`
        : "所有链接解析失败";
      showToast(msg, "error");
      return;
    }

    setParsedList(all);
    setActiveMedia(first);
    setFormatMap((prev) => ({
      ...prev,
      ...resolveFormatsForList(all, defaultQuality),
    }));

    const msg =
      urlMap.length > 1
        ? `完成：${ok} 成功${failedUrls.length ? `，${failedUrls.length} 失败（${failedUrls.join("、")}）` : ""}`
        : "解析完成";
    showToast(msg, ok === urlMap.length ? "success" : "error");
  }, [
    url,
    ipc,
    defaultQuality,
    showToast,
    refreshAll,
    getParseOpts,
    cacheHotlinkThumbnails,
  ]);

  const setFormatForMedia = useCallback((key: string, formatId: string) => {
    setFormatMap((prev) => ({ ...prev, [key]: formatId }));
  }, []);

  const addAllCandidates = useCallback(
    (queuedKeys: Set<string>) => {
      return parsedList
        .filter((m) => !queuedKeys.has(mediaKey(m)))
        .map((m) => ({
          media: m,
          format: formatMap[mediaKey(m)] || m.bestFormatId,
        }));
    },
    [parsedList, formatMap],
  );

  return {
    url,
    setUrl,
    parsedList,
    activeMedia,
    setActiveMedia,
    formatMap,
    setFormatForMedia,
    doParse,
    clearParseResults,
    addAllCandidates,
  };
}
