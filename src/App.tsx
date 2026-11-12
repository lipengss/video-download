import { useCallback, useEffect, useRef, useState } from "react";
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
import { MobileDock } from "./components/MobileDock";
import { useIPC } from "./hooks/useIPC";
import { useToast } from "./hooks/useToast";
import { useAppSettings } from "./hooks/useAppSettings";
import { useHistoryData } from "./hooks/useHistoryData";
import { useDownloadQueue } from "./hooks/useDownloadQueue";
import { useUrlParser } from "./hooks/useUrlParser";
export function App() {
  const ipc = useIPC();
  const { toast, showToast } = useToast();
  const settings = useAppSettings(ipc);
  const historyData = useHistoryData(ipc);

  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<{ path: string; name: string } | null>(null);
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [activated, setActivated] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [showActivation, setShowActivation] = useState(false);
  const pendingDownloadRef = useRef<(() => void) | null>(null);

  const getDownloadOpts = useCallback(
    () => ({
      cookies: settings.cookiesMap,
      useProxy: settings.useProxy,
      proxyUrl: settings.proxyUrl,
      poToken: settings.poToken,
      writeSubs: settings.writeSubs,
      downloadThumbnail: settings.downloadThumbnail,
    }),
    [
      settings.cookiesMap,
      settings.useProxy,
      settings.proxyUrl,
      settings.poToken,
      settings.writeSubs,
      settings.downloadThumbnail,
    ],
  );

  const getParseOpts = useCallback(
    () => ({
      cookies: settings.cookiesMap,
      useProxy: settings.useProxy,
      proxyUrl: settings.proxyUrl,
      poToken: settings.poToken,
    }),
    [settings.cookiesMap, settings.useProxy, settings.proxyUrl, settings.poToken],
  );

  const onNeedActivation = useCallback((retry: () => void) => {
    pendingDownloadRef.current = retry;
    setShowActivation(true);
  }, []);

  const queueCtrl = useDownloadQueue({
    ipc,
    activated,
    onNeedActivation,
    showToast,
    refreshAll: historyData.refreshAll,
    updateHistoryByParseUrl: historyData.updateHistoryByParseUrl,
    getDownloadOpts,
  });

  const parser = useUrlParser({
    ipc,
    defaultQuality: settings.defaultQuality,
    showToast,
    refreshAll: historyData.refreshAll,
    getParseOpts,
  });

  useEffect(() => {
    ipc.checkActivated().then((r) => {
      setActivated(r.activated);
      if (r.expiresAt) setExpiresAt(r.expiresAt);
      if (!r.activated) setShowActivation(true);
    });
    ipc.getSettings().then((s) => {
      if (s.activated) setActivated(true);
      if (s.activatedExpiresAt) setExpiresAt(s.activatedExpiresAt);
    });
  }, [ipc]);

  const needCookies =
    toast?.type === "error" && /cookie|login|auth|登录|权限|为空/i.test(toast.msg);

  const handleActivated = (expiresAtStr?: string) => {
    setActivated(true);
    setShowActivation(false);
    if (expiresAtStr) setExpiresAt(expiresAtStr);
    showToast("激活成功，已解锁下载功能", "success");
    if (pendingDownloadRef.current) {
      const retry = pendingDownloadRef.current;
      pendingDownloadRef.current = null;
      window.setTimeout(() => retry(), 300);
    }
  };

  const handleSaveSettings = async () => {
    await settings.saveSettings();
    setShowSettings(false);
    showToast("设置已保存", "success");
  };

  const pickCookies = async (name: string) => {
    const r = await ipc.selectCookiesFile(name);
    if (!r.path) return;
    const next = { ...settings.cookiesMap, [name]: r.path };
    settings.setCookiesMap(next);
    await ipc.saveSettings({ ...settings.settingsSnapshot, cookies: next });

    const check = r.check;
    const needsCheck = name === "youtube" || name === "instagram";
    if (needsCheck && check && !check.ok) {
      showToast(`已导入，但 ${check.reason}`, "error");
    } else {
      showToast(
        `已导入 ${name} cookies${needsCheck && check?.ok ? ` · ${check.reason}` : ""}`,
        "success",
      );
    }
  };

  const handleStartPot = async () => {
    const r = await settings.startPot();
    if (r.running) {
      showToast(`PO Token 服务已就绪${r.started ? "" : "（已在运行）"}`, "success");
    } else {
      showToast(r.error || "PO Token 服务启动失败", "error");
    }
  };

  const openMobileQueue = () => {
    setTab("queue");
    document.getElementById("app-sidebar")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <main className="relative flex min-w-0 flex-1 flex-col bg-card/80">
        <AppHeader
          onOpenHistory={() => setShowHistory(true)}
          onOpenSettings={() => setShowSettings(true)}
          activated={activated}
          expiresAt={expiresAt}
        />

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:flex-row md:gap-5 md:p-5">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            <PlatformButtons />

            <div className="shrink-0 space-y-3">
              <UrlInputBar
                url={parser.url}
                onUrlChange={parser.setUrl}
                onClear={parser.clearParseResults}
                onParse={parser.doParse}
                downloading={queueCtrl.downloading}
              />
              {needCookies && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  当前平台可能需要登录 cookies，请在设置里导入后重试。
                </div>
              )}
            </div>

            <MediaList
              parsedList={parser.parsedList}
              activeMedia={parser.activeMedia}
              formatMap={parser.formatMap}
              queuedKeys={queueCtrl.queuedKeys}
              downloading={queueCtrl.downloading}
              onSelectMedia={parser.setActiveMedia}
              onFormatChange={parser.setFormatForMedia}
              onAddToQueue={queueCtrl.addToQueue}
              onAddAudioToQueue={(m, fmt) => queueCtrl.addToQueue(m, fmt, true)}
              onAddAllToQueue={() => queueCtrl.addManyToQueue(parser.addAllCandidates(queueCtrl.queuedKeys))}
            />
          </section>

          <Sidebar
            id="app-sidebar"
            tab={tab}
            onTabChange={setTab}
            queue={queueCtrl.queue}
            downloading={queueCtrl.downloading}
            onSkip={queueCtrl.skipDownload}
            onRemove={queueCtrl.removeFromQueue}
            onPause={queueCtrl.pauseDownload}
            onResume={queueCtrl.resumeDownload}
            onRetry={queueCtrl.retryDownload}
            onPreview={(path, name) => setPreviewVideo({ path, name })}
            onOpenFolder={() => ipc.openFolder()}
            filteredHistory={historyData.filteredHistory}
            hPlatform={historyData.hPlatform}
            onPlatformChange={historyData.setHPlatform}
            onDeleteRecord={historyData.deleteRecord}
          />
        </div>

        <MobileDock queueCount={queueCtrl.queue.length} onOpenQueue={openMobileQueue} />
      </main>

      <Toast toast={toast} />
      <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} />
      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        dlPath={settings.dlPath}
        defaultQuality={settings.defaultQuality}
        cookiesMap={settings.cookiesMap}
        useProxy={settings.useProxy}
        proxyUrl={settings.proxyUrl}
        writeSubs={settings.writeSubs}
        downloadThumbnail={settings.downloadThumbnail}
        poToken={settings.poToken}
        potStatus={settings.potStatus}
        onStartPot={handleStartPot}
        onDlPathChange={settings.setDlPath}
        onDefaultQualityChange={settings.setDefaultQuality}
        onCookiesChange={settings.setCookiesMap}
        onUseProxyChange={settings.setUseProxy}
        onProxyUrlChange={settings.setProxyUrl}
        onWriteSubsChange={settings.setWriteSubs}
        onDownloadThumbnailChange={settings.setDownloadThumbnail}
        onPoTokenChange={settings.setPoToken}
        onSave={handleSaveSettings}
        onSelectDir={() => ipc.selectDir()}
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
        filteredHistory={historyData.filteredHistory}
        totalCount={historyData.totalCount}
        downloadedCount={historyData.downloadedCount}
        hPlatform={historyData.hPlatform}
        hStatus={historyData.hStatus}
        hSearch={historyData.hSearch}
        onPlatformChange={historyData.setHPlatform}
        onStatusChange={historyData.setHStatus}
        onSearchChange={historyData.setHSearch}
        onPreview={(path, name) => setPreviewVideo({ path, name })}
        onDelete={historyData.deleteRecord}
      />
    </div>
  );
}
