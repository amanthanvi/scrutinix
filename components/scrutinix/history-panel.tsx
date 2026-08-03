"use client";

import { Database, Download, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  downloadTextFile,
  resultsToCsv,
  resultsToJson,
} from "@/lib/client/export";
import { formatDisplayUrl } from "@/lib/domain/url";
import type { HistoryEntry, Verdict } from "@/lib/domain/types";
import { verdictColor, verdictInk } from "@/components/shared/scrutinix-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface HistoryPanelProps {
  entries: HistoryEntry[];
  historyQuery: string;
  onHistoryQueryChange: (value: string) => void;
  filterVerdict: Verdict | "all";
  onFilterVerdictChange: (value: Verdict | "all") => void;
  onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
  canUndoClear: boolean;
  onUndoClear: () => void;
}

const verdictFilters = [
  "all",
  "safe",
  "suspicious",
  "malicious",
  "critical",
  "unknown",
  "error",
] as const;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (sameDay) {
    return `Today ${time}`;
  }

  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${time}`;
  }

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryPanel({
  entries,
  historyQuery,
  onHistoryQueryChange,
  filterVerdict,
  onFilterVerdictChange,
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

  const statusText = historyQuery
    ? `Filtering: "${historyQuery}"`
    : `${entries.length} scan${entries.length === 1 ? "" : "s"} on this device`;

  return (
    <section
      className="sx-panel border-border flex h-full max-h-[calc(100vh-7.5rem)] min-h-[24rem] flex-col overflow-hidden rounded-lg border"
      aria-label="Scan history"
      role="region"
    >
      <div className="border-border border-b px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-[var(--sx-text)]">
                History
              </h2>
              <Badge variant="neutral">{entries.length}</Badge>
            </div>
            <p className="text-sm leading-6 text-[var(--sx-text-soft)]">
              {statusText}
            </p>
            {canUndoClear ? (
              <p className="text-sm leading-6 text-[var(--sx-text-soft)]">
                History was cleared. Undo restores the previous list.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
            {entries.length > 0 ? (
              <>
                <Button
                  type="button"
                  onClick={() =>
                    downloadTextFile("scan-history.csv", resultsToCsv(entries))
                  }
                  variant="subtle"
                  size="sm"
                  aria-label="Export history as CSV"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
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
                  variant="subtle"
                  size="sm"
                  aria-label="Export history as JSON"
                >
                  <Download className="h-3.5 w-3.5" />
                  JSON
                </Button>
                <Button
                  type="button"
                  onClick={handleClear}
                  variant={confirmClear ? "dangerSolid" : "danger"}
                  size="sm"
                  aria-label={
                    confirmClear
                      ? "Confirm clear all history"
                      : "Clear all history"
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {confirmClear ? "Confirm" : "Clear"}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <Input
            value={historyQuery}
            onChange={(event) => onHistoryQueryChange(event.target.value)}
            placeholder="Filter by URL or verdict"
            aria-label="Filter scan history"
            className="h-10"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {verdictFilters.map((tone) => (
            <Button
              key={tone}
              type="button"
              onClick={() => onFilterVerdictChange(tone)}
              aria-pressed={filterVerdict === tone}
              variant={filterVerdict === tone ? "view" : "ghost"}
              size="sm"
              className="rounded-md"
            >
              {tone}
            </Button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 py-4">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[var(--sx-border-muted)] px-5 py-10 text-center">
            <Database
              className="h-7 w-7 text-[var(--sx-border-muted)]"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-[var(--sx-text)]">
              {historyQuery || filterVerdict !== "all"
                ? "No matching scans"
                : canUndoClear
                  ? "History cleared"
                  : "No recent scans"}
            </p>
            <p className="max-w-[28ch] text-sm leading-6 text-[var(--sx-text-muted)]">
              {historyQuery || filterVerdict !== "all"
                ? "Try a different filter or clear the search."
                : canUndoClear
                  ? "Undo is still available for this session."
                  : "Completed scans stay on this device and appear here."}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-full pr-1">
            <div className="space-y-3 pr-2">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelect(entry)}
                  className="group border-border bg-card hover:bg-muted/40 w-full rounded-lg border px-4 py-4 text-left transition hover:border-[var(--sx-active-accent)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-[var(--sx-text-muted)]">
                      {formatTimestamp(entry.savedAt)}
                    </span>
                    <span
                      className="rounded-md px-2.5 py-1 text-[0.65rem] font-medium tracking-[0.08em] uppercase"
                      style={{
                        color: verdictInk(entry.verdict),
                        backgroundColor: `color-mix(in srgb, ${verdictColor(entry.verdict)} 12%, transparent)`,
                      }}
                    >
                      {entry.verdict}
                    </span>
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--sx-text)] transition-colors group-hover:text-[var(--sx-active-accent)]">
                    {formatDisplayUrl(entry.url)}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--sx-text-soft)]">
                    <span className="sx-font-hack">
                      Score {entry.threatInfo?.score ?? "--"}
                    </span>
                    <span className="capitalize">
                      {entry.threatInfo?.confidenceLabel ?? "n/a"} confidence
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </section>
  );
}
