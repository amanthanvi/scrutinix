import { getEnv } from "@/lib/config/env";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { createCacheKey, normalizeUrlInput } from "@/lib/domain/url";
import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
  type SignalName,
  type SignalPayloadMap,
  type SignalResult,
  type SignalResults,
} from "@/lib/domain/types";
import { createApiError } from "@/lib/server/api-error";
import { analysisCache } from "@/lib/server/cache";
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

type SignalListener = (payload: {
  name: SignalName;
  result: SignalResults[SignalName];
}) => void;

interface AnalyzeOptions {
  onSignal?: SignalListener;
  scanId?: string;
  startedAt?: string;
}

type SignalOutcome<Name extends SignalName> = {
  name: Name;
  result: SignalResult<SignalPayloadMap[Name]>;
};

export async function runAnalysis(input: string, options: AnalyzeOptions = {}) {
  const normalized = normalizeUrlInput(input);

  if (!normalized.ok) {
    return {
      ok: false as const,
      status: 400,
      error: createApiError("invalid_url", normalized.error, false),
    };
  }

  const startedAt = options.startedAt ?? new Date().toISOString();
  const scanId = options.scanId ?? crypto.randomUUID();
  const cacheKey = createCacheKey(normalized.value.normalizedUrl);
  const cached = analysisCache.get(cacheKey);

  if (cached) {
    const cachedResult = {
      ...cached,
      id: scanId,
      metadata: {
        ...cached.metadata,
        scanId,
        cacheHit: true,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    } satisfies AnalysisResult;

    for (const name of signalNames) {
      options.onSignal?.({ name, result: cachedResult.signals[name] });
    }

    return {
      ok: true as const,
      result: cachedResult,
      scanId,
      startedAt,
      cached: true,
      normalizedUrl: normalized.value.normalizedUrl,
    };
  }

  const signals: SignalResults = createPendingSignalResults();
  const signalTasks = [
    createSignalTask("virusTotal", () =>
      runVirusTotalProvider(normalized.value.normalizedUrl),
    ),
    createSignalTask("mlEnsemble", () =>
      runMlEnsembleProvider(normalized.value.normalizedUrl),
    ),
    createSignalTask("googleSafeBrowsing", () =>
      runGoogleSafeBrowsingProvider(normalized.value.normalizedUrl),
    ),
    createSignalTask("threatFeeds", () =>
      runThreatFeedsProvider(normalized.value.normalizedUrl),
    ),
    createSignalTask("ssl", () => runSslSignal(normalized.value.normalizedUrl)),
    createSignalTask("whois", () =>
      runWhoisSignal(normalized.value.normalizedUrl),
    ),
    createSignalTask("dns", () => runDnsSignal(normalized.value.normalizedUrl)),
    createSignalTask("redirectChain", () =>
      runRedirectSignal(normalized.value.normalizedUrl),
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
    url: normalized.value.normalizedUrl,
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId,
      startedAt,
      completedAt,
      cacheHit: false,
      partialFailure: Object.values(signals).some(
        (signal) => signal.status === "error",
      ),
      signalCount: signalNames.length,
      durationMs:
        new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    },
  };

  if (verdict !== "error" && !result.metadata?.partialFailure) {
    analysisCache.set(cacheKey, result);
  }

  const env = getEnv();
  logInfo(
    "scan.completed",
    createSafeLogContext(normalized.value.normalizedUrl, {
      scanId,
      verdict,
      cacheHit: false,
      partialFailure: result.metadata.partialFailure,
      configuredProviders: {
        virusTotal: Boolean(env.VIRUSTOTAL_API_KEY),
        googleSafeBrowsing: Boolean(env.GOOGLE_SAFE_BROWSING_API_KEY),
        huggingFace: Boolean(env.HUGGINGFACE_API_KEY),
      },
    }),
  );

  return {
    ok: true as const,
    result,
    scanId,
    startedAt,
    cached: false,
    normalizedUrl: normalized.value.normalizedUrl,
  };
}

function createSignalTask<Name extends SignalName>(
  name: Name,
  handler: () => Promise<SignalPayloadMap[Name]>,
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

      logError("signal.failed", {
        signal: name,
        message: getErrorMessage(error),
      });

      const result: SignalResult<SignalPayloadMap[Name]> = {
        status: "error",
        data: null,
        error: getErrorMessage(error),
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
