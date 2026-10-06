import { describe, expect, it } from "vitest";

import { createCacheKey, normalizeUrlInput } from "@/lib/domain/url";
import type { AnalysisResult } from "@/lib/domain/types";
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
});
