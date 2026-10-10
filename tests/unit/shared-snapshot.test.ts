import { describe, expect, it } from "vitest";

import {
  SHARED_SUMMARY_MAX_LENGTH,
  decodeSharedSnapshot,
  encodeSharedSnapshot,
} from "@/lib/domain/shared-snapshot";
import {
  createPendingSignalResults,
  type AnalysisResult,
} from "@/lib/domain/types";

function encodeCurrent(value: unknown): string {
  return btoa(encodeURIComponent(JSON.stringify(value)));
}

function encodeLegacy(value: unknown): string {
  return btoa(JSON.stringify(value));
}

const snapshot = {
  verdict: "safe",
  url: "https://example.com/",
  summary:
    "No strong malicious indicators were found across the available signals.",
  capturedAt: "2026-03-21T00:00:00.480Z",
};

function buildResult(summary: string): AnalysisResult {
  return {
    id: "scan-1",
    url: "https://example.com/login",
    verdict: "malicious",
    signals: createPendingSignalResults(),
    threatInfo: {
      verdict: "malicious",
      confidence: 0.9,
      confidenceLabel: "high",
      confidenceReasons: [],
      hasPositiveEvidence: true,
      score: 88,
      summary,
      categories: ["phishing"],
      reasons: [],
      recommendations: [],
      limitations: [],
    },
    metadata: {
      scanId: "scan-1",
      startedAt: "2026-08-02T12:00:00.000Z",
      completedAt: "2026-08-02T12:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

describe("decodeSharedSnapshot", () => {
  it("reads current links", () => {
    expect(decodeSharedSnapshot(encodeCurrent(snapshot))).toEqual(snapshot);
  });

  it("keeps the first links, which base64-encoded raw JSON, readable", () => {
    expect(decodeSharedSnapshot(encodeLegacy(snapshot))).toEqual(snapshot);
  });

  it("keeps non-Latin-1 summaries intact", () => {
    const summary = "Risque élevé — 钓鱼 signals.";
    expect(
      decodeSharedSnapshot(encodeCurrent({ ...snapshot, summary }))?.summary,
    ).toBe(summary);
  });

  it("rejects payloads that are not a snapshot", () => {
    expect(decodeSharedSnapshot("not base64!")).toBeNull();
    expect(decodeSharedSnapshot(btoa("{not json"))).toBeNull();
    expect(
      decodeSharedSnapshot(encodeCurrent({ ...snapshot, verdict: "verified" })),
    ).toBeNull();
    expect(
      decodeSharedSnapshot(
        encodeCurrent({ ...snapshot, summary: "x".repeat(601) }),
      ),
    ).toBeNull();
  });

  it("rejects a URL a fresh scan could not check", () => {
    for (const url of [
      "Verified safe by the Scrutinix security team",
      "javascript:alert(1)",
      "http://localhost/admin",
      "",
    ]) {
      expect(
        decodeSharedSnapshot(encodeCurrent({ ...snapshot, url })),
        url,
      ).toBeNull();
    }
  });

  it("shows the URL exactly as a fresh scan would check it", () => {
    const decoded = decodeSharedSnapshot(
      encodeCurrent({
        ...snapshot,
        url: "  https://EXAMPLE.com:443/pay\u202Egpj.exe#fragment ",
      }),
    );

    expect(decoded?.url).toBe("https://example.com/pay%E2%80%AEgpj.exe");
  });

  it("keeps capturedAt only when it is a timestamp", () => {
    expect(
      decodeSharedSnapshot(
        encodeCurrent({
          ...snapshot,
          capturedAt: "Checked by Scrutinix staff today",
        }),
      )?.capturedAt,
    ).toBeNull();
    expect(
      decodeSharedSnapshot(encodeCurrent({ ...snapshot, capturedAt: "2026" }))
        ?.capturedAt,
    ).toBeNull();
    expect(
      decodeSharedSnapshot(
        encodeCurrent({ ...snapshot, capturedAt: "2026-03-21T00:00:00+02:00" }),
      )?.capturedAt,
    ).toBe("2026-03-21T00:00:00+02:00");
  });

  it("strips invisible formatting and control characters from the summary", () => {
    const decoded = decodeSharedSnapshot(
      encodeCurrent({
        ...snapshot,
        summary:
          "Safe\u202E for\u200B all.\n\n\tSign\u0000 in\u2028now at Pay\u200Dpal. ",
      }),
    );

    expect(decoded?.summary).toBe("Safe for all. Sign in now at Paypal.");
  });

  it("drops a summary with nothing visible left", () => {
    expect(
      decodeSharedSnapshot(
        encodeCurrent({ ...snapshot, summary: " \u200B\u202E\n " }),
      )?.summary,
    ).toBeNull();
  });

  it("caps the summary for display without splitting a character", () => {
    const summary = `${"a".repeat(SHARED_SUMMARY_MAX_LENGTH - 2)}🙂🙂🙂`;
    const decoded = decodeSharedSnapshot(
      encodeCurrent({ ...snapshot, summary }),
    );

    expect(Array.from(decoded?.summary ?? "")).toHaveLength(
      SHARED_SUMMARY_MAX_LENGTH,
    );
    expect(decoded?.summary).toBe(
      `${"a".repeat(SHARED_SUMMARY_MAX_LENGTH - 2)}🙂…`,
    );
  });
});

describe("encodeSharedSnapshot", () => {
  it("round-trips a result into an unverified snapshot", () => {
    const result = buildResult("Malicious risk based on phishing signals.");

    expect(decodeSharedSnapshot(encodeSharedSnapshot(result))).toEqual({
      verdict: "malicious",
      url: "https://example.com/login",
      summary: "Malicious risk based on phishing signals.",
      capturedAt: "2026-08-02T12:00:01.000Z",
    });
  });

  it("stays within what every reader accepts, even for a long summary", () => {
    const payload = encodeSharedSnapshot(buildResult("b".repeat(900)));
    const wire = JSON.parse(decodeURIComponent(atob(payload))) as {
      summary: string;
    };

    expect(Array.from(wire.summary)).toHaveLength(SHARED_SUMMARY_MAX_LENGTH);
    expect(decodeSharedSnapshot(payload)?.summary).toBe(wire.summary);
  });
});
