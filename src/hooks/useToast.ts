import { useCallback, useState } from "react";

export type ToastType = "success" | "error" | "loading" | string;

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);

  const showToast = useCallback((msg: string, type: ToastType) => {
    setToast({ msg, type });
    if (type !== "loading") {
      window.setTimeout(() => setToast(null), 2600);
    }
  }, []);

  return { toast, showToast, clearToast: () => setToast(null) };
}
