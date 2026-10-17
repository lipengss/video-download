import { CheckCircle2, Download, Music, Play } from "lucide-react";
import { cn, duration, meta } from "../lib/utils";
import { Button } from "./ui/button";
import type { Media } from "../lib/types";

interface MediaCardProps {
  media: Media;
  isActive: boolean;
  selectedFormat: string | null;
  isQueued: boolean;
  onSelect: (media: Media) => void;
  onFormatChange: (mediaKey: string, formatId: string) => void;
  onAddToQueue: (media: Media, format: string | null) => void;
  onAddAudioToQueue: (media: Media, format: string | null) => void;
}

export function MediaCard({
  media,
  isActive,
  selectedFormat,
  isQueued,
  onSelect,
  onFormatChange,
  onAddToQueue,
  onAddAudioToQueue,
}: MediaCardProps) {
  const p = meta(media.url || "");
  const mKey = media.url || media.fileName;
  const fmts = media.formats || [];

  return (
    <article
      onClick={() => onSelect(media)}
      className={cn(
        "flex h-[148px] cursor-pointer overflow-hidden rounded-[16px] border bg-[#1b2739] shadow-[0_16px_40px_rgba(0,0,0,0.14)]",
        isActive ? "border-[#5577ff] ring-2 ring-[#5577ff]/15" : "border-white/[0.07] hover:border-white/[0.16]",
      )}
    >
      <div className="relative h-full w-[140px] shrink-0 overflow-hidden bg-black sm:w-[238px]">
        {media.thumbnail && (
          <img
            src={media.thumbnail}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
        {duration(media.duration) && (
          <span className="absolute bottom-3 right-3 rounded-md bg-black/70 px-2 py-1 text-[11px]">
            {duration(media.duration)}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between p-3 sm:p-4">
        <div>
          <h3 className="truncate text-[14px] font-semibold leading-5" title={media.fileName}>
            {media.fileName?.replace(/\.(mp4|mkv|webm|flv)$/i, "") || "未命名视频"}
          </h3>
          <p className="mt-1 truncate text-[11px] text-[#697d9d]">
            {media.resolution && media.resolution !== "未知" ? `分辨率 ${media.resolution}` : ""}
            {duration(media.duration)
              ? `${media.resolution && media.resolution !== "未知" ? " · " : ""}时长 ${duration(media.duration)}`
              : ""}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {fmts.slice(0, 3).map((f: any, j: number) => (
              <button
                key={f.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onFormatChange(mKey, f.id);
                }}
                className={cn(
                  "h-8 rounded-[9px] border px-2.5 text-[11px]",
                  selectedFormat === f.id
                    ? "border-[#4e73ff] bg-[#4e73ff]"
                    : "border-white/[0.08] bg-[#111a29] text-[#a9b8d4]",
                )}
              >
                {f.quality && !f.quality.startsWith("Quality") && f.quality !== "未知"
                  ? f.quality
                  : `${p.short}画质 ${j + 1}`}
              </button>
            ))}
          </div>
          {isQueued ? (
            <Button size="sm" disabled className="ml-auto h-8 rounded-[9px] bg-emerald-500/15 px-3 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已加入队列
            </Button>
          ) : (
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddAudioToQueue(media, selectedFormat);
                }}
                className="h-8 rounded-[9px] bg-orange-500/18 px-3 text-xs text-orange-300 hover:bg-orange-500/28"
              >
                <Music className="h-3.5 w-3.5" />
                提取音频
              </Button>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToQueue(media, selectedFormat);
                }}
                className="h-8 rounded-[9px] bg-[#4e73ff] px-3 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
