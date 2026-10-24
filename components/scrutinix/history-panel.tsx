"use client";

import { useEffect, useRef, useState } from "react";

import {
  downloadTextFile,
  resultsToCsv,
  resultsToJson,
} from "@/lib/client/export";
import type { HistoryEntry } from "@/lib/domain/types";
import {
  ROW_LAYOUT,
  ROW_TRAILING,
  RowLink,
  RowVerdict,
  useRowAnatomy,
} from "@/components/scrutinix/result-row";
import { SignalGlyph } from "@/components/scrutinix/signal-strip";
import { loadLinkParser } from "@/hooks/use-link-anatomy";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface HistoryPanelProps {
  entries: HistoryEntry[];
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

function HistoryRow({
  entry,
  onSelect,
}: {
  entry: HistoryEntry;
  onSelect: (entry: HistoryEntry) => void;
}) {
  const { anatomy, status: anatomyStatus } = useRowAnatomy(entry.url);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(entry)}
        className={cn(
          ROW_LAYOUT,
          "-mx-[12px] w-[calc(100%+24px)] rounded-[3px] px-[12px] py-3 text-left transition-colors hover:bg-[var(--sx-subtle)]",
        )}
      >
        <SignalGlyph result={entry} />
        <RowVerdict
          verdict={entry.verdict}
          impersonates={anatomy?.impersonates ?? null}
          anatomyStatus={anatomyStatus}
        />
        <RowLink url={entry.url} anatomy={anatomy} />
        <span
          className={cn(
            ROW_TRAILING,
            "text-caption font-mono text-[var(--sx-text-soft)]",
          )}
        >
          {formatTimestamp(entry.savedAt)}
        </span>
      </button>
    </li>
  );
}

export function HistoryPanel({
  entries,
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

  // Absence is the empty state: with nothing saved and nothing to undo, the
  // region stays in the page (landmark and tests) but draws nothing.
  if (totalCount === 0 && !canUndoClear) {
    return <section aria-label="Scan history" />;
  }

  return (
    <section aria-label="Scan history">
      <div className="flex min-h-11 flex-wrap items-end justify-between gap-x-3 gap-y-1 border-b border-[var(--sx-text)] pb-2">
        <h2 className="sx-section-title">
          History
          {totalCount > 0 ? (
            <>
              <span
                aria-hidden="true"
                className="text-meta ml-2 font-mono font-normal text-[var(--sx-text-soft)]"
              >
                {totalCount}
              </span>
              {/* Name reads "History (2 scans)", not "History2". */}
              <span className="sr-only">
                {totalCount === 1 ? " (1 scan)" : ` (${totalCount} scans)`}
              </span>
            </>
          ) : null}
        </h2>

        <div className="-mr-[10px] flex items-center gap-1">
          {canUndoClear ? (
            <Button
              type="button"
              onClick={onUndoClear}
              variant="ghost"
              size="sm"
              aria-label="Undo clear history"
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
                confirmClear
                  ? "text-[var(--sx-danger-fg)] hover:text-[var(--sx-danger-fg)]"
                  : undefined
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
        <p className="text-meta mt-3 text-[var(--sx-text-muted)]">
          History was cleared. Undo restores the previous list.
        </p>
      ) : null}

      {totalCount > 3 ? (
        <Input
          id="sx-history-filter"
          name="history-filter"
          type="search"
          value={historyQuery}
          onChange={(event) => onHistoryQueryChange(event.target.value)}
          placeholder="Filter by link or verdict"
          aria-label="Filter scan history"
          className="mt-4 h-11"
        />
      ) : null}

      {entries.length === 0 ? (
        historyQuery ? (
          <p className="text-body mt-3 text-[var(--sx-text-soft)]">
            No scans match this filter.
          </p>
        ) : null
      ) : (
        <>
          <ul
            className={cn(
              "divide-y divide-[var(--sx-border)] border-b border-[var(--sx-border)]",
              totalCount > 3 && "mt-3 border-t",
            )}
          >
            {entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} onSelect={onSelect} />
            ))}
          </ul>

          <div className="mt-2 -ml-[10px] flex flex-wrap items-center gap-1">
            <Button
              type="button"
              onClick={async () => {
                // Waits for the address parser, so a cold visit's export
                // still names every look-alike.
                const parse = await loadLinkParser();
                downloadTextFile(
                  "scan-history.csv",
                  resultsToCsv(entries, parse),
                );
              }}
              variant="ghost"
              size="sm"
              className="h-auto max-w-full py-1.5 whitespace-normal"
            >
              {historyQuery
                ? "Export filtered history CSV"
                : "Export history CSV"}
            </Button>
            <Button
              type="button"
              onClick={() =>
                downloadTextFile(
                  "scan-history.json",
                  resultsToJson(entries),
                  "application/json",
                )
              }
              variant="ghost"
              size="sm"
              className="h-auto max-w-full py-1.5 whitespace-normal"
            >
              {historyQuery
                ? "Export filtered history JSON"
                : "Export history JSON"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
