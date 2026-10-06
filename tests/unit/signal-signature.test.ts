import { describe, expect, it } from "vitest";

import { sharedSnapshotSchema } from "@/lib/domain/schemas";
import {
  buildSharedSnapshot,
  decodeSharedSnapshot,
  encodeSharedSnapshot,
  getResultSignature,
  getSignalSignature,
  isLegacySignalRecord,
  severityWords,
} from "@/lib/domain/signal-signature";
import { severities } from "@/lib/domain/signal-severity";
import { sanitizeHistoryEntry } from "@/lib/domain/runtime-safety";
import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
} from "@/lib/domain/types";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { cleanSignals } from "@/tests/fixtures/lure-signals";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

function resultFor(signals: AnalysisResult["signals"], url: string) {
  const { verdict, threatInfo } = buildThreatAssessment(signals);
  return {
    id: "scan-1",
    url,
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId: "scan-1",
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: "2026-10-06T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  } satisfies AnalysisResult;
}

describe("getSignalSignature (strip state mapping)", () => {
  it("returns one severity per signal in fixed signal order", () => {
    const signature = getSignalSignature(createPendingSignalResults());
    expect(signature).toHaveLength(signalNames.length);
    expect(new Set(signature)).toEqual(new Set(["pending"]));
  });

  it("maps a conviction to flagged and quiet checks to found-nothing gray", async () => {
    const signals = await fixtureSignals("malicious.scrutinix.test");
    const signature = getSignalSignature(signals);
    expect(signature[signalNames.indexOf("virusTotal")]).toBe("malicious");
    expect(signature[signalNames.indexOf("googleSafeBrowsing")]).toBe("clear");
    expect(severityWords.clear).toBe("found nothing");
    expect(severityWords.malicious).toBe("flagged the link");
    // A check that couldn't run never reads as a bad result.
    expect(severityWords.error).toBe("couldn't run");
    expect(severityWords.suspicious).toBe("found a warning sign");
  });

  it("marks a scored check as caution even when its own thresholds are quiet", () => {
    const signals = cleanSignals();
    const index = signalNames.indexOf("whois");
    expect(getSignalSignature(signals)[index]).toBe("clear");
    expect(getSignalSignature(signals, ["whois"])[index]).toBe("suspicious");
  });

  it("maps failed, skipped, and partial checks to their own states", () => {
    const signals = createPendingSignalResults();
    signals.virusTotal = {
      status: "error",
      data: null,
      error: "Timed out.",
      durationMs: 5_000,
    };
    signals.googleSafeBrowsing = {
      status: "skipped",
      data: null,
      error: "No API key.",
      durationMs: 0,
    };
    const signature = getSignalSignature(signals);
    expect(signature[signalNames.indexOf("virusTotal")]).toBe("error");
    expect(signature[signalNames.indexOf("googleSafeBrowsing")]).toBe(
      "skipped",
    );
    expect(Object.keys(severityWords).sort()).toEqual([...severities].sort());
  });
});

describe("legacy records", () => {
  it("draws no signature for entries saved before signals were kept", () => {
    const legacy = sanitizeHistoryEntry({
      id: "old",
      url: "https://old.example/",
      verdict: "safe",
      signals: {},
      metadata: { scanId: "old" },
      savedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(legacy).not.toBeNull();
    expect(isLegacySignalRecord(legacy!.signals)).toBe(true);
    expect(getResultSignature(legacy!)).toBeNull();
  });

  it("still draws eight failed cells for a real scan whose checks all failed", () => {
    const failed = sanitizeHistoryEntry({
      id: "failed",
      url: "https://down.example/",
      verdict: "error",
      signals: Object.fromEntries(
        signalNames.map((name) => [
          name,
          {
            status: "error",
            data: null,
            error: "The provider timed out.",
            durationMs: 0,
          },
        ]),
      ),
      metadata: { scanId: "failed" },
      savedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(failed).not.toBeNull();
    expect(isLegacySignalRecord(failed!.signals)).toBe(false);
    expect(getResultSignature(failed!)).toEqual(Array(8).fill("error"));
  });
});

describe("shared snapshots", () => {
  it("round-trips a snapshot with its signature", async () => {
    const result = resultFor(
      await fixtureSignals("feed-hit.scrutinix.test"),
      "https://feed-hit.scrutinix.test/payload.exe",
    );
    const snapshot = buildSharedSnapshot(result);
    expect(snapshot.signature).toHaveLength(8);
    expect(decodeSharedSnapshot(encodeSharedSnapshot(snapshot))).toEqual(
      snapshot,
    );
  });

  it("still parses links shared before the signature existed", () => {
    const old = {
      verdict: "malicious",
      url: "https://evil.example/",
      summary: "URLhaus flagged this link.",
      capturedAt: "2026-03-01T00:00:00.000Z",
    };
    // Both encodings that have shipped.
    const uriEncoded = btoa(encodeURIComponent(JSON.stringify(old)));
    const raw = btoa(JSON.stringify(old));
    for (const payload of [uriEncoded, raw]) {
      const decoded = decodeSharedSnapshot(payload);
      expect(decoded).toMatchObject(old);
      expect(decoded?.signature).toBeUndefined();
    }
  });

  it("drops a malformed signature instead of rejecting the snapshot", () => {
    const parsed = sharedSnapshotSchema.parse({
      verdict: "safe",
      url: "https://example.com/",
      summary: "",
      capturedAt: "2026-10-06T00:00:00.000Z",
      signature: ["clear", "nonsense"],
    });
    expect(parsed.signature).toBeUndefined();
  });

  it("rejects tampered or oversized payloads", () => {
    expect(decodeSharedSnapshot(null)).toBeNull();
    expect(decodeSharedSnapshot("%%%")).toBeNull();
    expect(decodeSharedSnapshot(btoa("{}"))).toBeNull();
    expect(
      decodeSharedSnapshot(
        btoa(
          JSON.stringify({
            verdict: "pwned",
            url: "x",
            summary: "",
            capturedAt: "",
          }),
        ),
      ),
    ).toBeNull();
    expect(decodeSharedSnapshot("A".repeat(20_000))).toBeNull();
  });

  it("omits the signature for legacy history entries", () => {
    const legacy = sanitizeHistoryEntry({
      id: "old",
      url: "https://old.example/",
      verdict: "safe",
      signals: {},
      metadata: { scanId: "old", completedAt: "2025-01-01T00:00:00.000Z" },
    });
    expect(buildSharedSnapshot(legacy!).signature).toBeUndefined();
  });

  it("dates a snapshot by when the evidence was gathered", () => {
    // Saved before checkedAt existed: the sanitizer falls back to its own
    // completedAt.
    const old = sanitizeHistoryEntry({
      id: "old",
      url: "https://old.example/",
      verdict: "safe",
      signals: {},
      metadata: { scanId: "old", completedAt: "2025-01-01T00:00:00.000Z" },
    });
    expect(old?.metadata.checkedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(buildSharedSnapshot(old!).capturedAt).toBe(
      "2025-01-01T00:00:00.000Z",
    );

    // A cache hit finished later than its evidence was gathered.
    const cached = sanitizeHistoryEntry({
      id: "hit",
      url: "https://old.example/",
      verdict: "safe",
      signals: {},
      metadata: {
        scanId: "hit",
        completedAt: "2025-01-01T00:10:00.000Z",
        checkedAt: "2025-01-01T00:00:00.000Z",
        cacheHit: true,
      },
    });
    expect(buildSharedSnapshot(cached!).capturedAt).toBe(
      "2025-01-01T00:00:00.000Z",
    );
  });
});
