import { getEnv } from "@/lib/config/env";
import type { ThreatFeedsData } from "@/lib/domain/types";
import { simplifyUrlForMatching } from "@/lib/domain/url";
import { fetchWithTimeout } from "@/lib/server/http";

type FeedMatch = ThreatFeedsData["matches"][number];

const THREATFOX_API = "https://threatfox-api.abuse.ch/api/v1/";
const TIMEOUT_MS = 5_000;

/**
 * abuse.ch ThreatFox IOC lookup by hostname. Reuses the URLhaus Auth-Key
 * (both services share the abuse.ch account key); without a key the lookup
 * is skipped with a coverage warning rather than failing the signal.
 *
 * A domain or IP IOC names the host itself. A URL IOC names one resource:
 * on path-tenanted platforms (github.com, docs.google.com) one listed
 * release download must not convict every other repo or document, so it
 * only matches the exact scanned URL - unless it names the host root.
 */
export async function checkThreatFox(
  url: string,
  signal?: AbortSignal,
): Promise<{ match: FeedMatch | null; warning: string | null }> {
  const hostname = new URL(url).hostname;
  const env = getEnv();
  if (!env.URLHAUS_AUTH_KEY) {
    return {
      match: null,
      warning: "ThreatFox lookup skipped: no abuse.ch Auth-Key is configured.",
    };
  }

  const response = await fetchWithTimeout(
    THREATFOX_API,
    {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "Auth-Key": env.URLHAUS_AUTH_KEY,
      },
      body: JSON.stringify({ query: "search_ioc", search_term: hostname }),
    },
    TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`ThreatFox lookup failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    query_status?: unknown;
    data?: unknown;
  };

  if (payload.query_status !== "ok" || !Array.isArray(payload.data)) {
    return { match: null, warning: null };
  }

  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  const scannedUrl = simplifyUrlForMatching(url);
  const scannedKey = resourceKey(scannedUrl);
  let entry: Record<string, unknown> | undefined;
  let matchType: FeedMatch["matchType"] = "host";

  for (const item of payload.data) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const ioc = typeof record.ioc === "string" ? parseIoc(record.ioc) : null;
    if (!ioc || ioc.hostname !== normalizedHostname) {
      continue;
    }

    if (ioc.url !== null && resourceKey(ioc.url) === scannedKey) {
      entry = record;
      matchType = "url";
      break;
    }

    if (ioc.url === null) {
      entry ??= record;
    }
  }

  if (!entry) {
    return { match: null, warning: null };
  }

  const threatType =
    typeof entry.threat_type === "string" ? entry.threat_type : "IOC";
  const malware =
    typeof entry.malware_printable === "string" &&
    entry.malware_printable !== "Unknown malware"
      ? entry.malware_printable
      : null;
  const confidenceLevel =
    typeof entry.confidence_level === "number" ? entry.confidence_level : 0;

  return {
    match: {
      feed: "threatfox",
      matchedUrl: matchType === "url" ? scannedUrl : normalizedHostname,
      detail: malware
        ? `${threatType} indicator for ${malware} in ThreatFox`
        : `${threatType} indicator in ThreatFox`,
      confidence: confidenceLevel >= 75 ? "high" : "medium",
      matchType,
    },
    warning: null,
  };
}

/** Feeds often list http:// while users paste https://; compare without the scheme. */
function resourceKey(url: string) {
  return url.replace(/^https?:\/\//i, "");
}

/** `url` is null when the IOC names only a host (domain, ip:port, or root URL). */
function parseIoc(
  ioc: string,
): { hostname: string; url: string | null } | null {
  try {
    const isUrl = ioc.includes("://");
    const parsed = new URL(isUrl ? ioc : `http://${ioc}`);
    const namesResource = isUrl && (parsed.pathname !== "/" || parsed.search);
    return {
      hostname: parsed.hostname.toLowerCase().replace(/\.$/, ""),
      url: namesResource ? simplifyUrlForMatching(ioc) : null,
    };
  } catch {
    return null;
  }
}
