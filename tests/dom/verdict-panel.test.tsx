import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  VERDICT_HEADING_ID,
  VerdictBand,
  VerdictDetails,
  formatSnapshotTime,
} from "@/components/scrutinix/verdict-panel";
import { createErrorAnalysisResult } from "@/lib/domain/analysis-result";
import { spokenTextNodes } from "@/tests/dom/helpers/speech";
import { SCORE_BANDS, bandSays } from "@/lib/domain/verdict-guidance";
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
  props: {
    evidenceShown?: boolean;
    impersonates?: string | null;
    registeredDomain?: string | null;
    holdDomain?: string | null;
  } = {},
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
      <VerdictDetails
        result={result}
        impersonates={props.impersonates ?? null}
      />
    </>,
  );
}

describe("VerdictBand", () => {
  it("names the registered domain in the serif under the verdict, and only names it", () => {
    renderPanel(buildResult("malicious", { score: 73 }), {
      registeredDomain: "secure-login.xyz",
      impersonates: "paypal.com",
    });
    const band = screen.getByRole("region", { name: "Scan result: Malicious" });
    const heading = screen.getByRole("heading", { level: 2 });
    // The word's slot, then the site's slot holding the domain.
    const site = heading.parentElement?.nextElementSibling as HTMLElement;
    const domain = site.querySelector("p.sx-band-domain");
    expect(domain?.textContent).toBe("secure-login.xyz");
    // The owner sentence belongs to the link anatomy, said once there.
    expect(band.textContent).not.toMatch(/belongs to/);
  });

  it("holds the site's line for the link's whole host while the link parser loads", () => {
    renderPanel(buildResult("safe", { score: 4 }), {
      holdDomain: "accounts.example.co.uk",
    });
    const site = screen.getByRole("heading", { level: 2 }).parentElement
      ?.nextElementSibling as HTMLElement;
    const standIn = site.querySelector("[data-stand-in]");
    expect(standIn?.getAttribute("data-stand-in")).toBe(
      "accounts.example.co.uk",
    );
    expect(standIn?.getAttribute("aria-hidden")).toBe("true");
    expect(site.querySelector("p.sx-band-domain")).toBeNull();
  });

  it("keeps the host's room when the shorter registered domain arrives", () => {
    const result = buildResult("safe", { score: 4 });
    const { rerender } = renderPanel(result, {
      holdDomain: "a-very-long-subdomain.accounts.example.co.uk",
    });
    rerender(
      <VerdictBand
        result={result}
        isStreaming={false}
        sharedSnapshot={null}
        completedSignals={8}
        registeredDomain="example.co.uk"
      />,
    );
    const site = screen.getByRole("heading", { level: 2 }).parentElement
      ?.nextElementSibling as HTMLElement;
    expect(
      site.querySelector("[data-stand-in]")?.getAttribute("data-stand-in"),
    ).toBe("a-very-long-subdomain.accounts.example.co.uk");
    expect(site.querySelector("p.sx-band-domain")?.textContent).toBe(
      "example.co.uk",
    );
  });

  it("draws a verdict rule keyed to the result, over the band's track", () => {
    renderPanel(buildResult("malicious", { score: 73 }));
    const band = screen.getByRole("region", { name: "Scan result: Malicious" });
    expect(band.querySelector(".sx-band-rule")).not.toBeNull();
    expect(band.style.getPropertyValue("--sx-band-rule")).toBe(
      "var(--sx-malicious)",
    );
  });

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
      name: "Malicious",
    });
    expect(heading.id).toBe(VERDICT_HEADING_ID);
    expect(heading.getAttribute("tabindex")).toBe("-1");
    // The instruction sits directly under the verdict word and domain.
    expect(
      heading.closest(".sx-band-head")?.nextElementSibling?.textContent,
    ).toBe("Don't open this link.");
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

  it("leaves a clean Safe to the imperative", () => {
    renderPanel(
      buildResult("safe", { score: 4, summary: "No check flagged this link." }),
    );

    expect(screen.getByText("Looks safe to open.")).toBeTruthy();
    // "Looks safe to open." and the Summary questions already say it.
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
      expect(heading.className).toContain("text-body");
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
      name: "Malicious",
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

  it("leaves out a shared summary that only repeats the instruction, as the sender's band did", () => {
    const clean = {
      confidence: "high",
      clean: true,
      partial: false,
      confirmed: false,
    } as const;
    const safe = {
      verdict: "safe" as const,
      url: "https://example.com/",
      summary: "No check flagged this link.",
      capturedAt: "2026-10-06T00:00:00.000Z",
    };
    const { rerender } = render(
      <VerdictBand
        result={null}
        isStreaming={false}
        sharedSnapshot={{ ...safe, basis: clean }}
      />,
    );
    expect(screen.getByText("Looks safe to open.")).toBeTruthy();
    expect(screen.queryByText("No check flagged this link.")).toBeNull();

    // A summary that adds something still shows under the same instruction.
    const limited = "No check flagged this link, but some checks were limited.";
    rerender(
      <VerdictBand
        result={null}
        isStreaming={false}
        sharedSnapshot={{ ...safe, summary: limited, basis: clean }}
      />,
    );
    expect(screen.getByText("Looks safe to open.")).toBeTruthy();
    expect(screen.getByText(limited)).toBeTruthy();

    // Under the hedge (signed before the basis) and on a look-alike, the
    // summary says what the instruction doesn't.
    rerender(
      <VerdictBand result={null} isStreaming={false} sharedSnapshot={safe} />,
    );
    expect(
      screen.getByText("Probably safe — still check who sent it."),
    ).toBeTruthy();
    expect(screen.getByText("No check flagged this link.")).toBeTruthy();
    rerender(
      <VerdictBand
        result={null}
        isStreaming={false}
        sharedSnapshot={{ ...safe, basis: clean }}
        impersonates="paypal.com"
      />,
    );
    expect(
      screen.getByText("Don't sign in or enter details here."),
    ).toBeTruthy();
    expect(screen.getByText("No check flagged this link.")).toBeTruthy();
  });

  it("dates a shared snapshot with its year, in UTC", () => {
    // A check from another year must not read as this year's.
    expect(formatSnapshotTime("2025-12-31T23:30:00.000Z")).toBe(
      "Dec 31, 2025, 11:30 PM UTC",
    );
    render(
      <VerdictBand
        result={null}
        isStreaming={false}
        sharedSnapshot={{
          verdict: "malicious",
          url: "https://malicious.scrutinix.test/",
          summary: "",
          capturedAt: "2026-10-06T09:00:00.000Z",
        }}
        onRunSharedScan={() => {}}
      />,
    );
    // One run of text (a <time> inside it was a reading stop of its own),
    // read before the button that replaces the result, drawn after it.
    const provenance = screen.getByText(
      "Verified Scrutinix result · checked Oct 6, 2026, 09:00 AM UTC. It may be out of date.",
    );
    expect(spokenTextNodes(provenance)).toHaveLength(1);
    const button = screen.getByRole("button", { name: "Run a fresh scan" });
    expect(
      provenance.compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(provenance.className).toContain("order-last");
  });

  it("says an expired shared result is too old, not unverified", () => {
    const { rerender } = render(
      <VerdictBand
        result={null}
        isStreaming={false}
        sharedSnapshot={null}
        unverifiedShare
        expiredShare
      />,
    );
    expect(screen.getByLabelText("Shared result, expired")).toBeTruthy();
    expect(
      screen.getByText(
        "This shared result is more than 3 days old, so we're not showing it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/can't confirm/)).toBeNull();

    rerender(
      <VerdictBand
        result={null}
        isStreaming={false}
        sharedSnapshot={null}
        unverifiedShare
      />,
    );
    expect(screen.getByLabelText("Shared link, not verified")).toBeTruthy();
    expect(screen.queryByText(/more than 3 days old/)).toBeNull();
  });

  it("drops the because line when the evidence below states it", () => {
    const result = buildResult("malicious", {
      score: 73,
      hasPositiveEvidence: true,
      summary: "7 VirusTotal engines flagged this link.",
    });
    const { unmount } = renderPanel(result, { evidenceShown: false });
    expect(
      screen.getByText("7 VirusTotal engines flagged this link."),
    ).toBeTruthy();
    unmount();

    renderPanel(result, { evidenceShown: true });
    expect(
      screen.queryByText("7 VirusTotal engines flagged this link."),
    ).toBeNull();
  });

  it("shows a look-alike Safe as Look-alike, its own verdict and score in the details", () => {
    renderPanel(buildResult("safe", { score: 3, confidenceLabel: "high" }), {
      impersonates: "paypal.com",
    });
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Look-alike",
    });
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
    // A low score beside "Look-alike" would reassure: the band shows none,
    // and the details state the checks' own verdict and score.
    expect(screen.queryByRole("meter", { name: "Threat score" })).toBeNull();
    expect(band?.textContent).not.toMatch(/\bSafe\b|3\/100/);
    expect(
      screen.getByText(
        "No check flagged it: on their own, the checks scored it Safe, 3 out of 100.",
      ),
    ).toBeTruthy();
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
      screen.getByRole("heading", { level: 2, name: "Error" }),
    ).toBeTruthy();
    expect(screen.queryByText(/confidence/i)).toBeNull();
    expect(
      screen.queryByRole("link", { name: "How scoring works" }),
    ).toBeNull();
  });

  it("sets the score numeral in the display serif, never mono, so a zero never reads as a slashed zero", () => {
    renderPanel(buildResult("safe", { score: 0 }));
    const meter = screen.getByRole("meter", { name: "Threat score" });
    expect(meter.className).toContain("font-serif");
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
    expect(verdict.textContent).toBe("Malicious");
    expect(document.activeElement).toBe(verdict);
  });

  /** The room a band holds: each stand-in's text, which is never text. */
  function heldRoom(band: HTMLElement): string[] {
    const standIns = [...band.querySelectorAll<HTMLElement>("[data-stand-in]")];
    for (const standIn of standIns) {
      // Generated content only: nothing to select, find, or hear.
      expect(standIn.textContent).toBe("");
      expect(standIn.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    return standIns.map((node) => node.dataset.standIn ?? "").sort();
  }

  function failedScan(): AnalysisResult {
    return createErrorAnalysisResult({
      url: "https://example.com/",
      scanId: "error-scan",
      startedAt: "2026-08-02T12:00:00.000Z",
      message: "Scan failed.",
    });
  }

  type Check = "pending" | "ready" | "failed";

  /** A scan's band from Checking to the verdict, with the address check. */
  function scanBand(check: Check, impersonates: string | null = null) {
    const view = render(
      <VerdictBand
        result={null}
        isStreaming
        sharedSnapshot={null}
        completedSignals={3}
        addressCheck={check}
        impersonates={impersonates}
        onCancelScan={() => {}}
      />,
    );
    const land = (result: AnalysisResult, landCheck: Check = check) =>
      view.rerender(
        <VerdictBand
          result={result}
          isStreaming={false}
          sharedSnapshot={null}
          completedSignals={8}
          addressCheck={landCheck}
          impersonates={impersonates}
          onRetry={() => {}}
        />,
      );
    return { ...view, land };
  }

  it("holds every verdict's room in Checking until the address check says otherwise", () => {
    scanBand("pending");
    const room = heldRoom(screen.getByRole("region"));
    // The longest of everything a band can say, whichever verdict lands.
    const says = bandSays();
    for (const text of [
      ...says.beside.words,
      ...says.beside.imperatives,
      ...says.across.words,
      ...says.across.imperatives,
      ...says.across.notes,
      ...says.confidenceLabels,
      ...SCORE_BANDS,
      "Cancel scan",
      "Try again",
    ]) {
      expect(room).toContain(text);
    }
    // None of it is text the band says.
    expect(screen.getByRole("region").textContent).not.toContain(
      "Looks safe to open.",
    );
  });

  it("holds no room for a Look-alike or Unconfirmed the address check has ruled out", () => {
    scanBand("ready");
    const room = heldRoom(screen.getByRole("region"));
    expect(room).toContain("Unknown");
    for (const text of [
      ...bandSays({ lookAlike: true, unconfirmed: false }).across.notes,
      ...bandSays({ lookAlike: false, unconfirmed: true }).across.notes,
      "Look-alike",
      "Unconfirmed",
    ]) {
      expect(room).not.toContain(text);
    }
  });

  it("keeps the room Checking held in every verdict it lands as", () => {
    const cases: [Check, string | null, AnalysisResult][] = [
      ["ready", null, buildResult("malicious", { score: 73 })],
      ["ready", null, buildResult("safe", { score: 3 })],
      ["ready", null, buildResult("unknown", { score: 20 })],
      ["ready", null, failedScan()],
      ["ready", "paypal.com", buildResult("safe", { score: 3 })],
      ["failed", null, buildResult("safe", { score: 3 })],
      ["pending", null, buildResult("critical", { score: 100 })],
    ];
    for (const [check, impersonates, result] of cases) {
      const { land, unmount } = scanBand(check, impersonates);
      const checking = heldRoom(screen.getByRole("region"));
      land(result);
      expect(
        heldRoom(screen.getByRole("region")),
        `${result.verdict} ${check}`,
      ).toEqual(checking);
      unmount();
    }
  });

  it("never shrinks a scan's room when the address check settles mid-scan", () => {
    const { land } = scanBand("pending");
    const checking = heldRoom(screen.getByRole("region"));
    // A Safe lands while the check runs: the band holds, then states it.
    land(buildResult("safe", { score: 3 }));
    expect(screen.getByRole("region").getAttribute("aria-label")).toBe(
      "Checking the link's address",
    );
    expect(heldRoom(screen.getByRole("region"))).toEqual(checking);
    land(buildResult("safe", { score: 3 }), "ready");
    expect(
      screen.getByRole("heading", { level: 2, name: "Safe" }),
    ).toBeTruthy();
    expect(heldRoom(screen.getByRole("region"))).toEqual(checking);
  });

  it("starts the next scan's room from what the address check knows", () => {
    const { land, rerender } = scanBand("pending");
    land(buildResult("malicious", { score: 73 }), "ready");
    expect(heldRoom(screen.getByRole("region"))).toContain("Unconfirmed");
    // Re-scan: a new scan, with the check ready from the start.
    rerender(
      <VerdictBand
        result={null}
        isStreaming
        sharedSnapshot={null}
        completedSignals={0}
        addressCheck="ready"
        onCancelScan={() => {}}
      />,
    );
    expect(heldRoom(screen.getByRole("region"))).not.toContain("Unconfirmed");
  });

  it("holds the tallest word in the band's own word slot, beside the heading", () => {
    scanBand("ready");
    const heading = screen.getByRole("heading", { level: 2, name: "Checking" });
    const slot = heading.parentElement as HTMLElement;
    expect(slot.className).toContain("sx-band-word");
    const words = [...slot.querySelectorAll<HTMLElement>("[data-stand-in]")]
      .map((node) => node.dataset.standIn)
      .sort();
    const says = bandSays({ lookAlike: false, unconfirmed: false });
    expect(words).toEqual(
      [...says.beside.words, "Checking", ...says.across.words].sort(),
    );
    // Before the heading, so a selection from the word on never crosses them.
    expect(slot.firstElementChild).not.toBe(heading);
    expect(slot.lastElementChild).toBe(heading);
  });

  it("holds no room in a shared band, which only a tap replaces", () => {
    render(
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
    expect(heldRoom(screen.getByRole("region"))).toEqual([]);
  });

  it("offers a failed scan's Try again in the score's place, where Cancel stood", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <VerdictBand
        result={failedScan()}
        isStreaming={false}
        sharedSnapshot={null}
        onRetry={onRetry}
      />,
    );
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry.className).toContain("sx-band-aside");
    expect(retry.closest(".sx-band-line")).toBeNull();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Only a failed scan offers it.
    rerender(
      <VerdictBand
        result={buildResult("malicious", { score: 73 })}
        isStreaming={false}
        sharedSnapshot={null}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("never speaks the room it holds: every stand-in is hidden", () => {
    const { container, rerender } = render(
      <VerdictBand
        result={null}
        isStreaming
        sharedSnapshot={null}
        addressCheck="pending"
        onCancelScan={() => {}}
      />,
    );
    const standIns = () =>
      Array.from(container.querySelectorAll("[data-stand-in]"));
    const spoken = () => spokenTextNodes(container).map((text) => text.trim());
    // Generated content is text to a screen reader unless it is hidden.
    expect(standIns().length).toBeGreaterThan(10);
    for (const standIn of standIns()) {
      expect(standIn.closest("[aria-hidden='true']")).not.toBeNull();
    }
    expect(spoken()).toEqual([
      "Checking",
      "0 of 8 checks finished",
      "Cancel scan",
    ]);

    rerender(
      <VerdictBand
        result={failedScan()}
        isStreaming={false}
        sharedSnapshot={null}
        addressCheck="pending"
        onRetry={() => {}}
      />,
    );
    for (const standIn of standIns()) {
      expect(standIn.closest("[aria-hidden='true']")).not.toBeNull();
    }
    // A failed scan: its word, instruction, and Try again, nothing more.
    expect(spoken()).toEqual([
      "Error",
      "The scan failed — try again.",
      "Try again",
    ]);
  });
});

describe("VerdictDetails reference", () => {
  it("states the scan id once when checks failed", () => {
    const signals = settledSignals();
    signals.virusTotal = {
      status: "error",
      data: null,
      error: "This check could not be completed.",
      durationMs: 10,
    };
    signals.ssl = {
      status: "error",
      data: null,
      error: "This check could not be completed.",
      durationMs: 10,
    };
    render(
      <VerdictDetails
        result={buildResult(
          "suspicious",
          {},
          { partialFailure: true, signals },
        )}
      />,
    );

    expect(screen.getAllByText(/Reference/)).toHaveLength(1);
    expect(screen.getByText("Reference: suspicious-scan")).toBeTruthy();
  });

  it("gives a failed batch item its reference without a verdict", () => {
    render(
      <VerdictDetails
        result={createErrorAnalysisResult({
          url: "https://failed.example/",
          scanId: "failed-scan",
          startedAt: "2026-08-02T12:00:00.000Z",
          message: "This URL could not be scanned.",
        })}
      />,
    );

    expect(screen.getByText("Reference: failed-scan")).toBeTruthy();
  });

  it("stays quiet when every check completed", () => {
    render(
      <VerdictDetails
        result={buildResult("safe", {
          reasons: ["Nothing flagged."],
          hasPositiveEvidence: true,
        })}
      />,
    );

    expect(screen.queryByText(/Reference/)).toBeNull();
  });
});

describe("VerdictDetails wording", () => {
  it("dates a cache hit by when its evidence was checked, not this request", () => {
    const result = buildResult("safe", {
      reasons: ["Nothing flagged."],
      hasPositiveEvidence: true,
    });
    result.metadata = {
      ...result.metadata,
      cacheHit: true,
      checkedAt: "2026-08-02T11:45:00.000Z",
      durationMs: 1,
    };
    const local = (iso: string) =>
      new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

    render(<VerdictDetails result={result} />);

    expect(
      screen.getByText(
        `8/8 checks · checked ${local("2026-08-02T11:45:00.000Z")} · cached`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/finished|1 ms/)).toBeNull();
  });

  it("dates a fresh scan by when it finished", () => {
    render(
      <VerdictDetails
        result={buildResult("safe", {
          reasons: ["Nothing flagged."],
          hasPositiveEvidence: true,
        })}
      />,
    );

    expect(screen.getByText(/^8\/8 checks · 1000 ms · finished /)).toBeTruthy();
    expect(screen.queryByText(/cached|checked /)).toBeNull();
  });

  it("says how many checks failed, so 8/8 never reads as eight answers", () => {
    const signals = Object.fromEntries(
      Object.entries(settledSignals()).map(([name, signal]) => [
        name,
        { ...signal, status: "error", data: null, error: "Check failed." },
      ]),
    ) as SignalResults;
    renderPanel(buildResult("error", {}, { signals }));
    expect(screen.getByText(/^8\/8 checks · 8 failed/)).toBeTruthy();
  });

  it("names no failures when every check answered", () => {
    renderPanel(
      buildResult("safe", {
        score: 4,
        confidenceReasons: ["Every check answered."],
      }),
    );
    expect(screen.getByText(/^8\/8 checks/).textContent).not.toMatch(/failed/);
  });

  it("calls a look-alike's confidence the checks' own, as its band claims none", () => {
    renderPanel(
      buildResult("safe", {
        score: 4,
        confidenceReasons: ["Every check answered."],
      }),
      { impersonates: "paypal.com" },
    );
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Why the checks have high confidence",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { level: 3, name: "Why high confidence" }),
    ).toBeNull();
  });
});
