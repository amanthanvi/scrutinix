"use client";

import { clsx } from "clsx";
import type { CSSProperties, ReactNode } from "react";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";

export function AnalyzerChrome({ children }: { children: ReactNode }) {
  const { accentColor, isMalicious } = useAnalyzerRuntime();

  return (
    <div
      className={clsx(
        "sx-casefile flex min-h-screen flex-col",
        isMalicious && "sx-alert",
      )}
      style={{ "--sx-active-accent": accentColor } as CSSProperties}
    >
      {children}
    </div>
  );
}
