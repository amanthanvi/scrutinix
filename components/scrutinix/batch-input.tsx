"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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

  return (
    <div className="flex flex-col gap-3">
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
        spellCheck={false}
        autoCapitalize="none"
        placeholder={"https://example.com\nhttps://another-link.example/offer"}
        aria-label="URLs to analyze, one per line"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "sx-batch-error" : "sx-batch-hint"}
        className="text-body resize-y font-mono"
      />

      {error ? (
        <p
          id="sx-batch-error"
          role="alert"
          className="text-meta text-[var(--sx-danger-fg)]"
        >
          {error}
        </p>
      ) : (
        <p id="sx-batch-hint" className="text-meta text-[var(--sx-text-soft)]">
          One link per line, up to 10. Cmd/Ctrl+Enter starts the batch.
          {urlCount > 0 ? (
            <span className="text-[var(--sx-text-muted)] tabular-nums">
              {" "}
              {urlCount} of 10 entered.
            </span>
          ) : null}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* aria-disabled while running: focus stays on the button. */}
        <Button
          type="button"
          onClick={() => {
            if (!streaming) onSubmit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && streaming) onCancel();
          }}
          aria-disabled={streaming || undefined}
          variant="primary"
          className="h-12 px-6"
        >
          Start batch
        </Button>
        {streaming ? (
          <Button type="button" onClick={onCancel} variant="ghost" size="sm">
            Cancel batch
          </Button>
        ) : null}
        {hasResults ? (
          <>
            <Button type="button" onClick={onCsv} variant="ghost" size="sm">
              Export batch CSV
            </Button>
            <Button type="button" onClick={onJson} variant="ghost" size="sm">
              Export batch JSON
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
