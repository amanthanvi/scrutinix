import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VerdictPanel } from "@/components/scrutinix/verdict-panel";
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

describe("VerdictPanel", () => {
  it("does not present an unreachable result as evidence of safety", () => {
    render(
      <VerdictPanel
        result={buildUnknownResult()}
        isStreaming={false}
        streamUrl=""
        sharedSnapshot={null}
        completedSignals={8}
      />,
    );

    expect(
      screen.getByText(
        "The host could not be inspected, so this scan cannot establish whether the URL is safe.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No direct malicious indicators/i)).toBeNull();
  });
});
