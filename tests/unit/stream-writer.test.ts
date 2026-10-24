import { afterEach, describe, expect, it, vi } from "vitest";

import { readNdjsonStream } from "@/lib/client/ndjson";
import {
  sanitizeAnalyzeEvent,
  sanitizeBatchEvent,
} from "@/lib/domain/runtime-safety";
import { createApiError } from "@/lib/server/api-error";
import { createNdjsonResponse } from "@/lib/server/stream";

const terminalError = (failure: {
  code: string;
  message: string;
  retryable: boolean;
}) => ({
  type: "scan_error" as const,
  error: createApiError(failure.code, failure.message, failure.retryable),
});
const SCAN_ID = "5f0c2a8e-3b1d-4c6e-9a7f-2d4b6c8e0a1f";
const scanStream = {
  terminalError,
  failureSummary: "The scan failed unexpectedly.",
  correlationId: SCAN_ID,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createNdjsonResponse", () => {
  it("streams events and closes cleanly", async () => {
    const response = createNdjsonResponse(async (writer) => {
      writer.send({ type: "batch_started", total: 1, startedAt: "t" });
      writer.send({ type: "keepalive" });
    }, scanStream);

    const text = await response.text();
    const lines = text.trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      type: "batch_started",
    });
  });

  it("aborts the run signal when the client cancels mid-stream", async () => {
    let observedSignal: AbortSignal | null = null;
    let releaseRun = () => {};
    const runHeld = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let sendAfterCancel: (() => void) | null = null;

    const response = createNdjsonResponse(async (writer, clientGone) => {
      observedSignal = clientGone;
      writer.send({ type: "batch_started", total: 1, startedAt: "t" });
      sendAfterCancel = () =>
        writer.send({ type: "batch_complete", results: [] });
      await runHeld;
    }, scanStream);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();

    expect(observedSignal).not.toBeNull();
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);

    // Sends after disconnect must be swallowed, not thrown.
    expect(() => sendAfterCancel?.()).not.toThrow();
    releaseRun();
  });

  it("writes a terminal scan_error the client reader can parse", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = createNdjsonResponse(async () => {
      throw new Error(
        "ONNXRuntime failed WRONGPASS s3cret-token redis://default:s3cret-token@cache.internal",
      );
    }, scanStream);

    const rawEvents: unknown[] = [];
    await readNdjsonStream(response, (event) => {
      rawEvents.push(event);
    });
    const parsed = rawEvents.flatMap((event) => {
      const sanitized = sanitizeAnalyzeEvent(event);
      return sanitized ? [sanitized] : [];
    });
    const scanError = parsed.find((event) => event.type === "scan_error");

    expect(scanError?.type).toBe("scan_error");
    if (scanError?.type !== "scan_error") {
      return;
    }
    // One reference per scan: the backstop cites the route's own scan id.
    expect(scanError.error.message).toBe(
      `The scan failed unexpectedly. Reference: ${SCAN_ID}.`,
    );
    const wire = JSON.stringify(rawEvents);
    expect(wire).not.toContain("s3cret-token");
    expect(wire).not.toContain("ONNXRuntime");
    expect(wire).not.toContain("redis://");

    const logged = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(logged).toContain("ONNXRuntime");
    expect(logged).toContain("WRONGPASS");
    expect(logged).not.toContain("redis://");
  });

  it("ends a batch stream with the batch_error its caller supplies", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = createNdjsonResponse(
      async (writer) => {
        writer.send({ type: "batch_started", total: 2, startedAt: "t" });
        throw new Error("pool exhausted");
      },
      {
        terminalError: (failure) => ({
          type: "batch_error",
          error: createApiError(
            failure.code,
            failure.message,
            failure.retryable,
          ),
        }),
        failureSummary: "The batch failed unexpectedly.",
        correlationId: "batch-1234",
      },
    );

    const rawEvents: unknown[] = [];
    await readNdjsonStream(response, (event) => {
      rawEvents.push(event);
    });
    const parsed = rawEvents.flatMap((event) => {
      const sanitized = sanitizeBatchEvent(event);
      return sanitized ? [sanitized] : [];
    });

    expect(parsed.map((event) => event.type)).toEqual([
      "batch_started",
      "batch_error",
    ]);
    expect(JSON.stringify(rawEvents)).not.toContain("pool exhausted");
    const batchError = parsed.at(-1);
    expect(batchError?.type === "batch_error" && batchError.error.message).toBe(
      "The batch failed unexpectedly. Reference: batch-1234.",
    );
  });

  it("requires a terminalError at the type level", () => {
    // @ts-expect-error a stream with no terminal error event is a compile error
    const missing = () => createNdjsonResponse(async () => {});
    expect(missing).toBeTypeOf("function");
  });
});
