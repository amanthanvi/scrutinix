import { Buffer } from "node:buffer";

import { getEnv } from "@/lib/config/env";
import type { VirusTotalData } from "@/lib/domain/types";
import { fetchWithTimeout, sleep, withTimeout } from "@/lib/server/http";

const API_BASE = "https://www.virustotal.com/api/v3";

/** Per-request ceiling; VT URL analyses often exceed the default 8s global budget. */
const VT_FETCH_TIMEOUT_MS = 25_000;
/** Wall-clock cap for submit + polling so scans cannot hang indefinitely. */
const VT_SUBMIT_POLL_BUDGET_MS = 90_000;
const VT_MAX_POLL_ATTEMPTS = 8;
const VT_POLL_BASE_DELAY_MS = 2_000;
const VT_429_MAX_RETRIES = 3;

interface VirusTotalEngineResultPayload {
  category?: string;
  result?: string | null;
}

interface VirusTotalStatsPayload {
  malicious?: number;
  suspicious?: number;
  harmless?: number;
  undetected?: number;
  timeout?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readStats(value: unknown): VirusTotalStatsPayload {
  const record = asRecord(value);

  return {
    malicious:
      typeof record?.malicious === "number" ? record.malicious : undefined,
    suspicious:
      typeof record?.suspicious === "number" ? record.suspicious : undefined,
    harmless:
      typeof record?.harmless === "number" ? record.harmless : undefined,
    undetected:
      typeof record?.undetected === "number" ? record.undetected : undefined,
    timeout: typeof record?.timeout === "number" ? record.timeout : undefined,
  };
}

function readEngineResults(
  value: unknown,
): Record<string, VirusTotalEngineResultPayload> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).flatMap(([engine, engineValue]) => {
      const engineRecord = asRecord(engineValue);
      if (!engineRecord) {
        return [];
      }

      return [
        [
          engine,
          {
            category:
              typeof engineRecord.category === "string"
                ? engineRecord.category
                : undefined,
            result:
              typeof engineRecord.result === "string" ||
              engineRecord.result === null
                ? engineRecord.result
                : undefined,
          },
        ],
      ];
    }),
  );
}

/** Parse Retry-After as seconds (number) or HTTP-date; returns delay in ms. */
function parseRetryAfterDelayMs(header: string | null): number | null {
  if (!header) {
    return null;
  }

  const trimmed = header.trim();
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(asSeconds * 1000, 60_000);
  }

  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) {
    const delta = when - Date.now();
    return delta > 0 ? Math.min(delta, 120_000) : 0;
  }

  return null;
}

async function virusTotalFetch(
  url: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-apikey", apiKey);

  let last429: Response | null = null;

  for (let attempt = 0; attempt <= VT_429_MAX_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(
      url,
      { ...init, headers },
      VT_FETCH_TIMEOUT_MS,
    );

    if (response.status !== 429) {
      return response;
    }

    last429 = response;

    if (attempt === VT_429_MAX_RETRIES) {
      return response;
    }

    const delay =
      parseRetryAfterDelayMs(response.headers.get("retry-after")) ??
      (attempt + 1) * 2_000;
    await sleep(delay);
  }

  return last429 ?? new Response(null, { status: 599 });
}

export async function runVirusTotalProvider(
  url: string,
): Promise<VirusTotalData> {
  const env = getEnv();
  const apiKey = env.VIRUSTOTAL_API_KEY;

  if (!apiKey) {
    throw new Error("VirusTotal API key is not configured.");
  }

  const urlId = Buffer.from(url).toString("base64url");
  const reportResponse = await virusTotalFetch(
    `${API_BASE}/urls/${urlId}`,
    apiKey,
  );

  if (reportResponse.ok) {
    const report = await reportResponse.json();
    return parseVirusTotalReport(report, urlId);
  }

  if (reportResponse.status !== 404) {
    throw new Error(
      `VirusTotal lookup failed with status ${reportResponse.status}.`,
    );
  }

  return withTimeout(
    submitAndPollAnalysis(url, urlId, apiKey),
    VT_SUBMIT_POLL_BUDGET_MS,
    "VirusTotal submit/poll",
  );
}

async function submitAndPollAnalysis(
  url: string,
  urlId: string,
  apiKey: string,
): Promise<VirusTotalData> {
  const submitResponse = await virusTotalFetch(`${API_BASE}/urls`, apiKey, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ url }),
  });

  if (!submitResponse.ok) {
    throw new Error(
      `VirusTotal submission failed with status ${submitResponse.status}.`,
    );
  }

  const submitPayload = asRecord(await submitResponse.json());
  const analysisId = asRecord(submitPayload?.data)?.id;
  if (typeof analysisId !== "string" || !analysisId) {
    throw new Error("VirusTotal submission did not return an analysis id.");
  }

  for (let attempt = 0; attempt < VT_MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep((attempt + 1) * VT_POLL_BASE_DELAY_MS);

    const analysisResponse = await virusTotalFetch(
      `${API_BASE}/analyses/${analysisId}`,
      apiKey,
    );

    if (!analysisResponse.ok) {
      throw new Error(
        `VirusTotal analysis polling failed with status ${analysisResponse.status}.`,
      );
    }

    const analysisPayload = await analysisResponse.json();
    const status = asRecord(
      asRecord(asRecord(analysisPayload)?.data)?.attributes,
    )?.status;
    if (status === "completed") {
      return parseVirusTotalAnalysis(analysisPayload, urlId);
    }
  }

  throw new Error(
    "VirusTotal analysis did not complete before the timeout budget.",
  );
}

function parseVirusTotalReport(
  payload: unknown,
  urlId: string,
): VirusTotalData {
  const attributes = asRecord(asRecord(asRecord(payload)?.data)?.attributes);
  const stats = readStats(attributes?.last_analysis_stats);
  const results = readEngineResults(attributes?.last_analysis_results);

  return {
    malicious: Number(stats.malicious ?? 0),
    suspicious: Number(stats.suspicious ?? 0),
    harmless: Number(stats.harmless ?? 0),
    undetected: Number(stats.undetected ?? 0),
    timeout: Number(stats.timeout ?? 0),
    results: parseVirusTotalResults(results).filter(
      (entry) => entry.category !== "undetected",
    ),
    permalink: `https://www.virustotal.com/gui/url/${urlId}`,
  };
}

function parseVirusTotalAnalysis(
  payload: unknown,
  urlId: string,
): VirusTotalData {
  const attributes = asRecord(asRecord(asRecord(payload)?.data)?.attributes);
  const stats = readStats(attributes?.stats);
  const results = readEngineResults(attributes?.results);

  return {
    malicious: Number(stats.malicious ?? 0),
    suspicious: Number(stats.suspicious ?? 0),
    harmless: Number(stats.harmless ?? 0),
    undetected: Number(stats.undetected ?? 0),
    timeout: Number(stats.timeout ?? 0),
    results: parseVirusTotalResults(results),
    permalink: `https://www.virustotal.com/gui/url/${urlId}`,
  };
}

function parseVirusTotalResults(
  results: Record<string, VirusTotalEngineResultPayload>,
) {
  return Object.entries(results).map(([engine, data]) => ({
    engine,
    category: String(data.category ?? "unknown"),
    result: data.result ?? null,
  }));
}
