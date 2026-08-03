import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VerdictHeroResult } from "@/components/scrutinix/verdict-hero-result";
import { createErrorAnalysisResult } from "@/lib/domain/analysis-result";
import {
  createPendingSignalResults,
  type AnalysisResult,
} from "@/lib/domain/types";

function buildUnknownResult(): AnalysisResult {
  return {
    id: "unreachable-scan",
    url: "https://unreachable.example/",
    verdict: "unknown",
    signals: createPendingSignalResults(),
    threatInfo: {
      verdict: "unknown",
      confidence: 0.2,
      confidenceLabel: "low",
      confidenceReasons: [],
      hasPositiveEvidence: false,
      score: 0,
      summary:
        "The host was unreachable during this scan; the absence of findings is not evidence of safety.",
      categories: [],
      reasons: [],
      recommendations: [],
      limitations: [],
    },
    metadata: {
      scanId: "unreachable-scan",
      startedAt: "2026-08-02T12:00:00.000Z",
      completedAt: "2026-08-02T12:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

describe("VerdictHeroResult", () => {
  it("renders zero confidence when an error result has no threat evidence", () => {
    render(
      <VerdictHeroResult
        result={createErrorAnalysisResult({
          url: "https://failed.example/",
          scanId: "failed-scan",
          startedAt: "2026-08-02T12:00:00.000Z",
          message: "Synthetic batch failure.",
        })}
        streamUrl=""
        sharedSnapshot={null}
        completedSignals={8}
      />,
    );

    expect(screen.getByText("Confidence")).toBeTruthy();
    expect(screen.getByText("LOW")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.queryByText("100%")).toBeNull();
  });

  it("does not present an unreachable result as evidence of safety", () => {
    render(
      <VerdictHeroResult
        result={buildUnknownResult()}
        streamUrl=""
        sharedSnapshot={null}
        completedSignals={8}
      />,
    );

    expect(
      screen.getAllByText(
        "The host could not be inspected, so this scan cannot establish whether the URL is safe.",
      ),
    ).not.toHaveLength(0);
    expect(
      screen.queryAllByText(/No direct malicious indicators/i),
    ).toHaveLength(0);
  });
});
