import {
  getSignalSeverity,
  type Severity,
} from "@/components/shared/scrutinix-types";
import { countOf, formatList } from "@/lib/domain/copy";
import type { SignalName, SignalResults } from "@/lib/domain/types";

/** Fixed Summary order: the sources that move a verdict most come first. */
export const summarySignalOrder = [
  "googleSafeBrowsing",
  "threatFeeds",
  "virusTotal",
  "mlEnsemble",
  "ssl",
  "redirectChain",
  "whois",
  "dns",
] as const satisfies readonly SignalName[];

/** Severities that drove (or undermined) the verdict, so Summary shows them. */
const DRIVER_SEVERITIES: ReadonlySet<Severity> = new Set([
  "malicious",
  "suspicious",
  "error",
]);

export interface SummarySelection {
  /** Signals that drove the verdict, in `summarySignalOrder`. */
  drivers: SignalName[];
  /**
   * Signals the verdict engine scored against the link. Rows use it so a
   * driver never shows the gray "found nothing" dot.
   */
  scored: ReadonlySet<SignalName>;
  /** Finished checks that found nothing. */
  clear: number;
  /** Finished checks with a caveat or that did not apply. */
  limited: number;
  /** Checks still running. */
  pending: number;
}

/**
 * Summary shows only the signals that drove the verdict; every other check
 * is folded into one count. A clean scan therefore shows no rows at all -
 * three "No threat matches" rows under a Malicious verdict read as
 * contradicting it.
 *
 * "Drove" means the verdict engine scored it (`threatInfo.scoredSignals`,
 * the single source of truth), or its own severity is a warning or a
 * failure. While a scan streams there is no verdict yet, so severity alone
 * decides.
 */
export function selectSummarySignals(
  signals: SignalResults,
  scoredSignals: readonly SignalName[] | ReadonlySet<SignalName> = [],
): SummarySelection {
  const scored: ReadonlySet<SignalName> = new Set(scoredSignals);
  const selection: SummarySelection = {
    drivers: [],
    scored,
    clear: 0,
    limited: 0,
    pending: 0,
  };

  for (const name of summarySignalOrder) {
    const signal = signals[name];
    const severity = getSignalSeverity(
      signal.status,
      signal.data,
      name,
      scored.has(name),
    );
    if (scored.has(name) || DRIVER_SEVERITIES.has(severity)) {
      selection.drivers.push(name);
    } else if (severity === "clear") {
      selection.clear += 1;
    } else if (severity === "pending") {
      selection.pending += 1;
    } else {
      selection.limited += 1;
    }
  }

  return selection;
}

/**
 * The one line standing in for the quiet checks, e.g. "6 other checks found
 * nothing." or "All 8 checks found nothing." Null when nothing is folded.
 */
export function describeQuietChecks(
  selection: SummarySelection,
): string | null {
  const { drivers, clear, limited, pending } = selection;
  const total = drivers.length + clear + limited + pending;

  if (drivers.length === 0 && limited === 0 && pending === 0 && clear > 0) {
    return clear === total && clear > 1
      ? `All ${clear} checks found nothing.`
      : `${countOf(clear, "check")} found nothing.`;
  }

  const noun = drivers.length > 0 ? "other check" : "check";
  const parts: string[] = [];
  if (clear > 0) {
    parts.push(`${countOf(clear, noun)} found nothing`);
  }
  if (limited > 0) {
    parts.push(
      parts.length > 0
        ? `${limited} couldn't give a full answer`
        : `${countOf(limited, noun)} couldn't give a full answer`,
    );
  }
  if (pending > 0) {
    const verb = pending === 1 ? "is" : "are";
    parts.push(
      parts.length > 0
        ? `${pending} ${verb} still running`
        : `${countOf(pending, noun)} ${verb} still running`,
    );
  }

  return parts.length > 0 ? `${formatList(parts)}.` : null;
}
