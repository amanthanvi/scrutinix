"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { useScanHistory } from "@/hooks/use-scan-history";

const HistoryPanel = dynamic(
  () =>
    import("@/components/scrutinix/history-panel").then(
      (module) => module.HistoryPanel,
    ),
  {
    loading: () => (
      <div
        role="region"
        aria-label="Scan history"
        className="text-[0.8125rem] text-[var(--sx-text-soft)]"
      >
        Loading history…
      </div>
    ),
  },
);

export function HistorySection() {
  const { historyEvent, selectHistoryEntry } = useAnalyzerRuntime();
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

  useEffect(() => {
    if (!historyEvent) return;
    void addResult(historyEvent.result);
  }, [addResult, historyEvent]);

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
