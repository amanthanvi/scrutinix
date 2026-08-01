"use client";

import { clsx } from "clsx";
import dynamic from "next/dynamic";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { VerdictHero } from "@/components/scrutinix/verdict-hero";
import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import { Card, CardContent } from "@/components/ui/card";

const BatchPanel = dynamic(
  () =>
    import("@/components/scrutinix/batch-panel").then(
      (module) => module.BatchPanel,
    ),
  {
    loading: () => (
      <Card>
        <CardContent className="px-5 py-6 text-xs text-[var(--sx-text-muted)]">
          Initializing batch console...
        </CardContent>
      </Card>
    ),
  },
);

const SignalCard = dynamic(
  () =>
    import("@/components/scrutinix/signal-card").then(
      (module) => module.SignalCard,
    ),
  {
    loading: () => (
      <Card className="border-dashed">
        <CardContent className="px-5 py-6 text-xs text-[var(--sx-text-muted)]">
          Resolving signal...
        </CardContent>
      </Card>
    ),
  },
);

export function AnalyzerWorkspace() {
  const {
    active,
    activeTab,
    batch,
    live,
    rescanUrl,
    scan,
    selectHistoryEntry,
    setViewMode,
    sharedSnapshot,
    signals,
    viewMode,
    visibleSignals,
    done,
  } = useAnalyzerRuntime();

  return (
    <section className="space-y-7">
      <div className="min-w-0">
        {activeTab === "single" ? (
          <VerdictHero
            result={active}
            isStreaming={scan.state.isStreaming}
            streamUrl={scan.state.url}
            sharedSnapshot={sharedSnapshot}
            completedSignals={done}
            onRunSharedScan={
              sharedSnapshot
                ? () => void rescanUrl(sharedSnapshot.url)
                : undefined
            }
          />
        ) : (
          <BatchPanel
            items={batch.state.items}
            isStreaming={batch.state.isStreaming}
            results={batch.state.results}
            onSelectResult={selectHistoryEntry}
          />
        )}
      </div>

      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs text-[var(--sx-text-muted)]">
              {activeTab === "single" ? "Signals" : "Batch"}
            </p>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-[var(--sx-text)] sm:text-2xl">
              {activeTab === "single"
                ? "Each signal resolves on its own."
                : "Inspect a finished row when it matters."}
            </h2>
          </div>

          {activeTab === "single" ? (
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <span
                className="text-xs font-medium text-[var(--sx-text-muted)]"
                id="signal-lanes-view-label"
              >
                View
              </span>
              <div
                className="flex items-center gap-2"
                role="group"
                aria-labelledby="signal-lanes-view-label"
              >
                <span
                  className={clsx(
                    "text-xs tabular-nums",
                    viewMode === "summary"
                      ? "font-semibold text-[var(--sx-text)]"
                      : "text-[var(--sx-text-muted)]",
                  )}
                >
                  Summary
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={viewMode === "full"}
                  aria-labelledby="signal-lanes-view-label"
                  onClick={() =>
                    setViewMode(viewMode === "summary" ? "full" : "summary")
                  }
                  className={clsx(
                    "border-border relative inline-block h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sx-active-accent)]",
                    viewMode === "full"
                      ? "bg-[color-mix(in_srgb,var(--sx-active-accent)_22%,transparent)]"
                      : "bg-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className={clsx(
                      "pointer-events-none absolute top-1 left-1 h-5 w-5 rounded-full bg-[var(--sx-text)] shadow transition-transform duration-200 ease-out",
                      viewMode === "full" ? "translate-x-5" : "translate-x-0",
                    )}
                  />
                </button>
                <span
                  className={clsx(
                    "text-xs tabular-nums",
                    viewMode === "full"
                      ? "font-semibold text-[var(--sx-text)]"
                      : "text-[var(--sx-text-muted)]",
                  )}
                >
                  Full
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {activeTab === "single" ? (
          <div className="transition-opacity duration-150">
            <p className="sr-only" aria-live="polite">
              {live
                ? `${done} of ${SIGNAL_COUNT} signals acquired so far.`
                : active
                  ? `${done} of ${SIGNAL_COUNT} signals completed for the current result.`
                  : "Awaiting scan."}
            </p>
            {visibleSignals.length > 0 ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {visibleSignals.map((signalName, index) => (
                  <SignalCard
                    key={signalName}
                    name={signalName}
                    result={signals[signalName]}
                    viewMode={viewMode}
                    isStreaming={live}
                    index={index}
                  />
                ))}
              </div>
            ) : (
              <div className="sx-panel rounded-lg border border-dashed border-[var(--sx-border-muted)] px-6 py-14 text-center">
                <p className="text-sm font-medium text-[var(--sx-text)]">
                  No signals yet
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--sx-text-muted)]">
                  Paste a URL above to start. Cards appear here as each provider
                  finishes.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="sx-panel rounded-lg border border-dashed border-[var(--sx-border-muted)] px-6 py-14 text-center">
            <p className="text-sm font-medium text-[var(--sx-text)]">
              Batch rows stay isolated
            </p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--sx-text-muted)]">
              Each queued URL can finish, fail, or error without stopping the
              rest. Open any completed row in single-scan mode for the full
              result.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}
