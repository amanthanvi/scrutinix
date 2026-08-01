"use client";

import { useCallback, useMemo, useState } from "react";

import { useNdjsonRequest } from "@/hooks/use-ndjson-request";
import {
  createPendingSignalResults,
  type AnalysisResult,
  type ApiError,
  type SignalResults,
} from "@/lib/domain/types";
import { sanitizeAnalyzeEvent } from "@/lib/domain/runtime-safety";

interface ScanState {
  url: string;
  startedAt: string | null;
  scanId: string | null;
  signals: SignalResults;
  result: AnalysisResult | null;
  error: ApiError | null;
  isStreaming: boolean;
  /** Whether the server answered from its result cache (null until known). */
  cached: boolean | null;
}

const initialState = (): ScanState => ({
  url: "",
  startedAt: null,
  scanId: null,
  signals: createPendingSignalResults(),
  result: null,
  error: null,
  isStreaming: false,
  cached: null,
});

export function useScanStream(onComplete?: (result: AnalysisResult) => void) {
  const [state, setState] = useState<ScanState>(initialState);
  const request = useNdjsonRequest({
    endpoint: "/api/analyze",
    requestLabel: "Scan request",
    streamFailureMessage: "The scan stream failed unexpectedly.",
  });

  const startScan = useCallback(
    async (url: string) => {
      setState({ ...initialState(), url, isStreaming: true });

      await request.start(
        { url },
        {
          onEvent: (rawEvent) => {
            const event = sanitizeAnalyzeEvent(rawEvent);
            if (!event) {
              return;
            }

            if (event.type === "scan_started") {
              setState((previous) => ({
                ...previous,
                url: event.url,
                scanId: event.scanId,
                startedAt: event.startedAt,
                cached: event.cached,
              }));
            }

            if (event.type === "signal_result") {
              setState((previous) => ({
                ...previous,
                signals: {
                  ...previous.signals,
                  [event.name]: event.result,
                },
              }));
            }

            if (event.type === "scan_complete") {
              setState((previous) => ({
                ...previous,
                result: event.result,
                signals: event.result.signals,
                isStreaming: false,
                error: null,
              }));
              onComplete?.(event.result);
            }

            if (event.type === "scan_error") {
              setState((previous) => ({
                ...previous,
                error: event.error,
                isStreaming: false,
              }));
            }
          },
          onError: (error) => {
            setState((previous) => ({
              ...previous,
              error,
              isStreaming: false,
            }));
          },
          onAborted: () => {
            setState((previous) => ({
              ...previous,
              isStreaming: false,
            }));
          },
        },
      );
    },
    [request, onComplete],
  );

  const cancelScan = useCallback(() => {
    request.cancel();
    setState((previous) => ({
      ...previous,
      isStreaming: false,
    }));
  }, [request]);

  return useMemo(
    () => ({ state, startScan, cancelScan }),
    [state, startScan, cancelScan],
  );
}
