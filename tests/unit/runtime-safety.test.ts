import { describe, expect, it } from "vitest";

import {
  sanitizeAnalysisResult,
  sanitizeAnalyzeEvent,
  sanitizeApiErrorResponse,
  sanitizeBatchEvent,
  sanitizeHistoryEntry,
} from "@/lib/domain/runtime-safety";
import {
  createPendingSignalResults,
  type AnalysisResult,
} from "@/lib/domain/types";

describe("runtime boundary sanitizers", () => {
  it("sanitizes analysis results through the runtime schema", () => {
    const result = sanitizeAnalysisResult({
      id: "",
      url: "https://example.com/",
      verdict: "not-a-verdict",
      signals: createPendingSignalResults(),
      threatInfo: {
        verdict: "suspicious",
        confidence: 2,
        confidenceLabel: "unknown",
        score: -1,
      },
      metadata: {
        completedAt: "2026-04-01T00:00:00.000Z",
        signalCount: -10,
        durationMs: -1,
      },
    });

    expect(result).toMatchObject({
      url: "https://example.com/",
      verdict: "suspicious",
      threatInfo: {
        confidence: 1,
        confidenceLabel: "low",
        score: 0,
      },
      metadata: {
        startedAt: "2026-04-01T00:00:00.000Z",
        completedAt: "2026-04-01T00:00:00.000Z",
        signalCount: 0,
        durationMs: 0,
      },
    });
    expect(result?.id).toMatch(/^restored-2026-04-01T00:00:00.000Z-/);
  });

  it("sanitizes analyze events and rejects invalid event payloads", () => {
    expect(
      sanitizeAnalyzeEvent({
        type: "scan_started",
        scanId: "scan-1",
        url: "https://example.com/",
        startedAt: "2026-04-01T00:00:00.000Z",
        cached: "yes",
      }),
    ).toEqual({
      type: "scan_started",
      scanId: "scan-1",
      url: "https://example.com/",
      cached: false,
      startedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(
      sanitizeAnalyzeEvent({
        type: "signal_result",
        name: "not-a-signal",
        result: {},
      }),
    ).toBeNull();

    expect(
      sanitizeAnalyzeEvent({
        type: "scan_complete",
        result: buildResult("https://example.com/"),
      }),
    ).toMatchObject({
      type: "scan_complete",
      result: {
        url: "https://example.com/",
      },
    });

    expect(
      sanitizeAnalyzeEvent({
        type: "scan_error",
      }),
    ).toEqual({
      type: "scan_error",
      error: {
        code: "unexpected_error",
        message: "The scan failed.",
        retryable: false,
      },
    });
  });

  it("sanitizes batch events and filters invalid completion results", () => {
    expect(
      sanitizeBatchEvent({
        type: "url_complete",
        index: -3,
        result: buildResult("https://example.com/"),
      }),
    ).toMatchObject({
      type: "url_complete",
      index: 0,
      url: "https://example.com/",
      result: {
        url: "https://example.com/",
      },
    });

    expect(
      sanitizeBatchEvent({
        type: "batch_complete",
        results: [null, buildResult("https://example.com/"), "bad"],
      }),
    ).toMatchObject({
      type: "batch_complete",
      results: [
        {
          url: "https://example.com/",
        },
      ],
    });

    expect(
      sanitizeBatchEvent({
        type: "url_started",
        index: 0,
        url: "",
      }),
    ).toBeNull();
  });

  it("coerces a garbage verdict to error when no threat info exists", () => {
    const result = sanitizeAnalysisResult({
      id: "scan-2",
      url: "https://example.com/",
      verdict: 42,
      signals: {},
      threatInfo: null,
      metadata: {},
    });

    expect(result?.verdict).toBe("error");
    expect(result?.signals.virusTotal.status).toBe("error");
  });

  it("restores legacy history entries and backfills savedAt", () => {
    const entry = sanitizeHistoryEntry({
      ...buildResult("https://example.com/legacy"),
      savedAt: undefined,
    });

    expect(entry).toMatchObject({
      url: "https://example.com/legacy",
      savedAt: "2026-04-01T00:00:01.000Z",
    });

    expect(sanitizeHistoryEntry("not-an-entry")).toBeNull();
    expect(sanitizeHistoryEntry(null)).toBeNull();
  });

  it("rejects events with an unknown type", () => {
    expect(sanitizeAnalyzeEvent({ type: "mystery_event" })).toBeNull();
    expect(sanitizeBatchEvent({ type: "keepalive" })).toBeNull();
    expect(sanitizeAnalyzeEvent(null)).toBeNull();
  });

  it("sanitizes API error responses without leaking malformed fields", () => {
    expect(
      sanitizeApiErrorResponse(
        {
          error: {
            code: 500,
            message: "Rate limited",
            retryable: "later",
          },
        },
        "Fallback message",
      ),
    ).toEqual({
      code: "unexpected_error",
      message: "Rate limited",
      retryable: false,
    });

    expect(sanitizeApiErrorResponse("bad", "Fallback message")).toEqual({
      code: "unexpected_error",
      message: "Fallback message",
      retryable: false,
    });
  });
});

function buildResult(url: string): AnalysisResult {
  return {
    id: "scan-1",
    url,
    verdict: "safe",
    signals: createPendingSignalResults(),
    threatInfo: null,
    metadata: {
      scanId: "scan-1",
      startedAt: "2026-04-01T00:00:00.000Z",
      completedAt: "2026-04-01T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}
