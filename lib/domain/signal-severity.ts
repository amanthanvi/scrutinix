import { feedMatchWeight } from "@/lib/domain/reputation";
import type {
  SignalName,
  SignalPayloadMap,
  ThreatFeedsData,
} from "@/lib/domain/types";

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

/**
 * A domain younger than this is brand new: the verdict engine's strongest
 * domain-age tier, the registration warning dot, and the Summary's
 * "blocklists lag new sites" sentence share it.
 */
export const NEW_DOMAIN_DAYS = 30;

/**
 * The verdict engine's page and certificate rules that the Summary
 * questions name, shared so the copy can never disagree with the score: a
 * redirect chain this long, this many frames on the final page (hidden or
 * not), this many signs of deliberately hard-to-read script, and a
 * certificate younger than this on a brand-new domain.
 */
export const LONG_REDIRECT_CHAIN_HOPS = 3;
/**
 * The statuses the redirect probe follows. A hop with one of these and a
 * Location redirected; when the chain's last hop still does, the probe
 * stopped there (a non-web or unreadable address) and the chain is not
 * finished, though the host answered.
 */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);
export const MANY_FRAMES = 3;
export const OBFUSCATION_HINTS = 2;
export const FRESH_CERTIFICATE_DAYS = 7;

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
    const d = data as ThreatFeedsData;
    const matches = d.matches ?? [];
    if (matches.length === 0) {
      return (d.warnings?.length ?? 0) > 0 ? "neutral" : "clear";
    }
    // Flagged only for a listing the engine treats as the feed vouching for
    // this link (exact link, or high confidence). A listing of other links
    // on the site, or a weaker one, corroborates: a warning sign.
    return matches.some((match) => feedMatchWeight(match).quality === "high")
      ? "malicious"
      : "suspicious";
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
      noHttps?: boolean;
    };
    // A plain-HTTP link that never reaches HTTPS has no certificate.
    if (d.noHttps) return "skipped";
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
    if (d.ageDays !== null && d.ageDays < NEW_DOMAIN_DAYS) return "suspicious";
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
