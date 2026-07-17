"use client";

import { useMemo } from "react";
import {
  ArrowRight,
  CornerDownLeft,
  Download,
  Link2,
  RefreshCw,
  Search,
} from "lucide-react";
import type { AnalysisResult } from "@/lib/domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SingleInputProps {
  url: string;
  onUrlChange: (v: string) => void;
  error?: string | null;
  streaming: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  result: AnalysisResult | null;
  onExport: () => void;
  onShare: () => void;
  onRescan: () => void;
}

export function SingleInput({
  url,
  onUrlChange,
  error,
  streaming,
  onSubmit,
  onCancel,
  result,
  onExport,
  onShare,
  onRescan,
}: SingleInputProps) {
  const hasUrl = url.trim().length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-xs text-[var(--sx-text-muted)]">Single target</h2>
          <p className="max-w-lg text-sm leading-6 text-[var(--sx-text-muted)]">
            Run one URL, then keep the result open for export or share.
          </p>
        </div>

        <Badge variant={streaming ? "active" : hasUrl ? "neutral" : "safe"}>
          {streaming ? "Streaming" : hasUrl ? "Ready" : "Paste URL"}
        </Badge>
      </div>

      <label htmlFor="sx-url-input" className="sr-only">
        URL to analyze
      </label>
      <div
        className={`sx-input-glow bg-card flex items-center gap-3 rounded-lg border px-4 transition-[border-color,box-shadow] duration-200${streaming ? "sx-scan-line" : ""}`}
        style={{
          borderColor: error
            ? "var(--sx-suspicious)"
            : streaming
              ? "var(--sx-active-accent)"
              : "var(--sx-border)",
        }}
      >
        <Search
          className="h-4 w-4 shrink-0 text-[var(--sx-text-soft)]"
          aria-hidden="true"
        />
        <Input
          id="sx-url-input"
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && streaming) {
              onCancel();
              return;
            }
            if (e.key === "Enter" && !streaming) onSubmit();
          }}
          placeholder="https://example.com/suspicious"
          aria-label="URL to analyze"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "sx-url-error" : undefined}
          className="h-12 border-0 bg-transparent px-0 text-[var(--sx-text)] shadow-none"
        />
      </div>

      {error && (
        <p id="sx-url-error" className="text-xs text-[var(--sx-suspicious)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={streaming || !hasUrl}
          variant="terminal"
          aria-label={streaming ? "Analyzing" : "Analyze URL, or press Enter"}
        >
          {streaming ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <CornerDownLeft className="h-3 w-3" aria-hidden />
          )}
          Analyze
        </Button>
        {streaming && (
          <Button type="button" onClick={onCancel} variant="ghost" size="sm">
            Cancel
          </Button>
        )}
        {result && (
          <>
            <Button type="button" onClick={onExport} variant="ghost" size="sm">
              <Download className="h-3 w-3" /> JSON
            </Button>
            <Button type="button" onClick={onShare} variant="ghost" size="sm">
              <Link2 className="h-3 w-3" /> Share
            </Button>
            <Button type="button" onClick={onRescan} variant="ghost" size="sm">
              <RefreshCw className="h-3 w-3" /> Re-scan
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

interface BatchInputProps {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  streaming: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  hasResults: boolean;
  onCsv: () => void;
  onJson: () => void;
}

export function BatchInput({
  value,
  onChange,
  error,
  streaming,
  onSubmit,
  onCancel,
  hasResults,
  onCsv,
  onJson,
}: BatchInputProps) {
  const urlCount = useMemo(
    () =>
      value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean).length,
    [value],
  );
  const hasUrls = value.trim().length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-xs text-[var(--sx-text-muted)]">Batch queue</h2>
          <p className="max-w-lg text-sm leading-6 text-[var(--sx-text-muted)]">
            Queue up to 10 URLs. Scrutinix runs 3 in parallel and isolates
            failures per row.
          </p>
        </div>
        {urlCount > 0 && (
          <Badge variant={streaming ? "active" : "neutral"}>
            {urlCount} URL{urlCount !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <label htmlFor="sx-batch-input" className="sr-only">
        URLs to analyze (one per line)
      </label>
      <div
        className={`sx-input-glow bg-card rounded-lg border px-4 pt-3 pb-1 transition-[border-color,box-shadow] duration-200${streaming ? "sx-scan-line" : ""}`}
        style={{
          borderColor: error
            ? "var(--sx-suspicious)"
            : streaming
              ? "var(--sx-active-accent)"
              : "var(--sx-border)",
        }}
      >
        <Textarea
          id="sx-batch-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && streaming) {
              onCancel();
              return;
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !streaming)
              onSubmit();
          }}
          rows={5}
          placeholder={"https://example.com\nhttps://malicious.test"}
          aria-label="URLs to analyze, one per line"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "sx-batch-error" : undefined}
          className="min-h-0 resize-none border-0 bg-transparent px-0 pb-3 text-[var(--sx-text)] shadow-none"
        />
      </div>

      {error && (
        <p id="sx-batch-error" className="text-xs text-[var(--sx-suspicious)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={streaming || !hasUrls}
          variant="terminal"
        >
          {streaming ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <ArrowRight className="h-3 w-3" />
          )}
          Start Batch
        </Button>
        {streaming && (
          <Button type="button" onClick={onCancel} variant="ghost" size="sm">
            Cancel
          </Button>
        )}
        {hasResults && (
          <>
            <Button type="button" onClick={onCsv} variant="ghost" size="sm">
              <Download className="h-3 w-3" /> CSV
            </Button>
            <Button type="button" onClick={onJson} variant="ghost" size="sm">
              <Download className="h-3 w-3" /> JSON
            </Button>
          </>
        )}
      </div>

      <p className="text-xs leading-5 text-[var(--sx-text-soft)]">
        Press Cmd/Ctrl+Enter to start. Export the finished batch to CSV or JSON.
      </p>
    </div>
  );
}
