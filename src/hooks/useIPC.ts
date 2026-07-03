import { useEffect, useCallback, useRef } from "react";

const api = (window as any).electronAPI;

export function useIPC() {
  return {
    getEngineInfo: () => api?.getEngineInfo?.() ?? Promise.resolve({}),
    parseUrl: (url: string, opts?: any) =>
      api?.parseUrl?.(url, opts) ?? Promise.resolve({ error: "API not available" }),
    startDownload: (p: any) => api?.startDownload?.(p) ?? Promise.resolve({ error: "API not available" }),
    cancelDownload: () => api?.cancelDownload?.() ?? Promise.resolve({ ok: false }),
    getSettings: () => api?.getSettings?.() ?? Promise.resolve({}),
    saveSettings: (s: any) => api?.saveSettings?.(s) ?? Promise.resolve({ ok: true }),
    selectDir: () => api?.selectDir?.() ?? Promise.resolve({ path: null }),
    getHistory: () => api?.getHistory?.() ?? Promise.resolve([]),
    addHistory: (r: any) => api?.addHistory?.(r) ?? Promise.resolve({ ok: true }),
    updateHistory: (id: string, u: any) => api?.updateHistory?.(id, u) ?? Promise.resolve({ ok: true }),
    deleteHistory: (id: string) => api?.deleteHistory?.(id) ?? Promise.resolve({ ok: true }),
    clearHistory: () => api?.clearHistory?.() ?? Promise.resolve({ ok: true }),
    deleteFile: (fp: string) => api?.deleteFile?.(fp) ?? Promise.resolve({ ok: false }),
    openFile: (fp: string) => api?.openFile?.(fp) ?? Promise.resolve({ ok: true }),
    openFolder: () => api?.openFolder?.() ?? Promise.resolve({ ok: true }),
    selectCookiesFile: () => api?.selectCookiesFile?.() ?? Promise.resolve({ path: null }),
    listLocalFiles: () => api?.listLocalFiles?.() ?? Promise.resolve([]),
    fileExists: (name: string) => api?.fileExists?.(name) ?? Promise.resolve({ exists: false }),
    cacheThumbnail: (url: string) => api?.cacheThumbnail?.(url) ?? Promise.resolve({ path: null }),
  };
}

export type IPC = ReturnType<typeof useIPC>;
