import { X } from "lucide-react";
import { Button } from "./ui/button";
import { videoSrc } from "../lib/utils";

interface VideoPreviewModalProps {
  video: { path: string; name: string } | null;
  onClose: () => void;
}

export function VideoPreviewModal({ video, onClose }: VideoPreviewModalProps) {
  if (!video) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[92vh] w-[min(92vw,960px)] overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#111b2b]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
          <span className="truncate text-sm font-semibold">{video.name}</span>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <video
          controls
          autoPlay
          className="block max-h-[calc(92vh-54px)] w-full bg-black"
          src={videoSrc(video.path)}
          onError={() => (window as any).electronAPI?.openFile?.(video.path)}
        />
      </div>
    </div>
  );
}
