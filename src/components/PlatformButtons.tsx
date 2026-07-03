import { PLATFORMS } from "../lib/constants";
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from "./ui/tooltip";

export function PlatformButtons() {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex gap-4">
        {PLATFORMS.map((p) => (
          <TooltipRoot key={p.name}>
            <TooltipTrigger asChild>
              <button
                className="flex h-11 w-11 items-center justify-center rounded-full font-semibold shadow-[0_10px_28px_rgba(0,0,0,0.18)] transition hover:-translate-y-0.5 hover:brightness-110"
                style={{ background: p.bg }}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full">
                  <img src={p.icon} className="h-7 w-7" referrerPolicy="no-referrer" />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{p.label}</p>
            </TooltipContent>
          </TooltipRoot>
        ))}
      </div>
    </TooltipProvider>
  );
}
