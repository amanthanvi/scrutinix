"use client";

import { useEffect } from "react";
import { toasterReady } from "@/components/ui/lazy-toaster";
import { Toaster } from "sonner";
export { toast } from "sonner";
import { useTheme } from "next-themes";

export default function AppToaster() {
  const { resolvedTheme } = useTheme();
  useEffect(toasterReady, []);

  return (
    <Toaster
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position="bottom-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "rounded-lg border border-[var(--sx-border)] bg-[var(--sx-surface)] text-[var(--sx-text)] shadow-lg",
          title: "text-sm font-medium text-[var(--sx-text)]",
          description: "text-xs text-[var(--sx-text-muted)]",
          actionButton:
            "rounded-md bg-[var(--sx-accent)] text-[var(--sx-accent-fg)]",
          cancelButton:
            "rounded-md border border-[var(--sx-border)] bg-transparent text-[var(--sx-text)]",
        },
      }}
    />
  );
}
