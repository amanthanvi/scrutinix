"use client";

import {
  getSignalDetailEntries,
  getSignalFinding,
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

interface SignalRowProps<N extends SignalName> {
  name: N;
  result: SignalResult<SignalPayloadMap[N]>;
  index: number;
  /** The verdict engine scored this check against the link. */
  scored?: boolean;
}

/** One `<li>` of the signal list; the parent renders the `<ul>`. */
export function SignalRow<N extends SignalName>({
  name,
  result,
  index,
  scored = false,
}: SignalRowProps<N>) {
  const label = signalLabels[name];
  const severity = getSignalSeverity(result.status, result.data, name, scored);
  const { dot } = severityColor[severity];
  const finding = getSignalFinding(name, result);

  const entries =
    result.status === "success" && result.data
      ? getSignalDetailEntries(name, result.data)
      : [];
  // Timing is reference detail: it lives in the expanded evidence only.
  if (entries.length > 0) {
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
      <span
        aria-hidden="true"
        className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: dot }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:gap-3">
        <span className="shrink-0 text-sm font-medium whitespace-nowrap text-[var(--sx-text)] sm:w-44">
          {label}
        </span>
        <span className="min-w-0 flex-1 text-[0.8125rem] leading-5 break-words text-[var(--sx-text-muted)] sm:pt-px">
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
        className="sx-enter flex items-start gap-3 py-3"
        style={enterDelay}
      >
        {summaryRow}
        <span aria-hidden="true" className="size-2 shrink-0" />
      </li>
    );
  }

  return (
    <li data-signal={name} className="sx-enter" style={enterDelay}>
      <details className="sx-disclosure">
        <summary
          aria-label={ariaLabel}
          className="hover:bg-muted/40 flex items-start gap-3 py-3"
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
        <dl className="space-y-1.5 pt-1 pb-4 pl-[1.125rem] font-mono text-xs leading-5">
          {entries.map((entry, entryIndex) => (
            <div key={`${entryIndex}-${entry.label}`} className="flex gap-3">
              <dt className="w-28 shrink-0 text-[var(--sx-text-soft)] sm:w-40">
                {entry.label}
              </dt>
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
