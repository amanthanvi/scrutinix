"use client";

import { ClipboardPaste, CornerDownLeft } from "lucide-react";
import { useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { warmLinkParser } from "@/hooks/use-link-anatomy";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Whether this browser lets a page read the clipboard on a click. */
function useCanReadClipboard(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => typeof navigator.clipboard?.readText === "function",
    () => false,
  );
}

interface SingleInputProps {
  url: string;
  onUrlChange: (v: string) => void;
  error?: string | null;
  streaming: boolean;
  /** A result for this input is on screen: Analyze steps back to outline. */
  showingResult?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

export function SingleInput({
  url,
  onUrlChange,
  error,
  streaming,
  showingResult = false,
  onSubmit,
  onCancel,
}: SingleInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canPaste = useCanReadClipboard();

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        warmLinkParser();
        onUrlChange(text);
      }
    } catch {
      toast.error(
        "Clipboard access was blocked. Paste into the field instead.",
      );
    }
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="sx-url-input" className="sr-only">
        URL to analyze
      </label>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Input
            ref={inputRef}
            id="sx-url-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            // Load the link parser before the scan, so the anatomy (and any
            // look-alike sentence) is in place before the strip appears.
            onFocus={warmLinkParser}
            onKeyDown={(e) => {
              if (e.key === "Escape" && streaming) {
                onCancel();
                return;
              }
              if (e.key === "Enter" && !streaming) onSubmit();
            }}
            placeholder="Paste a link"
            aria-label="URL to analyze"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "sx-url-error" : undefined}
            className={
              canPaste
                ? "text-body h-12 pr-24 font-mono"
                : "text-body h-12 font-mono"
            }
          />
          {canPaste ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void pasteFromClipboard()}
              className="absolute top-1/2 right-1 -translate-y-1/2 gap-1.5 px-2.5"
            >
              <ClipboardPaste aria-hidden="true" />
              Paste
            </Button>
          ) : null}
        </div>

        {/* Never disabled at rest: an empty submit explains itself inline.
            While a scan runs it is aria-disabled, not disabled, so keyboard
            focus stays here instead of falling to <body>. */}
        <Button
          type="button"
          aria-label="Analyze URL"
          onClick={() => {
            if (!streaming) onSubmit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && streaming) onCancel();
          }}
          aria-disabled={streaming || undefined}
          variant={showingResult && !streaming ? "outline" : "primary"}
          className="h-12 shrink-0 px-5 text-sm sm:min-w-32"
        >
          Analyze
          <CornerDownLeft aria-hidden="true" className="opacity-70" />
        </Button>
      </div>

      {error ? (
        <p
          id="sx-url-error"
          role="alert"
          className="text-meta text-[var(--sx-danger-fg)]"
        >
          {error}
        </p>
      ) : null}
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
          className="h-11 px-5 text-sm"
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
