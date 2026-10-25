import { capitalize, countOf, formatList } from "@/lib/domain/copy";
import {
  VT_STALE_ANALYSIS_DAYS,
  vtAnalysisAgeDays,
} from "@/lib/domain/reputation";
import {
  signalLabels,
  signalNames,
  type SignalName,
  type SignalResults,
} from "@/lib/domain/types";

/**
 * The single source of truth for "some checks were limited". The verdict
 * engine's summary and recommendations ask whether this list is empty; the
 * coverage caveat beside the verdict words each entry. So whenever the
 * summary says checks were limited, the caveat names them, and a summary
 * never claims a limit no caveat can name.
 */

export type LimitedCheckKind =
  /** The check errored. */
  | "failed"
  /** The check finished but reported warnings (e.g. a feed timed out). */
  | "partial"
  /** The TLS certificate was present but couldn't be fully verified. */
  | "unverified-certificate"
  /** The redirect probe never got an answer from the site. */
  | "unreachable"
  /** No registration record could be retrieved. */
  | "registration-unavailable"
  /** VirusTotal's stored analysis is older than the staleness window. */
  | "stale-analysis"
  /** The check was skipped because it doesn't fit this kind of link. */
  | "not-applicable";

export interface LimitedCheck {
  signal: SignalName;
  kind: LimitedCheckKind;
  /** VirusTotal analysis age, for `stale-analysis` only. */
  ageDays?: number;
}

/**
 * Every check whose coverage was limited, in signal order. `asOf` ages a
 * VirusTotal analysis: pass the scan's completion time for a stored result
 * so it describes what the verdict was built on.
 */
export function getLimitedChecks(
  signals: SignalResults,
  asOf: number = Date.now(),
): LimitedCheck[] {
  const checks: LimitedCheck[] = [];

  for (const name of signalNames) {
    const signal = signals[name];
    if (signal.status === "error") {
      checks.push({ signal: name, kind: "failed" });
      continue;
    }
    if (signal.status === "skipped") {
      checks.push({ signal: name, kind: "not-applicable" });
      continue;
    }
    if (signal.status !== "success" || !signal.data) {
      continue;
    }

    const data = signal.data as Record<string, unknown>;
    if (Array.isArray(data.warnings) && data.warnings.length > 0) {
      checks.push({ signal: name, kind: "partial" });
    } else if (name === "ssl" && data.validationState === "warning") {
      checks.push({ signal: name, kind: "unverified-certificate" });
    } else if (name === "redirectChain" && data.reachable === false) {
      checks.push({ signal: name, kind: "unreachable" });
    } else if (name === "whois" && data.available === false) {
      checks.push({ signal: name, kind: "registration-unavailable" });
    }
  }

  // Only a successful check has an analysis date, so a stale analysis never
  // doubles up with "VirusTotal didn't finish".
  const vtAgeDays = vtAnalysisAgeDays(signals, asOf);
  if (vtAgeDays !== null && vtAgeDays > VT_STALE_ANALYSIS_DAYS) {
    checks.push({
      signal: "virusTotal",
      kind: "stale-analysis",
      ageDays: vtAgeDays,
    });
  }

  return checks;
}

/**
 * One sentence naming the limited checks, e.g. "VirusTotal didn't finish;
 * TLS Certificate couldn't be fully verified." Null for an empty list.
 */
export function describeLimitedChecks(
  checks: readonly LimitedCheck[],
): string | null {
  const labelsOf = (kind: LimitedCheckKind) =>
    checks
      .filter((check) => check.kind === kind)
      .map((check) => signalLabels[check.signal]);

  const parts: string[] = [];
  const failed = labelsOf("failed");
  if (failed.length > 0) {
    parts.push(`${formatList(failed)} didn't finish`);
  }
  const partial = labelsOf("partial");
  if (partial.length > 0) {
    parts.push(`${formatList(partial)} only partly finished`);
  }
  // These kinds each come from one check, so each names at most one label.
  for (const [kind, predicate] of [
    ["unverified-certificate", "couldn't be fully verified"],
    ["unreachable", "couldn't reach the site"],
    ["registration-unavailable", "couldn't be looked up"],
  ] as const) {
    const labels = labelsOf(kind);
    if (labels.length > 0) {
      parts.push(`${formatList(labels)} ${predicate}`);
    }
  }
  const stale = checks.find((check) => check.kind === "stale-analysis");
  if (stale?.ageDays !== undefined) {
    parts.push(`VirusTotal's analysis is ${countOf(stale.ageDays, "day")} old`);
  }
  const notApplicable = labelsOf("not-applicable");
  if (notApplicable.length > 0) {
    parts.push(
      `${formatList(notApplicable)} ${notApplicable.length === 1 ? "doesn't" : "don't"} apply to this link`,
    );
  }

  return parts.length > 0 ? `${capitalize(parts.join("; "))}.` : null;
}
