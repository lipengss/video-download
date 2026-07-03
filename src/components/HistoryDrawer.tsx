import { Clock, Search, Trash2, X } from "lucide-react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Button } from "./ui/button";
import { cn, detectPlatform, fmtSize, meta } from "../lib/utils";
import { PLATFORMS, STATUSES } from "../lib/constants";
import type { HItem } from "../lib/types";

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  filteredHistory: HItem[];
  totalCount: number;
  downloadedCount: number;
  hPlatform: string;
  hStatus: string;
  hSearch: string;
  onPlatformChange: (platform: string) => void;
  onStatusChange: (status: string) => void;
  onSearchChange: (search: string) => void;
  onPreview: (path: string, name: string) => void;
  onDelete: (id: string) => void;
}

function HistoryItem({
  record,
  onPreview,
  onDelete,
}: {
  record: HItem;
  onPreview: (path: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const p = meta(record.url || "");
  const ok = record._local || record.status === "downloaded";
  return (
    <div
      className="group flex items-center gap-3 rounded-[12px] px-3 py-3 hover:bg-white/[0.035]"
      onClick={() => ok && record.filePath && onPreview(record.filePath, record.name || record.title || "视频")}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: p.bg }}>
        {p.icon && <img src={p.icon} className="h-5 w-5" referrerPolicy="no-referrer" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white">
          {record.title || record.name || record.url || "未知视频"}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-[#5f7190]">
          {record.time ? new Date(record.time).toLocaleString("zh-CN") : "未知时间"} ·{" "}
          {record.resolution || fmtSize(record.size)}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
          ok ? "bg-emerald-400/12 text-emerald-300" : "bg-amber-400/12 text-amber-300",
        )}
      >
        {ok ? "已下载" : "未下载"}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(record.id);
        }}
        className="ml-1 shrink-0 rounded-md p-1 text-[#5f7190] opacity-0 hover:bg-white/[0.06] hover:text-red-400 group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function HistoryDrawer({
  open,
  onClose,
  filteredHistory,
  totalCount,
  downloadedCount,
  hPlatform,
  hStatus,
  hSearch,
  onPlatformChange,
  onStatusChange,
  onSearchChange,
  onPreview,
  onDelete,
}: HistoryDrawerProps) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/45" onClick={onClose} />}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-white/[0.08] bg-[#131d2d]  transition-transform duration-200",
          !open && "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-bold">下载历史</span>
            <span className="rounded-full bg-[#4e73ff]/15 px-2 py-0.5 text-[11px] font-bold text-[#8fa2ff]">
              {totalCount}
            </span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2 border-b border-white/[0.06] bg-[#101826] px-5 py-4 text-center">
          <div>
            <p className="text-lg font-bold">{totalCount}</p>
            <p className="text-[10px] text-[#667897]">总记录</p>
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-300">{downloadedCount}</p>
            <p className="text-[10px] text-[#667897]">已下载</p>
          </div>
          <div>
            <p className="text-lg font-bold text-amber-300">{Math.max(totalCount - downloadedCount, 0)}</p>
            <p className="text-[10px] text-[#667897]">未下载</p>
          </div>
        </div>
        <div className="space-y-3 border-b border-white/[0.06] px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#7789a5]" />
            <input
              value={hSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索标题..."
              className="h-10 w-full rounded-[12px] border border-white/[0.08] bg-[#1d2a40] pl-9 pr-3 text-xs outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[{ name: "all", label: "全部" }, ...PLATFORMS.map((p) => ({ name: p.name, label: p.short }))].map((p) => (
              <button
                key={p.name}
                onClick={() => onPlatformChange(p.name)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px]",
                  hPlatform === p.name ? "bg-[#4e73ff]" : "bg-[#1d2a40] text-[#798aa5]",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px]",
                  hStatus === s ? "bg-[#4e73ff]" : "bg-[#1d2a40] text-[#798aa5]",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <OverlayScrollbarsComponent
          className="min-h-0 flex-1"
          options={{ scrollbars: { autoHide: "leave", theme: "os-theme-light" } }}
        >
          <div className="p-3">
            {filteredHistory.length ? (
              filteredHistory.map((r) => (
                <HistoryItem key={r.id} record={r} onPreview={onPreview} onDelete={onDelete} />
              ))
            ) : (
              <div className="py-16 text-center text-xs text-[#697d9d]">暂无记录</div>
            )}
          </div>
        </OverlayScrollbarsComponent>
      </div>
    </>
  );
}
