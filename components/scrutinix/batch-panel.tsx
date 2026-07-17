"use client";

import { ExternalLink, Layers } from "lucide-react";

import { formatDisplayUrl } from "@/lib/domain/url";
import type { AnalysisResult } from "@/lib/domain/types";
import { verdictInk } from "@/components/shared/scrutinix-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface BatchItem {
  index: number;
  url: string;
  status: "pending" | "complete";
  result: AnalysisResult | null;
}

interface BatchPanelProps {
  items: BatchItem[];
  isStreaming: boolean;
  results: AnalysisResult[];
  onSelectResult: (result: AnalysisResult) => void;
}

export function BatchPanel({
  items,
  isStreaming,
  results,
  onSelectResult,
}: BatchPanelProps) {
  if (items.length === 0) {
    return (
      <section className="sx-panel flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--sx-border-muted)] px-6 py-10 text-center">
        <Layers
          className="h-6 w-6 text-[var(--sx-border-muted)]"
          aria-hidden="true"
        />
        <h2 className="text-xs text-[var(--sx-text-muted)]">
          Batch results will appear here
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-6 text-[var(--sx-text-soft)]">
          Queue multiple URLs, let each row resolve independently, and inspect a
          finished verdict without collapsing the rest of the stream.
        </p>
      </section>
    );
  }

  const progressPct =
    items.length > 0 ? Math.min(100, (results.length / items.length) * 100) : 0;

  return (
    <section
      aria-label="Batch scan results"
      className="sx-panel border-border overflow-hidden rounded-xl border"
    >
      <div className="border-border border-b px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-3">
            <p className="text-xs text-[var(--sx-text-muted)]">Batch stream</p>
            <h2 className="sx-font-sans text-2xl font-semibold text-[var(--sx-text)]">
              {results.length}/{items.length} complete
            </h2>
            <p className="text-sm leading-6 text-[var(--sx-text-soft)]">
              Finished rows can be inspected immediately in single-scan mode
              while the rest of the queue keeps running.
            </p>
          </div>
          <Badge variant={isStreaming ? "active" : "safe"}>
            {isStreaming ? "In progress" : "Complete"}
          </Badge>
        </div>

        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-[var(--sx-border)]">
          <div
            className="h-full rounded-full bg-[var(--sx-active-accent)] transition-[width] duration-300"
            style={{
              width: `${progressPct}%`,
            }}
          />
        </div>
      </div>

      <ScrollArea className="w-full">
        <div className="min-w-[720px]">
          <div className="border-border grid grid-cols-[60px_minmax(0,1fr)_110px_130px_120px] gap-3 border-b px-5 py-3 text-xs font-medium text-[var(--sx-text-muted)]">
            <span>#</span>
            <span>URL</span>
            <span>Status</span>
            <span>Verdict</span>
            <span>Action</span>
          </div>

          <div className="divide-border divide-y">
            {items.map((item) => (
              <div
                key={`${item.index}-${item.url}`}
                className="hover:bg-muted/40 grid grid-cols-[60px_minmax(0,1fr)_110px_130px_120px] items-center gap-3 px-5 py-4 text-sm transition"
              >
                <span className="sx-font-hack text-[var(--sx-text-soft)]">
                  {item.index + 1}
                </span>
                <span className="truncate text-[var(--sx-text)]">
                  {formatDisplayUrl(item.url)}
                </span>
                <Badge
                  variant={
                    item.status === "complete"
                      ? item.result?.verdict === "error"
                        ? "error"
                        : "safe"
                      : "neutral"
                  }
                >
                  {item.status === "complete"
                    ? item.result?.verdict === "error"
                      ? "Error"
                      : "Done"
                    : "Queued"}
                </Badge>
                <span
                  className="text-xs font-medium capitalize"
                  style={{
                    color: item.result
                      ? verdictInk(item.result.verdict)
                      : "var(--sx-text-muted)",
                  }}
                >
                  {item.result ? item.result.verdict : "--"}
                </span>
                {item.result ? (
                  <Button
                    type="button"
                    onClick={() => {
                      if (item.result) onSelectResult(item.result);
                    }}
                    variant="ghost"
                    size="sm"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Inspect
                  </Button>
                ) : (
                  <span className="text-[var(--sx-text-muted)]">--</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </section>
  );
}
