"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { SignalRow } from "@/components/scrutinix/signal-row";
import {
  VERDICT_HEADING_ID,
  VerdictPanel,
} from "@/components/scrutinix/verdict-panel";
import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import { describeQuietChecks } from "@/components/shared/signal-selection";
import { Button } from "@/components/ui/button";
import { downloadTextFile } from "@/lib/client/export";
import {
  signalNames,
  type AnalysisResult,
  type SignalName,
  type SignalResults,
} from "@/lib/domain/types";
import { getVerdictAnnouncement } from "@/lib/domain/verdict-guidance";

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

function RuntimeSignalRow<N extends SignalName>({
  index,
  name,
  scored,
  signals,
}: {
  index: number;
  name: N;
  scored: boolean;
  signals: SignalResults;
}) {
  return (
    <SignalRow
      name={name}
      result={signals[name]}
      index={index}
      scored={scored}
    />
  );
}

export function ResultsSection() {
  const {
    active,
    activeTab,
    batch,
    done,
    openStoredResult,
    rescanUrl,
    scan,
    setSingleUrl,
    setViewMode,
    shareResult,
    sharedSnapshot,
    signals,
    summarySelection,
    verdictFocusRequest,
    viewMode,
    visibleSignals,
  } = useAnalyzerRuntime();

  // A stored result (history, batch "Open") replaced the view: move focus
  // to its verdict so keyboard and screen-reader users land on the answer,
  // and blank the live region for a beat so the same text (reopening the
  // same entry) is a real change and gets spoken again. The region itself
  // stays mounted: a freshly inserted live region is announced unreliably.
  const [announcedRequest, setAnnouncedRequest] = useState(0);
  const reannouncing = verdictFocusRequest !== announcedRequest;
  useEffect(() => {
    if (verdictFocusRequest === 0) return;
    document.getElementById(VERDICT_HEADING_ID)?.focus();
    const timer = window.setTimeout(
      () => setAnnouncedRequest(verdictFocusRequest),
      100,
    );
    return () => window.clearTimeout(timer);
  }, [verdictFocusRequest]);

  // Revealing the quiet checks removes the button that did it; move focus
  // to the first newly revealed check that can expand, so keyboard users
  // land on new evidence rather than a row Summary already showed. If none
  // of the revealed rows expands, focus the list instead of <body>.
  const signalListRef = useRef<HTMLUListElement>(null);
  const revealedFromRef = useRef<ReadonlySet<SignalName> | null>(null);
  useEffect(() => {
    const shownBefore = revealedFromRef.current;
    if (!shownBefore || viewMode !== "full") return;
    revealedFromRef.current = null;
    const list = signalListRef.current;
    const target = Array.from(
      list?.querySelectorAll<HTMLElement>("li[data-signal]") ?? [],
    )
      .filter((row) => !shownBefore.has(row.dataset.signal as SignalName))
      .map((row) => row.querySelector<HTMLElement>("summary"))
      .find(Boolean);
    (target ?? list)?.focus();
  }, [viewMode]);

  const hasSignalActivity =
    scan.state.isStreaming ||
    signalNames.some((name) => signals[name].status !== "pending");
  const quietChecks =
    viewMode === "summary" ? describeQuietChecks(summarySelection) : null;

  return (
    <section className="flex flex-col gap-6">
      <p className="sr-only" aria-live="polite">
        {reannouncing
          ? ""
          : getLiveStatus({
              activeTab,
              active,
              scanStreaming: scan.state.isStreaming,
              done,
              batchStreaming: batch.state.isStreaming,
              batchDone: batch.state.results.length,
              batchTotal: batch.state.items.length,
            })}
      </p>

      {activeTab === "single" ? (
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
      ) : (
        <BatchTable
          items={batch.state.items}
          isStreaming={batch.state.isStreaming}
          results={batch.state.results}
          onSelectResult={openStoredResult}
        />
      )}

      {activeTab === "single" && hasSignalActivity ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={viewMode === "full"}
            onClick={() =>
              setViewMode(viewMode === "summary" ? "full" : "summary")
            }
            className="inline-flex min-h-11 items-center gap-5 self-start text-[0.8125rem] font-medium"
          >
            <span
              className={`border-b-2 px-1 py-1.5 ${
                viewMode === "summary"
                  ? "border-[var(--sx-accent)] text-[var(--sx-text)]"
                  : "border-transparent text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]"
              }`}
            >
              Summary
            </span>{" "}
            <span
              className={`border-b-2 px-1 py-1.5 ${
                viewMode === "full"
                  ? "border-[var(--sx-accent)] text-[var(--sx-text)]"
                  : "border-transparent text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]"
              }`}
            >
              Full
            </span>
            {/* Name stays "Summary Full …": visible text first (WCAG 2.5.3). */}
            <span className="sr-only"> signal list</span>
          </button>

          {visibleSignals.length > 0 ? (
            <ul
              ref={signalListRef}
              aria-label="Signals"
              tabIndex={-1}
              className="border-border divide-border divide-y border-y outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sx-accent)]"
            >
              {visibleSignals.map((signalName, index) => (
                <RuntimeSignalRow
                  key={signalName}
                  name={signalName}
                  signals={signals}
                  scored={summarySelection.scored.has(signalName)}
                  index={index}
                />
              ))}
            </ul>
          ) : null}

          {quietChecks ? (
            <button
              type="button"
              onClick={() => {
                revealedFromRef.current = new Set(summarySelection.drivers);
                setViewMode("full");
              }}
              className="self-start py-1 text-left text-[0.8125rem] text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]"
            >
              {quietChecks}{" "}
              <span className="text-[var(--sx-accent)] underline-offset-2 hover:underline">
                Show all checks
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {activeTab === "single" && active ? (
        <div className="-mt-2 flex flex-wrap items-center gap-1">
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
              toast.success("Downloaded scan.json");
            }}
          >
            Download result (JSON)
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
    </section>
  );
}

/** Polite live-region text: progress while streaming, the shown verdict after. */
function getLiveStatus({
  activeTab,
  active,
  scanStreaming,
  done,
  batchStreaming,
  batchDone,
  batchTotal,
}: {
  activeTab: "single" | "batch";
  active: AnalysisResult | null;
  scanStreaming: boolean;
  done: number;
  batchStreaming: boolean;
  batchDone: number;
  batchTotal: number;
}): string {
  if (activeTab === "batch") {
    if (batchStreaming) {
      return `${batchDone} of ${batchTotal} links scanned.`;
    }
    return batchTotal > 0
      ? `Batch complete: ${batchDone} of ${batchTotal} links scanned.`
      : "";
  }

  // A displayed result outranks progress, matching the verdict panel: an
  // opened saved result is announced even while a scan streams behind it.
  if (scanStreaming && !active) {
    return `${done} of ${SIGNAL_COUNT} checks finished.`;
  }

  return active ? getVerdictAnnouncement(active) : "";
}
