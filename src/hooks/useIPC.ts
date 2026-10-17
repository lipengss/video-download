import type {
  AppSettings,
  CookiesCheck,
  DownloadComplete,
  DownloadError,
  DownloadProgress,
  EngineInfo,
  HItem,
  LocalFile,
  ParseResult,
} from "../lib/types";

const api = (window as any).electronAPI;

export function useIPC() {
  return {
    getEngineInfo: () => (api?.getEngineInfo?.() ?? Promise.resolve({})) as Promise<EngineInfo>,
    parseUrl: (url: string, opts?: any) =>
      (api?.parseUrl?.(url, opts) ?? Promise.resolve({ error: "API not available" })) as Promise<ParseResult>,
    startDownload: (p: any) =>
      (api?.startDownload?.(p) ?? Promise.resolve({ error: "API not available" })) as Promise<{
        success: boolean;
        filePath?: string;
        size?: number;
        error?: string;
      }>,
    cancelDownload: () => (api?.cancelDownload?.() ?? Promise.resolve({ ok: false })) as Promise<{ ok: boolean }>,
    getSettings: () => (api?.getSettings?.() ?? Promise.resolve({})) as Promise<AppSettings>,
    activate: (code: string) =>
      (api?.activate?.(code) ?? Promise.resolve({ ok: false, error: "API not available" })) as Promise<{
        ok: boolean;
        error?: string;
        expiresAt?: string;
      }>,
    checkActivated: () =>
      (api?.checkActivated?.() ?? Promise.resolve({ activated: false })) as Promise<{
        activated: boolean;
        expiresAt?: string | null;
        reason?: string;
      }>,
    saveSettings: (s: AppSettings) =>
      (api?.saveSettings?.(s) ?? Promise.resolve({ ok: true })) as Promise<{ ok: boolean }>,
    selectDir: () => (api?.selectDir?.() ?? Promise.resolve({ path: null })) as Promise<{ path: string | null }>,
    getHistory: () => (api?.getHistory?.() ?? Promise.resolve([])) as Promise<HItem[]>,
    addHistory: (r: Partial<HItem>) =>
      (api?.addHistory?.(r) ?? Promise.resolve({ ok: true })) as Promise<{ ok: boolean; id?: string }>,
    updateHistory: (id: string, u: Partial<HItem>) =>
      (api?.updateHistory?.(id, u) ?? Promise.resolve({ ok: true })) as Promise<{ ok: boolean }>,
    deleteHistory: (id: string) =>
      (api?.deleteHistory?.(id) ?? Promise.resolve({ ok: true })) as Promise<{ ok: boolean }>,
    clearHistory: () => (api?.clearHistory?.() ?? Promise.resolve({ ok: true })) as Promise<{ ok: boolean }>,
    deleteFile: (fp: string) => (api?.deleteFile?.(fp) ?? Promise.resolve({ ok: false })) as Promise<{ ok: boolean }>,
    openFile: (fp: string) => (api?.openFile?.(fp) ?? Promise.resolve({ ok: true })) as Promise<{ ok: boolean }>,
    openFolder: () => (api?.openFolder?.() ?? Promise.resolve({ ok: true })) as Promise<{ ok: boolean }>,
    selectCookiesFile: () =>
      (api?.selectCookiesFile?.() ?? Promise.resolve({ path: null, check: null })) as Promise<{
        path: string | null;
        check: CookiesCheck | null;
      }>,
    listLocalFiles: () => (api?.listLocalFiles?.() ?? Promise.resolve([])) as Promise<LocalFile[]>,
    fileExists: (name: string) =>
      (api?.fileExists?.(name) ?? Promise.resolve({ exists: false })) as Promise<{
        exists: boolean;
        path?: string;
        size?: number;
      }>,
    cacheThumbnail: (url: string) =>
      (api?.cacheThumbnail?.(url) ?? Promise.resolve({ path: null })) as Promise<{ path: string | null }>,
    getPotStatus: () =>
      (api?.getPotStatus?.() ?? Promise.resolve({ running: false, version: null })) as Promise<{
        running: boolean;
        version?: string | null;
      }>,
    startPotServer: () =>
      (api?.startPotServer?.() ?? Promise.resolve({ running: false })) as Promise<{
        running: boolean;
        started?: boolean;
        version?: string | null;
        error?: string;
      }>,
  };
}

export type IPC = ReturnType<typeof useIPC>;
