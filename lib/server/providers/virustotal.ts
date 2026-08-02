import { Buffer } from "node:buffer";

import { getEnv } from "@/lib/config/env";
import type { VirusTotalData } from "@/lib/domain/types";
import { fetchWithTimeout, sleep, withTimeout } from "@/lib/server/http";

const API_BASE = "https://www.virustotal.com/api/v3";

/** Per-request ceiling; VT URL analyses often exceed the default 8s global budget. */
const VT_FETCH_TIMEOUT_MS = 25_000;
/**
 * Wall-clock cap for the entire provider (report lookup, 429 retry sleeps,
 * submit + polling). Without it, Retry-After sleeps alone could hold a scan
 * open for minutes.
 */
const VT_PROVIDER_BUDGET_MS = 45_000;
const VT_MAX_POLL_ATTEMPTS = 8;
const VT_POLL_BASE_DELAY_MS = 2_000;
const VT_429_MAX_RETRIES = 3;

interface VtRequestContext {
  signal?: AbortSignal;
  deadline: number;
}

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
  context: VtRequestContext,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-apikey", apiKey);

  let last429: Response | null = null;

  for (let attempt = 0; attempt <= VT_429_MAX_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(
      url,
      { ...init, headers, signal: context.signal },
      Math.min(VT_FETCH_TIMEOUT_MS, remainingBudget(context)),
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

    // Never sleep past the provider deadline; return the 429 instead.
    const remaining = remainingBudget(context);
    if (delay >= remaining) {
      return response;
    }
    await sleep(delay, context.signal);
  }

  return last429 ?? new Response(null, { status: 599 });
}

function remainingBudget(context: VtRequestContext) {
  return Math.max(1, context.deadline - Date.now());
}

export async function runVirusTotalProvider(
  url: string,
  signal?: AbortSignal,
): Promise<VirusTotalData> {
  const env = getEnv();
  const apiKey = env.VIRUSTOTAL_API_KEY;

  if (!apiKey) {
    throw new Error("VirusTotal API key is not configured.");
  }

  const context: VtRequestContext = {
    signal,
    deadline: Date.now() + VT_PROVIDER_BUDGET_MS,
  };

  const urlId = Buffer.from(url).toString("base64url");
  const reportResponse = await virusTotalFetch(
    `${API_BASE}/urls/${urlId}`,
    apiKey,
    context,
  );

  if (reportResponse.ok) {
    const report = await reportResponse.json();
    // Keep successful report lookups to one request. Optional /domains
    // enrichment can otherwise consume half the 4/min free-tier budget and
    // crowd out primary URL coverage during cold batch scans.
    return parseVirusTotalReport(report, urlId);
  }

  if (reportResponse.status !== 404) {
    throw new Error(
      `VirusTotal lookup failed with status ${reportResponse.status}.`,
    );
  }

  return withTimeout(
    submitAndPollAnalysis(url, urlId, apiKey, context),
    remainingBudget(context),
    "VirusTotal submit/poll",
  );
}

async function submitAndPollAnalysis(
  url: string,
  urlId: string,
  apiKey: string,
  context: VtRequestContext,
): Promise<VirusTotalData> {
  const submitResponse = await virusTotalFetch(
    `${API_BASE}/urls`,
    apiKey,
    context,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ url }),
    },
  );

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
    const delay = (attempt + 1) * VT_POLL_BASE_DELAY_MS;
    if (delay >= remainingBudget(context)) {
      break;
    }
    await sleep(delay, context.signal);

    const analysisResponse = await virusTotalFetch(
      `${API_BASE}/analyses/${analysisId}`,
      apiKey,
      context,
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
  const lastAnalysisUnix =
    typeof attributes?.last_analysis_date === "number"
      ? attributes.last_analysis_date
      : null;

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
    lastAnalysisDate: lastAnalysisUnix
      ? new Date(lastAnalysisUnix * 1000).toISOString()
      : null,
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
    // A freshly-completed analysis is by definition current.
    lastAnalysisDate: new Date().toISOString(),
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
