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
            "rounded-md border border-[var(--sx-control)] bg-[var(--sx-surface)] text-[var(--sx-text)] shadow-[0_6px_20px_-8px_rgb(0_0_0/0.25)]",
          title: "text-meta font-medium text-[var(--sx-text)]",
          description: "text-caption text-[var(--sx-text-muted)]",
          actionButton:
            "rounded-md bg-[var(--sx-button)] font-semibold text-[var(--sx-button-fg)]",
          cancelButton:
            "rounded-md border border-[var(--sx-border)] bg-transparent text-[var(--sx-text)]",
        },
      }}
    />
  );
}
