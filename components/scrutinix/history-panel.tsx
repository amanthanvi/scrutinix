"use client";

import { useEffect, useRef, useState } from "react";

import {
  downloadTextFile,
  resultsToCsv,
  resultsToJson,
} from "@/lib/client/export";
import { formatDisplayUrl } from "@/lib/domain/url";
import type { HistoryEntry } from "@/lib/domain/types";
import { verdictFg } from "@/components/shared/scrutinix-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface HistoryPanelProps {
  entries: HistoryEntry[];
  /** Full unfiltered history — exports always cover this list. */
  exportEntries: HistoryEntry[];
  totalCount: number;
  historyQuery: string;
  onHistoryQueryChange: (value: string) => void;
  onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
  canUndoClear: boolean;
  onUndoClear: () => void;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (d.toDateString() === now.toDateString()) {
    return time;
  }

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function HistoryPanel({
  entries,
  exportEntries,
  totalCount,
  historyQuery,
  onHistoryQueryChange,
  onSelect,
  onClear,
  canUndoClear,
  onUndoClear,
}: HistoryPanelProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  const handleClear = () => {
    if (confirmClear) {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      onClear();
      setConfirmClear(false);
      return;
    }

    setConfirmClear(true);
    clearTimerRef.current = setTimeout(() => {
      setConfirmClear(false);
      clearTimerRef.current = null;
    }, 3000);
  };

  return (
    <section aria-label="Scan history" role="region">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          History
          {totalCount > 0 ? (
            <span className="ml-2 font-mono text-xs font-normal text-[var(--sx-text-soft)] tabular-nums">
              {totalCount}
            </span>
          ) : null}
        </h2>

        <div className="flex items-center gap-1">
          {canUndoClear ? (
            <Button
              type="button"
              onClick={onUndoClear}
              variant="ghost"
              size="sm"
              aria-label="Undo clearing scan history"
            >
              Undo clear
            </Button>
          ) : null}
          {totalCount > 0 ? (
            <Button
              type="button"
              onClick={handleClear}
              variant="ghost"
              size="sm"
              className={
                confirmClear ? "text-[var(--sx-malicious-fg)]" : undefined
              }
              aria-label={
                confirmClear ? "Confirm clear all history" : "Clear all history"
              }
            >
              {confirmClear ? "Confirm clear" : "Clear"}
            </Button>
          ) : null}
        </div>
      </div>

      {canUndoClear ? (
        <p className="mt-2 text-[0.8125rem] text-[var(--sx-text-muted)]">
          History was cleared. Undo restores the previous list.
        </p>
      ) : null}

      {totalCount > 3 ? (
        <Input
          value={historyQuery}
          onChange={(event) => onHistoryQueryChange(event.target.value)}
          placeholder="Filter by URL or verdict"
          aria-label="Filter scan history"
          className="mt-3 h-9 text-[0.8125rem]"
        />
      ) : null}

      {entries.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-[var(--sx-text-soft)]">
          {historyQuery
            ? "No scans match this filter."
            : "Completed scans stay on this device and appear here."}
        </p>
      ) : (
        <>
          <ul className="border-border divide-border mt-3 divide-y border-y">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  className="hover:bg-muted/40 flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span
                    className="w-20 shrink-0 text-[0.8125rem] font-medium capitalize"
                    style={{ color: verdictFg(entry.verdict) }}
                  >
                    {entry.verdict}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-[var(--sx-text-muted)]">
                    {formatDisplayUrl(entry.url)}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-[var(--sx-text-soft)] tabular-nums">
                    {formatTimestamp(entry.savedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex items-center gap-1">
            <Button
              type="button"
              onClick={() =>
                downloadTextFile(
                  "scan-history.csv",
                  resultsToCsv(exportEntries),
                )
              }
              variant="ghost"
              size="sm"
              aria-label="Export history as CSV"
            >
              Export CSV
            </Button>
            <Button
              type="button"
              onClick={() =>
                downloadTextFile(
                  "scan-history.json",
                  resultsToJson(exportEntries),
                  "application/json",
                )
              }
              variant="ghost"
              size="sm"
              aria-label="Export history as JSON"
            >
              Export JSON
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
