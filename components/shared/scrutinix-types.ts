import type { Severity } from "@/lib/domain/signal-severity";
import { signalNames, type Verdict } from "@/lib/domain/types";

export { getSignalSeverity, type Severity } from "@/lib/domain/signal-severity";

export type { SharedSnapshot } from "@/lib/domain/types";

export const SIGNAL_COUNT = signalNames.length;

/** AA-contrast text color for a stated verdict. */
export function verdictFg(verdict: Verdict | string): string {
  switch (verdict) {
    case "safe":
      return "var(--sx-safe-fg)";
    case "suspicious":
      return "var(--sx-suspicious-fg)";
    case "malicious":
      return "var(--sx-malicious-fg)";
    case "critical":
      return "var(--sx-critical-fg)";
    case "unknown":
      return "var(--sx-unknown-fg)";
    case "error":
      return "var(--sx-error-fg)";
    default:
      return "var(--sx-error-fg)";
  }
}
/**
 * The single severity encoding: a dot color for graphics and an AA text
 * color for stating the severity in words.
 */
export const severityColor: Record<Severity, { dot: string; fg: string }> = {
  clear: { dot: "var(--sx-clear)", fg: "var(--sx-text-muted)" },
  neutral: { dot: "var(--sx-unknown)", fg: "var(--sx-unknown-fg)" },
  suspicious: { dot: "var(--sx-suspicious)", fg: "var(--sx-suspicious-fg)" },
  malicious: { dot: "var(--sx-malicious)", fg: "var(--sx-malicious-fg)" },
  error: { dot: "var(--sx-error)", fg: "var(--sx-error-fg)" },
  pending: { dot: "var(--sx-border)", fg: "var(--sx-text-muted)" },
  skipped: { dot: "var(--sx-border)", fg: "var(--sx-text-muted)" },
};
