"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import { capitalize } from "@/lib/domain/copy";
import type {
  AnalysisResult,
  SharedSnapshot,
  Verdict,
} from "@/lib/domain/types";
import {
  clampScore,
  getConfidenceReasons,
  getCoverageCaveat,
  getScoreBandText,
  getVerdictGuidance,
  getVerdictRecommendations,
  shouldShowVerdictSummary,
} from "@/lib/domain/verdict-guidance";
import { cn } from "@/lib/utils";

/** Details section headings: secondary, but clearly headings. */
const DETAIL_HEADING = "text-meta font-semibold text-[var(--sx-text)]";

/** Focus target when a stored result replaces the view or a scan lands. */
export const VERDICT_HEADING_ID = "sx-verdict-heading";

function bandStyle(verdict: Verdict | "pending"): CSSProperties {
  return {
    backgroundColor: `var(--sx-${verdict}-surface)`,
    borderColor: `var(--sx-${verdict}-edge)`,
  };
}

/**
 * A shared snapshot's time, fixed to UTC: shared views render on the
 * server, so a viewer-local time would differ from the server's and break
 * hydration for nearly every viewer.
 */
export function formatSnapshotTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    timeZoneName: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Viewer-local time, for client-only metadata (a scan's finish time). */
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

/**
 * The band frame. Every state renders the same element tree, so the
 * heading node survives the switch from "Checking" to the verdict and a
 * focused heading keeps focus when the result lands.
 */
function Band({
  label,
  tone,
  heading,
  headingClassName,
  aside,
  imperative,
  children,
}: {
  label: string;
  tone: Verdict | "pending";
  heading: ReactNode;
  headingClassName?: string;
  aside?: ReactNode;
  imperative: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="sx-band scroll-mt-4 rounded-xl border px-5 py-6 sm:px-7 sm:py-7"
      style={bandStyle(tone)}
    >
      <div className="flex flex-col gap-x-8 gap-y-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id={VERDICT_HEADING_ID}
            tabIndex={-1}
            className={cn(
              "text-verdict-sm sm:text-verdict font-semibold outline-offset-4",
              headingClassName,
            )}
          >
            {heading}
          </h2>
          <p className="text-imperative mt-3 font-medium text-balance text-[var(--sx-text)]">
            {imperative}
          </p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A shared band's one primary action. */
function RunSharedScanButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sx-btn-press text-meta inline-flex min-h-11 items-center rounded-md bg-[var(--sx-accent-solid)] px-4 font-medium text-[var(--sx-accent-fg)] hover:bg-[var(--sx-accent-solid-hover)]"
    >
      {label}
    </button>
  );
}

interface VerdictBandProps {
  result: AnalysisResult | null;
  isStreaming: boolean;
  /** A shared snapshot Scrutinix signed (verified on the server). */
  sharedSnapshot: SharedSnapshot | null;
  /**
   * The page was opened from a shared link without a valid Scrutinix
   * signature: show the neutral "check it yourself" band, nothing from it.
   */
  unverifiedShare?: boolean;
  completedSignals?: number;
  /** Look-alike domain from the link anatomy; hedges Safe and Unknown. */
  impersonates?: string | null;
  /** Rows Summary shows; the "because" line yields to them. */
  driverRows?: number;
  onRunSharedScan?: () => void;
  /** Stops a running scan; shown inside the band so nothing reflows. */
  onCancelScan?: () => void;
}

/**
 * S1: the verdict owns the moment. A column-wide band on the verdict's
 * low-chroma surface (the one colour encoding), the verdict word in ink
 * at display size, the instruction directly beneath, and the score with
 * its band only when a number means something.
 */
export function VerdictBand({
  result,
  isStreaming,
  sharedSnapshot,
  unverifiedShare = false,
  completedSignals = 0,
  impersonates = null,
  driverRows = 0,
  onRunSharedScan,
  onCancelScan,
}: VerdictBandProps) {
  if (isStreaming && !result) {
    return (
      <Band
        label="Scanning URL"
        tone="pending"
        heading={<span>Checking</span>}
        headingClassName="text-[var(--sx-text-soft)]"
        aside={
          onCancelScan ? (
            <button
              type="button"
              onClick={onCancelScan}
              className="sx-btn-press text-meta -mr-2 inline-flex min-h-11 items-center self-start rounded-md px-3 font-medium text-[var(--sx-text-muted)] hover:bg-[var(--sx-subtle)] hover:text-[var(--sx-text)]"
            >
              Cancel scan
            </button>
          ) : null
        }
        imperative={
          <span className="text-[var(--sx-text-muted)] tabular-nums">
            {completedSignals} of {SIGNAL_COUNT} checks finished
          </span>
        }
      >
        {/* Holds the confidence line's slot, so the verdict changes the
            band's tone in place rather than growing it. */}
        <p aria-hidden="true" className="text-meta invisible mt-5">
          &nbsp;
        </p>
      </Band>
    );
  }

  if (!result && sharedSnapshot) {
    // Snapshots carry no score: the instruction falls back to its hedged
    // forms and no meter is shown.
    const guidance = getVerdictGuidance({
      verdict: sharedSnapshot.verdict,
      threatInfo: null,
      impersonates,
    });
    return (
      <Band
        label={`Scan result: ${sharedSnapshot.verdict}`}
        tone={guidance.tone}
        heading={
          <span
            key={`shared-${sharedSnapshot.verdict}`}
            className="sx-band-arrive capitalize"
          >
            {sharedSnapshot.verdict}
          </span>
        }
        imperative={guidance.imperative}
      >
        {sharedSnapshot.summary ? (
          <p className="text-body mt-4 max-w-[60ch] text-[var(--sx-text)]">
            {sharedSnapshot.summary}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {onRunSharedScan ? (
            <RunSharedScanButton
              onClick={onRunSharedScan}
              label="Run a fresh scan"
            />
          ) : null}
          <p className="text-meta text-[var(--sx-text-muted)]">
            Verified Scrutinix result · checked{" "}
            <time dateTime={sharedSnapshot.capturedAt}>
              {formatSnapshotTime(sharedSnapshot.capturedAt)}
            </time>
            . It may be out of date.
          </p>
        </div>
      </Band>
    );
  }

  if (!result && unverifiedShare) {
    // Someone's claim, not ours: no verdict word, tint, score, summary, or
    // strip from the payload. The link's anatomy below is Scrutinix's own.
    return (
      <Band
        label="Shared link, not verified"
        tone="pending"
        heading={<span>Check this shared link yourself</span>}
        headingClassName="text-headline sm:text-headline text-[var(--sx-text)]"
        imperative="We can't confirm the result in this link came from Scrutinix. It may be old or edited, so we're not showing it."
      >
        {onRunSharedScan ? (
          <div className="mt-5">
            <RunSharedScanButton
              onClick={onRunSharedScan}
              label="Scan this link"
            />
          </div>
        ) : null}
      </Band>
    );
  }

  if (!result) return null;

  const threatInfo = result.threatInfo;
  const guidance = getVerdictGuidance({ ...result, impersonates });
  const score = clampScore(threatInfo?.score);
  // A failed scan has no confidence to state; nothing defaults to "low".
  const confidence =
    threatInfo && result.verdict !== "error"
      ? (guidance.confidenceNote ??
        `${capitalize(threatInfo.confidenceLabel)} confidence`)
      : null;
  const caveat = getCoverageCaveat(result);
  const because =
    threatInfo && shouldShowVerdictSummary(result, driverRows)
      ? threatInfo.summary
      : null;

  return (
    <Band
      label={`Scan result: ${result.verdict}`}
      tone={guidance.tone}
      heading={
        // Keyed so the word remounts and arrives when a result lands.
        <span key={result.id} className="sx-band-arrive capitalize">
          {result.verdict}
        </span>
      }
      headingClassName="text-[var(--sx-text)]"
      imperative={guidance.imperative}
      aside={
        guidance.showScore ? (
          <div className="flex shrink-0 flex-row items-baseline gap-3 sm:flex-col sm:items-end sm:gap-1 sm:pt-1.5">
            <span
              role="meter"
              aria-label="Threat score"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={score}
              aria-valuetext={`${score} out of 100`}
              className="font-sans text-[2rem] leading-none font-medium tracking-[-0.02em] text-[var(--sx-text)] tabular-nums"
            >
              {/* Sans: Geist Mono's slashed zero reads as "Ø" at this size. */}
              {score}
              <span className="text-meta font-mono font-normal tracking-normal text-[var(--sx-text-muted)]">
                /100
              </span>
            </span>
            <span className="text-meta text-[var(--sx-text-muted)]">
              {getScoreBandText(score)}
            </span>
          </div>
        ) : null
      }
    >
      {because ? (
        <p className="text-body mt-4 max-w-[60ch] text-[var(--sx-text)]">
          {because}
        </p>
      ) : null}
      {caveat ? (
        <p className="text-body mt-4 max-w-[60ch] text-[var(--sx-text-muted)]">
          {caveat}
        </p>
      ) : null}
      {confidence ? (
        // When the line wraps, the link starts the next line with its
        // separator in the 1.25rem gutter left of the text edge, which the
        // clip hides; the clip keeps 0.25rem so the focus ring still shows.
        <p className="text-meta mt-5 text-[var(--sx-text-muted)] [clip-path:inset(-0.5rem_-0.5rem_-0.5rem_-0.25rem)]">
          <span className="-ml-5 flex flex-wrap items-baseline gap-y-1">
            <span className="ml-5">{confidence}</span>
            <span className="whitespace-nowrap">
              <span aria-hidden="true" className="inline-block w-5 text-center">
                ·
              </span>
              <Link href="/about#scoring" className="sx-link">
                How scoring works
              </Link>
            </span>
          </span>
        </p>
      ) : null}
    </Band>
  );
}

/**
 * The full reasoning, closed by default: what we found, what to do,
 * caveats, why this confidence, and scan metadata.
 */
export function VerdictDetails({
  result,
  impersonates = null,
}: {
  result: AnalysisResult;
  /** Look-alike domain from the link anatomy; hedges "What to do". */
  impersonates?: string | null;
}) {
  const threatInfo = result.threatInfo;
  const confidenceLabel = threatInfo?.confidenceLabel ?? "low";
  const reasons = threatInfo?.hasPositiveEvidence
    ? (threatInfo?.reasons ?? [])
    : [];
  const recommendations = getVerdictRecommendations({
    ...result,
    impersonates,
  });
  const limitations = threatInfo?.limitations ?? [];
  const confidenceReasons = getConfidenceReasons({ ...result, impersonates });
  const metadata = result.metadata;
  const completed = Object.values(result.signals).filter(
    (signal) => signal.status !== "pending",
  ).length;

  if (
    reasons.length === 0 &&
    recommendations.length === 0 &&
    limitations.length === 0 &&
    confidenceReasons.length === 0
  ) {
    return null;
  }

  return (
    <details className="sx-disclosure border-t border-[var(--sx-border)] pt-4">
      <summary className="text-meta inline-flex min-h-11 items-center gap-2 font-medium text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]">
        <svg
          aria-hidden="true"
          viewBox="0 0 8 8"
          className="sx-chevron size-2 fill-current"
        >
          <path d="M2 0l4 4-4 4z" />
        </svg>
        How we reached this verdict
      </summary>
      <div className="mt-2 max-w-[62ch] space-y-5 pb-1 text-sm leading-6">
        {reasons.length > 0 ? (
          <div>
            <h3 className={DETAIL_HEADING}>What we found</h3>
            <ul className="mt-1.5 space-y-1 text-[var(--sx-text)]">
              {reasons.slice(0, 6).map((reason, index) => (
                <li key={`${index}-${reason}`}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {recommendations.length > 0 ? (
          <div>
            <h3 className={DETAIL_HEADING}>What to do</h3>
            <ul className="mt-1.5 space-y-1 text-[var(--sx-text)]">
              {recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {limitations.length > 0 ? (
          <div>
            <h3 className={DETAIL_HEADING}>Caveats</h3>
            <ul className="mt-1.5 space-y-1 text-[var(--sx-text-muted)]">
              {limitations.slice(0, 4).map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {confidenceReasons.length > 0 ? (
          <div>
            <h3 className={DETAIL_HEADING}>Why {confidenceLabel} confidence</h3>
            <ul className="mt-1.5 space-y-1 text-[var(--sx-text-muted)]">
              {confidenceReasons.slice(0, 4).map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-caption font-mono text-[var(--sx-text-soft)]">
          {completed}/{SIGNAL_COUNT} checks
          {metadata?.durationMs ? ` · ${metadata.durationMs} ms` : ""}
          {metadata?.completedAt
            ? ` · finished ${formatTimestamp(metadata.completedAt)}`
            : ""}
          {metadata?.cacheHit ? " · cached" : ""}
        </p>
      </div>
    </details>
  );
}
