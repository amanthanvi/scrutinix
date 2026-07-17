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
    <div className="space-y-4">
      <label
        htmlFor="sx-url-input"
        className="text-sm font-medium text-[var(--sx-text)]"
      >
        URL to analyze
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div
          className={`sx-input-glow bg-card flex min-w-0 flex-1 items-center gap-3 rounded-md border px-3.5 transition-[border-color,box-shadow] duration-200${streaming ? "ring-1 ring-[color-mix(in_srgb,var(--sx-active-accent)_28%,transparent)]" : ""}`}
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
            placeholder="https://example.com"
            aria-label="URL to analyze"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "sx-url-error" : "sx-url-hint"}
            className="h-11 border-0 bg-transparent px-0 text-[var(--sx-text)] shadow-none"
          />
        </div>

        <Button
          type="button"
          onClick={onSubmit}
          disabled={streaming || !hasUrl}
          variant="primary"
          aria-label={streaming ? "Analyzing" : "Analyze URL, or press Enter"}
          className="h-11 shrink-0 gap-2 px-4 text-sm font-semibold sm:min-w-[8.5rem]"
        >
          {streaming ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
          )}
          Analyze
        </Button>
      </div>

      {error ? (
        <p id="sx-url-error" className="text-xs text-[var(--sx-suspicious)]">
          {error}
        </p>
      ) : (
        <p id="sx-url-hint" className="text-xs text-[var(--sx-text-soft)]">
          Include http:// or https://
        </p>
      )}

      {(streaming || result) && (
        <div className="flex flex-wrap items-center gap-2">
          {streaming && (
            <Button type="button" onClick={onCancel} variant="ghost" size="sm">
              Cancel
            </Button>
          )}
          {result && (
            <>
              <Button
                type="button"
                onClick={onExport}
                variant="ghost"
                size="sm"
              >
                <Download className="h-3 w-3" /> JSON
              </Button>
              <Button type="button" onClick={onShare} variant="ghost" size="sm">
                <Link2 className="h-3 w-3" /> Share
              </Button>
              <Button
                type="button"
                onClick={onRescan}
                variant="ghost"
                size="sm"
              >
                <RefreshCw className="h-3 w-3" /> Re-scan
              </Button>
            </>
          )}
        </div>
      )}
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label
          htmlFor="sx-batch-input"
          className="text-sm font-medium text-[var(--sx-text)]"
        >
          URLs to analyze
        </label>
        {urlCount > 0 && (
          <Badge variant={streaming ? "active" : "neutral"}>
            {urlCount} URL{urlCount !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <div
        className={`sx-input-glow bg-card rounded-md border px-3.5 pt-3 pb-1 transition-[border-color,box-shadow] duration-200${streaming ? "ring-1 ring-[color-mix(in_srgb,var(--sx-active-accent)_28%,transparent)]" : ""}`}
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
          aria-describedby={error ? "sx-batch-error" : "sx-batch-hint"}
          className="min-h-0 resize-none border-0 bg-transparent px-0 pb-3 text-[var(--sx-text)] shadow-none"
        />
      </div>

      {error ? (
        <p id="sx-batch-error" className="text-xs text-[var(--sx-suspicious)]">
          {error}
        </p>
      ) : (
        <p id="sx-batch-hint" className="text-xs text-[var(--sx-text-soft)]">
          One URL per line · up to 10 · Cmd/Ctrl+Enter to start
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={streaming || !hasUrls}
          variant="primary"
          className="h-10 gap-2 px-4 text-sm font-semibold"
        >
          {streaming ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          Start batch
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
    </div>
  );
}
