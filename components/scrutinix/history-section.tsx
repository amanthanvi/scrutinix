"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { warmLinkParser } from "@/hooks/use-link-anatomy";
import { useScanHistory } from "@/hooks/use-scan-history";

const HistoryPanel = dynamic(
  () =>
    import("@/components/scrutinix/history-panel").then(
      (module) => module.HistoryPanel,
    ),
  {
    loading: () => (
      // Nothing visible while history loads: most visits have none.
      <div role="region" aria-label="Scan history" aria-busy="true" />
    ),
  },
);

export function HistorySection() {
  const { drainHistoryQueue, historyQueue, selectHistoryEntry } =
    useAnalyzerRuntime();
  const {
    addResult,
    canUndoClear,
    clearHistory,
    entries,
    filteredEntries,
    historyQuery,
    setHistoryQuery,
    undoClearHistory,
  } = useScanHistory();

  // An opened entry shows its link anatomy (and any look-alike hedge) at
  // once only if the parser is already here: load it as soon as there is
  // history to open, not on the click.
  const hasEntries = entries.length > 0;
  useEffect(() => {
    if (hasEntries) warmLinkParser();
  }, [hasEntries]);

  useEffect(() => {
    if (!historyQueue.length) return;
    for (const result of historyQueue) {
      void addResult(result);
    }
    drainHistoryQueue();
  }, [addResult, drainHistoryQueue, historyQueue]);

  return (
    <HistoryPanel
      entries={filteredEntries}
      totalCount={entries.length}
      historyQuery={historyQuery}
      onHistoryQueryChange={setHistoryQuery}
      onSelect={selectHistoryEntry}
      onClear={() => void clearHistory()}
      canUndoClear={canUndoClear}
      onUndoClear={() => void undoClearHistory()}
    />
  );
}
