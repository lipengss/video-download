import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cleanUrl, detectPlatform } from "../lib/utils";
import { mediaKey } from "../lib/media";
import type {
  AppSettings,
  DownloadComplete,
  DownloadError,
  DownloadProgress,
  HItem,
  Media,
  QItem,
} from "../lib/types";
import type { IPC } from "./useIPC";
import type { ToastType } from "./useToast";

type DownloadOpts = Pick<AppSettings, "cookies" | "useProxy" | "proxyUrl" | "poToken" | "writeSubs" | "downloadThumbnail">;

interface UseDownloadQueueParams {
  ipc: IPC;
  activated: boolean;
  onNeedActivation: (retry: () => void) => void;
  showToast: (msg: string, type: ToastType) => void;
  refreshAll: () => Promise<void>;
  updateHistoryByParseUrl: (parseUrl: string, patch: Partial<HItem>) => Promise<void>;
  getDownloadOpts: () => DownloadOpts;
}

export function useDownloadQueue({
  ipc,
  activated,
  onNeedActivation,
  showToast,
  refreshAll,
  updateHistoryByParseUrl,
  getDownloadOpts,
}: UseDownloadQueueParams) {
  const [queue, setQueue] = useState<QItem[]>([]);
  const [downloading, setDownloading] = useState(false);
  const downloadingRef = useRef(false);
  const nextRef = useRef<() => void>(() => {});

  const queuedKeys = useMemo(() => {
    const s = new Set<string>();
    queue.forEach((q) => {
      if (q.media) s.add(mediaKey(q.media));
    });
    return s;
  }, [queue]);

  const buildParseOpts = useCallback(
    (url: string) => {
      const { cookies, useProxy, proxyUrl, poToken } = getDownloadOpts();
      const pf = detectPlatform(url);
      const opts: Record<string, unknown> = {};
      if (cookies?.[pf.name]) opts.cookiesFile = cookies[pf.name];
      if (useProxy && proxyUrl) opts.proxy = proxyUrl;
      if (poToken) opts.poToken = poToken;
      return opts;
    },
    [getDownloadOpts],
  );

  const processNext = useCallback(async () => {
    if (downloadingRef.current) return;

    const taskRef: {
      id: number;
      media: Media;
      format: string | null;
      extractAudio?: boolean;
    } | null = await new Promise((resolve) => {
      setQueue((q) => {
        const next = q.find((it) => it.status === "queued");
        if (!next?.media) {
          setDownloading(false);
          downloadingRef.current = false;
          resolve(null);
          return q;
        }
        setDownloading(true);
        downloadingRef.current = true;
        resolve({
          id: next.id,
          media: next.media,
          format: next.format,
          extractAudio: next.extractAudio,
        });
        return q.map((it) =>
          it.id === next.id ? { ...it, status: "downloading", pct: 0 } : it,
        );
      });
    });

    if (!taskRef) return;

    await new Promise((r) => window.setTimeout(r, 200));

    const m = taskRef.media;
    const parseUrl = m._parseUrl || cleanUrl(m.url || "");
    await updateHistoryByParseUrl(parseUrl, { status: "downloading" });

    const { writeSubs, downloadThumbnail } = getDownloadOpts();
    const opts = buildParseOpts(m.url || "");
    ipc.startDownload({
      url: m.url,
      formatId: taskRef.format || m.bestFormatId,
      index: 0,
      title: m.fileName,
      originalUrl: m._parseUrl || m.url,
      thumbnail: m.thumbnailUrl || m.thumbnail,
      extractAudio: !!taskRef.extractAudio,
      writeSubs,
      writeThumbnail: downloadThumbnail,
      mediaType: m.type,
      ...opts,
    });
  }, [ipc, buildParseOpts, getDownloadOpts, updateHistoryByParseUrl]);

  useEffect(() => {
    nextRef.current = processNext;
  }, [processNext]);

  useEffect(() => {
    const api = (window as { electronAPI?: Record<string, unknown> }).electronAPI;
    if (!api) return;

    const onProgress = api.onDownloadProgress as ((cb: (d: DownloadProgress) => void) => () => void) | undefined;
    const onComplete = api.onDownloadComplete as ((cb: (d: DownloadComplete) => void) => () => void) | undefined;
    const onError = api.onDownloadError as ((cb: (d: DownloadError) => void) => () => void) | undefined;

    const unsubProgress = onProgress?.((d: DownloadProgress) =>
      setQueue((q) =>
        q.map((it) =>
          it.status === "downloading"
            ? { ...it, pct: Math.round(d.percent || 0), phase: d.phase }
            : it,
        ),
      ),
    );

    const unsubComplete = onComplete?.((d: DownloadComplete) => {
      setQueue((q) =>
        q.map((it) =>
          it.status === "downloading"
            ? { ...it, status: "done", pct: 100, filePath: d?.filePath }
            : it,
        ),
      );
      setDownloading(false);
      downloadingRef.current = false;

      if (d?.originalUrl && d?.filePath) {
        updateHistoryByParseUrl(d.originalUrl, {
          status: "downloaded",
          filePath: d.filePath,
          size: d.size,
        }).then(() => refreshAll());
      } else {
        refreshAll();
      }

      window.setTimeout(() => {
        setQueue((q) => q.filter((it) => it.status !== "done"));
        refreshAll();
      }, 3000);
      window.setTimeout(() => nextRef.current(), 500);
    });

    const unsubError = onError?.((d: DownloadError) => {
      const errMsg = d?.error || "下载失败";
      setQueue((q) =>
        q.map((it) =>
          it.status === "downloading" ? { ...it, status: "failed", error: errMsg } : it,
        ),
      );
      setDownloading(false);
      downloadingRef.current = false;
      if (d?.filePath) ipc.deleteFile(d.filePath);
      showToast(errMsg, "error");
      window.setTimeout(() => nextRef.current(), 500);
    });

    return () => {
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
    };
  }, [ipc, refreshAll, showToast, updateHistoryByParseUrl]);

  const scheduleNext = useCallback(() => {
    if (!downloadingRef.current) window.setTimeout(() => nextRef.current(), 100);
  }, []);

  const addToQueue = useCallback(
    (m: Media, fmt: string | null, extractAudio = false) => {
      if (!activated) {
        onNeedActivation(() => addToQueue(m, fmt, extractAudio));
        return;
      }
      setQueue((q) => [
        ...q,
        {
          id: Date.now(),
          media: m,
          format: fmt,
          status: "queued",
          pct: 0,
          extractAudio,
        },
      ]);
      scheduleNext();
    },
    [activated, onNeedActivation, scheduleNext],
  );

  const addManyToQueue = useCallback(
    (items: { media: Media; format: string | null }[]) => {
      if (!items.length) return;
      const run = () => {
        setQueue((q) => [
          ...q,
          ...items.map((item, i) => ({
            id: Date.now() + i,
            media: item.media,
            format: item.format,
            status: "queued" as const,
            pct: 0,
          })),
        ]);
        scheduleNext();
      };
      if (!activated) {
        onNeedActivation(run);
        return;
      }
      run();
    },
    [activated, onNeedActivation, scheduleNext],
  );

  const skipDownload = useCallback(
    async (id: number) => {
      await ipc.cancelDownload();
      setQueue((q) => q.map((it) => (it.id === id ? { ...it, status: "cancelled", pct: 0 } : it)));
      setDownloading(false);
      downloadingRef.current = false;
      window.setTimeout(() => nextRef.current(), 500);
    },
    [ipc],
  );

  const pauseDownload = useCallback(
    async (id: number) => {
      await ipc.cancelDownload();
      setQueue((q) =>
        q.map((it) => (it.id === id ? { ...it, status: "paused", pct: it.pct } : it)),
      );
      setDownloading(false);
      downloadingRef.current = false;
      window.setTimeout(() => nextRef.current(), 500);
    },
    [ipc],
  );

  const resumeDownload = useCallback(
    (id: number) => {
      setQueue((q) => q.map((it) => (it.id === id ? { ...it, status: "queued", pct: 0 } : it)));
      scheduleNext();
    },
    [scheduleNext],
  );

  const retryDownload = useCallback(
    (id: number) => {
      setQueue((q) => q.map((it) => (it.id === id ? { ...it, status: "queued", pct: 0 } : it)));
      scheduleNext();
    },
    [scheduleNext],
  );

  const removeFromQueue = useCallback((id: number) => {
    setQueue((items) => items.filter((it) => it.id !== id));
  }, []);

  return {
    queue,
    downloading,
    queuedKeys,
    addToQueue,
    addManyToQueue,
    skipDownload,
    pauseDownload,
    resumeDownload,
    retryDownload,
    removeFromQueue,
  };
}
