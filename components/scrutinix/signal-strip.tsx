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

/*
 * Layout lives in app/scrutinix.css (`.sx-strip` and its parts) so the
 * first-load script doesn't carry it: on phones two columns of four rows,
 * numbered down each column, every cell a 44px row with its full name
 * beside it; from 40rem a 4 x 2 grid; a single row of eight from 64rem.
 */

/** How many cells sit side by side at this width (matches `.sx-strip`). */
function stripColumns(): 2 | 4 | 8 {
  if (window.matchMedia?.("(min-width: 64rem)").matches) return 8;
  if (window.matchMedia?.("(min-width: 40rem)").matches) return 4;
  return 2;
}

/**
 * A cell's number, 1-8 in `signalNames` order: the Summary cites it. Kept
 * here, not with the server-safe atoms, so the header's mark never pulls
 * the signal schemas into its chunk.
 */
export function cellNumber(name: SignalName): number {
  return signalNames.indexOf(name) + 1;
}

/**
 * The visible number and short name. The name wraps (hyphenating a long
 * word) rather than truncating, so a zoomed or narrow strip stays
 * identifiable; the text is static, so wrapping never moves a cell while
 * checks stream.
 */
function CellLabel({
  name,
  severity,
}: {
  name: SignalName;
  severity: Severity;
}) {
  return (
    <span aria-hidden="true" className="sx-cell-label">
      <span className="sx-tag" data-n={cellNumber(name)} />
      <span className="sx-cell-name" data-notable={NOTABLE.has(severity)}>
        {cellNames[name]}
      </span>
    </span>
  );
}

interface SignalStripProps {
  signals: SignalResults;
  scored: ReadonlySet<SignalName>;
  streaming: boolean;
  /**
   * What a cell leads to: the Summary question that cites the check, or
   * the check's evidence row (Full). An Error result's rows hold no
   * evidence ("This check could not be completed."), so a cell only moves
   * to its row: `"status-row"`.
   */
  leadsTo?: "question" | "row" | "status-row";
  /** Move focus to the question or row for this signal. */
  onActivate: (name: SignalName) => void;
}

/**
 * The live strip. It is the streaming progress (cells fill in place, never
 * reflowing) and the evidence index: each cell is a named control that
 * moves to the Summary question citing its check, or opens its row in
 * Full. Arrow keys, Home, and End move between cells; only one cell is in
 * the tab order (roving tabindex).
 */
export function SignalStrip({
  signals,
  scored,
  streaming,
  leadsTo = "row",
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
    // Left and Right step through the cells in order, as in any toolbar,
    // wrapping at the ends. Up and Down follow the layout: on phones the
    // cells run down two columns, so they step in order too; wider, they
    // move a row and stop at the edge.
    const columns = stripColumns();
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const step = forward ? 1 : -1;
    let target: number;
    if (event.key === "Home") target = 0;
    else if (event.key === "End") target = signalNames.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft")
      target = index + step;
    else if (event.key === "ArrowDown" || event.key === "ArrowUp")
      target =
        columns === 2
          ? index + step
          : Math.min(
              Math.max(index + step * columns, 0),
              signalNames.length - 1,
            );
    else return;
    event.preventDefault();
    moveFocus(target);
  };

  return (
    <div
      role="toolbar"
      aria-label="Checks"
      aria-describedby="sx-strip-hint"
      className="sx-strip"
    >
      <span id="sx-strip-hint" className="sr-only">
        {leadsTo === "question"
          ? "Each check moves to the question it answers below."
          : leadsTo === "status-row"
            ? "Each check moves to its row below."
            : "Each check opens its evidence below."}
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
            className="sx-strip-cell"
          >
            <SignalCell
              severity={severity}
              live={streaming}
              className="sx-cell-bar"
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
    <ul aria-label="Checks" className="sx-strip">
      {signalNames.map((name, index) => {
        const severity = signature[index] ?? "pending";
        return (
          // Real text, not aria-label on the item: browse modes read it.
          <li key={name} className="sx-strip-item">
            <SignalCell severity={severity} settled className="sx-cell-bar" />
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
