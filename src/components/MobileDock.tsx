import { ListOrdered } from "lucide-react";
import { Button } from "./ui/button";

interface MobileDockProps {
  queueCount: number;
  onOpenQueue: () => void;
}

/** 小屏下侧栏隐藏时，底部快捷打开队列 */
export function MobileDock({ queueCount, onOpenQueue }: MobileDockProps) {
  return (
    <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 lg:hidden">
      <Button
        onClick={onOpenQueue}
        className="h-11 gap-2 rounded-full border border-white/10 bg-[#1b2739]/95 px-5 shadow-lg backdrop-blur-md"
      >
        <ListOrdered className="h-4 w-4" />
        下载队列
        {queueCount > 0 && (
          <span className="rounded-full bg-[#4e73ff] px-2 py-0.5 text-[11px] font-semibold">
            {queueCount}
          </span>
        )}
      </Button>
    </div>
  );
}
