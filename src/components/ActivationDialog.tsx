import { useState, useCallback, useRef } from "react";
import { Key, X, AlertCircle, Check } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { useIPC } from "../hooks/useIPC";

interface ActivationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActivated: (expiresAt?: string) => void;
}

/** 格式化输入：自动插入 VIDEO- 前缀、连字符、转大写、限制长度 */
function formatCodeInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // 去掉用户可能已输入的 VIDEO 前缀，取后 16 位十六进制
  const hex = cleaned.startsWith("VIDEO") ? cleaned.slice(5).slice(0, 16) : cleaned.slice(0, 16);
  // 按 4-4-4-4 分组
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return "VIDEO-" + groups.join("-");
}

export function ActivationDialog({ open, onOpenChange, onActivated }: ActivationDialogProps) {
  const ipc = useIPC();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isValidFormat = /^VIDEO-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(code);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCodeInput(e.target.value);
    setCode(formatted);
    setError("");
    setSuccess(false);
  }, []);

  const handleActivate = useCallback(async () => {
    if (!isValidFormat) {
      setError("请使用 VIDEO-XXXX-XXXX-XXXX-XXXX 格式");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await ipc.activate(code);
      if (result.ok) {
        setSuccess(true);
        setTimeout(() => {
          setCode("");
          setSuccess(false);
          setLoading(false);
          onOpenChange(false);
          onActivated(result.expiresAt);
        }, 800);
      } else {
        setError(result.error || "激活码无效");
        setLoading(false);
      }
    } catch {
      setError("验证失败，请重试");
      setLoading(false);
    }
  }, [code, isValidFormat, ipc, onOpenChange, onActivated]);

  const handleClose = useCallback(() => {
    if (!loading) {
      setCode("");
      setError("");
      setSuccess(false);
      onOpenChange(false);
    }
  }, [loading, onOpenChange]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60" onClick={handleClose} />
      {/* Dialog */}
      <div className="fixed left-[50%] top-[50%] z-50 w-[400px] max-w-[90vw] translate-x-[-50%] translate-y-[-50%]">
        <div className="flex flex-col gap-5 rounded-[16px] border border-white/[0.08] bg-[#131d2d] p-6 shadow-2xl">
          {/* Close button */}
          <button
            onClick={handleClose}
            disabled={loading}
            className="absolute right-4 top-4 rounded-md p-1 text-[#5f7190] hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Icon */}
          <div className="flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#4e73ff]/15">
              <Key className="h-7 w-7 text-[#7f98ff]" />
            </div>
          </div>

          {/* Title */}
          <div className="text-center">
            <h2 className="text-lg font-bold text-white">激活 VideoDL Pro</h2>
            <p className="mt-1.5 text-xs text-[#a8b5cb]">请输入激活码以解锁全部下载功能</p>
          </div>

          {/* Input */}
          <div>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={code}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleActivate();
                }}
                placeholder="VIDEO-XXXX-XXXX-XXXX-XXXX"
                disabled={loading || success}
                autoFocus
                className={cn(
                  "h-11 w-full rounded-[12px] border bg-[#1d2a40] px-3 pr-10 text-center font-mono text-sm tracking-[2px] text-white outline-none transition-colors placeholder:text-[#556885]",
                  success
                    ? "border-emerald-400/40"
                    : error
                      ? "border-red-400/40"
                      : "border-white/[0.08] focus:border-[#4e73ff]/50",
                )}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {success ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : code && isValidFormat ? (
                  <Check className="h-4 w-4 text-emerald-400/50" />
                ) : code && !isValidFormat ? (
                  <X className="h-4 w-4 text-red-400/60" />
                ) : null}
              </div>
            </div>

            {/* Format hint */}
            {code && !isValidFormat && !error && (
              <p className="mt-1.5 text-[11px] text-[#627895]">格式：VIDEO-XXXX-XXXX-XXXX-XXXX（十六进制）</p>
            )}

            {/* Error */}
            {error && (
              <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-red-400/20 bg-red-400/8 px-3 py-2 text-xs text-red-200">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleActivate}
              disabled={!isValidFormat || loading || success}
              className="h-11 w-full rounded-[13px] bg-[#4e73ff] text-sm font-semibold hover:bg-[#4367e8] disabled:opacity-50"
            >
              {loading ? "验证中..." : success ? "激活成功" : "激活"}
            </Button>
            <button
              onClick={handleClose}
              disabled={loading}
              className="py-2 text-center text-xs text-[#788dab] hover:text-white disabled:opacity-40"
            >
              稍后再说
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
