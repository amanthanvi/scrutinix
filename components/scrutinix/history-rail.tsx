"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { Card, CardContent } from "@/components/ui/card";
import { useScanHistory } from "@/hooks/use-scan-history";

const HistoryPanel = dynamic(
  () =>
    import("@/components/scrutinix/history-panel").then(
      (module) => module.HistoryPanel,
    ),
  {
    loading: () => (
      <Card role="region" aria-label="Scan history" className="min-h-[22rem]">
        <CardContent className="px-5 py-6 text-xs text-[var(--sx-text-muted)]">
          Loading history console...
        </CardContent>
      </Card>
    ),
  },
);

export function HistoryRail() {
  const { historyQueue, drainHistoryQueue, selectHistoryEntry } =
    useAnalyzerRuntime();
  const {
    addResult,
    canUndoClear,
    clearHistory,
    filteredEntries,
    filterVerdict,
    historyQuery,
    setFilterVerdict,
    setHistoryQuery,
    undoClearHistory,
  } = useScanHistory();

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
      historyQuery={historyQuery}
      onHistoryQueryChange={setHistoryQuery}
      filterVerdict={filterVerdict}
      onFilterVerdictChange={setFilterVerdict}
      onSelect={selectHistoryEntry}
      onClear={() => void clearHistory()}
      canUndoClear={canUndoClear}
      onUndoClear={() => void undoClearHistory()}
    />
  );
}
