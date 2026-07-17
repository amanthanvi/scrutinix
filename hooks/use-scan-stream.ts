"use client";

import { useCallback, useRef, useState } from "react";

import { readNdjsonStream } from "@/lib/client/ndjson";
import { streamFailureApiError } from "@/lib/client/stream-error";
import {
  createPendingSignalResults,
  type AnalysisResult,
  type ApiError,
  type SignalResults,
} from "@/lib/domain/types";
import {
  sanitizeAnalyzeEvent,
  sanitizeApiErrorResponse,
} from "@/lib/domain/runtime-safety";

interface ScanState {
  url: string;
  startedAt: string | null;
  scanId: string | null;
  signals: SignalResults;
  result: AnalysisResult | null;
  error: ApiError | null;
  isStreaming: boolean;
}

const initialState = (): ScanState => ({
  url: "",
  startedAt: null,
  scanId: null,
  signals: createPendingSignalResults(),
  result: null,
  error: null,
  isStreaming: false,
});

export function useScanStream(onComplete?: (result: AnalysisResult) => void) {
  const [state, setState] = useState<ScanState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const startScan = useCallback(
    async (url: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        url,
        startedAt: null,
        scanId: null,
        signals: createPendingSignalResults(),
        result: null,
        error: null,
        isStreaming: true,
      });

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const error = sanitizeApiErrorResponse(
            payload,
            `Scan request failed with status ${response.status}.`,
          );
          setState((previous) => ({
            ...previous,
            error,
            isStreaming: false,
          }));
          return;
        }

        await readNdjsonStream(response, (rawEvent) => {
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
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          setState((previous) => ({
            ...previous,
            isStreaming: false,
          }));
          return;
        }

        setState((previous) => ({
          ...previous,
          isStreaming: false,
          error: streamFailureApiError(
            error,
            "The scan stream failed unexpectedly.",
          ),
        }));
      }
    },
    [onComplete],
  );

  const cancelScan = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((previous) => ({
      ...previous,
      isStreaming: false,
      error: previous.error,
    }));
  }, []);

  return {
    state,
    startScan,
    cancelScan,
  };
}
