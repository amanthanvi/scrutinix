"use client";

import {
  ROW_LAYOUT,
  ROW_TRAILING,
  RowLink,
  RowVerdict,
  useRowAnatomy,
} from "@/components/scrutinix/result-row";
import { SignalGlyph } from "@/components/scrutinix/signal-strip";
import { Button } from "@/components/ui/button";
import { formatDisplayUrl } from "@/lib/domain/url";
import type { AnalysisResult } from "@/lib/domain/types";
import { isLookAlikeSafe } from "@/lib/domain/verdict-guidance";
import { cn } from "@/lib/utils";

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

/**
 * Batch results. A row without a result is "Checking" only while the batch
 * runs; once it stops (finished, cancelled, rate-limited, or failed) such a
 * row is "Not checked" and stops animating, and the header says the batch
 * stopped rather than claiming results.
 */
export function BatchTable({
  items,
  isStreaming,
  results,
  onSelectResult,
}: BatchTableProps) {
  if (items.length === 0) {
    return null;
  }

  const stopped = !isStreaming && results.length < items.length;

  return (
    <section aria-label="Batch scan results" className="sx-enter">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--sx-border)] pb-3">
        <h2 className="text-title font-semibold text-[var(--sx-text)]">
          {isStreaming
            ? "Checking links"
            : stopped
              ? "Batch stopped"
              : "Batch results"}
        </h2>
        <p className="text-meta font-mono text-[var(--sx-text-muted)]">
          {results.length}/{items.length}
        </p>
      </div>

      <ul className="divide-y divide-[var(--sx-border)] border-b border-[var(--sx-border)]">
        {items.map((item) => (
          <BatchRow
            key={`${item.index}-${item.url}`}
            item={item}
            isStreaming={isStreaming}
            onSelectResult={onSelectResult}
          />
        ))}
      </ul>
    </section>
  );
}

function BatchRow({
  item,
  isStreaming,
  onSelectResult,
}: {
  item: BatchItem;
  isStreaming: boolean;
  onSelectResult: (result: AnalysisResult) => void;
}) {
  const anatomy = useRowAnatomy(item.url);
  const impersonates = anatomy?.impersonates ?? null;
  const live = !item.result && isStreaming;
  const lookAlike = item.result
    ? isLookAlikeSafe({ verdict: item.result.verdict, impersonates })
    : false;

  return (
    <li className={cn(ROW_LAYOUT, "py-1.5")}>
      <span className="text-caption hidden w-5 shrink-0 font-mono text-[var(--sx-text-soft)] sm:inline">
        {item.index + 1}
      </span>
      <SignalGlyph
        result={item.result}
        className={live ? "sx-live" : undefined}
      />
      <RowVerdict
        verdict={item.result?.verdict ?? null}
        impersonates={impersonates}
        label={isStreaming ? "Checking" : "Not checked"}
      />
      <RowLink url={item.url} anatomy={anatomy} />
      {item.result ? (
        <Button
          type="button"
          onClick={() => {
            if (item.result) onSelectResult(item.result);
          }}
          variant="ghost"
          size="sm"
          className={cn(ROW_TRAILING, "-mr-2.5")}
          aria-label={`Open result for ${formatDisplayUrl(item.url)}${lookAlike ? " (look-alike link)" : ""}`}
        >
          Open
        </Button>
      ) : (
        <span aria-hidden="true" className={cn(ROW_TRAILING, "w-12")} />
      )}
    </li>
  );
}
