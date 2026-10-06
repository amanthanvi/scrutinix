import { capitalize } from "@/lib/domain/copy";
import { describeLimitedChecks, getLimitedChecks } from "@/lib/domain/coverage";
import type { AnalysisResult, Verdict } from "@/lib/domain/types";
import { hasConfirmedReputationHit } from "@/lib/domain/reputation";

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
};

export interface VerdictGuidance {
  /** What the person should do, shown directly under the verdict word. */
  imperative: string;
  /** False when a number would imply a check that never happened. */
  showScore: boolean;
}

export function verdictLabel(verdict: Verdict | string): string {
  return capitalize(verdict);
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
  return `${subject}: ${verdictLabel(result.verdict)}${score}. ${guidance.imperative}`;
}

function announcementHost(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Whether the verdict panel should show the one-line summary. A clean,
 * fully covered Safe result has nothing to add beyond "Looks safe to open."
 * and the quiet-checks line ("All 8 checks found nothing."), so saying
 * "No check flagged this link." as well would state one fact twice. The
 * summary stays in the data for shares, exports, and history search.
 */
export function shouldShowVerdictSummary(
  result: Pick<AnalysisResult, "verdict" | "threatInfo"> & {
    metadata?: Pick<AnalysisResult["metadata"], "partialFailure"> | null;
  },
): boolean {
  if (!result.threatInfo?.summary) {
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
 * in full - or when the verdict line already says the scan failed. A stale
 * VirusTotal analysis is aged at the scan's completion time, so a reopened
 * result says what its verdict was built on.
 */
export function getCoverageCaveat(
  result: Pick<AnalysisResult, "verdict" | "signals"> & {
    metadata?: Pick<AnalysisResult["metadata"], "completedAt"> | null;
  },
): string | null {
  if (result.verdict === "error") {
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
