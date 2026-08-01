import { getEnv } from "@/lib/config/env";
import type { GoogleSafeBrowsingData } from "@/lib/domain/types";
import { fetchWithTimeout } from "@/lib/server/http";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export async function runGoogleSafeBrowsingProvider(
  url: string,
  signal?: AbortSignal,
): Promise<GoogleSafeBrowsingData> {
  const env = getEnv();
  const apiKey = env.GOOGLE_SAFE_BROWSING_API_KEY;

  if (!apiKey) {
    throw new Error("Google Safe Browsing API key is not configured.");
  }

  const response = await fetchWithTimeout(
    "https://safebrowsing.googleapis.com/v4/threatMatches:find",
    {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        // Header keeps the key out of proxy/CDN access logs.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        client: {
          clientId: "scrutinix",
          clientVersion: "3.0.0",
        },
        threatInfo: {
          threatTypes: [
            "MALWARE",
            "SOCIAL_ENGINEERING",
            "UNWANTED_SOFTWARE",
            "POTENTIALLY_HARMFUL_APPLICATION",
          ],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
    },
    8_000,
  );

  if (!response.ok) {
    throw new Error(
      `Google Safe Browsing lookup failed with status ${response.status}.`,
    );
  }

  const payload = asRecord(await response.json());
  const matches = Array.isArray(payload?.matches)
    ? payload.matches.flatMap((item) => {
        const record = asRecord(item);
        if (!record) {
          return [];
        }

        return [
          {
            threatType:
              typeof record.threatType === "string"
                ? record.threatType
                : "UNKNOWN",
            platformType:
              typeof record.platformType === "string"
                ? record.platformType
                : "ANY_PLATFORM",
            threatEntryType:
              typeof record.threatEntryType === "string"
                ? record.threatEntryType
                : "URL",
          },
        ];
      })
    : [];

  return {
    checkedAt: new Date().toISOString(),
    matches,
  };
}
