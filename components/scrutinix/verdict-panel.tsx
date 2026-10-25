"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";

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
  SCORE_BAND_TOPS,
  bandSays,
  clampScore,
  type BandOutcomes,
  getConfidenceReasons,
  getCoverageCaveat,
  getScoreBandText,
  getUnderlyingVerdictNote,
  getVerdictGuidance,
  getVerdictRecommendations,
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
 * by the band's own hairline. A scan's band holds its room (`BandRoom`).
 */
const CONFIDENCE_LINE = "sx-band-line";

/** Cancel while checking: a quiet button in the score's place. */
const CANCEL_BUTTON =
  "sx-btn-press text-body -mr-[12px] inline-flex min-h-11 items-center rounded-md px-[12px] font-medium";

/** The band's one ink button (a shared band's scan, a failed scan's retry). */
const INK_BUTTON =
  "sx-btn-press text-body inline-flex min-h-12 items-center rounded-md px-5 font-semibold";

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
 *
 * `room` marks a scan's band (Checking, the address check, and the verdict
 * it lands as). It holds the room the tallest verdict that can still land
 * takes (`BandRoom`), so Checking and that verdict are one height and
 * nothing on the page moves when it lands. What the band says sits at its
 * top and the confidence line at its foot, so any room a verdict leaves
 * opens above the hairline (or, with no last line, at the band's foot),
 * never between the word, the site, the instruction, and the score's place.
 * A shared band holds nothing: only a tap replaces it.
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
  room,
  children,
}: {
  label: string;
  tone: Verdict | "pending";
  arrival?: string;
  heading: ReactNode;
  headingClassName?: string;
  domain?: string | null;
  holdDomain?: boolean;
  /**
   * The score's place: the score, Cancel while checking, or a failed
   * scan's Try again, each its own element with `.sx-band-aside`, so one
   * never turns into (or slides into) another. Without it the word and
   * instruction take the band's width (`.sx-band-across`).
   */
  aside?: ReactNode;
  imperative: ReactNode;
  room?: BandOutcomes;
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
      <div className={cn("sx-band-body", !aside && "sx-band-across")}>
        {/* First, so a selection from the word to the last line never
            crosses it. */}
        {room ? (
          <BandRoom
            domain={domain ?? (holdDomain ? " " : null)}
            outcomes={room}
          />
        ) : null}
        <div className="sx-band-head">
          <div className="sx-slot sx-band-word">
            {room ? (
              <StandIns
                texts={wordsOf(room)}
                className="sx-band-heading font-serif font-semibold"
              />
            ) : null}
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
          </div>
          {domain ? (
            <p className="sx-band-domain">{domain}</p>
          ) : holdDomain ? (
            <p aria-hidden="true" className="sx-band-domain invisible">
              &nbsp;
            </p>
          ) : null}
        </div>
        <p className="sx-band-imperative">{imperative}</p>
        {aside}
        {children ? <div className="sx-band-tail">{children}</div> : null}
      </div>
    </section>
  );
}

/**
 * A scan's band without a verdict yet is laid out like one with a score: a
 * word, a progress line (or the address check), and Cancel in the score's
 * place.
 */
const HELD = {
  words: ["Checking"],
  lines: [
    `${SIGNAL_COUNT} of ${SIGNAL_COUNT} checks finished`,
    ADDRESS_CHECK_PENDING,
  ],
};

/**
 * Every word a scan's band can show. At a larger text size on a narrow
 * phone one word can wrap where another doesn't ("Checking" onto two lines,
 * "Safe" on one), so the band's own word slot holds the tallest of them
 * (`.sx-band-word`): the site and the instruction under it never move when
 * the verdict replaces "Checking".
 */
function wordsOf(outcomes: BandOutcomes): string[] {
  const { beside, across } = bandSays(outcomes);
  return [...beside.words, ...HELD.words, ...across.words];
}

/** The buttons that can take the score's place. */
const ASIDE_BUTTONS = [
  ["Cancel scan", CANCEL_BUTTON],
  ["Try again", INK_BUTTON],
] as const;

/**
 * The room a scan's band holds: the band's own layout drawn twice more,
 * invisibly, over the whole band (`.sx-band-room` shares its columns). One
 * holds the tallest band with something in the score's place (its longest
 * word and instruction, a score or a button, a confidence label; Checking
 * fits it too), the other the tallest band without (its longest word and
 * instruction across the band, then the longest note or label), of the
 * verdicts `outcomes` leaves possible. The band is as tall as the taller
 * of the two in every state; its last row is the only flexible one, so
 * the room a verdict doesn't use opens there, at the band's foot, never
 * between the word, the site, the instruction, and the score's place.
 */
function BandRoom({
  domain,
  outcomes,
}: {
  domain: string | null;
  outcomes: BandOutcomes;
}) {
  const { beside, across, confidenceLabels } = bandSays(outcomes);
  const head = (words: readonly string[]) => (
    <div className="sx-band-head">
      <div className="sx-slot">
        <StandIns
          texts={words}
          className="sx-band-heading font-serif font-semibold"
        />
      </div>
      {domain ? <p data-stand-in={domain} className="sx-band-domain" /> : null}
    </div>
  );
  const instruction = (lines: readonly string[]) => (
    <p className="sx-band-imperative sx-slot">
      <StandIns texts={lines} />
    </p>
  );
  return (
    <>
      <div aria-hidden="true" className="sx-band-room sx-stand-in">
        {head([...beside.words, ...HELD.words])}
        {instruction([...beside.imperatives, ...HELD.lines])}
        <div className="sx-band-aside sx-slot">
          {SCORE_BAND_TOPS.map((top) => (
            <ScoreLine
              key={top}
              score={top}
              band={getScoreBandText(top)}
              standIn
            />
          ))}
          {ASIDE_BUTTONS.map(([text, box]) => (
            <span key={text} data-stand-in={text} className={box} />
          ))}
        </div>
        <div className="sx-band-tail sx-slot">
          {confidenceLabels.map((text) => (
            <ConfidenceLine key={text} text={text} emphasis standIn />
          ))}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="sx-band-room sx-band-across sx-stand-in"
      >
        {head(across.words)}
        {instruction(across.imperatives)}
        <div className="sx-band-tail sx-slot">
          {[...confidenceLabels, ...across.notes].map((text) => (
            <ConfidenceLine
              key={text}
              text={text}
              emphasis={confidenceLabels.includes(text)}
              standIn
            />
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Invisible text holding the room `texts` take: generated content (never
 * text to select, find, or hear) stacked in the slot's one cell.
 */
function StandIns({
  texts,
  className,
}: {
  texts: readonly string[];
  className?: string;
}) {
  return texts.map((text) => (
    <span
      key={text}
      aria-hidden="true"
      data-stand-in={text}
      className={cn("sx-stand-in", className)}
    />
  ));
}

/**
 * The score with its band ("62/100", "Malicious band 55–79"), or (as a
 * `standIn`) the room that score and band take.
 */
function ScoreLine({
  score,
  band,
  standIn = false,
  className,
}: {
  score: number;
  band: string;
  standIn?: boolean;
  className?: string;
}) {
  if (standIn) {
    return (
      <div className="sx-score">
        <span
          data-stand-in={String(score)}
          className="sx-score-value font-serif tabular-nums"
        >
          <span data-stand-in="/100" />
        </span>
        <span data-stand-in={band} />
      </div>
    );
  }
  return (
    <div className={cn("sx-score", className)}>
      <span
        role="meter"
        aria-label="Threat score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={`${score} out of 100`}
        className="sx-score-value font-serif tabular-nums"
      >
        {score}
        <span>/100</span>
      </span>
      <span>{band}</span>
    </div>
  );
}

/**
 * The band's last line: the confidence label in ink 600 (`emphasis`), or a
 * note in its place, then "How scoring works". As a `standIn` it draws
 * nothing and holds the room that line takes.
 */
function ConfidenceLine({
  text,
  emphasis = false,
  standIn = false,
}: {
  text: string;
  emphasis?: boolean;
  standIn?: boolean;
}) {
  return (
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
            emphasis && "font-semibold text-[var(--sx-text)]",
          )}
        >
          {standIn ? <span data-stand-in={text} /> : text}
        </span>
        <span className="whitespace-nowrap">
          {standIn ? (
            <>
              <span
                data-stand-in="·"
                className="inline-block w-5 text-center"
              />
              <span data-stand-in="How scoring works" />
            </>
          ) : (
            <>
              <span aria-hidden="true" className="inline-block w-5 text-center">
                ·
              </span>
              <Link href="/about#scoring" className="sx-link">
                How scoring works
              </Link>
            </>
          )}
        </span>
      </span>
    </p>
  );
}

/**
 * The band before there is a verdict to state: "Checking" in soft ink on
 * the neutral surface and a progress line, in a band holding the room the
 * verdict will take (`room`), so the verdict changes the band's tone in
 * place rather than growing it. Called as a function, not rendered as a
 * component, so the root stays a `Band` and the heading node (and its
 * focus) survives.
 */
function heldBand({
  label,
  line,
  aside,
  domain,
  holdDomain,
  room,
}: {
  label: string;
  line: ReactNode;
  aside?: ReactNode;
  domain: string | null;
  holdDomain: boolean;
  room: BandOutcomes;
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
      room={room}
    />
  );
}

/** The band's one primary action: an ink button. */
function InkButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        INK_BUTTON,
        "bg-[var(--sx-button)] text-[var(--sx-button-fg)] hover:bg-[var(--sx-button-hover)]",
        className,
      )}
    >
      {label}
    </button>
  );
}

/** Stands for the band phase a `room` belongs to (see `useRoom`). */
const CHECKING = "checking";

/**
 * Which verdicts a scan's band holds room for. It starts from what the
 * link's address check knows when a scan starts (or a stored result
 * opens): once the check is ready, a link that spells out no other site
 * can't land as Look-alike or Unconfirmed, so their longer words and notes
 * hold no room. Until the next such start it only ever widens, so a check
 * that settles mid-scan, or after the verdict lands, never shrinks the
 * band under the reader.
 */
function useRoom(phase: string | null, known: BandOutcomes): BandOutcomes {
  const [held, setHeld] = useState({ phase, room: known });
  const fresh =
    held.phase !== phase && (phase === CHECKING || held.phase !== CHECKING);
  const room = fresh
    ? known
    : {
        lookAlike: held.room.lookAlike || known.lookAlike,
        unconfirmed: held.room.unconfirmed || known.unconfirmed,
      };
  if (
    held.phase !== phase ||
    held.room.lookAlike !== room.lookAlike ||
    held.room.unconfirmed !== room.unconfirmed
  ) {
    setHeld({ phase, room });
  }
  return room;
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
  /** Scans the shown link again; a failed scan's band offers it. */
  onRetry?: () => void;
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
  onRetry,
}: VerdictBandProps) {
  const domainProps = { domain: registeredDomain, holdDomain };
  const checking = isStreaming && !result;
  const room = useRoom(checking ? CHECKING : (result?.id ?? null), {
    lookAlike: impersonates !== null || addressCheck === "pending",
    unconfirmed: addressCheck !== "ready",
  });

  if (checking) {
    return heldBand({
      label: "Scanning URL",
      ...domainProps,
      room,
      aside: onCancelScan ? (
        <button
          type="button"
          onClick={onCancelScan}
          className={cn(
            "sx-band-aside",
            CANCEL_BUTTON,
            "text-[var(--sx-text-muted)] hover:bg-[var(--sx-subtle)] hover:text-[var(--sx-text)]",
          )}
        >
          Cancel scan
        </button>
      ) : null,
      line: `${completedSignals} of ${SIGNAL_COUNT} checks finished`,
    });
  }

  if (!result && sharedSnapshot) {
    // Snapshots carry no score: the instruction falls back to its hedged
    // forms and no meter is shown.
    const guidance = getVerdictGuidance({
      verdict: sharedSnapshot.verdict,
      threatInfo: null,
      impersonates,
    });
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
        {sharedSnapshot.summary ? (
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
            <InkButton onClick={onRunSharedScan} label="Run a fresh scan" />
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
            <InkButton onClick={onRunSharedScan} label="Scan this link" />
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
      room,
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
      room={room}
      aside={
        guidance.showScore ? (
          <ScoreLine
            score={score}
            band={getScoreBandText(score)}
            className="sx-band-aside"
          />
        ) : result.verdict === "error" && onRetry ? (
          // A failed scan has no score or confidence to state; the score's
          // place offers what its instruction says ("The scan failed — try
          // again."), where Cancel stood while it ran.
          <InkButton
            onClick={onRetry}
            label="Try again"
            className="sx-band-aside"
          />
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
        <ConfidenceLine text={confidence} emphasis={!guidance.confidenceNote} />
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
