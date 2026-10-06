import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  VERDICT_HEADING_ID,
  VerdictBand,
  VerdictDetails,
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

function renderPanel(
  result: AnalysisResult,
  props: { driverRows?: number; impersonates?: string | null } = {},
) {
  return render(
    <>
      <VerdictBand
        result={result}
        isStreaming={false}
        sharedSnapshot={null}
        completedSignals={8}
        {...props}
      />
      <VerdictDetails result={result} />
    </>,
  );
}

describe("VerdictBand", () => {
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
    // The instruction sits directly under the verdict word.
    expect(heading.nextElementSibling?.textContent).toBe(
      "Don't open this link.",
    );
    // One colour encoding: the band is tinted, the word stays ink.
    expect(heading.className).toContain("text-[var(--sx-text)]");
    expect(heading.closest("section")?.getAttribute("style")).toContain(
      "var(--sx-malicious-surface)",
    );
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
      expect(heading.className).toContain("text-meta");
      expect(heading.className).toContain("font-semibold");
    }
  });

  it("gives a shared snapshot the same instruction line", () => {
    const { rerender } = render(
      <VerdictBand
        result={null}
        isStreaming={false}
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
      <VerdictBand
        result={null}
        isStreaming={false}
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

  it("drops the because line when Summary already shows the driver row", () => {
    const result = buildResult("malicious", {
      score: 73,
      hasPositiveEvidence: true,
      summary: "7 VirusTotal engines flagged this link.",
    });
    const { unmount } = renderPanel(result, { driverRows: 0 });
    expect(
      screen.getByText("7 VirusTotal engines flagged this link."),
    ).toBeTruthy();
    unmount();

    renderPanel(result, { driverRows: 1 });
    expect(
      screen.queryByText("7 VirusTotal engines flagged this link."),
    ).toBeNull();
  });

  it("hedges a Safe verdict for a look-alike link without touching the score", () => {
    renderPanel(buildResult("safe", { score: 3, confidenceLabel: "high" }), {
      impersonates: "paypal.com",
    });
    const heading = screen.getByRole("heading", { level: 2, name: "safe" });
    const band = heading.closest("section");
    expect(
      screen.getByText("Don't sign in or enter details here."),
    ).toBeTruthy();
    // The neutral surface: the one colour encoding never reassures.
    expect(band?.getAttribute("style")).toContain("var(--sx-unknown-surface)");
    expect(band?.getAttribute("style")).not.toContain("--sx-safe-surface");
    expect(screen.queryByText(/High confidence/)).toBeNull();
    expect(
      screen.getByText("No check flagged it, but the name is misleading."),
    ).toBeTruthy();
    // The owner fact belongs to the anatomy line, not the band.
    expect(band?.textContent).not.toMatch(/isn't really|paypal\.com/);
    expect(
      screen.getByRole("meter", { name: "Threat score" }).textContent,
    ).toBe("3/100");
  });

  it("states no confidence on a failed scan", () => {
    const result = createErrorAnalysisResult({
      url: "https://example.com/",
      scanId: "error-scan",
      startedAt: "2026-08-02T12:00:00.000Z",
      message: "Scan failed.",
    });
    render(
      <VerdictBand
        result={{ ...result, threatInfo: null }}
        isStreaming={false}
        sharedSnapshot={null}
        completedSignals={8}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "error" }),
    ).toBeTruthy();
    expect(screen.queryByText(/confidence/i)).toBeNull();
    expect(
      screen.queryByRole("link", { name: "How scoring works" }),
    ).toBeNull();
  });

  it("sets the score numeral in sans so a zero never reads as a slashed zero", () => {
    renderPanel(buildResult("safe", { score: 0 }));
    const meter = screen.getByRole("meter", { name: "Threat score" });
    expect(meter.className).toContain("font-sans");
    expect(meter.className).toContain("tabular-nums");
    expect(meter.className).not.toMatch(/(^|\s)font-mono(\s|$)/);
  });

  it("keeps the heading node, and its focus, from Checking to the verdict", () => {
    const { rerender } = render(
      <VerdictBand
        result={null}
        isStreaming
        sharedSnapshot={null}
        completedSignals={3}
      />,
    );
    const checking = screen.getByRole("heading", { level: 2 });
    expect(checking.textContent).toBe("Checking");
    expect(screen.getByText("3 of 8 checks finished")).toBeTruthy();
    checking.focus();

    rerender(
      <VerdictBand
        result={buildResult("malicious", { score: 73 })}
        isStreaming={false}
        sharedSnapshot={null}
        completedSignals={8}
      />,
    );
    const verdict = screen.getByRole("heading", { level: 2 });
    expect(verdict).toBe(checking);
    expect(verdict.textContent).toBe("malicious");
    expect(document.activeElement).toBe(verdict);
  });
});
