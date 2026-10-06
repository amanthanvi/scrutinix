import { describe, expect, it, vi } from "vitest";

import {
  createPendingSignalResults,
  type AnalysisResult,
  type SignalResults,
  type ThreatInfo,
  type Verdict,
} from "@/lib/domain/types";
import { sanitizeHistoryEntry } from "@/lib/domain/runtime-safety";
import {
  clampScore,
  getConfidenceReasons,
  getCoverageCaveat,
  getScoreBandText,
  getVerdictAnnouncement,
  getVerdictGuidance,
  getVerdictRecommendations,
  isProvisionalSafe,
  ownershipSentence,
  shouldShowVerdictSummary,
} from "@/lib/domain/verdict-guidance";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

function completeSignals(): SignalResults {
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
  overrides: {
    score?: number;
    confidenceLabel?: ThreatInfo["confidenceLabel"];
    hasPositiveEvidence?: boolean;
    limitations?: string[];
    summary?: string;
    partialFailure?: boolean;
    signals?: SignalResults;
    threatInfo?: null;
  } = {},
): AnalysisResult {
  return {
    id: "scan",
    url: "https://example.com/",
    verdict,
    signals: overrides.signals ?? completeSignals(),
    threatInfo:
      overrides.threatInfo === null
        ? null
        : {
            verdict,
            confidence: 0.9,
            confidenceLabel: overrides.confidenceLabel ?? "high",
            confidenceReasons: [],
            hasPositiveEvidence: overrides.hasPositiveEvidence ?? false,
            score: overrides.score ?? 0,
            summary: overrides.summary ?? "",
            categories: [],
            reasons: [],
            recommendations: [],
            limitations: overrides.limitations ?? [],
          },
    metadata: {
      scanId: "scan",
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: "2026-10-06T00:00:01.000Z",
      cacheHit: false,
      partialFailure: overrides.partialFailure ?? false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

describe("getVerdictGuidance", () => {
  it("tells the person what to do for every verdict", () => {
    expect(
      getVerdictGuidance(buildResult("critical", { score: 90 })),
    ).toMatchObject({
      imperative: "Don't open this link.",
      showScore: true,
      tone: "critical",
      confidenceNote: null,
    });
    expect(
      getVerdictGuidance(buildResult("malicious", { score: 73 })),
    ).toMatchObject({ imperative: "Don't open this link.", showScore: true });
    expect(
      getVerdictGuidance(buildResult("suspicious", { score: 40 })).imperative,
    ).toBe("Don't sign in or enter payment details here.");
    expect(getVerdictGuidance(buildResult("safe")).imperative).toBe(
      "Looks safe to open.",
    );
    expect(getVerdictGuidance(buildResult("unknown"))).toMatchObject({
      imperative: "We couldn't check this link — treat it as unsafe.",
      showScore: false,
    });
    expect(
      getVerdictGuidance(buildResult("error", { threatInfo: null })),
    ).toMatchObject({
      imperative: "The scan failed — try again.",
      showScore: false,
      tone: "error",
    });
  });

  it("hedges a Safe verdict it cannot fully stand behind", () => {
    const lowConfidence = buildResult("safe", { confidenceLabel: "low" });
    const moderate = buildResult("safe", { confidenceLabel: "moderate" });
    const partial = buildResult("safe", { partialFailure: true });

    for (const result of [lowConfidence, moderate, partial]) {
      expect(isProvisionalSafe(result)).toBe(true);
      expect(getVerdictGuidance(result).imperative).toBe(
        "Probably safe — still check who sent it.",
      );
    }
    expect(isProvisionalSafe(buildResult("safe"))).toBe(false);
    expect(isProvisionalSafe(buildResult("malicious"))).toBe(false);
  });

  it("never shows a score for Unknown or Error", () => {
    expect(getVerdictGuidance(buildResult("unknown")).showScore).toBe(false);
    expect(getVerdictGuidance(buildResult("error")).showScore).toBe(false);
  });
});

describe("getVerdictAnnouncement", () => {
  it("states the verdict, score, and instruction", () => {
    expect(
      getVerdictAnnouncement(buildResult("malicious", { score: 73 })),
    ).toBe(
      "Result for example.com: Malicious, 73 out of 100. Don't open this link.",
    );
  });

  it("omits the score when it would mislead", () => {
    expect(getVerdictAnnouncement(buildResult("unknown"))).toBe(
      "Result for example.com: Unknown. We couldn't check this link — treat it as unsafe.",
    );
    expect(
      getVerdictAnnouncement(buildResult("error", { threatInfo: null })),
    ).toBe("Result for example.com: Error. The scan failed — try again.");
  });
});

describe("score helpers", () => {
  it("names the band a score falls in", () => {
    expect(getScoreBandText(0)).toBe("Safe band 0–24");
    expect(getScoreBandText(24)).toBe("Safe band 0–24");
    expect(getScoreBandText(25)).toBe("Suspicious band 25–54");
    expect(getScoreBandText(73)).toBe("Malicious band 55–79");
    expect(getScoreBandText(80)).toBe("Critical band 80–100");
  });

  it("clamps stored scores into 0-100", () => {
    expect(clampScore(-4)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(undefined)).toBe(0);
  });
});

describe("getCoverageCaveat", () => {
  it("adds nothing when every check ran in full", () => {
    // The D7 bug: Unknown showed "Based on 8/8 resolved signals."
    expect(
      getCoverageCaveat(buildResult("unknown", { partialFailure: true })),
    ).toBeNull();
    expect(getCoverageCaveat(buildResult("safe"))).toBeNull();
  });

  it("names a failed check", () => {
    const signals = completeSignals();
    signals.virusTotal = {
      status: "error",
      data: null,
      error: "timeout",
      durationMs: 5_000,
    };
    expect(getCoverageCaveat(buildResult("safe", { signals }))).toBe(
      "VirusTotal didn't finish.",
    );
  });

  it("lists several limits with correct agreement", () => {
    const signals = completeSignals();
    signals.virusTotal = {
      status: "error",
      data: null,
      error: "timeout",
      durationMs: 5_000,
    };
    signals.googleSafeBrowsing = {
      status: "error",
      data: null,
      error: "quota",
      durationMs: 5,
    };
    signals.whois = {
      status: "skipped",
      data: null,
      error: "IP targets have no registration record.",
      durationMs: 0,
    };
    signals.threatFeeds = {
      status: "success",
      data: {
        checkedAt: "",
        matches: [],
        observations: [],
        warnings: ["SURBL is unavailable."],
      },
      error: null,
      durationMs: 9,
    };

    expect(getCoverageCaveat(buildResult("suspicious", { signals }))).toBe(
      "VirusTotal and Google Safe Browsing didn't finish; Threat Feeds only partly finished; Domain Registration doesn't apply to this link.",
    );

    signals.dns = {
      status: "skipped",
      data: null,
      error: "IP targets have no DNS zone.",
      durationMs: 0,
    };
    expect(getCoverageCaveat(buildResult("suspicious", { signals }))).toMatch(
      /Domain Registration and DNS Profile don't apply to this link\.$/,
    );
  });

  it("names a stale VirusTotal analysis, aged at scan time", () => {
    const completedAt = Date.parse("2026-10-06T00:00:01.000Z");
    const daysBefore = (days: number) =>
      new Date(completedAt - days * 24 * 60 * 60 * 1000).toISOString();
    const withAnalysisDate = (lastAnalysisDate: string) => {
      const signals = completeSignals();
      signals.virusTotal = {
        status: "success",
        data: {
          malicious: 0,
          suspicious: 0,
          harmless: 40,
          undetected: 20,
          timeout: 0,
          results: [],
          permalink: "https://www.virustotal.com/gui/url/x",
          lastAnalysisDate,
        },
        error: null,
        durationMs: 20,
      };
      return signals;
    };

    expect(
      getCoverageCaveat(
        buildResult("safe", { signals: withAnalysisDate(daysBefore(90)) }),
      ),
    ).toBe("VirusTotal's analysis is 90 days old.");
    // Fresh at scan time stays fresh, however long ago the scan was: a
    // reopened history entry must not gain a caveat its verdict never had.
    vi.useFakeTimers({ now: Date.parse("2027-03-01T00:00:00.000Z") });
    try {
      expect(
        getCoverageCaveat(
          buildResult("safe", { signals: withAnalysisDate(daysBefore(10)) }),
        ),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent for Error, whose verdict line already says it failed", () => {
    const signals = completeSignals();
    signals.dns = { status: "error", data: null, error: "x", durationMs: 1 };
    expect(
      getCoverageCaveat(buildResult("error", { signals, threatInfo: null })),
    ).toBeNull();
  });
});

/** Critical from local heuristics alone: no reputation source objected. */
async function heuristicCriticalSignals(): Promise<SignalResults> {
  const signals = await fixtureSignals("example.com");
  const ml = signals.mlEnsemble.data;
  if (ml) {
    ml.consensusLabel = "malicious";
    ml.consensusScore = 0.98;
    ml.reasons = ["The link imitates a bank sign-in page."];
  }
  if (signals.whois.data) signals.whois.data.ageDays = 3;
  if (signals.ssl.data) {
    signals.ssl.data.validationState = "invalid";
    signals.ssl.data.validFrom = new Date(
      Date.now() - 86_400_000,
    ).toISOString();
  }
  if (signals.dns.data) {
    signals.dns.data.anomalies = [
      "The hostname uses punycode, which can hide a look-alike name.",
      "No mail records exist for a domain that asks for logins.",
    ];
  }
  if (signals.redirectChain.data) {
    signals.redirectChain.data.content = {
      title: "Sign in",
      crossOriginFormHosts: ["collect.example"],
      crossOriginPasswordFormHosts: ["collect.example"],
      passwordInputCount: 1,
      iframeCount: 0,
      hiddenIframeCount: 0,
      obfuscationHints: ["eval", "atob"],
      metaRefreshTarget: null,
    };
  }
  if (signals.virusTotal.data) signals.virusTotal.data.harmless = 10;
  return signals;
}

function resultFrom(signals: SignalResults): AnalysisResult {
  const { verdict, threatInfo } = buildThreatAssessment(signals);
  return {
    id: "scan",
    url: "https://example.com/",
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId: "scan",
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: "2026-10-06T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

describe("critical guidance", () => {
  it("does not call a heuristic-only Critical a known threat", async () => {
    const result = resultFrom(await heuristicCriticalSignals());

    expect(result.verdict).toBe("critical");
    expect(getVerdictGuidance(result).imperative).toBe("Don't open this link.");
    expect(getVerdictAnnouncement(result)).not.toMatch(/known threat/);
  });

  it("keeps the known-threat clause when a reputation source confirmed it", async () => {
    const withGsb = await heuristicCriticalSignals();
    withGsb.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 5,
      data: {
        checkedAt: "",
        matches: [
          {
            threatType: "SOCIAL_ENGINEERING",
            platformType: "ANY_PLATFORM",
            threatEntryType: "URL",
          },
        ],
      },
    };
    const withFeed = await heuristicCriticalSignals();
    withFeed.threatFeeds.data?.matches.push({
      feed: "openphish",
      matchedUrl: "https://example.com/",
      detail: "lists this exact link as phishing",
      confidence: "high",
      matchType: "url",
    });

    for (const signals of [withGsb, withFeed]) {
      const result = resultFrom(signals);
      expect(result.verdict).toBe("critical");
      expect(getVerdictGuidance(result).imperative).toBe(
        "Don't open this link — it's a known threat.",
      );
    }
  });

  it("falls back to the plain imperative without signals", () => {
    expect(
      getVerdictGuidance({ verdict: "critical", threatInfo: null }).imperative,
    ).toBe("Don't open this link.");
  });
});

describe("provisional Safe", () => {
  it("hedges a high-confidence Safe that still found minor warning signs", () => {
    const result = buildResult("safe", {
      confidenceLabel: "high",
      hasPositiveEvidence: true,
      partialFailure: false,
    });

    expect(isProvisionalSafe(result)).toBe(true);
    expect(getVerdictGuidance(result).imperative).toBe(
      "Probably safe — still check who sent it.",
    );
    expect(getVerdictAnnouncement(result)).toMatch(
      /Probably safe — still check who sent it\.$/,
    );
  });

  it("stays unhedged for a clean, high-confidence Safe", () => {
    const result = buildResult("safe");
    expect(result.threatInfo?.hasPositiveEvidence).toBe(false);
    expect(getVerdictGuidance(result).imperative).toBe("Looks safe to open.");
  });
});

describe("announcements", () => {
  it("names the host so two opened results never read the same", () => {
    const a = { ...buildResult("safe"), url: "https://one.example/" };
    const b = { ...buildResult("safe"), url: "https://two.example/path" };

    expect(getVerdictAnnouncement(a)).toBe(
      "Result for one.example: Safe, 0 out of 100. Looks safe to open.",
    );
    expect(getVerdictAnnouncement(b)).toBe(
      "Result for two.example: Safe, 0 out of 100. Looks safe to open.",
    );
  });
});

describe("shouldShowVerdictSummary", () => {
  it("hides the summary only for a clean, fully covered Safe", () => {
    const summary = "Something worth saying.";
    expect(shouldShowVerdictSummary(buildResult("safe", { summary }))).toBe(
      false,
    );
    expect(
      shouldShowVerdictSummary(
        buildResult("safe", { summary, limitations: ["VirusTotal: timeout"] }),
      ),
    ).toBe(true);
    expect(
      shouldShowVerdictSummary(
        buildResult("safe", { summary, partialFailure: true }),
      ),
    ).toBe(true);
    expect(
      shouldShowVerdictSummary(
        buildResult("safe", { summary, hasPositiveEvidence: true }),
      ),
    ).toBe(true);
    for (const verdict of [
      "malicious",
      "suspicious",
      "unknown",
      "critical",
    ] as const) {
      expect(shouldShowVerdictSummary(buildResult(verdict, { summary }))).toBe(
        true,
      );
    }
  });

  it("does not echo the quiet-checks line on the clean fixture", async () => {
    const result = resultFrom(await fixtureSignals("example.com"));
    expect(result.verdict).toBe("safe");
    expect(result.threatInfo?.summary).toBe("No check flagged this link.");
    expect(shouldShowVerdictSummary(result)).toBe(false);
  });
});

describe("look-alike hedging (presentation only)", () => {
  it("turns a look-alike Safe neutral and action-only, keeping its score", () => {
    const safe = buildResult("safe", { score: 4, confidenceLabel: "high" });
    expect(getVerdictGuidance(safe)).toMatchObject({
      imperative: "Looks safe to open.",
      showScore: true,
      tone: "safe",
      confidenceNote: null,
    });
    expect(getVerdictGuidance({ ...safe, impersonates: "paypal.com" })).toEqual(
      {
        // The owner fact is said once, by the anatomy: not here.
        imperative: "Don't sign in or enter details here.",
        showScore: true,
        tone: "unknown",
        confidenceNote: "No check flagged it, but the name is misleading.",
      },
    );
    // The score itself is untouched.
    expect(safe.threatInfo?.score).toBe(4);
  });

  it("keeps Unknown's own instruction for a look-alike", () => {
    const unknown = buildResult("unknown");
    expect(
      getVerdictGuidance({ ...unknown, impersonates: "paypal.com" }),
    ).toMatchObject({
      imperative: "We couldn't check this link — treat it as unsafe.",
      tone: "unknown",
      confidenceNote: null,
    });
  });

  it("states the owner with one shared sentence", () => {
    expect(ownershipSentence("secure-login.xyz", "paypal.com")).toBe(
      "This link belongs to secure-login.xyz, not paypal.com.",
    );
  });

  it("leaves the stronger instructions alone", () => {
    for (const verdict of ["suspicious", "malicious"] as const) {
      const result = buildResult(verdict, { score: 60 });
      expect(
        getVerdictGuidance({ ...result, impersonates: "paypal.com" }),
      ).toEqual(getVerdictGuidance(result));
    }
  });

  it("states the owner in the announcement, which has no anatomy line", () => {
    const safe = buildResult("safe", { score: 4, confidenceLabel: "high" });
    expect(
      getVerdictAnnouncement({
        ...safe,
        url: "https://paypal.com.secure-login.xyz/",
        impersonates: "paypal.com",
        registeredDomain: "secure-login.xyz",
      }),
    ).toBe(
      "Result for paypal.com.secure-login.xyz: Safe, 4 out of 100. Don't sign in or enter details here. This link belongs to secure-login.xyz, not paypal.com.",
    );
    expect(
      getVerdictAnnouncement({
        ...buildResult("unknown"),
        url: "https://paypal.com.secure-login.xyz/",
        impersonates: "paypal.com",
        registeredDomain: "secure-login.xyz",
      }),
    ).toBe(
      "Result for paypal.com.secure-login.xyz: Unknown. We couldn't check this link — treat it as unsafe. This link belongs to secure-login.xyz, not paypal.com.",
    );
  });

  it("hedges What to do, never permitting a sign-in after a sender check", () => {
    const safe = buildResult("safe", { score: 4, confidenceLabel: "high" });
    const hedged = getVerdictRecommendations({
      ...safe,
      impersonates: "paypal.com",
    });
    expect(hedged).toEqual([
      "Don't sign in, pay, or enter codes on this site.",
      "To reach paypal.com, type its address yourself or use its app.",
    ]);
    expect(getVerdictRecommendations(safe)).toEqual(
      safe.threatInfo?.recommendations ?? [],
    );
    const malicious = buildResult("malicious", { score: 70 });
    expect(
      getVerdictRecommendations({ ...malicious, impersonates: "paypal.com" }),
    ).toEqual(malicious.threatInfo?.recommendations ?? []);
  });

  it("qualifies a look-alike Safe's confidence reasons", () => {
    const safe = buildResult("safe", { score: 4, confidenceLabel: "high" });
    expect(
      getConfidenceReasons({ ...safe, impersonates: "paypal.com" }).at(-1),
    ).toBe(
      "Confidence covers reputation only; the address still imitates paypal.com.",
    );
    expect(getConfidenceReasons(safe)).toEqual(
      safe.threatInfo?.confidenceReasons ?? [],
    );
  });
});

describe("legacy records and the coverage caveat", () => {
  const legacy = (verdict: string) =>
    sanitizeHistoryEntry({
      id: "legacy",
      url: "https://example.com/",
      verdict,
      signals: {},
      metadata: { scanId: "legacy" },
      savedAt: "2026-01-01T00:00:00.000Z",
    });

  it("says nothing about checks that finished but were never stored", () => {
    for (const verdict of ["safe", "suspicious"]) {
      const entry = legacy(verdict);
      expect(entry).not.toBeNull();
      expect(getCoverageCaveat(entry!)).toBeNull();
    }
  });

  it("still names checks that really failed with a provider message", () => {
    const signals = createPendingSignalResults();
    for (const name of Object.keys(signals) as Array<keyof SignalResults>) {
      signals[name] = {
        status: "error",
        data: null,
        error: "Provider timed out",
        durationMs: 10,
      };
    }
    expect(
      getCoverageCaveat(buildResult("suspicious", { signals, score: 30 })),
    ).toMatch(/didn't finish/);
  });
});

describe("the verdict band's because line", () => {
  it("yields to driver rows so one fact is stated once", () => {
    const result = buildResult("malicious", {
      score: 70,
      summary: "7 VirusTotal engines flagged this link.",
    });
    expect(shouldShowVerdictSummary(result)).toBe(true);
    expect(shouldShowVerdictSummary(result, 1)).toBe(false);
  });
});
