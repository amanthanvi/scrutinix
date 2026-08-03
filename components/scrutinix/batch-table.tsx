"use client";

import { formatDisplayUrl } from "@/lib/domain/url";
import type { AnalysisResult } from "@/lib/domain/types";
import { verdictFg } from "@/components/shared/scrutinix-types";
import { Button } from "@/components/ui/button";

interface BatchItem {
  index: number;
  url: string;
  status: "pending" | "complete";
  result: AnalysisResult | null;
}

interface BatchTableProps {
  items: BatchItem[];
  isStreaming: boolean;
  results: AnalysisResult[];
  onSelectResult: (result: AnalysisResult) => void;
}

export function BatchTable({
  items,
  isStreaming,
  results,
  onSelectResult,
}: BatchTableProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-label="Batch scan results" className="sx-enter">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[0.8125rem] text-[var(--sx-text-muted)]">
          {isStreaming ? "Scanning batch" : "Batch complete"}
        </p>
        <p className="font-mono text-xs text-[var(--sx-text-muted)] tabular-nums">
          {results.length}/{items.length}
        </p>
      </div>

      {isStreaming ? (
        <div className="sx-progress mt-2 rounded-full" aria-hidden="true">
          <span
            style={{ transform: `scaleX(${results.length / items.length})` }}
          />
        </div>
      ) : null}

      <ul className="border-border divide-border mt-3 divide-y border-y">
        {items.map((item) => (
          <li
            key={`${item.index}-${item.url}`}
            className="flex items-center gap-3 py-2"
          >
            <span className="w-5 shrink-0 font-mono text-xs text-[var(--sx-text-soft)] tabular-nums">
              {item.index + 1}
            </span>
            <span
              className="w-20 shrink-0 text-[0.8125rem] font-medium capitalize"
              style={{
                color: item.result
                  ? verdictFg(item.result.verdict)
                  : "var(--sx-text-muted)",
              }}
            >
              {item.result ? item.result.verdict : "Queued"}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-[var(--sx-text-muted)]">
              {formatDisplayUrl(item.url)}
            </span>
            {item.result ? (
              <Button
                type="button"
                onClick={() => {
                  if (item.result) onSelectResult(item.result);
                }}
                variant="ghost"
                size="sm"
                className="shrink-0"
              >
                Open
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
