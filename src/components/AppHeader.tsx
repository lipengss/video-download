import { Clock, Download, Minus, Settings, Square, X } from "lucide-react";
import { Button } from "./ui/button";

interface AppHeaderProps {
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

export function AppHeader({ onOpenHistory, onOpenSettings }: AppHeaderProps) {
  return (
    <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-white/[0.05] bg-[#0f1724] px-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#4e73ff]/16 text-[#6f8cff]">
          <Download className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[13px] font-bold leading-none text-[#7184a5]">视频下载器</p>
        </div>
      </div>
      <div className="no-drag flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" onClick={onOpenHistory}>
          <Clock className="h-4 w-4 text-[#7184a5]" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onOpenSettings}>
          <Settings className="h-4 w-4 text-[#7184a5]" />
        </Button>
        <button
          onClick={() => (window as any).electronAPI?.minimize()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#8899b5] hover:bg-white/[0.06]"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => (window as any).electronAPI?.maximize()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#8899b5] hover:bg-white/[0.06]"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          onClick={() => (window as any).electronAPI?.close()}
          className="flex h-7 w-7 items-center justify-center  rounded-lg text-[#8899b5] hover:bg-red-500/18 hover:text-red-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
