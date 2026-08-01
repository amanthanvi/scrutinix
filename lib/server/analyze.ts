import { getEnv } from "@/lib/config/env";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { createCacheKey, type NormalizedUrl } from "@/lib/domain/url";
import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
  type SignalName,
  type SignalPayloadMap,
  type SignalResult,
  type SignalResults,
} from "@/lib/domain/types";
import {
  analysisCache,
  DEGRADED_RESULT_TTL_MS,
  FULL_RESULT_TTL_MS,
} from "@/lib/server/cache";
import { logError, logInfo, createSafeLogContext } from "@/lib/server/logger";
import { runGoogleSafeBrowsingProvider } from "@/lib/server/providers/google-safe-browsing";
import { runMlEnsembleProvider } from "@/lib/server/providers/ml-ensemble";
import { runThreatFeedsProvider } from "@/lib/server/providers/threat-feeds";
import { runVirusTotalProvider } from "@/lib/server/providers/virustotal";
import { getErrorMessage, isSignalSkipError } from "@/lib/server/signal-error";
import { runDnsSignal } from "@/lib/server/signals/dns";
import { runRedirectSignal } from "@/lib/server/signals/redirect-chain";
import { runSslSignal } from "@/lib/server/signals/ssl";
import { runWhoisSignal } from "@/lib/server/signals/whois";

/** Wall-clock budget for one scan; routes wire it into the AbortSignal. */
export const SCAN_BUDGET_MS = 60_000;

const ABORTED_SIGNAL_MESSAGE =
  "The scan was cancelled or exceeded its time budget.";

type SignalListener = (payload: {
  name: SignalName;
  result: SignalResults[SignalName];
}) => void;

type ScanReadyListener = (payload: {
  cached: boolean;
  scanId: string;
  startedAt: string;
  normalizedUrl: string;
}) => void;

interface AnalyzeOptions {
  onSignal?: SignalListener;
  /** Fired once after the cache decision, before any signal_result events. */
  onScanReady?: ScanReadyListener;
  scanId?: string;
  startedAt?: string;
  /** Aborts in-flight provider work (client disconnect or budget expiry). */
  signal?: AbortSignal;
}

type SignalOutcome<Name extends SignalName> = {
  name: Name;
  result: SignalResult<SignalPayloadMap[Name]>;
};

export async function runAnalysis(
  target: NormalizedUrl,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const env = getEnv();
  const startedAt = options.startedAt ?? new Date().toISOString();
  const scanId = options.scanId ?? crypto.randomUUID();
  const normalizedUrl = target.normalizedUrl;
  const cacheKey = createCacheKey(normalizedUrl);
  const cached = await analysisCache.get(cacheKey);
  const signal = options.signal;

  options.onScanReady?.({
    cached: Boolean(cached),
    scanId,
    startedAt,
    normalizedUrl,
  });

  if (cached) {
    const completedAt = new Date().toISOString();
    const cachedResult = {
      ...cached,
      id: scanId,
      metadata: {
        ...cached.metadata,
        scanId,
        cacheHit: true,
        startedAt,
        completedAt,
        durationMs:
          new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      },
    } satisfies AnalysisResult;

    for (const name of signalNames) {
      options.onSignal?.({ name, result: cachedResult.signals[name] });
    }

    return cachedResult;
  }

  const signals: SignalResults = createPendingSignalResults();
  const signalTasks = [
    createSignalTask(
      "virusTotal",
      () => runVirusTotalProvider(normalizedUrl, signal),
      signal,
    ),
    createSignalTask(
      "mlEnsemble",
      () => runMlEnsembleProvider(normalizedUrl),
      signal,
    ),
    createSignalTask(
      "googleSafeBrowsing",
      () => runGoogleSafeBrowsingProvider(normalizedUrl, signal),
      signal,
    ),
    createSignalTask(
      "threatFeeds",
      () => runThreatFeedsProvider(normalizedUrl, signal),
      signal,
    ),
    createSignalTask("ssl", () => runSslSignal(normalizedUrl, signal), signal),
    createSignalTask(
      "whois",
      () => runWhoisSignal(normalizedUrl, signal),
      signal,
    ),
    createSignalTask("dns", () => runDnsSignal(normalizedUrl), signal),
    createSignalTask(
      "redirectChain",
      () => runRedirectSignal(normalizedUrl, signal),
      signal,
    ),
  ] as const;

  const pending = signalTasks.map(async (task) => {
    const outcome = await task();
    setSignalResult(signals, outcome);
    options.onSignal?.(
      outcome as { name: SignalName; result: SignalResults[SignalName] },
    );
  });

  await Promise.all(pending);

  const completedAt = new Date().toISOString();
  const { verdict, threatInfo } = buildThreatAssessment(signals);

  const result: AnalysisResult = {
    id: scanId,
    url: normalizedUrl,
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId,
      startedAt,
      completedAt,
      cacheHit: false,
      partialFailure: Object.values(signals).some(
        (signalResult) => signalResult.status === "error",
      ),
      signalCount: signalNames.length,
      durationMs:
        new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    },
  };

  // Cache anything with an actionable verdict. Degraded (partial-failure)
  // results get a shorter TTL so a provider hiccup doesn't pin stale data;
  // aborted scans are never cached.
  if (verdict !== "error" && !signal?.aborted) {
    await analysisCache.set(
      cacheKey,
      result,
      result.metadata.partialFailure
        ? DEGRADED_RESULT_TTL_MS
        : FULL_RESULT_TTL_MS,
    );
  }

  logInfo(
    "scan.completed",
    createSafeLogContext(normalizedUrl, {
      scanId,
      verdict,
      cacheHit: false,
      partialFailure: result.metadata.partialFailure,
      configuredProviders: {
        virusTotal: Boolean(env.VIRUSTOTAL_API_KEY),
        googleSafeBrowsing: Boolean(env.GOOGLE_SAFE_BROWSING_API_KEY),
        abuseCh: Boolean(env.URLHAUS_AUTH_KEY),
      },
    }),
  );

  return result;
}

function createSignalTask<Name extends SignalName>(
  name: Name,
  handler: () => Promise<SignalPayloadMap[Name]>,
  signal: AbortSignal | undefined,
) {
  return async (): Promise<SignalOutcome<Name>> => {
    const start = performance.now();

    try {
      const data = await handler();
      const result: SignalResult<SignalPayloadMap[Name]> = {
        status: "success",
        data,
        error: null,
        durationMs: Math.round(performance.now() - start),
      };

      return {
        name,
        result,
      };
    } catch (error) {
      if (isSignalSkipError(error)) {
        const result: SignalResult<SignalPayloadMap[Name]> = {
          status: "skipped",
          data: null,
          error: error.message,
          durationMs: Math.round(performance.now() - start),
        };

        return {
          name,
          result,
        };
      }

      const message = signal?.aborted
        ? ABORTED_SIGNAL_MESSAGE
        : getErrorMessage(error);

      logError("signal.failed", {
        signal: name,
        message,
      });

      const result: SignalResult<SignalPayloadMap[Name]> = {
        status: "error",
        data: null,
        error: message,
        durationMs: Math.round(performance.now() - start),
      };

      return {
        name,
        result,
      };
    }
  };
}

function setSignalResult<Name extends SignalName>(
  signals: SignalResults,
  outcome: SignalOutcome<Name>,
) {
  signals[outcome.name] = outcome.result as SignalResults[Name];
}
