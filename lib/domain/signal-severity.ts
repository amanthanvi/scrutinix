import type { SignalName, SignalPayloadMap } from "@/lib/domain/types";

/**
 * Per-signal severity. "clear" means "this source found nothing" - it is
 * not a safety claim, so it renders neutral gray; green belongs only to a
 * Safe verdict. "neutral" means the check finished with a caveat (partial
 * coverage, nothing to inspect).
 *
 * Pass `scored` (from `getScoredSignals`) so a check that added score to
 * the verdict reads as a warning even when its own thresholds are quiet.
 */
/**
 * A domain younger than this is "fairly new": the verdict engine's
 * young-domain tier and the link anatomy's domain-age fact share it.
 */
export const YOUNG_DOMAIN_DAYS = 180;

export const severities = [
  "clear",
  "neutral",
  "suspicious",
  "malicious",
  "error",
  "pending",
  "skipped",
] as const;

export type Severity = (typeof severities)[number];

export function getSignalSeverity(
  status: string,
  data: SignalPayloadMap[SignalName] | null,
  name: SignalName,
  scored = false,
): Severity {
  const severity = getBaseSeverity(status, data, name);
  // The verdict engine is the single source of truth for what counted
  // against the link: a check that added score never shows the gray
  // "found nothing" dot, whatever its own thresholds say.
  return scored && (severity === "clear" || severity === "neutral")
    ? "suspicious"
    : severity;
}

function getBaseSeverity(
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
    return "clear";
  }
  if (name === "googleSafeBrowsing") {
    const d = data as { matches: unknown[] };
    return (d.matches?.length ?? 0) > 0 ? "malicious" : "clear";
  }
  if (name === "threatFeeds") {
    const d = data as { matches: unknown[]; warnings?: string[] };
    if ((d.matches?.length ?? 0) === 0 && (d.warnings?.length ?? 0) > 0)
      return "neutral";
    return (d.matches?.length ?? 0) > 0 ? "malicious" : "clear";
  }
  if (name === "mlEnsemble") {
    const d = data as { consensusLabel: string; warnings?: string[] };
    if (d.consensusLabel === "benign" && (d.warnings?.length ?? 0) > 0) {
      return "neutral";
    }
    if (d.consensusLabel === "malicious") return "malicious";
    if (d.consensusLabel === "risky") return "suspicious";
    return "clear";
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
    return "clear";
  }
  if (name === "whois") {
    const d = data as { available?: boolean; ageDays: number | null };
    if (d.available === false) return "neutral";
    if (d.ageDays !== null && d.ageDays < 30) return "suspicious";
    return "clear";
  }
  if (name === "redirectChain") {
    const d = data as { totalHops: number; reachable?: boolean };
    if (d.reachable === false) return "neutral";
    if (d.totalHops > 3) return "suspicious";
    return "clear";
  }
  if (name === "dns") {
    const d = data as { anomalies?: string[]; observations?: string[] };
    if ((d.anomalies?.length ?? 0) > 0) return "suspicious";
    if ((d.observations?.length ?? 0) > 0) return "neutral";
    return "clear";
  }
  return "clear";
}
