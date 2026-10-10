import { capitalize, formatList } from "@/lib/domain/copy";
import type { ThreatFeedsData } from "@/lib/domain/schemas";

export type FeedMatch = ThreatFeedsData["matches"][number];
export type FeedId = FeedMatch["feed"];

/** The names people know these feeds by - never show the raw ids. */
export const feedDisplayNames: Record<FeedId, string> = {
  urlhaus: "URLhaus",
  openphish: "OpenPhish",
  threatfox: "ThreatFox",
  "spamhaus-dbl": "Spamhaus DBL",
  surbl: "SURBL",
};

export function feedDisplayName(feed: string): string {
  return feedDisplayNames[feed as FeedId] ?? feed;
}

/** Readable names for the raw threat-type tokens abuse.ch APIs return. */
const threatTypeNames: Record<string, string> = {
  botnet_cc: "botnet command-and-control",
  payload_delivery: "malware delivery",
  payload: "a malware payload",
  cc_skimming: "card skimming",
  malware_download: "malware download",
};

/** "payload_delivery" -> "malware delivery"; unknown tokens lose underscores. */
export function humanizeThreatType(token: string): string {
  const known = threatTypeNames[token.toLowerCase()];
  if (known) {
    return known;
  }

  return humanizeToken(token);
}

/** Last-resort rendering of an API enum: "SOME_NEW_TYPE" -> "some new type". */
export function humanizeToken(token: string): string {
  return token.replace(/_/g, " ").trim().toLowerCase();
}

/** Google Safe Browsing threat types, worded for people. */
export const safeBrowsingThreatNames: Record<string, string> = {
  MALWARE: "malware",
  SOCIAL_ENGINEERING: "phishing or a deceptive site",
  UNWANTED_SOFTWARE: "unwanted software",
  POTENTIALLY_HARMFUL_APPLICATION: "a harmful app",
  THREAT_TYPE_UNSPECIFIED: "an unspecified threat",
  UNKNOWN: "an unspecified threat",
};

/** "SOCIAL_ENGINEERING" -> "phishing or a deceptive site". */
export function describeSafeBrowsingThreat(type: string): string {
  return safeBrowsingThreatNames[type.toUpperCase()] ?? humanizeToken(type);
}

/** The distinct threat types of a set of GSB matches, as one phrase. */
export function describeSafeBrowsingThreats(
  matches: readonly { threatType: string }[],
): string {
  return formatList([
    ...new Set(
      matches.map((match) => describeSafeBrowsingThreat(match.threatType)),
    ),
  ]);
}

/**
 * True when the feed lists a different link on the same host, not this
 * link: OpenPhish/URLhaus host fallbacks and ThreatFox URLs elsewhere on a
 * shared host. DNSBL zones and ThreatFox host IOCs list the host itself, so
 * they stay direct listings.
 */
export function isElsewhereOnHost(match: FeedMatch): boolean {
  return (
    match.listedElsewhereOnHost === true ||
    ((match.feed === "openphish" || match.feed === "urlhaus") &&
      match.matchType === "host")
  );
}

/**
 * The ThreatFox clause body: "an indicator of malware delivery (AgentTesla)"
 * or "a threat indicator" when the IOC carries no usable type.
 */
export function threatIndicatorPhrase(
  threatType: string | null,
  malware: string | null,
): string {
  const kind =
    threatType && threatType.toUpperCase() !== "IOC"
      ? humanizeThreatType(threatType)
      : null;
  const base = kind ? `an indicator of ${kind}` : "a threat indicator";
  return malware ? `${base} (${malware})` : base;
}

/** Clauses written to the `detail` contract start with one of these verbs. */
const CLAUSE_PATTERN = /^(lists|reports|flags)\b/;

const FEED_MENTION_PATTERN =
  /\s+(?:by|in)\s+(?:the\s+)?(?:spamhaus dbl|surbl|urlhaus|threatfox|openphish)(?:\s+community feed)?/gi;

/**
 * The finding as a clause that follows the feed name, without the name or
 * a final period: "lists this link as phishing".
 *
 * Current providers already write `detail` in that shape. Results cached
 * or saved before the contract existed carry free-form strings ("listed in
 * the OpenPhish community feed", "malware_download"); rewrite those rather
 * than prefixing the feed name and producing "OpenPhish listed the URL as
 * listed in ...".
 */
export function feedMatchClause(match: FeedMatch): string {
  const detail = match.detail.trim().replace(/\.$/, "");
  if (CLAUSE_PATTERN.test(detail)) {
    return detail;
  }

  const target = match.matchType === "host" ? "host" : "link";
  const cleaned = detail
    .replace(FEED_MENTION_PATTERN, "")
    .replace(/^listed\b\s*/i, "")
    .replace(/_/g, " ")
    .trim();

  if (/^host(name)? appears\b/i.test(cleaned)) {
    return "lists another link on this host";
  }

  if (/^host has\b/i.test(cleaned)) {
    return `reports this ${cleaned}`;
  }

  if (cleaned.length === 0) {
    return `lists this ${target}`;
  }

  if (/^as\b/i.test(cleaned)) {
    return `lists this ${target} ${cleaned}`;
  }

  return `lists this ${target} (${cleaned})`;
}

/** Full sentence: "URLhaus lists this link as a malware download." */
export function describeFeedMatch(match: FeedMatch): string {
  return `${feedDisplayName(match.feed)} ${feedMatchClause(match)}.`;
}

/** The clause as a standalone sentence, for rows already labelled by feed. */
export function describeFeedFinding(match: FeedMatch): string {
  return `${capitalize(feedMatchClause(match))}.`;
}
