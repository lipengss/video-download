import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";

interface ToastProps {
  toast: { msg: string; type: string } | null;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null;

  return (
    <div
      className={cn(
        "slide-down fixed left-1/2 top-5 z-[100] -translate-x-1/2 rounded-[14px] border px-4 py-2.5 text-sm font-medium shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm",
        toast.type === "loading" && "border-[#4e73ff]/30 bg-[#1a2745]/95 text-[#a3b8ff]",
        toast.type === "success" && "border-emerald-400/25 bg-[#11271b]/95 text-emerald-300",
        toast.type === "error" && "border-red-400/25 bg-[#271111]/95 text-red-300",
      )}
    >
      {toast.type === "loading" && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
      {toast.type === "success" && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
      {toast.type === "error" && <AlertCircle className="mr-2 inline h-4 w-4" />}
      {toast.msg}
    </div>
  );
}
