import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
} from "@/lib/domain/types";

/**
 * A fully-formed error-verdict result for scans that failed before any
 * signal could run (e.g. a batch item that threw during setup).
 */
export function createErrorAnalysisResult(options: {
  url: string;
  scanId: string;
  startedAt: string;
  message: string;
}): AnalysisResult {
  const { url, scanId, startedAt, message } = options;
  const completedAt = new Date().toISOString();
  const signals = createPendingSignalResults();
  const signalMessage = `The scan failed before Scrutinix could complete signal execution: ${message}`;

  for (const signalName of signalNames) {
    signals[signalName] = {
      status: "error",
      data: null,
      error: signalMessage,
      durationMs: 0,
    };
  }

  return {
    id: scanId,
    url,
    verdict: "error",
    threatInfo: null,
    signals,
    metadata: {
      scanId,
      startedAt,
      completedAt,
      cacheHit: false,
      partialFailure: true,
      signalCount: signalNames.length,
      durationMs:
        new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    },
  };
}
