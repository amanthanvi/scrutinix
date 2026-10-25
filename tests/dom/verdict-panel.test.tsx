import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  VERDICT_HEADING_ID,
  VerdictPanel,
} from "@/components/scrutinix/verdict-panel";
import { createErrorAnalysisResult } from "@/lib/domain/analysis-result";
import {
  createPendingSignalResults,
  type AnalysisResult,
  type SignalResults,
  type ThreatInfo,
  type Verdict,
} from "@/lib/domain/types";

function settledSignals(): SignalResults {
  const signals = createPendingSignalResults();
  for (const name of Object.keys(signals) as Array<keyof SignalResults>) {
    signals[name] = {
      status: "success",
      data: {} as never,
      error: null,
      durationMs: 10,
    };
  }
  return signals;
}

function buildResult(
  verdict: Verdict,
  threatInfo: Partial<ThreatInfo>,
  options: { partialFailure?: boolean; signals?: SignalResults } = {},
): AnalysisResult {
  return {
    id: `${verdict}-scan`,
    url: "https://example.com/",
    verdict,
    signals: options.signals ?? settledSignals(),
    threatInfo: {
      verdict,
      confidence: 0.9,
      confidenceLabel: "high",
      confidenceReasons: [],
      hasPositiveEvidence: false,
      score: 0,
      summary: "",
      categories: [],
      reasons: [],
      recommendations: [],
      limitations: [],
      ...threatInfo,
    },
    metadata: {
      scanId: `${verdict}-scan`,
      startedAt: "2026-08-02T12:00:00.000Z",
      completedAt: "2026-08-02T12:00:01.000Z",
      cacheHit: false,
      partialFailure: options.partialFailure ?? false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

function renderPanel(result: AnalysisResult) {
  return render(
    <VerdictPanel
      result={result}
      isStreaming={false}
      streamUrl=""
      sharedSnapshot={null}
      completedSignals={8}
    />,
  );
}

describe("VerdictPanel", () => {
  it("puts the instruction under the verdict and explains the score in place", () => {
    renderPanel(
      buildResult("malicious", {
        score: 73,
        confidenceLabel: "moderate",
        hasPositiveEvidence: true,
        summary: "7 VirusTotal engines flagged this link.",
        reasons: ["7 VirusTotal engines marked this link as malicious."],
      }),
    );

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "malicious",
    });
    expect(heading.id).toBe(VERDICT_HEADING_ID);
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(heading.nextElementSibling?.textContent).toContain("73/100");
    expect(screen.getByText("Don't open this link.")).toBeTruthy();
    expect(
      screen.getByRole("meter", { name: "Threat score" }).textContent,
    ).toBe("73/100");
    expect(screen.getByText("Malicious band 55–79")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "How scoring works" })
        .getAttribute("href"),
    ).toBe("/about#scoring");
  });

  it("shows no score for an error result", () => {
    renderPanel(
      createErrorAnalysisResult({
        url: "https://failed.example/",
        scanId: "failed-scan",
        startedAt: "2026-08-02T12:00:00.000Z",
        message: "Synthetic batch failure.",
      }),
    );

    expect(screen.getByText("The scan failed — try again.")).toBeTruthy();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText(/\/100/)).toBeNull();
  });

  it("says once that an unreachable result is not evidence of safety", () => {
    renderPanel(
      buildResult("unknown", {
        confidence: 0.2,
        confidenceLabel: "low",
        summary:
          "The site didn't respond, so we couldn't look at the page itself.",
      }),
    );

    expect(
      screen.getByText("We couldn't check this link — treat it as unsafe."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The site didn't respond, so we couldn't look at the page itself.",
      ),
    ).toBeTruthy();
    // A 0/100 next to Unknown would claim a check that never happened.
    expect(screen.queryByRole("meter")).toBeNull();
    // No "Based on 8/8 resolved signals." when every check resolved.
    expect(screen.queryByText(/resolved signals|Based on/i)).toBeNull();
    expect(screen.queryByText(/No direct malicious indicators/i)).toBeNull();
  });

  it("leaves a clean Safe to the imperative and the quiet-checks line", () => {
    renderPanel(
      buildResult("safe", { score: 4, summary: "No check flagged this link." }),
    );

    expect(screen.getByText("Looks safe to open.")).toBeTruthy();
    // "All 8 checks found nothing." (results section) already says it.
    expect(screen.queryByText(/flagged this link|indicators/i)).toBeNull();
  });

  it("keeps the Safe summary when it carries a hedge", () => {
    renderPanel(
      buildResult("safe", {
        score: 8,
        hasPositiveEvidence: true,
        summary: "Only minor warning signs turned up.",
      }),
    );
    expect(
      screen.getByText("Only minor warning signs turned up."),
    ).toBeTruthy();
  });

  it("moves the reasons into Details and splits caveats from confidence", () => {
    const { container } = renderPanel(
      buildResult("malicious", {
        score: 73,
        confidenceLabel: "moderate",
        hasPositiveEvidence: true,
        summary: "7 VirusTotal engines flagged this link.",
        reasons: ["7 VirusTotal engines marked this link as malicious."],
        recommendations: ["Delete the message the link came in."],
        confidenceReasons: [
          "1 major reputation source independently flagged this link.",
        ],
      }),
    );

    const details = container.querySelector("details");
    const reason = screen.getByText(
      "7 VirusTotal engines marked this link as malicious.",
    );
    expect(details?.contains(reason)).toBe(true);
    expect(
      screen.getByRole("heading", { level: 3, name: "What we found" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Why moderate confidence",
      }),
    ).toBeTruthy();
    // No limitations: no Caveats heading for supporting reasons.
    expect(screen.queryByRole("heading", { name: "Caveats" })).toBeNull();
  });

  it("names the checks that limited coverage", () => {
    const signals = settledSignals();
    signals.virusTotal = {
      status: "error",
      data: null,
      error: "VirusTotal timed out.",
      durationMs: 5_000,
    };

    renderPanel(
      buildResult(
        "safe",
        {
          score: 4,
          confidenceLabel: "moderate",
          summary: "No check flagged this link, but some checks were limited.",
        },
        { partialFailure: true, signals },
      ),
    );

    expect(
      screen.getByText("Probably safe — still check who sent it."),
    ).toBeTruthy();
    expect(screen.getByText("VirusTotal didn't finish.")).toBeTruthy();
  });

  it("raises the detail headings above caption size", () => {
    renderPanel(
      buildResult("suspicious", {
        score: 40,
        recommendations: ["Don't download files from this site."],
        limitations: ["DNS Profile: timed out"],
        confidenceReasons: [
          "DNS Profile didn't finish, which lowers confidence.",
        ],
      }),
    );

    for (const name of ["What to do", "Caveats", "Why high confidence"]) {
      const heading = screen.getByRole("heading", { level: 3, name });
      expect(heading.className).toContain("text-[0.8125rem]");
      expect(heading.className).toContain("font-semibold");
    }
  });

  it("gives a shared snapshot the same instruction line", () => {
    const { rerender } = render(
      <VerdictPanel
        result={null}
        isStreaming={false}
        streamUrl=""
        sharedSnapshot={{
          verdict: "malicious",
          url: "https://malicious.scrutinix.test/",
          summary: "7 VirusTotal engines flagged this link.",
          capturedAt: "2026-10-06T00:00:00.000Z",
        }}
      />,
    );

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "malicious",
    });
    expect(heading.id).toBe(VERDICT_HEADING_ID);
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByText("Don't open this link.")).toBeTruthy();

    rerender(
      <VerdictPanel
        result={null}
        isStreaming={false}
        streamUrl=""
        sharedSnapshot={{
          verdict: "safe",
          url: "https://example.com/",
          summary: "No check flagged this link.",
          capturedAt: "2026-10-06T00:00:00.000Z",
        }}
      />,
    );
    expect(
      screen.getByText("Probably safe — still check who sent it."),
    ).toBeTruthy();
    expect(screen.queryByRole("meter")).toBeNull();
  });
});
