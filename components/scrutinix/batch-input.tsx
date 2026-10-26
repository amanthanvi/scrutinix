"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { getToast } from "@/components/ui/lazy-toaster";
import { Textarea } from "@/components/ui/textarea";
import { loadLinkParser } from "@/hooks/use-link-anatomy";
import { downloadTextFile } from "@/lib/client/export";
import { resultsToCsv, resultsToJson } from "@/lib/client/export-formats";
import type { AnalysisResult } from "@/lib/domain/types";

interface BatchInputProps {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  streaming: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  /** The batch's finished results, which its export buttons save. */
  results: AnalysisResult[];
}

export function BatchInput({
  value,
  onChange,
  error,
  streaming,
  onSubmit,
  onCancel,
  results,
}: BatchInputProps) {
  const urlCount = useMemo(
    () =>
      value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean).length,
    [value],
  );
  const hasResults = results.length > 0;

  // The export formats load with this panel, not the page.
  const onCsv = async () => {
    const parser = await loadLinkParser();
    downloadTextFile("batch.csv", resultsToCsv(results, parser));
    (await getToast()).success("Downloaded batch.csv");
  };
  const onJson = async () => {
    downloadTextFile("batch.json", resultsToJson(results), "application/json");
    (await getToast()).success("Downloaded batch.json");
  };

  return (
    <div className="flex flex-col gap-3">
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
        // The field's description, so a reading cursor doesn't meet it a
        // second time right after the field.
        <p
          id="sx-batch-hint"
          aria-hidden="true"
          className="text-meta text-[var(--sx-text-soft)]"
        >
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
