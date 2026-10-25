"use client";

import { ClipboardPaste, CornerDownLeft } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { getToast } from "@/components/ui/lazy-toaster";

import { Button } from "@/components/ui/button";
import { warmLinkParser } from "@/hooks/use-link-anatomy";
import { Input } from "@/components/ui/input";

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
      (await getToast()).error(
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

      <div className="sx-input-row flex flex-col gap-2.5 sm:flex-row">
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
                ? "text-body h-[3.25rem] pr-28 font-mono sm:h-14"
                : "text-body h-[3.25rem] font-mono sm:h-14"
            }
          />
          {canPaste ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void pasteFromClipboard()}
              className="sx-paste absolute top-1/2 right-1.5 -translate-y-1/2 gap-1.5 px-3"
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
          id="sx-analyze"
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
          className="h-[3.25rem] shrink-0 px-7 sm:h-14 sm:min-w-36"
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
