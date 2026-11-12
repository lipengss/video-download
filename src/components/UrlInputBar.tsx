import { Clipboard, Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { ScrollableTextarea } from "./ui/scrollable-textarea";

interface UrlInputBarProps {
  url: string;
  onUrlChange: (url: string) => void;
  onClear: () => void;
  onParse: () => void;
  downloading: boolean;
}

const ROW_H = "h-[72px]";

export function UrlInputBar({ url, onUrlChange, onClear, onParse, downloading }: UrlInputBarProps) {
  return (
    <div className={`flex items-stretch gap-3`}>
      <div className={`relative min-w-0 flex-1 ${ROW_H}`}>
        <ScrollableTextarea
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="粘贴视频链接，每行一条，Ctrl+Enter 解析"
          rows={1}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (url.trim() && !downloading) onParse();
            }
          }}
          className={`box-border ${ROW_H} w-full resize-none rounded-[10px] border border-white/[0.08] bg-[#20314b] px-3 py-2.5 pr-10 text-sm leading-6 text-white placeholder:text-[#7c8dac] focus:border-primary/70 focus-visible:ring-0`}
        />
        {url && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#7f90ad] hover:bg-white/[0.06]"
            aria-label="清空"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Button
        variant="ghost"
        type="button"
        onClick={async () => {
          try {
            const t = await navigator.clipboard.readText();
            if (t) onUrlChange(t.trim() ? `${url ? `${url}\n` : ""}${t}` : url);
          } catch {
            /* 无剪贴板权限 */
          }
        }}
        className={`${ROW_H} shrink-0 gap-2 rounded-[10px] border border-white/[0.08] bg-[#20314b] px-5 text-[#7184a5]`}
      >
        <Clipboard className="h-4 w-4" />
        粘贴
      </Button>

      <Button
        type="button"
        onClick={onParse}
        disabled={!url.trim() || downloading}
        className={`${ROW_H} shrink-0 gap-2 rounded-[10px] bg-primary px-8 hover:bg-primary/90`}
      >
        <Search className="h-4 w-4" />
        解析
      </Button>
    </div>
  );
}
