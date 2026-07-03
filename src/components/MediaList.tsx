import { CheckCircle2, Download } from "lucide-react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import "overlayscrollbars/overlayscrollbars.css";
import { Button } from "./ui/button";
import { EmptyState } from "./EmptyState";
import { MediaCard } from "./MediaCard";
import type { Media } from "../lib/types";

interface MediaListProps {
  parsedList: Media[];
  activeMedia: Media | null;
  formatMap: Record<string, string>;
  queuedKeys: Set<string>;
  downloading: boolean;
  onSelectMedia: (media: Media) => void;
  onFormatChange: (mediaKey: string, formatId: string) => void;
  onAddToQueue: (media: Media, format: string | null) => void;
  onAddAllToQueue: () => void;
}

export function MediaList({
  parsedList,
  activeMedia,
  formatMap,
  queuedKeys,
  downloading,
  onSelectMedia,
  onFormatChange,
  onAddToQueue,
  onAddAllToQueue,
}: MediaListProps) {
  if (parsedList.length === 0) {
    return (
      <EmptyState
        icon={<Download className="h-6 w-6" />}
        title="粘贴链接后开始解析"
        description="支持单条或多行批量链接"
        className="min-h-[236px]"
      />
    );
  }

  const allQueued = parsedList.every((m) => queuedKeys.has(m.url || m.fileName));

  return (
    <div className="min-h-0 flex-1">
      <OverlayScrollbarsComponent
        className="h-full"
        options={{ scrollbars: { autoHide: "leave", theme: "os-theme-light" } }}
      >
        <div className="mb-3 flex items-center justify-between pr-1">
          <p className="text-xs font-semibold uppercase tracking-[1.6px] text-[#7890b6]">解析结果</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={onAddAllToQueue}
              disabled={parsedList.length === 0 || allQueued}
              className="h-7 rounded-[9px] bg-emerald-500/18 px-2.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/28"
            >
              <CheckCircle2 className="h-3 w-3" />
              全部加入队列
            </Button>
            <span className="rounded-full bg-[#263652] px-2.5 py-1 text-[11px] text-[#9fb3d6]">
              {parsedList.length} 条
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 pr-1 xl:grid-cols-2">
          {parsedList.map((m, i) => (
            <MediaCard
              key={`${m.url || m.fileName}-${i}`}
              media={m}
              isActive={activeMedia === m}
              selectedFormat={formatMap[m.url || m.fileName] ?? null}
              isQueued={queuedKeys.has(m.url || m.fileName)}
              onSelect={onSelectMedia}
              onFormatChange={onFormatChange}
              onAddToQueue={onAddToQueue}
            />
          ))}
        </div>
      </OverlayScrollbarsComponent>
    </div>
  );
}
