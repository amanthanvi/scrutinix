import type { ThreatFeedsData } from "@/lib/domain/schemas";
import type { SignalResults } from "@/lib/domain/types";

/**
 * Reputation thresholds shared by the verdict engine and the client. Kept
 * free of server-only dependencies (no `node:net`, no public-suffix list)
 * so presentation code can ask "did a reputation source confirm this?"
 * without bundling the scorer.
 */

/** Days after which a stored VirusTotal analysis is considered stale. */
export const VT_STALE_ANALYSIS_DAYS = 30;

/** VirusTotal engines that convict on their own. */
export const VT_CONVICTION_ENGINES = 5;

type FeedMatch = ThreatFeedsData["matches"][number];

/** Age of the VirusTotal analysis backing the verdict, in whole days. */
export function vtAnalysisAgeDays(signals: SignalResults): number | null {
  const vt = signals.virusTotal;
  if (vt.status !== "success" || !vt.data?.lastAnalysisDate) {
    return null;
  }

  const analyzedAt = new Date(vt.data.lastAnalysisDate).getTime();
  if (Number.isNaN(analyzedAt) || analyzedAt > Date.now()) {
    return null;
  }

  return Math.floor((Date.now() - analyzedAt) / (1000 * 60 * 60 * 24));
}

export function feedMatchWeight(match: FeedMatch): {
  score: number;
  quality: "high" | "medium" | "low";
} {
  switch (match.feed) {
    case "urlhaus":
    case "openphish":
      // An exact-URL listing convicts; a host-level listing corroborates.
      return match.matchType === "host"
        ? { score: 25, quality: "medium" }
        : { score: 55, quality: "high" };
    case "threatfox":
      // A listed URL or host IOC convicts at high confidence; a different
      // URL listed on a shared host only corroborates, like a URLhaus host.
      if (match.listedElsewhereOnHost) {
        return { score: 25, quality: "medium" };
      }
      return match.confidence === "high"
        ? { score: 55, quality: "high" }
        : { score: 40, quality: "medium" };
    case "spamhaus-dbl":
      if (match.confidence === "high") {
        return { score: 45, quality: "high" };
      }
      return match.detail.includes("abused")
        ? { score: 15, quality: "medium" }
        : { score: 25, quality: "medium" };
    case "surbl":
      return match.confidence === "high"
        ? { score: 35, quality: "high" }
        : { score: 20, quality: "medium" };
  }
}

/**
 * True when a reputation source confirmed the threat on its own: a Google
 * Safe Browsing match, a convicting threat-feed listing (exact link or
 * listed indicator), or 5+ VirusTotal engines on a current analysis. Local
 * heuristics can reach Critical too, but only this earns "known threat".
 */
export function hasConfirmedReputationHit(signals: SignalResults): boolean {
  const gsb = signals.googleSafeBrowsing;
  if (gsb.status === "success" && (gsb.data?.matches?.length ?? 0) > 0) {
    return true;
  }

  const feeds = signals.threatFeeds;
  if (
    feeds.status === "success" &&
    (feeds.data?.matches ?? []).some(
      (match) => feedMatchWeight(match).quality === "high",
    )
  ) {
    return true;
  }

  const vt = signals.virusTotal;
  const vtAgeDays = vtAnalysisAgeDays(signals);
  return (
    vt.status === "success" &&
    !!vt.data &&
    vt.data.malicious >= VT_CONVICTION_ENGINES &&
    (vtAgeDays === null || vtAgeDays <= VT_STALE_ANALYSIS_DAYS)
  );
}
