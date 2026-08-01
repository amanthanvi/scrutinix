import { getEnv } from "@/lib/config/env";
import type { ThreatFeedsData } from "@/lib/domain/types";
import { simplifyUrlForMatching } from "@/lib/domain/url";
import { fetchWithTimeout } from "@/lib/server/http";
import { checkOpenPhishFeed } from "@/lib/server/providers/openphish-feed";
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

  const [urlhausResult, openPhishResult] = await Promise.allSettled([
    checkUrlhaus(url, signal),
    checkOpenPhishFeed(url),
  ]);

  if (urlhausResult.status === "fulfilled" && urlhausResult.value.match) {
    matches.push(urlhausResult.value.match);
  }

  if (
    urlhausResult.status === "fulfilled" &&
    urlhausResult.value.noListingObservation
  ) {
    observations.push(URLHAUS_NO_LISTING_OBSERVATION);
  }

  if (openPhishResult.status === "fulfilled" && openPhishResult.value) {
    matches.push(openPhishResult.value);
  }

  if (urlhausResult.status === "rejected") {
    warnings.push(
      getErrorMessage(urlhausResult.reason, "URLhaus lookup failed."),
    );
  }

  if (openPhishResult.status === "rejected") {
    warnings.push(
      getErrorMessage(openPhishResult.reason, "OpenPhish lookup failed."),
    );
  }

  if (matches.length === 0 && warnings.length === 2) {
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
      },
      noListingObservation: false,
    };
  }

  return {
    match: null,
    noListingObservation: queryStatus === "no_results",
  };
}
