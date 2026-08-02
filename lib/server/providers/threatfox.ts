import { getEnv } from "@/lib/config/env";
import type { ThreatFeedsData } from "@/lib/domain/types";
import { fetchWithTimeout } from "@/lib/server/http";

type FeedMatch = ThreatFeedsData["matches"][number];

const THREATFOX_API = "https://threatfox-api.abuse.ch/api/v1/";
const TIMEOUT_MS = 5_000;

/**
 * abuse.ch ThreatFox IOC lookup by hostname. Reuses the URLhaus Auth-Key
 * (both services share the abuse.ch account key); without a key the lookup
 * is skipped with a coverage warning rather than failing the signal.
 */
export async function checkThreatFox(
  hostname: string,
  signal?: AbortSignal,
): Promise<{ match: FeedMatch | null; warning: string | null }> {
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
  const entry = payload.data.find((item): item is Record<string, unknown> => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const ioc = (item as Record<string, unknown>).ioc;
    if (typeof ioc !== "string") {
      return false;
    }

    const iocHostname = parseIocHostname(ioc);
    return (
      iocHostname === normalizedHostname ||
      iocHostname?.endsWith(`.${normalizedHostname}`) === true
    );
  });

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
      matchedUrl: hostname,
      detail: malware
        ? `${threatType} indicator for ${malware} in ThreatFox`
        : `${threatType} indicator in ThreatFox`,
      confidence: confidenceLevel >= 75 ? "high" : "medium",
      matchType: "host",
    },
    warning: null,
  };
}

function parseIocHostname(ioc: string): string | null {
  try {
    const value = ioc.includes("://") ? ioc : `http://${ioc}`;
    return new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}
