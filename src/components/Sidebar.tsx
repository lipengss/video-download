import { FolderOpen, Trash2 } from "lucide-react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Button } from "./ui/button";
import { cn, fmtSize, meta } from "../lib/utils";
import { PLATFORMS } from "../lib/constants";
import type { QItem, HItem } from "../lib/types";
import { QueuePanel } from "./QueuePanel";

interface SidebarProps {
  tab: "queue" | "history";
  onTabChange: (tab: "queue" | "history") => void;
  queue: QItem[];
  downloading: boolean;
  onSkip: (id: number) => void;
  onRemove: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onRetry: (id: number) => void;
  onPreview: (path: string, name: string) => void;
  onOpenFolder: () => void;
  filteredHistory: HItem[];
  hPlatform: string;
  onPlatformChange: (p: string) => void;
  onDeleteRecord: (id: string) => void;
}

function HistoryTab({
  filteredHistory,
  hPlatform,
  onPlatformChange,
  onPreview,
  onDelete,
}: {
  filteredHistory: HItem[];
  hPlatform: string;
  onPlatformChange: (p: string) => void;
  onPreview: (path: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <OverlayScrollbarsComponent
      className="h-full"
      options={{ scrollbars: { autoHide: "leave", theme: "os-theme-light" } }}
    >
      <div className="pr-2">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[{ name: "all", label: "全部" }, ...PLATFORMS.map((p) => ({ name: p.name, label: p.short }))].map((p) => (
            <button
              key={p.name}
              onClick={() => onPlatformChange(p.name)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px]",
                hPlatform === p.name ? "bg-[#4e73ff]" : "bg-[#1b2739] text-[#7184a5]",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {filteredHistory.length ? (
          filteredHistory.slice(0, 80).map((r) => {
            const p = meta(r.url || "");
            const ok = r._local || r.status === "downloaded";
            return (
              <div
                key={r.id}
                className="group flex items-center gap-3 rounded-[12px] px-3 py-3 hover:bg-white/[0.035]"
                onClick={() => ok && r.filePath && onPreview(r.filePath, r.name || r.title || "视频")}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ background: p.bg }}
                >
                  {p.icon && <img src={p.icon} className="h-5 w-5" referrerPolicy="no-referrer" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white">{r.title || r.name || r.url || "未知视频"}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[#5f7190]">
                    {r.time ? new Date(r.time).toLocaleString("zh-CN") : "未知时间"} · {r.resolution || fmtSize(r.size)}
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
                    onDelete(r.id);
                  }}
                  className="ml-1 shrink-0 rounded-md p-1 text-[#5f7190] opacity-0 hover:bg-white/[0.06] hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        ) : (
          <div className="py-16 text-center text-xs text-[#697d9d]">暂无记录</div>
        )}
      </div>
    </OverlayScrollbarsComponent>
  );
}

export function Sidebar({
  tab,
  onTabChange,
  queue,
  downloading,
  onSkip,
  onRemove,
  onPause,
  onResume,
  onRetry,
  onPreview,
  onOpenFolder,
  filteredHistory,
  hPlatform,
  onPlatformChange,
  onDeleteRecord,
}: SidebarProps) {
  return (
    <aside className="hidden w-[350px] shrink-0 flex-col overflow-hidden rounded-[10px] border border-white/[0.07] bg-[#111b2b] lg:flex">
      {/* Tab header + folder button — fixed height */}
      <div className="mb-4 flex shrink-0 items-center justify-between px-4 pt-4">
        <div className="flex rounded-[10px] bg-[#172236] p-1">
          <button
            onClick={() => onTabChange("queue")}
            className={cn(
              "rounded-[9px] px-3 py-2 text-xs font-semibold",
              tab === "queue" ? "bg-[#263955] text-white" : "text-[#7588a8]",
            )}
          >
            下载队列{queue.length ? ` · ${queue.length}` : ""}
          </button>
          <button
            onClick={() => onTabChange("history")}
            className={cn(
              "rounded-[9px] px-3 py-2 text-xs font-semibold",
              tab === "history" ? "bg-[#263955] text-white" : "text-[#7588a8]",
            )}
          >
            下载记录
          </button>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onOpenFolder}>
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable content area — fills remaining height */}
      <div className="min-h-0 flex-1 overflow-hidden pl-4 pb-4 pr-0">
        {tab === "queue" ? (
          <QueuePanel
            queue={queue}
            downloading={downloading}
            onSkip={onSkip}
            onRemove={onRemove}
            onPause={onPause}
            onResume={onResume}
            onRetry={onRetry}
            onPreview={onPreview}
          />
        ) : (
          <HistoryTab
            filteredHistory={filteredHistory}
            hPlatform={hPlatform}
            onPlatformChange={onPlatformChange}
            onPreview={onPreview}
            onDelete={onDeleteRecord}
          />
        )}
      </div>
    </aside>
  );
}
