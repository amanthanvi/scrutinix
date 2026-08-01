"use client";

import { useMemo } from "react";

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
}

export function SingleInput({
  url,
  onUrlChange,
  error,
  streaming,
  onSubmit,
  onCancel,
}: SingleInputProps) {
  const hasUrl = url.trim().length > 0;

  return (
    <div className="space-y-3">
      <label htmlFor="sx-url-input" className="sr-only">
        URL to analyze
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
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
          aria-describedby={error ? "sx-url-error" : undefined}
          className="h-10 min-w-0 flex-1 font-mono text-sm aria-invalid:border-[var(--sx-suspicious-fg)]"
        />

        <Button
          type="button"
          onClick={onSubmit}
          disabled={streaming || !hasUrl}
          variant="primary"
          className="h-10 shrink-0 px-4 text-sm sm:min-w-24"
        >
          Analyze
        </Button>
      </div>

      {error ? (
        <p id="sx-url-error" className="text-xs text-[var(--sx-suspicious-fg)]">
          {error}
        </p>
      ) : null}

      {streaming && (
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" onClick={onCancel} variant="ghost" size="sm">
            Cancel
          </Button>
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
    <div className="space-y-3">
      <label htmlFor="sx-batch-input" className="sr-only">
        URLs to analyze
      </label>

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
        className="resize-none font-mono text-sm aria-invalid:border-[var(--sx-suspicious-fg)]"
      />

      {error ? (
        <p
          id="sx-batch-error"
          className="text-xs text-[var(--sx-suspicious-fg)]"
        >
          {error}
        </p>
      ) : (
        <p id="sx-batch-hint" className="text-xs text-[var(--sx-text-soft)]">
          One URL per line · up to 10 · Cmd/Ctrl+Enter to start
          {urlCount > 1 ? ` · ${urlCount} URLs` : ""}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={streaming || !hasUrls}
          variant="primary"
          className="h-10 px-4 text-sm"
        >
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
              Export CSV
            </Button>
            <Button type="button" onClick={onJson} variant="ghost" size="sm">
              Export JSON
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
