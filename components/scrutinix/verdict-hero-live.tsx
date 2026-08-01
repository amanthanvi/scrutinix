"use client";

import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import { ScoreRing } from "@/components/scrutinix/score-ring";
import { formatDisplayUrl } from "@/lib/domain/url";

export function VerdictHeroIdle() {
  return (
    <section
      className="sx-panel rounded-lg border border-dashed border-[var(--sx-border-muted)] px-6 py-8 sm:px-8"
      aria-label="Awaiting target URL"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
        <div className="space-y-3">
          <p className="sx-label">Waiting</p>
          <h2 className="max-w-2xl text-2xl font-semibold tracking-[-0.02em] text-balance text-[var(--sx-text)]">
            Paste a link above to start.
          </h2>
        </div>

        <div className="flex flex-col items-center gap-3">
          <ScoreRing score={0} color="var(--sx-border-muted)" isIdle />
        </div>
      </div>
    </section>
  );
}

interface VerdictHeroStreamingProps {
  streamUrl: string;
  completedSignals: number;
}

export function VerdictHeroStreaming({
  streamUrl,
  completedSignals,
}: VerdictHeroStreamingProps) {
  const displayUrl = formatDisplayUrl(streamUrl);
  const progress = Math.min(
    100,
    Math.max(0, (completedSignals / SIGNAL_COUNT) * 100),
  );

  return (
    <section
      className="sx-panel rounded-lg border border-[var(--sx-accent)] px-6 py-6 sm:px-8"
      aria-label="Scanning URL"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div className="space-y-5">
          <p className="sx-pulse sx-label text-[var(--sx-accent)]">
            Stream in progress
          </p>
          <h2 className="truncate text-2xl font-semibold tracking-[-0.02em] text-[var(--sx-text)] sm:text-3xl">
            {displayUrl}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-[var(--sx-text-muted)]">
            Signals resolve independently. Cards below fill as each provider
            completes, errors, or marks itself not-applicable.
          </p>
          <div className="max-w-xl">
            <div className="flex items-center justify-between gap-3 text-xs text-[var(--sx-text-muted)]">
              <span>Signal coverage</span>
              <span className="sx-font-hack tabular-nums">
                {completedSignals}/{SIGNAL_COUNT} complete
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--sx-border)]">
              <div
                className="h-full rounded-full bg-[var(--sx-active-accent)] transition-[width] duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="border-border bg-card flex flex-col items-center gap-3 rounded-lg border px-5 py-5">
          <p className="text-xs text-[var(--sx-text-muted)]">Live status</p>
          <ScoreRing
            score={completedSignals}
            color="var(--sx-accent)"
            isStreaming
          />
          <p className="sx-font-hack text-sm text-[var(--sx-text-soft)] tabular-nums">
            {completedSignals}/{SIGNAL_COUNT} signals
          </p>
        </div>
      </div>
    </section>
  );
}
