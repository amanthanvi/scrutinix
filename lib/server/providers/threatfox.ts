import { getEnv } from "@/lib/config/env";
import type { ThreatFeedsData } from "@/lib/domain/types";
import { simplifyUrlForMatching } from "@/lib/domain/url";
import { fetchWithTimeout } from "@/lib/server/http";

type FeedMatch = ThreatFeedsData["matches"][number];

const THREATFOX_API = "https://threatfox-api.abuse.ch/api/v1/";
const TIMEOUT_MS = 5_000;

/**
 * abuse.ch ThreatFox IOC lookup, searched by hostname. Reuses the URLhaus
 * Auth-Key (both services share the abuse.ch account key); without a key the
 * lookup is skipped with a coverage warning rather than failing the signal.
 *
 * A domain or IP IOC names the host itself. A URL IOC names one resource:
 * on path-tenanted platforms (github.com, docs.google.com) one listed
 * release download must not convict every other repo or document. So, like
 * URLhaus, an exact URL listing convicts and a listing elsewhere on the host
 * only corroborates.
 */
export async function checkThreatFox(
  url: string,
  signal?: AbortSignal,
): Promise<{ match: FeedMatch | null; warning: string | null }> {
  const scanned = new URL(url);
  const hostname = normalizeHostname(scanned.hostname);
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

  const scannedKey = resourceKey(scanned);
  let exact: Record<string, unknown> | undefined;
  let hostIoc: Record<string, unknown> | undefined;
  let elsewhereOnHost: Record<string, unknown> | undefined;

  for (const item of payload.data) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const ioc = typeof record.ioc === "string" ? parseIoc(record.ioc) : null;
    if (!ioc || ioc.hostname !== hostname) {
      continue;
    }

    if (ioc.resourceKey === null) {
      hostIoc = moreConfident(hostIoc, record);
    } else if (ioc.resourceKey === scannedKey) {
      exact = moreConfident(exact, record);
    } else {
      elsewhereOnHost = moreConfident(elsewhereOnHost, record);
    }
  }

  if (exact) {
    return {
      match: toMatch(exact, "url", simplifyUrlForMatching(url)),
      warning: null,
    };
  }

  if (hostIoc) {
    return { match: toMatch(hostIoc, "host", hostname), warning: null };
  }

  if (elsewhereOnHost) {
    const match = toMatch(elsewhereOnHost, "host", hostname);
    return {
      match: {
        ...match,
        detail: `host has another URL listed as a ${match.detail}`,
        confidence: "medium",
      },
      warning: null,
    };
  }

  return { match: null, warning: null };
}

function toMatch(
  entry: Record<string, unknown>,
  matchType: NonNullable<FeedMatch["matchType"]>,
  matchedUrl: string,
): FeedMatch {
  const threatType =
    typeof entry.threat_type === "string" ? entry.threat_type : "IOC";
  const malware =
    typeof entry.malware_printable === "string" &&
    entry.malware_printable !== "Unknown malware"
      ? entry.malware_printable
      : null;

  return {
    feed: "threatfox",
    matchedUrl,
    detail: malware
      ? `${threatType} indicator for ${malware} in ThreatFox`
      : `${threatType} indicator in ThreatFox`,
    confidence: confidenceLevel(entry) >= 75 ? "high" : "medium",
    matchType,
  };
}

function confidenceLevel(entry: Record<string, unknown> | undefined) {
  return typeof entry?.confidence_level === "number"
    ? entry.confidence_level
    : 0;
}

function moreConfident(
  current: Record<string, unknown> | undefined,
  candidate: Record<string, unknown>,
) {
  return confidenceLevel(candidate) > confidenceLevel(current)
    ? candidate
    : (current ?? candidate);
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * Host, port, path and query, without the scheme (feeds often list http://
 * while users paste https://) or a trailing slash.
 */
function resourceKey(parsed: URL) {
  const port = parsed.port ? `:${parsed.port}` : "";
  const path = parsed.pathname.replace(/\/$/, "");
  return `${normalizeHostname(parsed.hostname)}${port}${path}${parsed.search}`;
}

/** `resourceKey` is null when the IOC names only a host (domain, ip:port, or root URL). */
function parseIoc(
  ioc: string,
): { hostname: string; resourceKey: string | null } | null {
  try {
    const isUrl = ioc.includes("://");
    const parsed = new URL(isUrl ? ioc : `http://${ioc}`);
    const namesResource =
      isUrl && (parsed.pathname !== "/" || parsed.search !== "");
    return {
      hostname: normalizeHostname(parsed.hostname),
      resourceKey: namesResource ? resourceKey(parsed) : null,
    };
  } catch {
    return null;
  }
}
