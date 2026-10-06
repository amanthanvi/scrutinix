"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatDisplayUrl } from "@/lib/domain/url";
import type { AnalysisResult } from "@/lib/domain/types";
import {
  clampScore,
  getCoverageCaveat,
  getScoreBandText,
  getVerdictGuidance,
  shouldShowVerdictSummary,
} from "@/lib/domain/verdict-guidance";
import {
  SIGNAL_COUNT,
  verdictFg,
  type SharedSnapshot,
} from "@/components/shared/scrutinix-types";

/** Details section headings: secondary, but clearly headings. */
const DETAIL_HEADING = "text-[0.8125rem] font-semibold text-[var(--sx-text)]";

/** Focus target when a stored result replaces the view. */
export const VERDICT_HEADING_ID = "sx-verdict-heading";

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
    // Snapshots carry no signals or score: the imperative falls back to
    // its hedged forms, and no meter is shown.
    const snapshotGuidance = getVerdictGuidance({
      verdict: sharedSnapshot.verdict,
      threatInfo: null,
    });
    return (
      <section
        className="sx-enter"
        aria-label={`Scan result: ${sharedSnapshot.verdict}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id={VERDICT_HEADING_ID}
            tabIndex={-1}
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
        <p className="mt-1 text-base font-medium text-[var(--sx-text)]">
          {snapshotGuidance.imperative}
        </p>
        <p className="mt-2 font-mono text-sm break-all text-[var(--sx-text-muted)]">
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
  const guidance = getVerdictGuidance(result);
  const score = clampScore(threatInfo?.score);
  const confidenceLabel = threatInfo?.confidenceLabel ?? "low";
  const reasons = threatInfo?.hasPositiveEvidence
    ? (threatInfo?.reasons ?? [])
    : [];
  const recommendations = threatInfo?.recommendations ?? [];
  const limitations = threatInfo?.limitations ?? [];
  const confidenceReasons = threatInfo?.confidenceReasons ?? [];
  const metadata = result.metadata;
  const caveat = getCoverageCaveat(result);

  const completed = Object.values(result.signals).filter(
    (s) => s.status !== "pending",
  ).length;

  return (
    <section className="sx-enter" aria-label={`Scan result: ${result.verdict}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id={VERDICT_HEADING_ID}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-[-0.01em] capitalize"
          style={{ color: verdictFg(result.verdict) }}
        >
          {result.verdict}
        </h2>
        {guidance.showScore ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-[var(--sx-text-muted)]">
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
            <span>{getScoreBandText(score)}</span>
            {/* Each separator wraps with the item after it, never dangling. */}
            <span className="whitespace-nowrap">
              <span aria-hidden="true">· </span>
              {confidenceLabel} confidence
            </span>
            <span className="whitespace-nowrap">
              <span aria-hidden="true">· </span>
              <Link
                href="/about#scoring"
                className="text-[var(--sx-accent)] underline-offset-2 hover:underline"
              >
                How scoring works
              </Link>
            </span>
          </p>
        ) : null}
      </div>

      <p className="mt-1 text-base font-medium text-[var(--sx-text)]">
        {guidance.imperative}
      </p>

      <p className="mt-2 font-mono text-sm break-all text-[var(--sx-text-muted)]">
        {formatDisplayUrl(result.url)}
      </p>

      {threatInfo && shouldShowVerdictSummary(result) ? (
        <p className="mt-3 text-sm leading-6 text-[var(--sx-text)]">
          {threatInfo.summary}
        </p>
      ) : null}

      {caveat ? (
        <p className="mt-3 text-sm leading-6 text-[var(--sx-suspicious-fg)]">
          {caveat}
        </p>
      ) : null}

      {(reasons.length > 0 ||
        recommendations.length > 0 ||
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
            {/* The summary sentence and the driver rows already state the
                main finding; the full evidence list lives here. */}
            {reasons.length > 0 ? (
              <div>
                <h3 className={DETAIL_HEADING}>What we found</h3>
                <ul className="mt-1 space-y-1 text-[var(--sx-text)]">
                  {reasons.slice(0, 6).map((reason, index) => (
                    <li key={`${index}-${reason}`}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {recommendations.length > 0 ? (
              <div>
                <h3 className={DETAIL_HEADING}>What to do</h3>
                <ul className="mt-1 space-y-1 text-[var(--sx-text)]">
                  {recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {limitations.length > 0 ? (
              <div>
                <h3 className={DETAIL_HEADING}>Caveats</h3>
                <ul className="mt-1 space-y-1 text-[var(--sx-text-muted)]">
                  {limitations.slice(0, 4).map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {confidenceReasons.length > 0 ? (
              <div>
                <h3 className={DETAIL_HEADING}>
                  Why {confidenceLabel} confidence
                </h3>
                <ul className="mt-1 space-y-1 text-[var(--sx-text-muted)]">
                  {confidenceReasons.slice(0, 4).map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="font-mono text-xs text-[var(--sx-text-muted)] tabular-nums">
              {completed}/{SIGNAL_COUNT} checks · {metadata?.durationMs ?? 0} ms
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
