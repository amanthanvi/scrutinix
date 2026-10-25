import { capitalize } from "@/lib/domain/copy";
import { describeLimitedChecks, getLimitedChecks } from "@/lib/domain/coverage";
import type {
  AnalysisResult,
  SharedSnapshot,
  Verdict,
  VerdictBasis,
} from "@/lib/domain/types";
import { isLegacySignalRecord } from "@/lib/domain/signal-signature";
import { evidenceTimeOf, getVerdictBasis } from "@/lib/domain/verdict-basis";

/**
 * Pure presentation logic for a finished verdict: the one-line instruction,
 * whether a score is meaningful, the screen-reader announcement, and the
 * coverage caveat. Components render these strings; they never compose
 * verdict copy themselves.
 */

type GuidanceInput = Pick<AnalysisResult, "verdict" | "threatInfo"> & {
  /** `checkedAt`/`completedAt` date the evidence (`getVerdictBasis`). */
  metadata?:
    | (Pick<AnalysisResult["metadata"], "partialFailure"> &
        Partial<Pick<AnalysisResult["metadata"], "checkedAt" | "completedAt">>)
    | null;
  /** Optional: shared snapshots and legacy records carry no signals. */
  signals?: AnalysisResult["signals"] | null;
  /** When present, the announcement names the host it is about. */
  url?: string | null;
  /**
   * A domain the link spells out but does not belong to
   * (`LinkAnatomy.impersonates`). Presentation only, never the score or
   * the stored verdict: a Safe verdict is shown as "Look-alike"
   * (`verdictWord`), with a hardened instruction, a plain note instead of
   * the reassuring confidence line, a neutral band, and its score moved to
   * the details (`getUnderlyingVerdictNote`). Unknown keeps its own word
   * and instruction. The owner fact itself is said once, by
   * `ownershipSentence`, in the anatomy line.
   */
  impersonates?: string | null;
  /**
   * The look-alike check couldn't run: the link parser failed to load, so
   * whether the address imitates another site is unknown. Presentation
   * only, like `impersonates`: a Safe verdict is shown as "Unconfirmed"
   * (`verdictWord`) with a neutral band, no score, an instruction to check
   * the address, and a note saying why in place of the confidence line.
   * While the parser is still loading nothing is stated at all
   * (`ADDRESS_CHECK_PENDING`).
   */
  addressUnchecked?: boolean;
  /**
   * The link's registered domain (`LinkAnatomy.registeredDomain`). Channels
   * with no anatomy line (the live region) append the ownership sentence.
   */
  registeredDomain?: string | null;
  /**
   * A verified shared snapshot's signed basis (`SharedSnapshot.basis`),
   * standing in for the threatInfo, metadata, and signals a snapshot
   * doesn't carry. Absent for a result: its basis is read from the result
   * itself (`getVerdictBasis`), so the two word the instruction the same.
   */
  basis?: VerdictBasis | null;
};

/** The facts the instruction is worded from (`getVerdictBasis`). */
function basisOf(
  result: Pick<GuidanceInput, "threatInfo" | "metadata" | "signals" | "basis">,
): VerdictBasis {
  return result.basis ?? getVerdictBasis(result);
}

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

/** The word a Safe look-alike is shown as, everywhere a verdict is named. */
export const LOOK_ALIKE_WORD = "Look-alike";

/**
 * A Safe verdict on a link whose address couldn't be checked for a
 * look-alike (`addressUnchecked`). An actual look-alike outranks it.
 */
export function isUncheckedSafe(
  result: Pick<GuidanceInput, "verdict" | "impersonates" | "addressUnchecked">,
): boolean {
  return (
    result.verdict === "safe" &&
    !result.impersonates &&
    Boolean(result.addressUnchecked)
  );
}

/**
 * The word a Safe verdict is shown as when its address couldn't be checked:
 * the checks found nothing, but we can't say the link is what it claims.
 */
export const UNCONFIRMED_WORD = "Unconfirmed";

/**
 * What the band says in place of a Safe verdict while the address check
 * is still loading. Nothing reassuring (or alarming) is stated until it
 * settles; rows hold "—" the same way.
 */
export const ADDRESS_CHECK_PENDING = "Checking the link's address";

/**
 * The verdict word people see: the verdict, except that a Safe look-alike
 * is shown as "Look-alike" on the band, in history and batch rows, in the
 * live announcement, and on share cards. No check flagged it, so "Safe"
 * would reassure while the instruction warns; the stored verdict and score
 * are unchanged and stated in the details (`getUnderlyingVerdictNote`).
 * A Safe link whose address couldn't be checked reads "Unconfirmed" on
 * the same surfaces, for the same reason.
 */
export function verdictWord(
  result: Pick<GuidanceInput, "verdict" | "impersonates" | "addressUnchecked">,
): string {
  if (isLookAlikeSafe(result)) return LOOK_ALIKE_WORD;
  if (isUncheckedSafe(result)) return UNCONFIRMED_WORD;
  return verdictLabel(result.verdict);
}

/**
 * What a share preview leads with: the verdict word (`verdictWord`); a
 * Safe look-alike's page title names the imitated site, since many chat
 * clients show only the title and image. `short` is the card's one word,
 * whose ownership line names both domains.
 */
export function shareHeadline(
  result: Pick<GuidanceInput, "verdict" | "impersonates">,
  { short = false }: { short?: boolean } = {},
): string {
  if (isLookAlikeSafe(result) && !short) {
    return `${LOOK_ALIKE_WORD} of ${result.impersonates}`;
  }
  return verdictWord(result);
}

/**
 * Whether we may say no check flagged the link: only when the verdict
 * engine scored nothing against it. A Safe verdict can still carry minor
 * findings (one VirusTotal engine, a few structure points), and a shared
 * snapshot without a basis carries no evidence to say either way.
 */
function nothingFlagged(
  result: Pick<GuidanceInput, "threatInfo" | "basis">,
): boolean {
  return basisOf(result).clean;
}

/**
 * Where a Safe look-alike's own verdict and score live, since its band
 * shows "Look-alike" and no score: "No check flagged it: on their own, the
 * checks scored it Safe, 4 out of 100." It only says nothing was flagged
 * when that is true. An "Unconfirmed" Safe states them the same way. Null
 * for every other result.
 */
export function getUnderlyingVerdictNote(
  result: Pick<
    GuidanceInput,
    "verdict" | "impersonates" | "addressUnchecked" | "threatInfo" | "basis"
  >,
): string | null {
  if (!isLookAlikeSafe(result) && !isUncheckedSafe(result)) {
    return null;
  }
  const score = result.threatInfo
    ? `, ${clampScore(result.threatInfo.score)} out of 100`
    : "";
  const scored = `the checks scored it ${verdictLabel(result.verdict)}${score}.`;
  return nothingFlagged(result)
    ? `No check flagged it: on their own, ${scored}`
    : `On their own, ${scored}`;
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
 * signs (or a shared snapshot with no basis to say otherwise).
 */
export function isProvisionalSafe(result: GuidanceInput): boolean {
  if (result.verdict !== "safe") {
    return false;
  }

  const basis = basisOf(result);
  return basis.confidence !== "high" || !basis.clean || basis.partial;
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
        imperative: basisOf(result).confirmed
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
        // No check flagged it, but a green band, "High confidence", and a
        // low score would contradict the instruction. The word reads
        // "Look-alike" (`verdictWord`); the score moves to the details.
        return {
          imperative: "Don't sign in or enter details here.",
          showScore: false,
          tone: "unknown",
          confidenceNote: nothingFlagged(result)
            ? "No check flagged it, but the name is misleading."
            : "The checks found nothing serious, but the name is misleading.",
        };
      }
      if (result.addressUnchecked) {
        // The parser that spots look-alikes failed to load. "Looks safe to
        // open" and "High confidence" would vouch for an address nobody
        // checked; say what to do and why, and move the score to the
        // details.
        return {
          imperative: "Check the link's address before you open it.",
          showScore: false,
          tone: "unknown",
          confidenceNote: UNCHECKED_ADDRESS_NOTE,
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

/**
 * The guidance for a verified shared snapshot: its verdict and the basis
 * the server signed with it, plus the look-alike from Scrutinix's own
 * anatomy of the link. The shared band, the page's metadata, and the share
 * card all take their instruction from here, so a recipient reads what the
 * sender's band said. A snapshot signed before the basis existed keeps the
 * hedged forms ("Probably safe — still check who sent it.", a plain
 * "Don't open this link."). Call it only with a verified snapshot.
 */
export function getSharedGuidance(
  snapshot: Pick<SharedSnapshot, "verdict" | "basis">,
  impersonates: string | null,
): VerdictGuidance {
  return getVerdictGuidance({
    verdict: snapshot.verdict,
    threatInfo: null,
    basis: snapshot.basis ?? null,
    impersonates,
  });
}

/** Why an "Unconfirmed" Safe carries no score or confidence on its band. */
const UNCHECKED_ADDRESS_NOTE =
  "We couldn't check whether this address imitates another site.";

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
  // The live region has no anatomy line: it states the owner itself, or
  // that the address couldn't be checked.
  const owner =
    result.impersonates && result.registeredDomain
      ? ` ${ownershipSentence(result.registeredDomain, result.impersonates)}`
      : isUncheckedSafe(result)
        ? ` ${UNCHECKED_ADDRESS_NOTE}`
        : "";
  return `${subject}: ${verdictWord(result)}${score}. ${guidance.imperative}${owner}`;
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
 * another site, and an "Unconfirmed" Safe that its address wasn't checked.
 */
export function getConfidenceReasons(result: GuidanceInput): string[] {
  const reasons = result.threatInfo?.confidenceReasons ?? [];
  if (isLookAlikeSafe(result)) {
    return [
      ...reasons.slice(0, 3),
      `Confidence covers reputation only; the address still imitates ${result.impersonates}.`,
    ];
  }
  if (isUncheckedSafe(result)) {
    return [
      ...reasons.slice(0, 3),
      "Confidence covers reputation only; we couldn't check whether the address imitates another site.",
    ];
  }
  return reasons;
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
 * - Not when the evidence below states it (`evidenceShown`): the Summary
 *   questions answer "Has it been reported?" and "What else raises
 *   concern?" with the same facts, and the Full rows state each check, so
 *   the line would say one fact twice. In practice it shows only for a
 *   result with no evidence on screen (a record saved before checks were
 *   kept).
 * - Not for a clean, fully covered Safe result: "Looks safe to open."
 *   already says it.
 *
 * The summary stays in the data for shares, exports, and history search.
 */
export function shouldShowVerdictSummary(
  result: Pick<AnalysisResult, "verdict" | "threatInfo"> & {
    metadata?: Pick<AnalysisResult["metadata"], "partialFailure"> | null;
  },
  evidenceShown = false,
): boolean {
  if (!result.threatInfo?.summary || evidenceShown) {
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
 * A Safe result's summary when the engine scored nothing and every check
 * finished in full (`buildSummary` in `lib/domain/verdict.ts`).
 */
export const NOTHING_FLAGGED_SUMMARY = "No check flagged this link.";

/**
 * Whether a verified shared band prints the snapshot's summary. With no
 * evidence beneath it, it is the one sentence a recipient gets on why, so
 * it shows, except where it only repeats the instruction: under "Looks
 * safe to open.", "No check flagged this link." says it again, and the
 * sender's band left it out too (`shouldShowVerdictSummary`). "…, but some
 * checks were limited." adds something, so it stays.
 */
export function shouldShowSharedSummary(
  snapshot: Pick<SharedSnapshot, "verdict" | "summary" | "basis">,
  impersonates: string | null,
): boolean {
  if (!snapshot.summary) return false;
  const saysLooksSafe =
    snapshot.verdict === "safe" &&
    !impersonates &&
    !isProvisionalSafe({
      verdict: snapshot.verdict,
      threatInfo: null,
      basis: snapshot.basis ?? null,
    });
  return !(saysLooksSafe && snapshot.summary === NOTHING_FLAGGED_SUMMARY);
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
 * VirusTotal analysis is aged at the result's check time (`evidenceTimeOf`),
 * the clock its verdict, basis, and Summary use, so a reopened result says
 * what its verdict was built on.
 */
export function getCoverageCaveat(
  result: Pick<AnalysisResult, "verdict" | "signals"> & {
    metadata?: Partial<
      Pick<AnalysisResult["metadata"], "checkedAt" | "completedAt">
    > | null;
  },
): string | null {
  if (result.verdict === "error" || isLegacySignalRecord(result.signals)) {
    return null;
  }

  const checks = getLimitedChecks(
    result.signals,
    evidenceTimeOf(result.metadata ?? {}) ?? Date.now(),
  ).filter(
    // Unknown's summary already says the site didn't respond.
    (check) => !(result.verdict === "unknown" && check.kind === "unreachable"),
  );

  return describeLimitedChecks(checks);
}
