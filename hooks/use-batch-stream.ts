"use client";

import { useCallback, useMemo, useState } from "react";

import { useNdjsonRequest } from "@/hooks/use-ndjson-request";
import { sanitizeBatchEvent } from "@/lib/domain/runtime-safety";
import type { AnalysisResult, ApiError } from "@/lib/domain/types";

interface BatchItem {
  index: number;
  url: string;
  status: "pending" | "complete";
  result: AnalysisResult | null;
}

interface BatchState {
  items: BatchItem[];
  isStreaming: boolean;
  error: ApiError | null;
  /** Total scans the server acknowledged for this batch. */
  total: number | null;
  /** Index of the most recently started URL, for progress display. */
  activeIndex: number | null;
}

function completedResults(items: BatchItem[]): AnalysisResult[] {
  return items.flatMap((item) => (item.result ? [item.result] : []));
}

export function useBatchStream(
  onUrlComplete?: (result: AnalysisResult) => void,
) {
  const [state, setState] = useState<BatchState>({
    items: [],
    isStreaming: false,
    error: null,
    total: null,
    activeIndex: null,
  });
  const request = useNdjsonRequest({
    endpoint: "/api/analyze/batch",
    requestLabel: "Batch request",
    streamFailureMessage: "The batch request stream failed unexpectedly.",
  });

  const startBatch = useCallback(
    async (urls: string[]) => {
      setState({
        items: urls.map((url, index) => ({
          index,
          url,
          status: "pending",
          result: null,
        })),
        isStreaming: true,
        error: null,
        total: urls.length,
        activeIndex: null,
      });

      await request.start(
        { urls },
        {
          onEvent: (rawEvent) => {
            const event = sanitizeBatchEvent(rawEvent);
            if (!event) {
              return;
            }

            if (event.type === "batch_started") {
              setState((previous) => ({
                ...previous,
                total: event.total,
              }));
            }

            if (event.type === "url_started") {
              setState((previous) => ({
                ...previous,
                activeIndex: event.index,
              }));
            }

            if (event.type === "url_complete") {
              setState((previous) => ({
                ...previous,
                items: previous.items.map((item) =>
                  item.index === event.index
                    ? {
                        ...item,
                        url: event.result.url,
                        status: "complete",
                        result: event.result,
                      }
                    : item,
                ),
              }));
              onUrlComplete?.(event.result);
            }

            if (event.type === "batch_complete") {
              setState((previous) => ({
                ...previous,
                isStreaming: false,
                activeIndex: null,
                items: previous.items.map((item) => {
                  const fromEvent = event.results[item.index];
                  if (!fromEvent) {
                    return item;
                  }

                  return {
                    ...item,
                    url: fromEvent.url,
                    status: "complete",
                    result: fromEvent,
                  };
                }),
              }));
            }

            if (event.type === "batch_error") {
              setState((previous) => ({
                ...previous,
                isStreaming: false,
                error: event.error,
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
    [request, onUrlComplete],
  );

  const cancelBatch = useCallback(() => {
    request.cancel();
    setState((previous) => ({
      ...previous,
      isStreaming: false,
    }));
  }, [request]);

  const value = useMemo(() => {
    const results = completedResults(state.items);
    return {
      state: {
        ...state,
        results,
      },
      startBatch,
      cancelBatch,
    };
  }, [state, startBatch, cancelBatch]);

  return value;
}
