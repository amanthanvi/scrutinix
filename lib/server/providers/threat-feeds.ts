import { getEnv } from "@/lib/config/env";
import { getRegistrableDomain } from "@/lib/domain/registrable-domain";
import type { ThreatFeedsData } from "@/lib/domain/types";
import { simplifyUrlForMatching } from "@/lib/domain/url";
import { fetchWithTimeout } from "@/lib/server/http";
import { queryDnsbls } from "@/lib/server/providers/dnsbl";
import { checkOpenPhishFeed } from "@/lib/server/providers/openphish-feed";
import { checkThreatFox } from "@/lib/server/providers/threatfox";
import { getErrorMessage } from "@/lib/server/signal-error";

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
  const registrableDomain = getRegistrableDomain(new URL(url).hostname);

  const [urlhausResult, openPhishResult, threatFoxResult, dnsblResult] =
    await Promise.allSettled([
      checkUrlhaus(url, signal),
      checkOpenPhishFeed(url),
      checkThreatFox(registrableDomain, signal),
      queryDnsbls(registrableDomain),
    ]);

  if (urlhausResult.status === "fulfilled") {
    if (urlhausResult.value.match) {
      matches.push(urlhausResult.value.match);
    }
    if (urlhausResult.value.noListingObservation) {
      observations.push(URLHAUS_NO_LISTING_OBSERVATION);
    }
  } else {
    warnings.push(
      getErrorMessage(urlhausResult.reason, "URLhaus lookup failed."),
    );
  }

  if (openPhishResult.status === "fulfilled") {
    if (openPhishResult.value) {
      matches.push(openPhishResult.value);
    }
  } else {
    warnings.push(
      getErrorMessage(openPhishResult.reason, "OpenPhish lookup failed."),
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
      getErrorMessage(threatFoxResult.reason, "ThreatFox lookup failed."),
    );
  }

  if (dnsblResult.status === "fulfilled") {
    matches.push(...dnsblResult.value.matches);
    warnings.push(...dnsblResult.value.warnings);
    observations.push(...dnsblResult.value.observations);
  } else {
    warnings.push(getErrorMessage(dnsblResult.reason, "DNSBL lookup failed."));
  }

  const rejectedCount = [
    urlhausResult,
    openPhishResult,
    threatFoxResult,
    dnsblResult,
  ].filter((result) => result.status === "rejected").length;

  if (matches.length === 0 && rejectedCount === 4) {
    throw new Error("All threat-feed lookups failed.");
  }

  return {
    checkedAt: new Date().toISOString(),
    matches,
    observations,
    warnings,
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
    throw new Error(`URLhaus lookup failed with status ${response.status}.`);
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
    // The exact-URL lookup already succeeded; treat host-level errors softly.
    return null;
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
