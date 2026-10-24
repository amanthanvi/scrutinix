"use client";

import { SignalCell } from "@/components/scrutinix/signal-cell";
import { cellNumber } from "@/components/scrutinix/signal-strip";
import {
  getSignalDetailEntries,
  getSignalFinding,
} from "@/components/shared/signal-utils";
import { getSignalSeverity } from "@/components/shared/scrutinix-types";
import {
  signalLabels,
  type SignalName,
  type SignalResult,
  type SignalPayloadMap,
} from "@/lib/domain/types";

interface SignalRowProps<N extends SignalName> {
  name: N;
  result: SignalResult<SignalPayloadMap[N]>;
  index: number;
  /** The verdict engine scored this check against the link. */
  scored?: boolean;
  /** When the evidence was gathered; ages count from it. Defaults to now. */
  evidenceTime?: number;
}

/**
 * One `<li>` of the evidence list; the parent renders the `<ul>`. The row
 * marker is the strip's own cell, so a row and its strip cell read as the
 * same thing.
 */
export function SignalRow<N extends SignalName>({
  name,
  result,
  index,
  scored = false,
  evidenceTime,
}: SignalRowProps<N>) {
  const label = signalLabels[name];
  const severity = getSignalSeverity(result.status, result.data, name, scored);
  const finding = getSignalFinding(name, result);

  const entries =
    result.status === "success" && result.data
      ? getSignalDetailEntries(name, result.data, undefined, evidenceTime)
      : [];
  // Timing is reference detail: it lives in the expanded evidence only.
  if (entries.length > 0 && result.durationMs > 0) {
    entries.push({ label: "Took", value: `${result.durationMs} ms` });
  }

  // The visible text, in order (WCAG 2.5.3: the name contains the label a
  // voice user reads off the screen): "{Label}: {finding}".
  const ariaLabel = `${label}: ${finding}`;

  // Stagger only the initial pending fill; resolving rows enter instantly.
  const enterDelay =
    result.status === "pending"
      ? { transitionDelay: `${index * 40}ms` }
      : undefined;

  // The Summary's rail: the check (its cell, number, and name) in the
  // left column from 64rem, the finding beside it.
  const summaryRow = (
    <>
      <SignalCell
        severity={severity}
        settled
        className="mt-[0.3125rem] h-3.5 w-6 shrink-0 rounded-[2px]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:gap-6 lg:gap-12">
        <span className="text-body flex shrink-0 items-baseline gap-[0.4375rem] font-medium [overflow-wrap:anywhere] text-[var(--sx-text)] sm:w-52 sm:whitespace-nowrap lg:w-[16.625rem]">
          <span aria-hidden="true" className="sx-tag self-center">
            {cellNumber(name)}
          </span>
          {label}
        </span>{" "}
        <span className="text-body min-w-0 flex-1 break-words text-[var(--sx-text-muted)]">
          {finding}
        </span>
      </span>
    </>
  );

  if (entries.length === 0) {
    return (
      <li
        data-signal={name}
        aria-label={ariaLabel}
        tabIndex={-1}
        className="sx-enter flex scroll-mt-6 items-start gap-3.5 py-4 outline-offset-2"
        style={enterDelay}
      >
        {summaryRow}
        <span aria-hidden="true" className="size-2 shrink-0" />
      </li>
    );
  }

  return (
    <li data-signal={name} className="sx-enter scroll-mt-6" style={enterDelay}>
      <details className="sx-disclosure">
        <summary
          aria-label={ariaLabel}
          className="-mx-[12px] flex items-start gap-3.5 rounded-[3px] px-[12px] py-4 transition-colors hover:bg-[var(--sx-subtle)]"
        >
          {summaryRow}
          <svg
            aria-hidden="true"
            viewBox="0 0 8 8"
            className="sx-chevron mt-2 size-2 shrink-0 fill-[var(--sx-text-soft)]"
          >
            <path d="M2 0l4 4-4 4z" />
          </svg>
        </summary>
        <dl className="text-caption mb-5 ml-[2.375rem] grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-[3px] bg-[var(--sx-subtle)] px-4 py-3.5 font-mono leading-5 max-[20rem]:grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)] lg:ml-[22rem]">
          {entries.map((entry, entryIndex) => (
            <div key={`${entryIndex}-${entry.label}`} className="contents">
              <dt className="text-[var(--sx-text-soft)]">{entry.label}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere] text-[var(--sx-text-muted)]">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}
