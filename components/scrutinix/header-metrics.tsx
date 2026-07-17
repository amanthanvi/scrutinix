"use client";

import { clsx } from "clsx";

import { AppHeader } from "@/components/scrutinix/app-header";
import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import { Badge } from "@/components/ui/badge";

export function HeaderMetrics() {
  const { done, live, score, scoreColor } = useAnalyzerRuntime();
  const hasActivity = live || done > 0;
  const clampedScore = Math.min(Math.max(score, 0), 100);
  const readinessLabel = live ? "Live" : hasActivity ? "Complete" : "Idle";
  const readinessVariant = live
    ? ("active" as const)
    : hasActivity
      ? ("safe" as const)
      : ("neutral" as const);
  const coverageText = hasActivity
    ? `${done}/${SIGNAL_COUNT} signals`
    : "Awaiting scan";
  const meterLabel = hasActivity ? `${clampedScore}/100` : "Awaiting scan";
  const meterValueText = hasActivity
    ? `${clampedScore} out of 100`
    : "Awaiting scan";

  return (
    <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-0">
      <div className="flex min-w-0 flex-1 flex-col justify-center sm:pr-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--sx-text-muted)]">
            Threat score
          </span>
          <span className="sx-font-hack text-xs text-[var(--sx-text)] tabular-nums">
            {meterLabel}
          </span>
        </div>
        <div
          role="meter"
          aria-label="Threat score"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hasActivity ? clampedScore : 0}
          aria-valuetext={meterValueText}
          className={clsx(
            "relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[var(--sx-border)]",
            !hasActivity &&
              "ring-dashed ring-1 ring-[var(--sx-border-muted)] ring-inset",
          )}
        >
          <div
            className="sx-threat-fill absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-500 ease-out"
            style={{
              width: `${hasActivity ? clampedScore : 0}%`,
              backgroundColor: hasActivity
                ? scoreColor
                : "var(--sx-border-muted)",
            }}
          />
        </div>
      </div>

      <div
        className="bg-border hidden w-px shrink-0 sm:block sm:self-stretch"
        aria-hidden="true"
      />

      <div className="flex flex-wrap items-center gap-2 sm:min-w-[11rem] sm:flex-none sm:justify-end sm:self-center sm:pl-6">
        <Badge variant={readinessVariant}>{readinessLabel}</Badge>
        <span className="sx-font-hack text-xs tracking-[0.08em] text-[var(--sx-text-muted)] tabular-nums">
          {coverageText}
        </span>
      </div>
    </div>
  );
}

export function ShellHeader() {
  const { done, live, score, scoreColor } = useAnalyzerRuntime();
  const hasActivity = live || done > 0;

  return (
    <AppHeader
      threatScore={Math.min(Math.max(score, 0), 100)}
      scoreColor={hasActivity ? scoreColor : undefined}
      hasActivity={hasActivity}
    />
  );
}
