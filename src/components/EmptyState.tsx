import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  className?: string;
}

export function EmptyState({ icon, title, description, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-[10px] border border-dashed border-white/[0.08] bg-[#111827]/70 text-center",
        className,
      )}
    >
      <div>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1d2a40] text-[#6387ff]">
          {icon}
        </div>
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="mt-1 text-xs text-[#667897]">{description}</p>}
      </div>
    </div>
  );
}
