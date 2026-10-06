import { capitalize } from "@/lib/domain/copy";
import { describeLimitedChecks, getLimitedChecks } from "@/lib/domain/coverage";
import type { AnalysisResult, Verdict } from "@/lib/domain/types";
import { hasConfirmedReputationHit } from "@/lib/domain/reputation";
import { isLegacySignalRecord } from "@/lib/domain/signal-signature";

/**
 * Pure presentation logic for a finished verdict: the one-line instruction,
 * whether a score is meaningful, the screen-reader announcement, and the
 * coverage caveat. Components render these strings; they never compose
 * verdict copy themselves.
 */

type GuidanceInput = Pick<AnalysisResult, "verdict" | "threatInfo"> & {
  metadata?: Pick<AnalysisResult["metadata"], "partialFailure"> | null;
  /** Optional: shared snapshots and legacy records carry no signals. */
  signals?: AnalysisResult["signals"] | null;
  /** When present, the announcement names the host it is about. */
  url?: string | null;
  /**
   * A domain the link spells out but does not belong to
   * (`LinkAnatomy.impersonates`). Presentation only, never the score or
   * the verdict word: on a Safe verdict it hardens the instruction, swaps
   * the reassuring confidence line for a plain note, and turns the band
   * neutral. Unknown keeps its own instruction. The owner fact itself is
   * said once, by `ownershipSentence`, in the anatomy line.
   */
  impersonates?: string | null;
  /**
   * The link's registered domain (`LinkAnatomy.registeredDomain`). Channels
   * with no anatomy line (the live region) append the ownership sentence.
   */
  registeredDomain?: string | null;
};

const VERDICTS: readonly Verdict[] = [
  "safe",
  "suspicious",
  "malicious",
  "critical",
  "unknown",
  "error",
];

export interface VerdictGuidance {
  /** What the person should do, shown directly under the verdict word. */
  imperative: string;
  /** False when a number would imply a check that never happened. */
  showScore: boolean;
  /**
   * The band's colour. Normally the verdict; a look-alike Safe takes the
   * neutral Unknown surface so the one colour encoding never reassures
   * while the instruction warns.
   */
  tone: Verdict;
  /**
   * Replaces the "<X> confidence" line when the verdict's confidence would
   * read as an endorsement of a look-alike. Null otherwise.
   */
  confidenceNote: string | null;
}

export function verdictLabel(verdict: Verdict | string): string {
  return capitalize(verdict);
}

/** A Safe verdict on a link that spells out another site's domain. */
export function isLookAlikeSafe(
  result: Pick<GuidanceInput, "verdict" | "impersonates">,
): boolean {
  return result.verdict === "safe" && Boolean(result.impersonates);
}

/**
 * What a share preview leads with: the verdict word, except that a Safe
 * look-alike never leads with "Safe" (many chat clients show only the
 * title and image). `short` is the card's one word, whose ownership line
 * names both domains; the title names the imitated site.
 */
export function shareHeadline(
  result: Pick<GuidanceInput, "verdict" | "impersonates">,
  { short = false }: { short?: boolean } = {},
): string {
  if (isLookAlikeSafe(result)) {
    return short ? "Look-alike" : `Look-alike of ${result.impersonates}`;
  }
  return verdictLabel(result.verdict);
}

/**
 * The one sentence that states a look-alike's real owner: "This link
 * belongs to secure-login.xyz, not paypal.com." Every surface that states
 * the fact (anatomy, live region, share description, share card) uses it.
 */
export function ownershipSentence(
  registeredDomain: string,
  impersonates: string,
): string {
  return `This link belongs to ${registeredDomain}, not ${impersonates}.`;
}

/**
 * A Safe verdict we cannot fully stand behind: confidence below high, a
 * check that failed or only partly finished, or one with minor warning
 * signs.
 */
export function isProvisionalSafe(result: GuidanceInput): boolean {
  if (result.verdict !== "safe") {
    return false;
  }

  return (
    result.threatInfo?.confidenceLabel !== "high" ||
    Boolean(result.threatInfo?.hasPositiveEvidence) ||
    Boolean(result.metadata?.partialFailure)
  );
}

export function getVerdictGuidance(result: GuidanceInput): VerdictGuidance {
  const verdict = result.verdict;
  const base = {
    tone: VERDICTS.includes(verdict) ? verdict : ("error" as const),
    confidenceNote: null,
  };
  return { ...base, ...getInstruction(result) };
}

function getInstruction(
  result: GuidanceInput,
): Pick<VerdictGuidance, "imperative" | "showScore"> &
  Partial<Pick<VerdictGuidance, "tone" | "confidenceNote">> {
  switch (result.verdict) {
    case "critical":
      // Critical can come from local heuristics alone; "known threat" is
      // only true when a reputation source confirmed it.
      return {
        imperative:
          result.signals && hasConfirmedReputationHit(result.signals)
            ? "Don't open this link — it's a known threat."
            : "Don't open this link.",
        showScore: true,
      };
    case "malicious":
      return { imperative: "Don't open this link.", showScore: true };
    case "suspicious":
      return {
        imperative: "Don't sign in or enter payment details here.",
        showScore: true,
      };
    case "safe":
      if (result.impersonates) {
        // No check flagged it, but a green band and "High confidence"
        // would contradict the instruction. The score and word stay.
        return {
          imperative: "Don't sign in or enter details here.",
          showScore: true,
          tone: "unknown",
          confidenceNote: "No check flagged it, but the name is misleading.",
        };
      }
      return {
        imperative: isProvisionalSafe(result)
          ? "Probably safe — still check who sent it."
          : "Looks safe to open.",
        showScore: true,
      };
    case "unknown":
      return {
        imperative: "We couldn't check this link — treat it as unsafe.",
        showScore: false,
      };
    default:
      return { imperative: "The scan failed — try again.", showScore: false };
  }
}

/** Clamp a stored score into the 0-100 range the meter promises. */
export function clampScore(score: number | null | undefined): number {
  return Math.min(Math.max(Math.round(score ?? 0), 0), 100);
}

/** The band a score falls in, worded for display: "Malicious band 55–79". */
export function getScoreBandText(score: number): string {
  if (score >= 80) return "Critical band 80–100";
  if (score >= 55) return "Malicious band 55–79";
  if (score >= 25) return "Suspicious band 25–54";
  return "Safe band 0–24";
}

/**
 * What the polite live region says when a result is shown, e.g.
 * "Result for evil.example: Malicious, 73 out of 100. Don't open this
 * link." Naming the host makes two opened results with the same verdict
 * read differently.
 */
export function getVerdictAnnouncement(result: GuidanceInput): string {
  const guidance = getVerdictGuidance(result);
  const score = guidance.showScore
    ? `, ${clampScore(result.threatInfo?.score)} out of 100`
    : "";
  const host = result.url ? announcementHost(result.url) : null;
  const subject = host ? `Result for ${host}` : "Result";
  // The live region has no anatomy line: it states the owner itself.
  const owner =
    result.impersonates && result.registeredDomain
      ? ` ${ownershipSentence(result.registeredDomain, result.impersonates)}`
      : "";
  return `${subject}: ${verdictLabel(result.verdict)}${score}. ${guidance.imperative}${owner}`;
}

/**
 * "What to do" in the verdict details. A look-alike that no check flagged
 * gets the hedged steps instead of the engine's ("Still check who sent the
 * link before you sign in"), which would read as permission to sign in.
 */
export function getVerdictRecommendations(result: GuidanceInput): string[] {
  if (
    result.impersonates &&
    (result.verdict === "safe" || result.verdict === "unknown")
  ) {
    return [
      "Don't sign in, pay, or enter codes on this site.",
      `To reach ${result.impersonates}, type its address yourself or use its app.`,
    ];
  }
  return result.threatInfo?.recommendations ?? [];
}

/**
 * "Why <X> confidence" in the details. Confidence measures reputation
 * coverage only, so a look-alike Safe says that its address still imitates
 * another site.
 */
export function getConfidenceReasons(result: GuidanceInput): string[] {
  const reasons = result.threatInfo?.confidenceReasons ?? [];
  return isLookAlikeSafe(result)
    ? [
        ...reasons.slice(0, 3),
        `Confidence covers reputation only; the address still imitates ${result.impersonates}.`,
      ]
    : reasons;
}

function announcementHost(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Whether the verdict band should show the one-line summary as its
 * "because" line. It only appears when it adds information:
 *
 * - Not when Summary already shows driver rows: "7 VirusTotal engines
 *   flagged this link." above a VirusTotal row saying the same thing
 *   states one fact twice (`driverRows`).
 * - Not for a clean, fully covered Safe result: "Looks safe to open." and
 *   the quiet-checks line ("All 8 checks found nothing.") already say it.
 *
 * The summary stays in the data for shares, exports, and history search.
 */
export function shouldShowVerdictSummary(
  result: Pick<AnalysisResult, "verdict" | "threatInfo"> & {
    metadata?: Pick<AnalysisResult["metadata"], "partialFailure"> | null;
  },
  driverRows = 0,
): boolean {
  if (!result.threatInfo?.summary || driverRows > 0) {
    return false;
  }
  if (result.verdict !== "safe") {
    return true;
  }

  return (
    result.threatInfo.hasPositiveEvidence ||
    result.threatInfo.limitations.length > 0 ||
    Boolean(result.metadata?.partialFailure)
  );
}

/**
 * One sentence naming the checks that limited coverage, e.g. "VirusTotal
 * didn't finish; TLS Certificate couldn't be fully verified." Built from
 * the same `getLimitedChecks` list the verdict summary's "some checks were
 * limited" comes from, so the two always agree. Null when every check ran
 * in full - or when the verdict line already says the scan failed. Legacy
 * records get no caveat either: their checks finished but were never
 * stored (the sanitizer fills each as a "missing" error), and the legacy
 * notice beside the result says exactly that. A stale
 * VirusTotal analysis is aged at the scan's completion time, so a reopened
 * result says what its verdict was built on.
 */
export function getCoverageCaveat(
  result: Pick<AnalysisResult, "verdict" | "signals"> & {
    metadata?: Pick<AnalysisResult["metadata"], "completedAt"> | null;
  },
): string | null {
  if (result.verdict === "error" || isLegacySignalRecord(result.signals)) {
    return null;
  }

  const completedAt = Date.parse(result.metadata?.completedAt ?? "");
  const checks = getLimitedChecks(
    result.signals,
    Number.isNaN(completedAt) ? Date.now() : completedAt,
  ).filter(
    // Unknown's summary already says the site didn't respond.
    (check) => !(result.verdict === "unknown" && check.kind === "unreachable"),
  );

  return describeLimitedChecks(checks);
}
