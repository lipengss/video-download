import * as React from "react";
import { useEffect, useRef } from "react";
import { useOverlayScrollbars } from "overlayscrollbars-react";
import "overlayscrollbars/overlayscrollbars.css";
import { cn } from "../../lib/utils";
import { Textarea } from "./textarea";

const scrollbarOptions = {
  scrollbars: { autoHide: "leave" as const, theme: "os-theme-light" },
};

export type ScrollableTextareaProps = React.ComponentProps<typeof Textarea>;

export const ScrollableTextarea = React.forwardRef<HTMLTextAreaElement, ScrollableTextareaProps>(
  ({ className, style, ...props }, forwardedRef) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [initialize, getInstance] = useOverlayScrollbars({ options: scrollbarOptions });

    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      initialize(el);
      return () => {
        getInstance()?.destroy();
      };
    }, [initialize, getInstance]);

    return (
      <Textarea
        ref={setRef}
        className={cn("overflow-hidden [&::-webkit-scrollbar]:hidden", className)}
        style={{ scrollbarWidth: "none", ...style }}
        {...props}
      />
    );
  },
);

ScrollableTextarea.displayName = "ScrollableTextarea";
