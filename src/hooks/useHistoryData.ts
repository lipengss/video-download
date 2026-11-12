import { useCallback, useEffect, useMemo, useState } from "react";
import { cleanUrl, detectPlatform } from "../lib/utils";
import type { HItem, LocalFile } from "../lib/types";
import type { IPC } from "./useIPC";

export function useHistoryData(ipc: IPC) {
  const [history, setHistory] = useState<HItem[]>([]);
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [hPlatform, setHPlatform] = useState("all");
  const [hStatus, setHStatus] = useState("全部");
  const [hSearch, setHSearch] = useState("");

  const refreshAll = useCallback(async () => {
    const [h, lf] = await Promise.all([ipc.getHistory(), ipc.listLocalFiles()]);
    setHistory(Array.isArray(h) ? h : []);
    setLocalFiles(Array.isArray(lf) ? lf : []);
  }, [ipc]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

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
    if (hPlatform !== "all") {
      rows = rows.filter((r) => detectPlatform(r.url || "").name === hPlatform);
    }
    if (hStatus === "已下载") {
      rows = rows.filter((r) => r._local || r.status === "downloaded");
    }
    if (hStatus === "未下载") {
      rows = rows.filter((r) => !r._local && r.status !== "downloaded");
    }
    if (hSearch) {
      const q = hSearch.toLowerCase();
      rows = rows.filter((r) =>
        (r.title || r.name || r.url || "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [merged, hPlatform, hStatus, hSearch]);

  const totalCount = merged.length;
  const downloadedCount = merged.filter((r) => r._local || r.status === "downloaded").length;

  const deleteRecord = useCallback(
    async (id: string) => {
      await ipc.deleteHistory(id);
      await refreshAll();
    },
    [ipc, refreshAll],
  );

  const updateHistoryByParseUrl = useCallback(
    async (parseUrl: string, patch: Partial<HItem>) => {
      const hist = await ipc.getHistory();
      const record = hist.find((r) => cleanUrl(r.url || "") === cleanUrl(parseUrl));
      if (record) await ipc.updateHistory(record.id, patch);
    },
    [ipc],
  );

  return {
    history,
    localFiles,
    merged,
    filteredHistory,
    totalCount,
    downloadedCount,
    hPlatform,
    setHPlatform,
    hStatus,
    setHStatus,
    hSearch,
    setHSearch,
    refreshAll,
    deleteRecord,
    updateHistoryByParseUrl,
  };
}
