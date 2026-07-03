import { Clipboard, Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface UrlInputBarProps {
  url: string;
  onUrlChange: (url: string) => void;
  onClear: () => void;
  onParse: () => void;
  downloading: boolean;
}

export function UrlInputBar({ url, onUrlChange, onClear, onParse, downloading }: UrlInputBarProps) {
  return (
    <div className="flex items-stretch gap-3">
      <div className="relative min-w-0 flex-1 h-[62px]">
        <Textarea
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="粘贴视频链接，每行一条..."
          rows={1}
          autoFocus
          className="box-border h-full w-full resize-none rounded-[10px] border border-white/[0.08] bg-[#20314b] px-2 py-2 pr-10 text-sm leading-6 text-white placeholder:text-[#7c8dac] focus:border-[#5f7dff]/70 focus-visible:ring-0 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" as any }}
        />
        {url && (
          <button
            onClick={onClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#7f90ad] hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        onClick={async () => {
          const t = await navigator.clipboard.readText();
          if (t) onUrlChange(t);
        }}
        className="h-[80px] rounded-[10px] text-[#7184a5] px-5 border border-white/[0.08] bg-[#20314b]"
      >
        <Clipboard className="h-4 w-4" />
        粘贴
      </Button>
      <Button
        onClick={onParse}
        disabled={!url || downloading}
        className="rounded-[10px] h-[80px] bg-[#4e73ff] px-10 text-sm hover:bg-[#4468ea]"
      >
        <Search className="h-4 w-4" />
        解析
      </Button>
    </div>
  );
}
