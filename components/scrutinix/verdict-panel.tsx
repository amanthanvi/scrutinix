"use client";

import { Button } from "@/components/ui/button";
import { formatDisplayUrl } from "@/lib/domain/url";
import type { AnalysisResult } from "@/lib/domain/types";
import {
  SIGNAL_COUNT,
  verdictFg,
  type SharedSnapshot,
} from "@/components/shared/scrutinix-types";

interface VerdictPanelProps {
  result: AnalysisResult | null;
  isStreaming: boolean;
  streamUrl: string;
  sharedSnapshot: SharedSnapshot | null;
  completedSignals?: number;
  onRunSharedScan?: () => void;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VerdictPanel({
  result,
  isStreaming,
  streamUrl,
  sharedSnapshot,
  completedSignals = 0,
  onRunSharedScan,
}: VerdictPanelProps) {
  if (!result && !isStreaming && !sharedSnapshot) {
    return null;
  }

  if (isStreaming && !result) {
    return (
      <section className="sx-enter" aria-label="Scanning URL">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="sx-live size-1.5 shrink-0 rounded-full bg-[var(--sx-accent)]"
          />
          <p className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--sx-text)]">
            {formatDisplayUrl(streamUrl)}
          </p>
          <p className="font-mono text-xs text-[var(--sx-text-muted)] tabular-nums">
            {completedSignals}/{SIGNAL_COUNT}
          </p>
        </div>
        <div className="sx-progress mt-3" aria-hidden="true">
          <span
            style={{
              transform: `scaleX(${completedSignals / SIGNAL_COUNT})`,
            }}
          />
        </div>
      </section>
    );
  }

  if (!result && sharedSnapshot) {
    return (
      <section
        className="sx-enter"
        aria-label={`Scan result: ${sharedSnapshot.verdict}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            className="text-2xl font-semibold tracking-[-0.01em] capitalize"
            style={{ color: verdictFg(sharedSnapshot.verdict) }}
          >
            {sharedSnapshot.verdict}
          </h2>
          <p className="text-xs text-[var(--sx-text-muted)]">
            Shared snapshot · captured{" "}
            {formatTimestamp(sharedSnapshot.capturedAt)}
          </p>
        </div>
        <p className="mt-1 font-mono text-sm break-all text-[var(--sx-text-muted)]">
          {formatDisplayUrl(sharedSnapshot.url)}
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--sx-text)]">
          {sharedSnapshot.summary}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {onRunSharedScan ? (
            <Button type="button" variant="outline" onClick={onRunSharedScan}>
              Run fresh scan
            </Button>
          ) : null}
          <p className="text-xs text-[var(--sx-text-muted)]">
            Snapshots are embedded in the link — run a fresh scan to verify.
          </p>
        </div>
      </section>
    );
  }

  if (!result) return null;

  const threatInfo = result.threatInfo;
  const score = Math.min(Math.max(threatInfo?.score ?? 0, 0), 100);
  const confidence = threatInfo?.confidence ?? 0;
  const confidenceLabel = threatInfo?.confidenceLabel ?? "low";
  const reasons = threatInfo?.hasPositiveEvidence
    ? (threatInfo?.reasons ?? [])
    : [];
  const emptyEvidenceText =
    result.verdict === "safe"
      ? "No direct malicious indicators were found in the completed signals."
      : result.verdict === "unknown"
        ? "The host could not be inspected, so this scan cannot establish whether the URL is safe."
        : "Supporting evidence details are unavailable for this verdict.";
  const recommendations = threatInfo?.recommendations ?? [];
  const limitations = threatInfo?.limitations ?? [];
  const confidenceReasons = threatInfo?.confidenceReasons ?? [];
  const metadata = result.metadata;

  const signalValues = Object.values(result.signals);
  const completed = signalValues.filter((s) => s.status !== "pending").length;
  const failed = signalValues.filter((s) => s.status === "error").length;
  const skipped = signalValues.filter((s) => s.status === "skipped").length;

  const limitedCoverage = Boolean(metadata?.partialFailure);
  const provisionalSafe = result.verdict === "safe" && confidence < 0.5;
  const caveat = limitedCoverage
    ? `Based on ${completed}/${SIGNAL_COUNT} resolved signals${
        failed > 0 ? `; ${failed} failed` : ""
      }${skipped > 0 ? `, ${skipped} not applicable` : ""}.${
        provisionalSafe ? " Not a clean bill of health." : ""
      }`
    : provisionalSafe
      ? "Not a clean bill of health — treat this safe verdict with caution."
      : null;

  return (
    <section className="sx-enter" aria-label={`Scan result: ${result.verdict}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          className="text-2xl font-semibold tracking-[-0.01em] capitalize"
          style={{ color: verdictFg(result.verdict) }}
        >
          {result.verdict}
        </h2>
        <p className="flex items-baseline gap-2 text-xs text-[var(--sx-text-muted)]">
          <span
            role="meter"
            aria-label="Threat score"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            aria-valuetext={`${score} out of 100`}
            className="font-mono text-sm text-[var(--sx-text)] tabular-nums"
          >
            {score}/100
          </span>
          {confidenceLabel} confidence
        </p>
      </div>

      <p className="mt-1 font-mono text-sm break-all text-[var(--sx-text-muted)]">
        {formatDisplayUrl(result.url)}
      </p>

      {threatInfo?.summary ? (
        <p className="mt-3 text-sm leading-6 text-[var(--sx-text)]">
          {threatInfo.summary}
        </p>
      ) : null}

      {caveat ? (
        <p className="mt-3 text-sm leading-6 text-[var(--sx-suspicious-fg)]">
          {caveat}
        </p>
      ) : null}

      {reasons.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {reasons.slice(0, 6).map((reason, index) => (
            <li
              key={`${index}-${reason}`}
              className="flex gap-2.5 text-sm leading-6 text-[var(--sx-text)]"
            >
              <span
                aria-hidden="true"
                className="mt-[0.6875rem] size-1 shrink-0 rounded-full bg-current opacity-60"
              />
              {reason}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[var(--sx-text-muted)]">
          {emptyEvidenceText}
        </p>
      )}

      {(recommendations.length > 0 ||
        limitations.length > 0 ||
        confidenceReasons.length > 0) && (
        <details className="sx-disclosure group mt-4">
          <summary className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]">
            <svg
              aria-hidden="true"
              viewBox="0 0 8 8"
              className="sx-chevron size-2 fill-current"
            >
              <path d="M2 0l4 4-4 4z" />
            </svg>
            Details
          </summary>
          <div className="mt-3 space-y-4 text-sm leading-6">
            {recommendations.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium text-[var(--sx-text-muted)]">
                  What to do
                </h3>
                <ul className="mt-1 space-y-1 text-[var(--sx-text)]">
                  {recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {limitations.length > 0 || confidenceReasons.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium text-[var(--sx-text-muted)]">
                  Caveats
                </h3>
                <ul className="mt-1 space-y-1 text-[var(--sx-text-muted)]">
                  {[
                    ...limitations.slice(0, 4),
                    ...confidenceReasons.slice(0, 4),
                  ].map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="font-mono text-xs text-[var(--sx-text-muted)] tabular-nums">
              {completed}/{SIGNAL_COUNT} signals · {metadata?.durationMs ?? 0}{" "}
              ms
              {metadata?.completedAt
                ? ` · finished ${formatTimestamp(metadata.completedAt)}`
                : ""}
              {metadata?.cacheHit ? " · cached" : ""}
            </p>
          </div>
        </details>
      )}
    </section>
  );
}
