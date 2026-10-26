import { describe, expect, it } from "vitest";

import { createCacheKey, normalizeUrlInput } from "@/lib/domain/url";
import type { AnalysisResult } from "@/lib/domain/types";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { getCoverageCaveat } from "@/lib/domain/verdict-guidance";
import { runAnalysis } from "@/lib/server/analyze";
import { analysisCache, FULL_RESULT_TTL_MS } from "@/lib/server/cache";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

describe("cached results", () => {
  it("re-derive the verdict so older cache entries get current copy", async () => {
    const target = normalizeUrlInput("https://cached-feed.example/");
    if (!target.ok) throw new Error("bad target");

    const signals = await fixtureSignals("feed-hit.scrutinix.test");
    // An entry written by an older release: stale wording, no scoredSignals.
    const stale: AnalysisResult = {
      id: "old",
      url: target.value.normalizedUrl,
      verdict: "malicious",
      signals,
      threatInfo: {
        verdict: "malicious",
        confidence: 0.8,
        confidenceLabel: "moderate",
        confidenceReasons: [
          "8 of 8 checks finished, and 8 returned full results.",
        ],
        hasPositiveEvidence: true,
        score: 55,
        summary: "Malicious risk based on Threat Feed signals.",
        categories: ["Threat Feed"],
        reasons: ["urlhaus listed the URL as listed in URLhaus."],
        recommendations: [],
        limitations: [],
      },
      metadata: {
        scanId: "old",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        cacheHit: false,
        partialFailure: false,
        signalCount: 8,
        durationMs: 1_000,
      },
    };
    await analysisCache.set(
      createCacheKey(target.value.normalizedUrl),
      stale,
      FULL_RESULT_TTL_MS,
    );

    const result = await runAnalysis(target.value);

    expect(result.metadata.cacheHit).toBe(true);
    expect(result.verdict).toBe("malicious");
    expect(result.threatInfo?.scoredSignals).toEqual(["threatFeeds"]);
    expect(result.threatInfo?.summary).toBe("URLhaus flagged this link.");
    expect(result.threatInfo?.reasons.join(" ")).not.toMatch(/listed.*listed/);
  });

  it("re-derive the verdict as of the original check, like its basis and caveat", async () => {
    const target = normalizeUrlInput("https://cached-clock.example/");
    if (!target.ok) throw new Error("bad target");

    // Checked long ago on a VirusTotal analysis that was 29 days old then,
    // so current at the check (30-day limit) and stale by the time it is
    // served. The hit must read as the scan it repeats.
    const checkedAt = "2026-01-01T00:00:01.000Z";
    const signals = await fixtureSignals("example.com");
    const vt = signals.virusTotal.data;
    if (signals.virusTotal.status !== "success" || !vt) {
      throw new Error("fixture lost its VirusTotal data");
    }
    vt.lastAnalysisDate = new Date(
      Date.parse(checkedAt) - 29 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const original = buildThreatAssessment(signals, Date.parse(checkedAt));
    expect(original.threatInfo?.limitations.join(" ")).not.toMatch(
      /VirusTotal analysis from/,
    );
    // Judged now instead, the same evidence would gain a stale caveat.
    expect(
      buildThreatAssessment(signals).threatInfo?.limitations.join(" "),
    ).toMatch(/VirusTotal analysis from/);

    await analysisCache.set(
      createCacheKey(target.value.normalizedUrl),
      {
        id: "original",
        url: target.value.normalizedUrl,
        signals,
        ...original,
        metadata: {
          scanId: "original",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: checkedAt,
          checkedAt,
          cacheHit: false,
          partialFailure: false,
          signalCount: 8,
          durationMs: 1_000,
        },
      },
      FULL_RESULT_TTL_MS,
    );

    const result = await runAnalysis(target.value);

    expect(result.metadata.cacheHit).toBe(true);
    expect(result.metadata.checkedAt).toBe(checkedAt);
    expect(result.verdict).toBe(original.verdict);
    expect(result.threatInfo).toEqual(original.threatInfo);
    expect(getCoverageCaveat(result)).toBeNull();
  });
});
