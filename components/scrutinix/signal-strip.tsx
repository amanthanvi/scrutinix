"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { SignalCell, cellNames } from "@/components/scrutinix/signal-cell";
import { getSignalFinding } from "@/components/shared/signal-utils";
import {
  signalLabels,
  signalNames,
  type SignalName,
  type SignalResults,
} from "@/lib/domain/types";
import type { Severity } from "@/lib/domain/signal-severity";
import type { SignalSignature } from "@/lib/domain/schemas";
import {
  getResultSignature,
  getSignalSignature,
  severityWords,
} from "@/lib/domain/signal-signature";
import type { AnalysisResult } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/**
 * The eight-cell strip: one cell per signal, fixed order, fixed ramp. The
 * same grammar appears at every scale — the live strip (streaming progress
 * and evidence index), the row marker, the history and batch glyph, the
 * brand mark, the icons, and the share images.
 */

/** Severities that name a finding worth reading: their labels go to ink. */
const NOTABLE: ReadonlySet<Severity> = new Set([
  "malicious",
  "suspicious",
  "error",
]);

/** Four columns on phones and narrow (zoomed) windows, eight from 48rem. */
const STRIP_GRID =
  "grid grid-cols-4 gap-x-2 gap-y-3 md:grid-cols-8 md:gap-x-1.5";

/**
 * The visible short name. It wraps (hyphenating a long word) rather than
 * truncating, so a zoomed or narrow strip stays identifiable; the text is
 * static, so wrapping never moves a cell while checks stream.
 */
function CellLabel({
  name,
  severity,
}: {
  name: SignalName;
  severity: Severity;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "text-caption leading-tight tracking-[-0.01em] text-balance break-words hyphens-auto",
        NOTABLE.has(severity)
          ? "font-medium text-[var(--sx-text)]"
          : "text-[var(--sx-text-soft)]",
      )}
    >
      {cellNames[name]}
    </span>
  );
}

interface SignalStripProps {
  signals: SignalResults;
  scored: ReadonlySet<SignalName>;
  streaming: boolean;
  /** Reveal and focus the row for this signal. */
  onActivate: (name: SignalName) => void;
}

/**
 * The live strip. It is the streaming progress (cells fill in place, never
 * reflowing) and the evidence index: each cell is a named control that
 * reveals its row. Arrow keys, Home, and End move between cells; only one
 * cell is in the tab order (roving tabindex).
 */
export function SignalStrip({
  signals,
  scored,
  streaming,
  onActivate,
}: SignalStripProps) {
  const signature = getSignalSignature(signals, scored);
  const [focusIndex, setFocusIndex] = useState(0);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveFocus = (index: number) => {
    const next = (index + signalNames.length) % signalNames.length;
    setFocusIndex(next);
    cellRefs.current[next]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    // Matches the grid's md:grid-cols-8 switch.
    const columns = window.matchMedia?.("(min-width: 48rem)").matches ? 8 : 4;
    const keyMoves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + columns,
      ArrowUp: index - columns,
      Home: 0,
      End: signalNames.length - 1,
    };
    const target = keyMoves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    moveFocus(
      event.key === "ArrowDown" || event.key === "ArrowUp"
        ? Math.min(Math.max(target, 0), signalNames.length - 1)
        : target,
    );
  };

  return (
    <div
      role="toolbar"
      aria-label="Checks"
      aria-describedby="sx-strip-hint"
      className={STRIP_GRID}
    >
      <span id="sx-strip-hint" className="sr-only">
        Each check opens its evidence below.
      </span>
      {signalNames.map((name, index) => {
        const severity = signature[index] ?? "pending";
        const finding = getSignalFinding(name, signals[name]);
        return (
          <button
            key={name}
            ref={(node) => {
              cellRefs.current[index] = node;
            }}
            type="button"
            data-signal={name}
            tabIndex={index === focusIndex ? 0 : -1}
            // The name starts with the visible label (WCAG 2.5.3), so
            // "click Redirects" works; the title keeps the full name.
            aria-label={`${cellNames[name]}: ${finding}`}
            title={`${signalLabels[name]} — ${severityWords[severity]}`}
            onClick={() => {
              setFocusIndex(index);
              onActivate(name);
            }}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="sx-strip-cell -mx-1 flex min-h-11 min-w-0 flex-col items-stretch gap-2 rounded-md px-1 pt-1.5 pb-1 text-left"
          >
            <SignalCell
              severity={severity}
              live={streaming}
              className="h-3 w-full"
            />
            <CellLabel name={name} severity={severity} />
          </button>
        );
      })}
    </div>
  );
}

/** A settled strip drawn from a stored signature (shared snapshots). */
export function SignatureStrip({ signature }: { signature: SignalSignature }) {
  return (
    <ul aria-label="Checks" className={STRIP_GRID}>
      {signalNames.map((name, index) => {
        const severity = signature[index] ?? "pending";
        return (
          // Real text, not aria-label on the item: browse modes read it.
          <li key={name} className="flex min-w-0 flex-col gap-2 pt-1.5">
            <SignalCell severity={severity} settled className="h-3 w-full" />
            <CellLabel name={name} severity={severity} />
            <span className="sr-only">
              {`${signalLabels[name]}: ${severityWords[severity]}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The mini glyph for history and batch rows, drawn from the stored
 * signals. Entries saved before signals were kept draw empty slots.
 */
export function SignalGlyph({
  result,
  className,
}: {
  result: Pick<AnalysisResult, "signals" | "threatInfo"> | null;
  className?: string;
}) {
  const signature = result ? getResultSignature(result) : null;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 gap-[2px]", className)}
    >
      {signalNames.map((name, index) => (
        <SignalCell
          key={name}
          severity={signature?.[index] ?? "pending"}
          settled
          className="size-[7px] rounded-[1.5px]"
        />
      ))}
    </span>
  );
}
