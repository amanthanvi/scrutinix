"use client";

import { SignalCell } from "@/components/scrutinix/signal-cell";
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
}: SignalRowProps<N>) {
  const label = signalLabels[name];
  const severity = getSignalSeverity(result.status, result.data, name, scored);
  const finding = getSignalFinding(name, result);

  const entries =
    result.status === "success" && result.data
      ? getSignalDetailEntries(name, result.data)
      : [];
  // Timing is reference detail: it lives in the expanded evidence only.
  if (entries.length > 0 && result.durationMs > 0) {
    entries.push({ label: "Took", value: `${result.durationMs} ms` });
  }

  // Keeps the e2e/a11y contract: "{Label} signal: {finding}".
  const ariaLabel = `${label} signal: ${finding}`;

  // Stagger only the initial pending fill; resolving rows enter instantly.
  const enterDelay =
    result.status === "pending"
      ? { transitionDelay: `${index * 40}ms` }
      : undefined;

  const summaryRow = (
    <>
      <SignalCell
        severity={severity}
        settled
        className="mt-[0.4375rem] h-2 w-3.5 shrink-0 rounded-[1.5px]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:gap-4">
        <span className="shrink-0 text-sm font-medium whitespace-nowrap text-[var(--sx-text)] sm:w-44">
          {label}
        </span>
        <span className="min-w-0 flex-1 text-sm leading-[1.375rem] break-words text-[var(--sx-text-muted)]">
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
        className="sx-enter flex scroll-mt-4 items-start gap-3 py-3.5 outline-offset-2"
        style={enterDelay}
      >
        {summaryRow}
        <span aria-hidden="true" className="size-2 shrink-0" />
      </li>
    );
  }

  return (
    <li data-signal={name} className="sx-enter scroll-mt-4" style={enterDelay}>
      <details className="sx-disclosure">
        <summary
          aria-label={ariaLabel}
          className="-mx-2 flex items-start gap-3 rounded-md px-2 py-3.5 transition-colors hover:bg-[var(--sx-subtle)]"
        >
          {summaryRow}
          <svg
            aria-hidden="true"
            viewBox="0 0 8 8"
            className="sx-chevron mt-1.5 size-2 shrink-0 fill-[var(--sx-text-soft)]"
          >
            <path d="M2 0l4 4-4 4z" />
          </svg>
        </summary>
        <dl className="text-caption mb-4 ml-[1.625rem] grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md bg-[var(--sx-subtle)] px-3.5 py-3 font-mono leading-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
          {entries.map((entry, entryIndex) => (
            <div key={`${entryIndex}-${entry.label}`} className="contents">
              <dt className="text-[var(--sx-text-soft)]">{entry.label}</dt>
              <dd className="min-w-0 break-all text-[var(--sx-text-muted)]">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}
