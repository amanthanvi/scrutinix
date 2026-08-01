"use client";

import dynamic from "next/dynamic";
import { toast } from "sonner";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { SignalRow } from "@/components/scrutinix/signal-row";
import { VerdictPanel } from "@/components/scrutinix/verdict-panel";
import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import { Button } from "@/components/ui/button";
import { downloadTextFile } from "@/lib/client/export";
import { signalNames } from "@/lib/domain/types";

const BatchTable = dynamic(
  () =>
    import("@/components/scrutinix/batch-table").then(
      (module) => module.BatchTable,
    ),
  {
    loading: () => (
      <p className="text-[0.8125rem] text-[var(--sx-text-soft)]">
        Loading batch results…
      </p>
    ),
  },
);

export function ResultsSection() {
  const {
    active,
    activeTab,
    batch,
    done,
    live,
    rescanUrl,
    scan,
    setActiveTab,
    setSelectedResult,
    setSingleUrl,
    shareResult,
    sharedSnapshot,
    signals,
  } = useAnalyzerRuntime();

  const hasSignalActivity =
    scan.state.isStreaming ||
    signalNames.some((name) => signals[name].status !== "pending");

  return (
    <section className="flex flex-col gap-6">
      <p className="sr-only" aria-live="polite">
        {live
          ? `${done} of ${SIGNAL_COUNT} signals acquired so far.`
          : active
            ? `${done} of ${SIGNAL_COUNT} signals completed for the current result.`
            : "Awaiting scan."}
      </p>

      {activeTab === "single" ? (
        <div className="flex flex-col gap-1.5">
          <VerdictPanel
            result={active}
            isStreaming={scan.state.isStreaming}
            streamUrl={scan.state.url}
            sharedSnapshot={sharedSnapshot}
            completedSignals={done}
            onRunSharedScan={
              sharedSnapshot
                ? () => {
                    setSingleUrl(sharedSnapshot.url);
                    void rescanUrl(sharedSnapshot.url);
                  }
                : undefined
            }
          />
          {active ? (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  downloadTextFile(
                    "scan.json",
                    JSON.stringify(active, null, 2),
                    "application/json",
                  );
                  toast.success("Exported scan.json");
                }}
              >
                Export JSON
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void shareResult(active)}
              >
                Share
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void rescanUrl(active.url)}
              >
                Re-scan
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <BatchTable
          items={batch.state.items}
          isStreaming={batch.state.isStreaming}
          results={batch.state.results}
          onSelectResult={(result) => {
            setSelectedResult(result);
            setSingleUrl(result.url);
            setActiveTab("single");
          }}
        />
      )}

      {activeTab === "single" && hasSignalActivity ? (
        <div className="border-border divide-border divide-y rounded-lg border bg-[var(--sx-surface)]">
          {signalNames.map((signalName, index) => (
            <SignalRow
              key={signalName}
              name={signalName}
              result={signals[signalName]}
              index={index}
            />
          ))}
        </div>
      ) : activeTab === "single" && !sharedSnapshot ? (
        <p className="text-[0.8125rem] text-[var(--sx-text-soft)]">
          Results appear here.
        </p>
      ) : null}
    </section>
  );
}
