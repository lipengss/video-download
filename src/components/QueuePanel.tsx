import { Download, Eye, Pause, Play, RefreshCw, X } from "lucide-react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { cn, meta } from "../lib/utils";
import type { QItem } from "../lib/types";

interface QueuePanelProps {
  queue: QItem[];
  downloading: boolean;
  onSkip: (id: number) => void;
  onRemove: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onRetry: (id: number) => void;
  onPreview: (path: string, name: string) => void;
}

export function QueuePanel({
  queue,
  downloading,
  onSkip,
  onRemove,
  onPause,
  onResume,
  onRetry,
  onPreview,
}: QueuePanelProps) {
  const statusLabel = (q: QItem) => {
    switch (q.status) {
      case "downloading":
        return `${q.pct}%`;
      case "done":
        return "完成";
      case "cancelled":
        return "取消";
      case "paused":
        return "暂停";
      case "failed":
        return "失败";
      default:
        return "等待";
    }
  };

  return (
    <OverlayScrollbarsComponent
      className="h-full"
      options={{ scrollbars: { autoHide: "leave", theme: "os-theme-light" } }}
    >
      <div className="space-y-2 pr-2">
        {queue.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center rounded-[16px] border border-dashed border-white/[0.08] text-center text-xs text-[#697d9d]">
            <div>
              <Download className="mx-auto mb-2 h-8 w-8 text-[#3b4963]" />
              队列为空
            </div>
          </div>
        ) : (
          queue.map((q) => {
            const p = meta(q.media?.url || "");
            return (
              <div
                key={q.id}
                className={cn(
                  "rounded-[14px] border bg-[#182336] p-3",
                  q.status === "downloading" ? "border-[#4e73ff]/40" : "border-white/[0.06]",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{ background: p.bg }}
                  >
                    {p.icon && <img src={p.icon} className="h-3.5 w-3.5" referrerPolicy="no-referrer" />}
                  </span>
                  <span className="w-11 shrink-0 text-[11px] font-bold text-[#7385a6]">{statusLabel(q)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{q.media?.fileName || "未知任务"}</p>
                    {q.status === "downloading" && <Progress value={q.pct} className="mt-2 h-1" />}
                    {q.status === "failed" && q.error && (
                      <p className="mt-1 truncate text-[10px] text-red-400/70">{q.error}</p>
                    )}
                  </div>
                  {q.status === "downloading" && (
                    <Button variant="ghost" size="icon-sm" onClick={() => onPause(q.id)}>
                      <Pause className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {q.status === "paused" && (
                    <Button variant="ghost" size="icon-sm" onClick={() => onResume(q.id)}>
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {q.status === "queued" && (
                    <Button variant="ghost" size="icon-sm" onClick={() => onRemove(q.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {q.status === "failed" && (
                    <Button variant="ghost" size="icon-sm" onClick={() => onRetry(q.id)}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {q.status === "downloading" && (
                    <Button variant="ghost" size="icon-sm" onClick={() => onSkip(q.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {q.status === "done" && (
                    <Button variant="ghost" size="icon-sm" onClick={() => onRemove(q.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {q.filePath && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onPreview(q.filePath!, q.media?.fileName || "视频")}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </OverlayScrollbarsComponent>
  );
}
