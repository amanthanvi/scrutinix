import {
  signalNames,
  type SignalName,
  type SignalPayloadMap,
  type Verdict,
} from "@/lib/domain/types";

export const SIGNAL_COUNT = signalNames.length;

export interface SharedSnapshot {
  verdict: Verdict;
  url: string;
  summary: string;
  capturedAt: string;
}

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
    default:
      return "var(--sx-error-fg)";
  }
}

export type Severity =
  | "safe"
  | "neutral"
  | "suspicious"
  | "malicious"
  | "error"
  | "pending"
  | "skipped";

export function getSignalSeverity(
  status: string,
  data: SignalPayloadMap[SignalName] | null,
  name: SignalName,
): Severity {
  if (status === "pending") return "pending";
  if (status === "skipped") return "skipped";
  if (status === "error") return "error";
  if (status !== "success" || !data) return "pending";

  if (name === "virusTotal") {
    const d = data as { malicious: number; suspicious: number };
    if (d.malicious > 3) return "malicious";
    if (d.malicious > 0 || d.suspicious > 0) return "suspicious";
    return "safe";
  }
  if (name === "googleSafeBrowsing") {
    const d = data as { matches: unknown[] };
    return (d.matches?.length ?? 0) > 0 ? "malicious" : "safe";
  }
  if (name === "threatFeeds") {
    const d = data as { matches: unknown[]; warnings?: string[] };
    if ((d.matches?.length ?? 0) === 0 && (d.warnings?.length ?? 0) > 0)
      return "neutral";
    return (d.matches?.length ?? 0) > 0 ? "malicious" : "safe";
  }
  if (name === "mlEnsemble") {
    const d = data as { consensusLabel: string; warnings?: string[] };
    if (d.consensusLabel === "benign" && (d.warnings?.length ?? 0) > 0) {
      return "neutral";
    }
    if (d.consensusLabel === "malicious") return "malicious";
    if (d.consensusLabel === "risky") return "suspicious";
    return "safe";
  }
  if (name === "ssl") {
    const d = data as {
      available: boolean;
      validationState: string;
    };
    if (!d.available) return "neutral";
    if (d.validationState === "warning") return "neutral";
    if (d.validationState === "invalid" || d.validationState === "untrusted") {
      return "suspicious";
    }
    return "safe";
  }
  if (name === "whois") {
    const d = data as { available?: boolean; ageDays: number | null };
    if (d.available === false) return "neutral";
    if (d.ageDays !== null && d.ageDays < 30) return "suspicious";
    return "safe";
  }
  if (name === "redirectChain") {
    const d = data as { totalHops: number; reachable?: boolean };
    if (d.reachable === false) return "neutral";
    if (d.totalHops > 3) return "suspicious";
    return "safe";
  }
  if (name === "dns") {
    const d = data as { anomalies?: string[]; observations?: string[] };
    if ((d.anomalies?.length ?? 0) > 0) return "suspicious";
    if ((d.observations?.length ?? 0) > 0) return "neutral";
    return "safe";
  }
  return "safe";
}

/**
 * The single severity encoding: a dot color for graphics and an AA text
 * color for stating the severity in words.
 */
export const severityColor: Record<Severity, { dot: string; fg: string }> = {
  safe: { dot: "var(--sx-safe)", fg: "var(--sx-safe-fg)" },
  neutral: { dot: "var(--sx-info)", fg: "var(--sx-info-fg)" },
  suspicious: { dot: "var(--sx-suspicious)", fg: "var(--sx-suspicious-fg)" },
  malicious: { dot: "var(--sx-malicious)", fg: "var(--sx-malicious-fg)" },
  error: { dot: "var(--sx-error)", fg: "var(--sx-error-fg)" },
  pending: { dot: "var(--sx-border)", fg: "var(--sx-text-muted)" },
  skipped: { dot: "var(--sx-border)", fg: "var(--sx-text-muted)" },
};
