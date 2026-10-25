import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBatchStream } from "@/hooks/use-batch-stream";
import { useScanStream } from "@/hooks/use-scan-stream";

function ndjsonResponse(events: unknown[]): Response {
  return new Response(
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    },
  );
}

function apiError(message: string) {
  return { code: "scan_failed", message, retryable: false };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The route emits its own terminal error, and the stream backstop adds a
// second one if the handler throws afterwards. The first one is the cause.
describe("two terminal error events on one stream", () => {
  it("keeps the first scan_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse([
          { type: "scan_error", error: apiError("First failure.") },
          { type: "scan_error", error: apiError("Second failure.") },
        ]),
      ),
    );

    const { result } = renderHook(() => useScanStream());
    await act(async () => {
      await result.current.startScan("https://example.com/");
    });

    expect(result.current.state.error?.message).toBe("First failure.");
    expect(result.current.state.isStreaming).toBe(false);
  });

  it("keeps the first scan_error when a later line is truncated", async () => {
    const first =
      "The scan failed unexpectedly. Reference: 11111111-1111-1111-1111-111111111111.";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `${JSON.stringify({ type: "scan_error", error: apiError(first) })}\n{"type":"scan_error","error":`,
            {
              status: 200,
              headers: { "content-type": "application/x-ndjson" },
            },
          ),
      ),
    );

    const { result } = renderHook(() => useScanStream());
    await act(async () => {
      await result.current.startScan("https://example.com/");
    });

    expect(result.current.state.error?.message).toBe(first);
    expect(result.current.state.isStreaming).toBe(false);
  });

  it("keeps the first batch_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse([
          { type: "batch_started", total: 1, startedAt: "t" },
          { type: "batch_error", error: apiError("First failure.") },
          { type: "batch_error", error: apiError("Second failure.") },
        ]),
      ),
    );

    const { result } = renderHook(() => useBatchStream());
    await act(async () => {
      await result.current.startBatch(["https://example.com/"]);
    });

    expect(result.current.state.error?.message).toBe("First failure.");
    expect(result.current.state.isStreaming).toBe(false);
  });
});
