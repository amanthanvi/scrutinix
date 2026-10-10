import { getEnv } from "@/lib/config/env";
import { PublicError } from "@/lib/domain/public-error";
import { getRegistrableDomain } from "@/lib/domain/registrable-domain";
import { isSharedPlatformHost } from "@/lib/domain/shared-platforms";
import type { ThreatFeedsData } from "@/lib/domain/types";
import { simplifyUrlForMatching } from "@/lib/domain/url";
import { exposeClientError } from "@/lib/server/client-error";
import { fetchWithTimeout } from "@/lib/server/http";
import { queryDnsbls } from "@/lib/server/providers/dnsbl";
import { checkOpenPhishFeed } from "@/lib/server/providers/openphish-feed";
import { checkThreatFox } from "@/lib/server/providers/threatfox";

function feedFailureMessage(
  error: unknown,
  summary: string,
  redact: readonly string[],
) {
  return exposeClientError(error, {
    correlationId: crypto.randomUUID(),
    summary,
    code: "lookup_failed",
    logEvent: "threat_feed.lookup_failed",
    redact,
  }).message;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/** Shown when URLhaus returns `no_results` so SAFE is not read as “verified clean.” */
export const URLHAUS_NO_LISTING_OBSERVATION =
  "URLhaus has no listing for this exact URL. Feed hits use the full malicious URL string from a listing, not hub pages such as urlhaus.abuse.ch/browse/.";

export async function runThreatFeedsProvider(
  url: string,
  signal?: AbortSignal,
): Promise<ThreatFeedsData> {
  const warnings: string[] = [];
  const observations: string[] = [];
  const matches: ThreatFeedsData["matches"] = [];
  const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  const registrableDomain = getRegistrableDomain(hostname);

  const [urlhausResult, openPhishResult, threatFoxResult, dnsblResult] =
    await Promise.allSettled([
      checkUrlhaus(url, signal),
      checkOpenPhishFeed(url),
      checkThreatFox(url, signal),
      queryDnsbls(registrableDomain),
    ]);

  const redact = [url, hostname, registrableDomain];

  if (urlhausResult.status === "fulfilled") {
    if (urlhausResult.value.match) {
      matches.push(urlhausResult.value.match);
    }
    if (urlhausResult.value.noListingObservation) {
      observations.push(URLHAUS_NO_LISTING_OBSERVATION);
    }
  } else {
    warnings.push(
      feedFailureMessage(
        urlhausResult.reason,
        "URLhaus lookup failed.",
        redact,
      ),
    );
  }

  if (openPhishResult.status === "fulfilled") {
    if (openPhishResult.value) {
      matches.push(openPhishResult.value);
    }
  } else {
    warnings.push(
      feedFailureMessage(
        openPhishResult.reason,
        "OpenPhish lookup failed.",
        redact,
      ),
    );
  }

  if (threatFoxResult.status === "fulfilled") {
    if (threatFoxResult.value.match) {
      matches.push(threatFoxResult.value.match);
    }
    if (threatFoxResult.value.warning) {
      warnings.push(threatFoxResult.value.warning);
    }
  } else {
    warnings.push(
      feedFailureMessage(
        threatFoxResult.reason,
        "ThreatFox lookup failed.",
        redact,
      ),
    );
  }

  if (dnsblResult.status === "fulfilled") {
    matches.push(...dnsblResult.value.matches);
    warnings.push(...dnsblResult.value.warnings);
    observations.push(...dnsblResult.value.observations);
  } else {
    warnings.push(
      feedFailureMessage(dnsblResult.reason, "DNSBL lookup failed.", redact),
    );
  }

  const rejectedCount = [
    urlhausResult,
    openPhishResult,
    threatFoxResult,
    dnsblResult,
  ].filter((result) => result.status === "rejected").length;

  if (matches.length === 0 && rejectedCount === 4) {
    throw new PublicError("lookup_failed", "All threat-feed lookups failed.");
  }

  // On a path-tenanted platform a host-level listing describes other
  // users' content; keep it visible but let only exact-URL evidence score.
  const scoredMatches = isSharedPlatformHost(hostname)
    ? matches.filter((match) => {
        if (match.matchType !== "host") {
          return true;
        }
        observations.push(
          `${hostname} is a shared platform, so a host-level listing is not counted against this URL (${match.feed}: ${match.detail}).`,
        );
        return false;
      })
    : matches;

  return {
    checkedAt: new Date().toISOString(),
    matches: scoredMatches,
    observations,
    warnings,
    ...(scoredMatches.length < matches.length
      ? { sharedPlatformListingsIgnored: true }
      : {}),
  };
}

async function checkUrlhaus(
  url: string,
  signal?: AbortSignal,
): Promise<{
  match: ThreatFeedsData["matches"][number] | null;
  noListingObservation: boolean;
}> {
  const env = getEnv();
  const response = await fetchWithTimeout(
    "https://urlhaus-api.abuse.ch/v1/url/",
    {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        ...(env.URLHAUS_AUTH_KEY ? { "Auth-Key": env.URLHAUS_AUTH_KEY } : {}),
      },
      body: new URLSearchParams({ url }),
    },
  );

  if (!response.ok) {
    throw new PublicError(
      "lookup_failed",
      `URLhaus lookup failed with status ${response.status}.`,
    );
  }

  const payload = asRecord(await response.json());
  const queryStatus =
    typeof payload?.query_status === "string" ? payload.query_status : null;
  const urlStatus =
    typeof payload?.url_status === "string" ? payload.url_status : null;
  const threat = typeof payload?.threat === "string" ? payload.threat : null;

  if (queryStatus === "ok") {
    return {
      match: {
        feed: "urlhaus" as const,
        matchedUrl: simplifyUrlForMatching(url),
        detail: threat ?? urlStatus ?? "listed in URLhaus",
        confidence: "high" as const,
        matchType: "url" as const,
      },
      noListingObservation: false,
    };
  }

  // Exact URL unknown; check whether the host itself carries listings.
  if (queryStatus === "no_results") {
    const hostMatch = await checkUrlhausHost(url, env.URLHAUS_AUTH_KEY, signal);
    return {
      match: hostMatch,
      noListingObservation: hostMatch === null,
    };
  }

  return {
    match: null,
    noListingObservation: false,
  };
}

async function checkUrlhausHost(
  url: string,
  authKey: string | undefined,
  signal?: AbortSignal,
): Promise<ThreatFeedsData["matches"][number] | null> {
  const hostname = new URL(url).hostname;
  const response = await fetchWithTimeout(
    "https://urlhaus-api.abuse.ch/v1/host/",
    {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        ...(authKey ? { "Auth-Key": authKey } : {}),
      },
      body: new URLSearchParams({ host: hostname }),
    },
  );

  if (!response.ok) {
    throw new PublicError(
      "lookup_failed",
      `URLhaus host lookup failed with status ${response.status}.`,
    );
  }

  const payload = asRecord(await response.json());
  const queryStatus =
    typeof payload?.query_status === "string" ? payload.query_status : null;
  const urlCount =
    typeof payload?.url_count === "number"
      ? payload.url_count
      : Number(payload?.url_count ?? 0);

  if (queryStatus === "ok" && Number.isFinite(urlCount) && urlCount > 0) {
    return {
      feed: "urlhaus",
      matchedUrl: hostname,
      detail: `host has ${urlCount} malware URL listing${urlCount === 1 ? "" : "s"} in URLhaus`,
      confidence: "medium",
      matchType: "host",
    };
  }

  return null;
}
