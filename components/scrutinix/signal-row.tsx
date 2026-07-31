"use client";

import {
  getSignalDetailEntries,
  getSignalSummary,
} from "@/components/shared/signal-utils";
import {
  getSignalSeverity,
  severityColor,
} from "@/components/shared/scrutinix-types";
import {
  signalLabels,
  type SignalName,
  type SignalResult,
  type SignalPayloadMap,
} from "@/lib/domain/types";

interface SignalRowProps {
  name: SignalName;
  result: SignalResult<SignalPayloadMap[SignalName]>;
  index: number;
}

export function SignalRow({ name, result, index }: SignalRowProps) {
  const label = signalLabels[name];
  const severity = getSignalSeverity(result.status, result.data, name);
  const { dot } = severityColor[severity];

  const statusLine =
    result.status === "pending"
      ? "Waiting"
      : result.status === "skipped"
        ? "Not applicable"
        : result.status === "error"
          ? (result.error ?? "Signal failed")
          : result.data
            ? getSignalSummary(name, result.data)
            : "Signal complete.";

  const entries =
    result.status === "success" && result.data
      ? getSignalDetailEntries(name, result.data)
      : [];

  const ariaLabel = `${label} signal: ${result.status}`;

  // Stagger only the initial pending fill; resolving rows enter instantly.
  const enterDelay =
    result.status === "pending"
      ? { transitionDelay: `${index * 40}ms` }
      : undefined;

  const summaryRow = (
    <>
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: dot }}
      />
      <span className="w-32 shrink-0 text-sm font-medium text-[var(--sx-text)]">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-[var(--sx-text-muted)]">
        {statusLine}
      </span>
      {result.status !== "pending" ? (
        <span className="hidden shrink-0 font-mono text-xs text-[var(--sx-text-soft)] tabular-nums sm:inline">
          {result.durationMs} ms
        </span>
      ) : null}
    </>
  );

  if (entries.length === 0) {
    return (
      <div
        aria-label={ariaLabel}
        className="sx-enter flex items-center gap-3 px-4 py-3"
        style={enterDelay}
      >
        {summaryRow}
        <span aria-hidden="true" className="size-2 shrink-0" />
      </div>
    );
  }

  return (
    <details className="sx-disclosure sx-enter" style={enterDelay}>
      <summary
        aria-label={ariaLabel}
        className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--sx-bg)]"
      >
        {summaryRow}
        <svg
          aria-hidden="true"
          viewBox="0 0 8 8"
          className="sx-chevron size-2 shrink-0 fill-[var(--sx-text-soft)]"
        >
          <path d="M2 0l4 4-4 4z" />
        </svg>
      </summary>
      <dl className="space-y-1.5 px-4 pt-1 pb-4 pl-[2.15rem] font-mono text-xs leading-5">
        {entries.map((entry, entryIndex) => (
          <div key={`${entryIndex}-${entry.label}`} className="flex gap-3">
            <dt className="w-28 shrink-0 text-[var(--sx-text-soft)]">
              {entry.label}
            </dt>
            <dd className="min-w-0 break-all text-[var(--sx-text-muted)]">
              {entry.value}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
