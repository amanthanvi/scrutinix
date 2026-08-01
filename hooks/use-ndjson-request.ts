"use client";

import { useCallback, useMemo, useRef } from "react";

import { readNdjsonStream } from "@/lib/client/ndjson";
import { streamFailureApiError } from "@/lib/client/stream-error";
import { sanitizeApiErrorResponse } from "@/lib/domain/runtime-safety";
import type { ApiError } from "@/lib/domain/types";

interface NdjsonRequestOptions {
  endpoint: string;
  /** Prefix for HTTP-level failures, e.g. "Scan request". */
  requestLabel: string;
  /** Error message when the stream itself breaks mid-flight. */
  streamFailureMessage: string;
}

interface NdjsonRequestHandlers {
  onEvent: (rawEvent: unknown) => void;
  onError: (error: ApiError) => void;
  onAborted: () => void;
}

/**
 * Shared POST-and-stream core for the scan hooks: abort lifecycle, HTTP
 * error sanitizing, NDJSON consumption, and cancel semantics. Callers own
 * their state; this owns the wire.
 */
export function useNdjsonRequest(options: NdjsonRequestOptions) {
  const { endpoint, requestLabel, streamFailureMessage } = options;
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (body: unknown, handlers: NdjsonRequestHandlers) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          handlers.onError(
            sanitizeApiErrorResponse(
              payload,
              `${requestLabel} failed with status ${response.status}.`,
            ),
          );
          return;
        }

        await readNdjsonStream(response, handlers.onEvent);
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          handlers.onAborted();
          return;
        }

        handlers.onError(streamFailureApiError(error, streamFailureMessage));
      }
    },
    [endpoint, requestLabel, streamFailureMessage],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return useMemo(() => ({ start, cancel }), [start, cancel]);
}
