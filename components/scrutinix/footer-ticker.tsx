"use client";

import { AppFooter } from "@/components/scrutinix/app-footer";
import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";

/**
 * Quiet footer status — last signal note only. No marquee ticker.
 */
export function FooterTicker() {
  const { live, ticker } = useAnalyzerRuntime();
  const latest = ticker.length > 0 ? ticker[ticker.length - 1] : null;

  return (
    <AppFooter>
      <p className="sx-font-hack w-full text-right text-[11px] leading-5 text-[var(--sx-text-soft)] tabular-nums">
        {latest ? (
          <>
            <span className="text-[var(--sx-text-muted)]">{latest.time}</span>
            <span
              className="mx-1.5 text-[var(--sx-border-muted)]"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="text-[var(--sx-text-muted)]">{latest.text}</span>
          </>
        ) : (
          <>
            {SIGNAL_COUNT} signals
            <span
              className="mx-1.5 text-[var(--sx-border-muted)]"
              aria-hidden="true"
            >
              ·
            </span>
            {live ? "Stream active" : "Idle"}
          </>
        )}
      </p>
    </AppFooter>
  );
}
