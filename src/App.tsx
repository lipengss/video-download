import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import "overlayscrollbars/overlayscrollbars.css";
import { AppHeader } from "./components/AppHeader";
import { PlatformButtons } from "./components/PlatformButtons";
import { UrlInputBar } from "./components/UrlInputBar";
import { MediaList } from "./components/MediaList";
import { Sidebar } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { VideoPreviewModal } from "./components/VideoPreviewModal";
import { ActivationDialog } from "./components/ActivationDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { useIPC } from "./hooks/useIPC";
import { cleanUrl, cn, detectPlatform, fmtSize } from "./lib/utils";
import type { AppSettings, DownloadComplete, DownloadError, DownloadProgress, HItem, Media, QItem, VideoFormat } from "./lib/types";

export function App() {
  const ipc = useIPC();
  const [url, setUrl] = useState("");
  const [parsedList, setParsedList] = useState<Media[]>([]);
  const [activeMedia, setActiveMedia] = useState<Media | null>(null);
  const [formatMap, setFormatMap] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [history, setHistory] = useState<HItem[]>([]);
  const [localFiles, setLocalFiles] = useState<{ name: string; path: string; size: number; time: string }[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [dlPath, setDlPath] = useState("");
  const [cookiesMap, setCookiesMap] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [hPlatform, setHPlatform] = useState("all");
  const [hStatus, setHStatus] = useState("全部");
  const [hSearch, setHSearch] = useState("");
  const [defaultQuality, setDefaultQuality] = useState("1080P 高清");
  const [useProxy, setUseProxy] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [writeSubs, setWriteSubs] = useState(false);
  const [downloadThumbnail, setDownloadThumbnail] = useState(false);
  const [poToken, setPoToken] = useState("");
  const [potStatus, setPotStatus] = useState<{ running: boolean; version?: string | null } | null>(null);
  const [previewVideo, setPreviewVideo] = useState<{ path: string; name: string } | null>(null);
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [activated, setActivated] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [showActivation, setShowActivation] = useState(false);
  const pendingDownloadRef = useRef<(() => void) | null>(null);
  const nextRef = useRef<() => void>(() => {});
  const downloadingRef = useRef(false); // 避免闭包陈旧值导致同时下载多个
  const queuedKeys = useMemo(() => {
    const s = new Set<string>();
    queue.forEach((q) => {
      if (q.media) s.add(q.media.url || q.media.fileName);
    });
    return s;
  }, [queue]);

  const showToast = (msg: string, type: string) => {
    setToast({ msg, type });
    if (type !== "loading") window.setTimeout(() => setToast(null), 2600);
  };
  const refreshAll = async () => {
    const [h, lf] = await Promise.all([ipc.getHistory(), ipc.listLocalFiles()]);
    setHistory(Array.isArray(h) ? h : []);
    setLocalFiles(Array.isArray(lf) ? lf : []);
  };

  useEffect(() => {
    ipc.getSettings().then((s: AppSettings) => {
      setDlPath(s.downloadPath || "");
      if (s.defaultQuality) setDefaultQuality(s.defaultQuality);
      if (s.cookies) setCookiesMap(s.cookies);
      if (typeof s.useProxy === "boolean") setUseProxy(s.useProxy);
      if (s.proxyUrl) setProxyUrl(s.proxyUrl);
      if (typeof s.writeSubs === "boolean") setWriteSubs(s.writeSubs);
      if (typeof s.downloadThumbnail === "boolean") setDownloadThumbnail(s.downloadThumbnail);
      if (s.poToken) setPoToken(s.poToken);
      if (s.activated) setActivated(true);
      if (s.activatedExpiresAt) setExpiresAt(s.activatedExpiresAt);
    });
    // 启动时校验激活状态（含过期检测），未激活则自动弹出激活窗口
    ipc.checkActivated().then((r: { activated: boolean; expiresAt?: string | null }) => {
      setActivated(r.activated);
      if (r.expiresAt) setExpiresAt(r.expiresAt);
      if (!r.activated) setShowActivation(true);
    });
    refreshAll();
    refreshPotStatus();
    const api = (window as any).electronAPI;
    if (!api) return;

    const unsubProgress = api.onDownloadProgress?.((d: DownloadProgress) =>
      setQueue((q) =>
        q.map((it) =>
          it.status === "downloading" ? { ...it, pct: Math.round(d.percent || 0), phase: d.phase } : it,
        ),
      ),
    );
    const unsubComplete = api.onDownloadComplete?.((d: DownloadComplete) => {
      setQueue((q) =>
        q.map((it) => (it.status === "downloading" ? { ...it, status: "done", pct: 100, filePath: d?.filePath } : it)),
      );
      setDownloading(false);
      downloadingRef.current = false;
      // 用 d.originalUrl（= m._parseUrl）匹配更新历史记录
      if (d?.originalUrl && d?.filePath) {
        ipc.getHistory().then(async (hist: HItem[]) => {
          const record = hist.find((r: HItem) => cleanUrl(r.url || "") === cleanUrl(d.originalUrl || ""));
          if (record) {
            await ipc.updateHistory(record.id, { status: "downloaded", filePath: d.filePath, size: d.size });
            refreshAll();
          }
        });
      } else {
        refreshAll();
      }
      // 完成后 3 秒自动移出队列
      window.setTimeout(() => {
        setQueue((q) => q.filter((it) => it.status !== "done"));
        refreshAll();
      }, 3000);
      window.setTimeout(() => nextRef.current(), 500);
    });
    const unsubError = api.onDownloadError?.((d: DownloadError) => {
      const errMsg = d?.error || "下载失败";
      setQueue((q) => q.map((it) => (it.status === "downloading" ? { ...it, status: "failed", error: errMsg } : it)));
      setDownloading(false);
      downloadingRef.current = false;
      // 删除下载失败的文件残留
      if (d?.filePath) ipc.deleteFile(d.filePath);
      showToast(errMsg, "error");
      window.setTimeout(() => nextRef.current(), 500);
    });

    return () => {
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
    };
  }, []);

  const merged = useMemo(() => {
    const seen = new Map<string, HItem>();
    history.forEach((r) => {
      const k = r.url || r.id;
      if (!seen.has(k)) seen.set(k, r);
    });
    const names = new Set(localFiles.map((f) => f.name));
    return Array.from(seen.values()).map((r) => ({
      ...r,
      _local: r.filePath ? localFiles.some((f) => f.path === r.filePath) : names.has(r.name || ""),
    }));
  }, [history, localFiles]);
  const filteredHistory = useMemo(() => {
    let rows = merged;
    if (hPlatform !== "all") rows = rows.filter((r) => detectPlatform(r.url || "").name === hPlatform);
    if (hStatus === "已下载") rows = rows.filter((r) => r._local || r.status === "downloaded");
    if (hStatus === "未下载") rows = rows.filter((r) => !r._local && r.status !== "downloaded");
    if (hSearch)
      rows = rows.filter((r) => (r.title || r.name || r.url || "").toLowerCase().includes(hSearch.toLowerCase()));
    return rows;
  }, [merged, hPlatform, hStatus, hSearch]);
  const totalCount = merged.length;
  const downloadedCount = merged.filter((r) => r._local || r.status === "downloaded").length;
  const needCookies = toast?.type === "error" && /cookie|login|auth|登录|权限|为空/i.test(toast.msg);

  const doParse = async () => {
    // 提取所有 URL（支持含中文/emoji 的混排文本）
    const lines = url.split("\n").map((x) => x.trim());
    const urlMap: { raw: string; clean: string }[] = [];
    for (const line of lines) {
      const c = cleanUrl(line);
      if (c) urlMap.push({ raw: line, clean: c });
    }
    if (!urlMap.length) return showToast("未找到有效链接", "error");

    showToast(urlMap.length > 1 ? `批量解析 ${urlMap.length} 条链接` : "正在解析链接", "loading");
    const all: Media[] = [];
    const failedUrls: string[] = [];
    let first: Media | null = null;
    let ok = 0;

    for (let i = 0; i < urlMap.length; i++) {
      const { clean } = urlMap[i];
      const pf = detectPlatform(clean);
      if (urlMap.length > 1) showToast(`解析中 ${i + 1}/${urlMap.length} · ${pf.label}`, "loading");
      try {
        const opts: any = {};
        if (cookiesMap[pf.name]) opts.cookiesFile = cookiesMap[pf.name];
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
        const m = r.media?.[0];
        if (!m) {
          failedUrls.push(pf.label);
          continue;
        }
        ok++;
        m._parseUrl = clean; // 记录原始链接，后续下载完成时匹配历史记录
        all.push(m);
        if (!first) first = m;
        await ipc.addHistory({
          url: clean,
          title: m.fileName,
          platform: pf.name,
          status: "parsed",
          resolution: m.resolution,
          thumbnail: m.thumbnail,
        });
      } catch {
        failedUrls.push(pf.label);
      }
      // 每个请求间隔 300ms，避免 API 限流
      if (i < urlMap.length - 1) await new Promise((r) => window.setTimeout(r, 300));
    }

    refreshAll();

    // 只对抖音/TikTok/快手 缓存缩略图到本地（防盗链），其他平台直接用原始 URL
    for (const m of all) {
      const mUrl = m.url || "";
      const isHotlink = /douyin\.com|v\.douyin|tiktok\.com|kuaishou\.com/i.test(mUrl);
      if (isHotlink && m.thumbnail && /^https?:\/\//i.test(m.thumbnail)) {
        m.thumbnailUrl = m.thumbnail; // 保留原始地址，供「下载封面」使用
        const cached = await ipc.cacheThumbnail(m.thumbnail);
        if (cached.path) m.thumbnail = `file:///${cached.path.replace(/\\/g, "/")}`;
      }
    }

    if (!first) {
      const msg = failedUrls.length ? `全部解析失败（${failedUrls.join("、")}）` : "所有链接解析失败";
      return showToast(msg, "error");
    }
    setParsedList(all);
    setActiveMedia(first);
    const qmap: Record<string, string[]> = {
      "4K 超清": ["4K", "2160p", "1440p"],
      "1080P 高清": ["1080P", "1080p", "1920"],
      "720P 标清": ["720P", "720p", "1280"],
      "480P 流畅": ["480P", "480p", "640"],
    };
    const newFormats: Record<string, string> = {};
    for (const m of all) {
      const fmts = m.formats || [];
      let chosen = m.bestFormatId || fmts[0]?.id || null;
      for (const kw of qmap[defaultQuality] || []) {
        const found = fmts.find((f: VideoFormat) => f.resolution?.includes(kw) || f.quality?.includes(kw));
        if (found) {
          chosen = found.id;
          break;
        }
      }
      if (chosen) newFormats[m.url || m.fileName] = chosen;
    }
    setFormatMap((prev) => ({ ...prev, ...newFormats }));
    const msg =
      urlMap.length > 1
        ? `完成：${ok} 成功${failedUrls.length ? `，${failedUrls.length} 失败（${failedUrls.join("、")}）` : ""}`
        : "解析完成";
    showToast(msg, ok === urlMap.length ? "success" : "error");
  };

  const processNext = async () => {
    // 防止并发：如果已有下载进行中则跳过
    if (downloadingRef.current) return;

    // 使用函数式 setState 获取最新队列，提取第一个等待任务
    const taskRef: { id: number; media: Media; format: string | null; extractAudio?: boolean } | null = await new Promise((resolve) => {
      setQueue((q) => {
        const next = q.find((it) => it.status === "queued");
        if (!next || !next.media) {
          setDownloading(false);
          downloadingRef.current = false;
          resolve(null);
          return q;
        }
        setDownloading(true);
        downloadingRef.current = true;
        resolve({ id: next.id, media: next.media, format: next.format, extractAudio: next.extractAudio });
        return q.map((it) => (it.id === next.id ? { ...it, status: "downloading", pct: 0 } : it));
      });
    });

    if (!taskRef) return;

    // 等待状态更新生效
    await new Promise((r) => window.setTimeout(r, 200));

    // 启动下载前：更新历史记录状态
    const m = taskRef.media;
    const parseUrl = m._parseUrl || cleanUrl(m.url || "");
    ipc.getHistory().then((hist: HItem[]) => {
      const record = hist.find((r: HItem) => cleanUrl(r.url || "") === parseUrl);
      if (record) ipc.updateHistory(record.id, { status: "downloading" });
    });

    // 启动下载
    const fmt = taskRef.format;
    const dl = m.url;
    const opts: any = {};
    const pf = detectPlatform(m.url || url);
    if (cookiesMap[pf.name]) opts.cookiesFile = cookiesMap[pf.name];
    if (useProxy && proxyUrl) opts.proxy = proxyUrl;
    if (poToken) opts.poToken = poToken;
    ipc.startDownload({
      url: dl,
      formatId: fmt || m.bestFormatId,
      index: 0,
      title: m.fileName,
      originalUrl: m._parseUrl || m.url,
      thumbnail: m.thumbnailUrl || m.thumbnail,
      extractAudio: !!taskRef.extractAudio,
      writeSubs,
      writeThumbnail: downloadThumbnail,
      ...opts,
    });
  };
  nextRef.current = processNext;

  const addToQueue = (m: Media, fmt: string | null, extractAudio = false) => {
    if (!activated) {
      pendingDownloadRef.current = () => addToQueue(m, fmt, extractAudio);
      setShowActivation(true);
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
    if (!downloadingRef.current) window.setTimeout(() => nextRef.current(), 100);
  };

  const skipDownload = async (id: number) => {
    await ipc.cancelDownload();
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, status: "cancelled", pct: 0 } : it)));
    setDownloading(false);
    downloadingRef.current = false;
    window.setTimeout(() => nextRef.current(), 500);
  };

  const pauseDownload = async (id: number) => {
    await ipc.cancelDownload();
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, status: "paused", pct: it.pct } : it)));
    setDownloading(false);
    downloadingRef.current = false;
    window.setTimeout(() => nextRef.current(), 500);
  };

  const resumeDownload = async (id: number) => {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, status: "queued", pct: 0 } : it)));
    if (!downloadingRef.current) window.setTimeout(() => nextRef.current(), 100);
  };

  const retryDownload = (id: number) => {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, status: "queued", pct: 0 } : it)));
    if (!downloadingRef.current) window.setTimeout(() => nextRef.current(), 100);
  };

  const saveSettings = () => {
    ipc.saveSettings({ downloadPath: dlPath, defaultQuality, useProxy, proxyUrl, cookies: cookiesMap, writeSubs, downloadThumbnail, poToken });
    setShowSettings(false);
    showToast("设置已保存", "success");
  };

  const handleActivated = (expiresAtStr?: string) => {
    setActivated(true);
    setShowActivation(false);
    if (expiresAtStr) setExpiresAt(expiresAtStr);
    showToast("激活成功，已解锁下载功能", "success");
    // 重试之前挂起的下载操作
    if (pendingDownloadRef.current) {
      const retry = pendingDownloadRef.current;
      pendingDownloadRef.current = null;
      window.setTimeout(() => retry(), 300);
    }
  };

  const pickCookies = async (name: string) => {
    const r = await ipc.selectCookiesFile();
    if (!r.path) return;
    const next = { ...cookiesMap, [name]: r.path };
    setCookiesMap(next);
    await ipc.saveSettings({ downloadPath: dlPath, defaultQuality, useProxy, proxyUrl, cookies: next, writeSubs, downloadThumbnail, poToken });

    const check = r.check;
    if (name === "youtube" && check && !check.ok) {
      showToast(`已导入，但 ${check.reason}`, "error");
    } else {
      showToast(
        `已导入 ${name} cookies${name === "youtube" && check?.ok ? ` · ${check.reason}` : ""}`,
        "success",
      );
    }
  };

  const refreshPotStatus = () => {
    ipc.getPotStatus().then((s) => setPotStatus(s));
  };

  const startPot = async () => {
    const r = await ipc.startPotServer();
    setPotStatus({ running: r.running, version: r.version });
    if (r.running) showToast(`PO Token 服务已就绪${r.started ? "" : "（已在运行）"}`, "success");
    else showToast(r.error || "PO Token 服务启动失败", "error");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b0f17] text-white">
      <main className="flex min-w-0 flex-1 flex-col bg-[#121a29]">
        <AppHeader
          onOpenHistory={() => setShowHistory(true)}
          onOpenSettings={() => setShowSettings(true)}
          activated={activated}
          expiresAt={expiresAt}
        />
        <div className="flex min-h-0 flex-1 gap-5 p-5">
          <section className="flex min-w-0 flex-1 flex-col gap-4">
            <PlatformButtons />
            <div className="rounded-[10px] mb-[10px]">
              <UrlInputBar
                url={url}
                onUrlChange={setUrl}
                onClear={() => {
                  setUrl("");
                  setParsedList([]);
                  setActiveMedia(null);
                }}
                onParse={doParse}
                downloading={downloading}
              />
              {needCookies && (
                <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
                  <AlertCircle className="h-4 w-4" />
                  当前平台可能需要登录 cookies，请在设置里导入后重试。
                </div>
              )}
            </div>
            <MediaList
              parsedList={parsedList}
              activeMedia={activeMedia}
              formatMap={formatMap}
              queuedKeys={queuedKeys}
              downloading={downloading}
              onSelectMedia={setActiveMedia}
              onFormatChange={(mediaKey, formatId) => setFormatMap((prev) => ({ ...prev, [mediaKey]: formatId }))}
              onAddToQueue={addToQueue}
              onAddAudioToQueue={(m, fmt) => addToQueue(m, fmt, true)}
              onAddAllToQueue={() => {
                if (!activated) {
                  pendingDownloadRef.current = () => {
                    const toAdd = parsedList.filter((m) => !queuedKeys.has(m.url || m.fileName));
                    if (!toAdd.length) return;
                    setQueue((q) => [
                      ...q,
                      ...toAdd.map((m, i) => ({
                        id: Date.now() + i,
                        media: m,
                        format: formatMap[m.url || m.fileName] || m.bestFormatId,
                        status: "queued" as const,
                        pct: 0,
                      })),
                    ]);
                    if (!downloadingRef.current) window.setTimeout(() => nextRef.current(), 100);
                  };
                  setShowActivation(true);
                  return;
                }
                const toAdd = parsedList.filter((m) => !queuedKeys.has(m.url || m.fileName));
                if (!toAdd.length) return;
                setQueue((q) => [
                  ...q,
                  ...toAdd.map((m, i) => ({
                    id: Date.now() + i,
                    media: m,
                    format: formatMap[m.url || m.fileName] || m.bestFormatId,
                    status: "queued" as const,
                    pct: 0,
                  })),
                ]);
                if (!downloadingRef.current) window.setTimeout(() => nextRef.current(), 100);
              }}
            />
          </section>
          <Sidebar
            tab={tab}
            onTabChange={setTab}
            queue={queue}
            downloading={downloading}
            onSkip={skipDownload}
            onRemove={(id) => setQueue((items) => items.filter((it) => it.id !== id))}
            onPause={pauseDownload}
            onResume={resumeDownload}
            onRetry={retryDownload}
            onPreview={(path, name) => setPreviewVideo({ path, name })}
            onOpenFolder={() => ipc.openFolder()}
            filteredHistory={filteredHistory}
            hPlatform={hPlatform}
            onPlatformChange={setHPlatform}
            onDeleteRecord={(id) => {
              ipc.deleteHistory(id);
              refreshAll();
            }}
          />
        </div>
      </main>
      <Toast toast={toast} />
      <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} />
      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        dlPath={dlPath}
        defaultQuality={defaultQuality}
        cookiesMap={cookiesMap}
        useProxy={useProxy}
        proxyUrl={proxyUrl}
        writeSubs={writeSubs}
        downloadThumbnail={downloadThumbnail}
        poToken={poToken}
        potStatus={potStatus}
        onStartPot={startPot}
        onDlPathChange={setDlPath}
        onDefaultQualityChange={setDefaultQuality}
        onCookiesChange={setCookiesMap}
        onUseProxyChange={setUseProxy}
        onProxyUrlChange={setProxyUrl}
        onWriteSubsChange={setWriteSubs}
        onDownloadThumbnailChange={setDownloadThumbnail}
        onPoTokenChange={setPoToken}
        onSave={saveSettings}
        onSelectDir={async () => ipc.selectDir()}
        onPickCookies={pickCookies}
      />
      <ActivationDialog
        open={showActivation}
        onOpenChange={setShowActivation}
        onActivated={handleActivated}
      />
      <HistoryDrawer
        open={showHistory}
        onClose={() => setShowHistory(false)}
        filteredHistory={filteredHistory}
        totalCount={totalCount}
        downloadedCount={downloadedCount}
        hPlatform={hPlatform}
        hStatus={hStatus}
        hSearch={hSearch}
        onPlatformChange={setHPlatform}
        onStatusChange={setHStatus}
        onSearchChange={setHSearch}
        onPreview={(path, name) => setPreviewVideo({ path, name })}
        onDelete={(id) => {
          ipc.deleteHistory(id);
          refreshAll();
        }}
      />
    </div>
  );
}
