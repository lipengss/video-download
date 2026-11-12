import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "../lib/types";
import type { IPC } from "./useIPC";

export function useAppSettings(ipc: IPC) {
  const [dlPath, setDlPath] = useState("");
  const [defaultQuality, setDefaultQuality] = useState("1080P 高清");
  const [useProxy, setUseProxy] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [writeSubs, setWriteSubs] = useState(false);
  const [downloadThumbnail, setDownloadThumbnail] = useState(false);
  const [cookiesMap, setCookiesMap] = useState<Record<string, string>>({});
  const [poToken, setPoToken] = useState("");
  const [potStatus, setPotStatus] = useState<{ running: boolean; version?: string | null } | null>(
    null,
  );

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
    });
    ipc.getPotStatus().then((s) => setPotStatus(s));
  }, [ipc]);

  const settingsSnapshot = useMemo(
    (): AppSettings => ({
      downloadPath: dlPath,
      defaultQuality,
      useProxy,
      proxyUrl,
      cookies: cookiesMap,
      writeSubs,
      downloadThumbnail,
      poToken,
    }),
    [dlPath, defaultQuality, useProxy, proxyUrl, cookiesMap, writeSubs, downloadThumbnail, poToken],
  );

  const saveSettings = useCallback(async () => {
    await ipc.saveSettings(settingsSnapshot);
  }, [ipc, settingsSnapshot]);

  const refreshPotStatus = useCallback(() => {
    ipc.getPotStatus().then((s) => setPotStatus(s));
  }, [ipc]);

  const startPot = useCallback(async () => {
    const r = await ipc.startPotServer();
    setPotStatus({ running: r.running, version: r.version });
    return r;
  }, [ipc]);

  return {
    dlPath,
    setDlPath,
    defaultQuality,
    setDefaultQuality,
    useProxy,
    setUseProxy,
    proxyUrl,
    setProxyUrl,
    writeSubs,
    setWriteSubs,
    downloadThumbnail,
    setDownloadThumbnail,
    cookiesMap,
    setCookiesMap,
    poToken,
    setPoToken,
    potStatus,
    refreshPotStatus,
    startPot,
    settingsSnapshot,
    saveSettings,
  };
}
