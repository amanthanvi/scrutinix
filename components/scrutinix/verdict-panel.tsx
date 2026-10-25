"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import type { LinkParserStatus } from "@/hooks/use-link-anatomy";
import { capitalize } from "@/lib/domain/copy";
import { SHARE_MAX_AGE_WORDS } from "@/lib/domain/signal-signature";
import type {
  AnalysisResult,
  SharedSnapshot,
  Verdict,
} from "@/lib/domain/types";
import {
  ADDRESS_CHECK_PENDING,
  clampScore,
  getConfidenceReasons,
  getCoverageCaveat,
  getScoreBandText,
  getSharedGuidance,
  getUnderlyingVerdictNote,
  getVerdictGuidance,
  getVerdictRecommendations,
  shouldShowSharedSummary,
  shouldShowVerdictSummary,
  verdictWord,
} from "@/lib/domain/verdict-guidance";
import { cn } from "@/lib/utils";

/** Details section headings: secondary, but clearly headings. */
const DETAIL_HEADING = "text-body font-semibold text-[var(--sx-text)]";

/** Focus target when a stored result replaces the view or a scan lands. */
export const VERDICT_HEADING_ID = "sx-verdict-heading";

/**
 * The band's tone: its surface, the colour of its top rule, its inner
 * hairline, and the tinted ink for secondary text on it.
 */
function bandStyle(verdict: Verdict | "pending"): CSSProperties {
  return {
    backgroundColor: `var(--sx-${verdict}-surface)`,
    "--sx-band-rule": `var(--sx-${verdict})`,
    "--sx-band-edge": `var(--sx-${verdict}-edge)`,
    "--sx-band-ink": `var(--sx-${verdict}-ink)`,
  } as CSSProperties;
}

/**
 * The band's last line (confidence, or a verified share's note), set off
 * by the band's own hairline. Checking holds its slot.
 */
const CONFIDENCE_LINE = "sx-band-line";

/** Secondary text on the band: tinted from its hue, never plain gray. */
const BAND_INK = "text-[var(--sx-band-ink)]";

/** The neutral band's line for a link Scrutinix did not sign. */
const UNVERIFIED_SHARE_LINE =
  "We can't confirm the result in this link came from Scrutinix. It may be old or edited, so we're not showing it.";

/** The neutral band's line for a signed result past `SHARE_MAX_AGE`. */
const EXPIRED_SHARE_LINE = `This shared result is more than ${SHARE_MAX_AGE_WORDS} old, so we're not showing it.`;

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
    year: "numeric",
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
 * The band frame: squared, on the tone's low-chroma surface, under a heavy
 * top rule. Every state renders the same element tree, so the heading node
 * survives the switch from "Checking" to the verdict and a focused heading
 * keeps focus when the result lands.
 *
 * `arrival` keys the rule: when a verdict lands, a new rule draws left to
 * right over the neutral track (the one authored moment). Without it the
 * band shows only the track (Checking, or a shared link we can't vouch
 * for).
 *
 * `domain` is the registered domain in the display serif directly under
 * the heading: the subject of what the band says. It only names the site;
 * the link anatomy below carries the sentence ("This link belongs to …").
 * While the link parser loads, `holdDomain` keeps its line's height so
 * nothing below the band moves when it arrives.
 */
function Band({
  label,
  tone,
  arrival,
  heading,
  headingClassName,
  domain,
  holdDomain = false,
  aside,
  imperative,
  children,
}: {
  label: string;
  tone: Verdict | "pending";
  arrival?: string;
  heading: ReactNode;
  headingClassName?: string;
  domain?: string | null;
  holdDomain?: boolean;
  aside?: ReactNode;
  imperative: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="sx-band sx-band-frame scroll-mt-4"
      style={bandStyle(tone)}
    >
      {arrival ? (
        <span key={arrival} aria-hidden="true" className="sx-band-rule" />
      ) : null}
      <div className="sx-band-body">
        <div className="min-w-0">
          <h2
            id={VERDICT_HEADING_ID}
            tabIndex={-1}
            className={cn(
              "sx-band-heading font-serif font-semibold",
              headingClassName,
            )}
          >
            {heading}
          </h2>
          {domain ? (
            <p className="sx-band-domain">{domain}</p>
          ) : holdDomain ? (
            <p aria-hidden="true" className="sx-band-domain invisible">
              &nbsp;
            </p>
          ) : null}
          <p className="sx-band-imperative">{imperative}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The band before there is a verdict to state: "Checking" in soft ink on
 * the neutral surface, a progress line, and the confidence line's slot
 * held, so the verdict changes the band's tone in place rather than
 * growing it. Called as a function, not rendered as a component, so the
 * root stays a `Band` and the heading node (and its focus) survives.
 */
function heldBand({
  label,
  line,
  aside,
  domain,
  holdDomain,
}: {
  label: string;
  line: ReactNode;
  aside?: ReactNode;
  domain: string | null;
  holdDomain: boolean;
}) {
  return (
    <Band
      label={label}
      tone="pending"
      heading={<span>Checking</span>}
      headingClassName="text-[var(--sx-text-soft)]"
      domain={domain}
      holdDomain={holdDomain}
      aside={aside}
      imperative={
        <span className="text-[var(--sx-text-muted)] tabular-nums">{line}</span>
      }
    >
      <p aria-hidden="true" className={cn(CONFIDENCE_LINE, "invisible")}>
        &nbsp;
      </p>
    </Band>
  );
}

/** A shared band's one primary action: an ink button. */
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
      className="sx-btn-press text-body inline-flex min-h-12 items-center rounded-md bg-[var(--sx-button)] px-5 font-semibold text-[var(--sx-button-fg)] hover:bg-[var(--sx-button-hover)]"
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
  /**
   * With `unverifiedShare`: the signature was Scrutinix's, but the check
   * is older than `SHARE_MAX_AGE`, so the band says that instead.
   */
  expiredShare?: boolean;
  completedSignals?: number;
  /** Look-alike domain from the link anatomy; hedges Safe and Unknown. */
  impersonates?: string | null;
  /**
   * Whether `impersonates` is final. A Safe result holds in the Checking
   * state while it is "pending" and reads "Unconfirmed" if it "failed";
   * every other verdict shows at once.
   */
  addressCheck?: LinkParserStatus;
  /**
   * The link's registered domain from the anatomy (null until the parser
   * loads): named in the serif under the heading.
   */
  registeredDomain?: string | null;
  /** A link is on screen, so hold the domain line's height until it loads. */
  holdDomain?: boolean;
  /**
   * The questions or rows below state the evidence, so the "because" line
   * yields to them.
   */
  evidenceShown?: boolean;
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
  expiredShare = false,
  completedSignals = 0,
  impersonates = null,
  addressCheck = "ready",
  registeredDomain = null,
  holdDomain = false,
  evidenceShown = false,
  onRunSharedScan,
  onCancelScan,
}: VerdictBandProps) {
  const domainProps = { domain: registeredDomain, holdDomain };

  if (isStreaming && !result) {
    return heldBand({
      label: "Scanning URL",
      ...domainProps,
      aside: onCancelScan ? (
        <button
          type="button"
          onClick={onCancelScan}
          className="sx-btn-press text-body -mr-[12px] inline-flex min-h-11 items-center self-start rounded-md px-[12px] font-medium text-[var(--sx-text-muted)] hover:bg-[var(--sx-subtle)] hover:text-[var(--sx-text)]"
        >
          Cancel scan
        </button>
      ) : null,
      line: `${completedSignals} of ${SIGNAL_COUNT} checks finished`,
    });
  }

  if (!result && sharedSnapshot) {
    // Snapshots carry no score, so no meter is shown. The instruction is
    // worded from the basis the server signed with the verdict, as the
    // sender's band was; a snapshot without one keeps the hedged forms.
    const guidance = getSharedGuidance(sharedSnapshot, impersonates);
    const word = verdictWord({ verdict: sharedSnapshot.verdict, impersonates });
    return (
      <Band
        label={`Scan result: ${word}`}
        tone={guidance.tone}
        arrival={`shared-${sharedSnapshot.verdict}`}
        heading={
          <span
            key={`shared-${sharedSnapshot.verdict}`}
            className="sx-band-arrive"
          >
            {word}
          </span>
        }
        {...domainProps}
        imperative={guidance.imperative}
      >
        {shouldShowSharedSummary(sharedSnapshot, impersonates) ? (
          <p className="text-body mt-4 max-w-[65ch] text-[var(--sx-text)]">
            {sharedSnapshot.summary}
          </p>
        ) : null}
        <div
          className={cn(
            CONFIDENCE_LINE,
            "flex flex-wrap items-center gap-x-5 gap-y-3",
          )}
        >
          {onRunSharedScan ? (
            <RunSharedScanButton
              onClick={onRunSharedScan}
              label="Run a fresh scan"
            />
          ) : null}
          <p className={cn("text-meta", BAND_INK)}>
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
    // Someone's claim, or our own that has expired: no verdict word, tint,
    // score, summary, or strip from the payload. The link's anatomy below
    // is Scrutinix's own.
    return (
      <Band
        label={
          expiredShare ? "Shared result, expired" : "Shared link, not verified"
        }
        tone="pending"
        heading={<span>Check this shared link yourself</span>}
        headingClassName="sx-band-heading-claim text-[var(--sx-text)]"
        {...domainProps}
        imperative={expiredShare ? EXPIRED_SHARE_LINE : UNVERIFIED_SHARE_LINE}
      >
        {onRunSharedScan ? (
          <div className="mt-6">
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

  // Safe is the one verdict a look-alike changes: until the address check
  // settles, state nothing rather than a "Safe" that may turn into
  // "Look-alike".
  if (result.verdict === "safe" && addressCheck === "pending") {
    return heldBand({
      label: ADDRESS_CHECK_PENDING,
      line: ADDRESS_CHECK_PENDING,
      ...domainProps,
    });
  }

  const threatInfo = result.threatInfo;
  const addressUnchecked = addressCheck === "failed";
  const guidance = getVerdictGuidance({
    ...result,
    impersonates,
    addressUnchecked,
  });
  const word = verdictWord({
    verdict: result.verdict,
    impersonates,
    addressUnchecked,
  });
  const score = clampScore(threatInfo?.score);
  // A failed scan has no confidence to state; nothing defaults to "low".
  const confidence =
    threatInfo && result.verdict !== "error"
      ? (guidance.confidenceNote ??
        `${capitalize(threatInfo.confidenceLabel)} confidence`)
      : null;
  const caveat = getCoverageCaveat(result);
  const because =
    threatInfo && shouldShowVerdictSummary(result, evidenceShown)
      ? threatInfo.summary
      : null;

  return (
    <Band
      label={`Scan result: ${word}`}
      tone={guidance.tone}
      arrival={result.id}
      heading={
        // Keyed so the word remounts and arrives when a result lands.
        <span key={result.id} className="sx-band-arrive">
          {word}
        </span>
      }
      headingClassName="text-[var(--sx-text)]"
      {...domainProps}
      imperative={guidance.imperative}
      aside={
        guidance.showScore ? (
          <div className="sx-score">
            <span
              role="meter"
              aria-label="Threat score"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={score}
              aria-valuetext={`${score} out of 100`}
              className="font-serif tabular-nums"
            >
              {score}
              <span>/100</span>
            </span>
            <span>{getScoreBandText(score)}</span>
          </div>
        ) : null
      }
    >
      {because ? (
        <p className="text-body mt-5 max-w-[65ch] text-[var(--sx-text)]">
          {because}
        </p>
      ) : null}
      {caveat ? (
        <p className={cn("text-body mt-4 max-w-[65ch]", BAND_INK)}>{caveat}</p>
      ) : null}
      {confidence ? (
        // When the line wraps, the link starts the next line with its
        // separator in the 1.25rem gutter left of the text edge, which the
        // clip hides; the clip keeps 0.25rem so the focus ring still shows.
        <p
          className={cn(
            CONFIDENCE_LINE,
            BAND_INK,
            "[clip-path:inset(-0.5rem_-0.5rem_-0.75rem_-0.25rem)]",
          )}
        >
          <span className="-ml-5 flex flex-wrap items-baseline gap-y-1">
            <span
              className={cn(
                "ml-5",
                !guidance.confidenceNote &&
                  "font-semibold text-[var(--sx-text)]",
              )}
            >
              {confidence}
            </span>
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
  addressCheck = "ready",
}: {
  result: AnalysisResult;
  /** Look-alike domain from the link anatomy; hedges "What to do". */
  impersonates?: string | null;
  /** As on the band: "failed" states the checks' own verdict and score. */
  addressCheck?: LinkParserStatus;
}) {
  const addressUnchecked = addressCheck === "failed";
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
  const confidenceReasons = getConfidenceReasons({
    ...result,
    impersonates,
    addressUnchecked,
  });
  // A Safe look-alike's band says "Look-alike" with no score (an unchecked
  // one "Unconfirmed"); its own verdict and score are stated here.
  const underlying = getUnderlyingVerdictNote({
    ...result,
    impersonates,
    addressUnchecked,
  });
  const metadata = result.metadata;
  const completed = Object.values(result.signals).filter(
    (signal) => signal.status !== "pending",
  ).length;
  // "8/8 checks" alone reads as eight answers when all eight failed.
  const failed = Object.values(result.signals).filter(
    (signal) => signal.status === "error",
  ).length;
  // Failed checks keep a plain sentence; the scan id is the one reference
  // for every server log line behind them, so it is stated once, here.
  const reference =
    result.verdict === "error" || metadata?.partialFailure
      ? metadata?.scanId || result.id
      : null;

  if (
    !underlying &&
    reasons.length === 0 &&
    recommendations.length === 0 &&
    limitations.length === 0 &&
    confidenceReasons.length === 0 &&
    !reference
  ) {
    return null;
  }

  return (
    <details className="sx-disclosure border-t border-[var(--sx-border)] pt-3">
      <summary className="text-body inline-flex min-h-11 items-center gap-2.5 font-medium text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]">
        <svg
          aria-hidden="true"
          viewBox="0 0 8 8"
          className="sx-chevron size-2 fill-current"
        >
          <path d="M2 0l4 4-4 4z" />
        </svg>
        How we reached this verdict
      </summary>
      <div className="text-body mt-2 max-w-[65ch] space-y-5 pb-1">
        {underlying ? (
          <p className="text-[var(--sx-text)]">{underlying}</p>
        ) : null}

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
            <h3 className={DETAIL_HEADING}>
              {/* A look-alike's (or unconfirmed) band claims no confidence;
                  this is the checks' own. */}
              {underlying
                ? `Why the checks have ${confidenceLabel} confidence`
                : `Why ${confidenceLabel} confidence`}
            </h3>
            <ul className="mt-1.5 space-y-1 text-[var(--sx-text-muted)]">
              {confidenceReasons.slice(0, 4).map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-caption font-mono text-[var(--sx-text-soft)]">
          {completed}/{SIGNAL_COUNT} checks
          {failed > 0 ? ` · ${failed} failed` : ""}
          {metadata?.durationMs ? ` · ${metadata.durationMs} ms` : ""}
          {metadata?.completedAt
            ? ` · finished ${formatTimestamp(metadata.completedAt)}`
            : ""}
          {metadata?.cacheHit ? " · cached" : ""}
        </p>
        {reference ? (
          <p className="text-caption font-mono break-all text-[var(--sx-text-soft)]">
            Reference: {reference}
          </p>
        ) : null}
      </div>
    </details>
  );
}
