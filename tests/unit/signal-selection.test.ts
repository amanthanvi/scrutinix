import { describe, expect, it } from "vitest";

import {
  describeQuietChecks,
  selectSummarySignals,
} from "@/components/shared/signal-selection";
import { getSignalSeverity } from "@/lib/domain/signal-severity";
import {
  createPendingSignalResults,
  signalNames,
  type SignalResults,
} from "@/lib/domain/types";
import { buildThreatAssessment, getScoredSignals } from "@/lib/domain/verdict";
import {
  fixtureHosts,
  fixtureSignals,
} from "@/tests/fixtures/scenario-signals";

/** All eight checks finished and found nothing. */
function cleanSignals(): SignalResults {
  const signals = createPendingSignalResults();
  signals.virusTotal = {
    status: "success",
    error: null,
    durationMs: 20,
    data: {
      malicious: 0,
      suspicious: 0,
      harmless: 70,
      undetected: 10,
      timeout: 0,
      results: [],
      permalink: "https://www.virustotal.com/gui/url/x",
    },
  };
  signals.mlEnsemble = {
    status: "success",
    error: null,
    durationMs: 10,
    data: {
      transformerModel: null,
      lexicalModel: {
        label: "benign",
        score: 0.05,
        reasons: [],
        model: "lexical-heuristic",
      },
      consensusLabel: "benign",
      consensusScore: 0.05,
      reasons: [],
      warnings: [],
    },
  };
  signals.googleSafeBrowsing = {
    status: "success",
    error: null,
    durationMs: 8,
    data: { checkedAt: "", matches: [] },
  };
  signals.threatFeeds = {
    status: "success",
    error: null,
    durationMs: 8,
    data: { checkedAt: "", matches: [], observations: [], warnings: [] },
  };
  signals.ssl = {
    status: "success",
    error: null,
    durationMs: 8,
    data: {
      protocol: "TLSv1.3",
      available: true,
      validationState: "trusted",
      authorized: true,
      authorizationError: null,
      issuer: "CA",
      subject: "example.com",
      validFrom: null,
      validTo: null,
      daysRemaining: null,
      selfSigned: false,
      fingerprint256: null,
      observations: [],
    },
  };
  signals.whois = {
    status: "success",
    error: null,
    durationMs: 8,
    data: {
      subjectType: "domain",
      available: true,
      registrar: null,
      registeredAt: null,
      updatedAt: null,
      expiresAt: null,
      ageDays: 4_000,
      country: null,
      handle: null,
      rdapUrl: "https://rdap.example/domain/example.com",
      observations: [],
    },
  };
  signals.dns = {
    status: "success",
    error: null,
    durationMs: 8,
    data: {
      subjectType: "hostname",
      addresses: ["93.184.216.34"],
      cnames: [],
      mx: [],
      txt: [],
      nameservers: [],
      reverseHostnames: [],
      anomalies: [],
      observations: [],
    },
  };
  signals.redirectChain = {
    status: "success",
    error: null,
    durationMs: 8,
    data: {
      finalUrl: "https://example.com/",
      totalHops: 0,
      httpsUpgraded: false,
      reachable: true,
      terminalStatus: 200,
      terminalError: null,
      hops: [],
      observations: [],
    },
  };
  return signals;
}

describe("selectSummarySignals", () => {
  it("shows no rows and one plain line for a clean, complete scan", () => {
    const selection = selectSummarySignals(cleanSignals());

    expect(selection.drivers).toEqual([]);
    expect(describeQuietChecks(selection)).toBe("All 8 checks found nothing.");
  });

  it("shows only the signals that drove a Malicious verdict", () => {
    // The D6 bug: three slots filled by severity put two "No threat
    // matches" rows under a Malicious verdict.
    const signals = cleanSignals();
    if (signals.virusTotal.data) signals.virusTotal.data.malicious = 7;
    if (signals.threatFeeds.data) {
      signals.threatFeeds.data.matches = [
        {
          feed: "urlhaus",
          matchedUrl: "https://evil.example/",
          detail: "lists this link as a malware download",
          confidence: "high",
          matchType: "url",
        },
      ];
    }

    const selection = selectSummarySignals(signals);

    expect(selection.drivers).toEqual(["threatFeeds", "virusTotal"]);
    expect(describeQuietChecks(selection)).toBe(
      "6 other checks found nothing.",
    );
  });

  it("keeps drivers in a fixed order and counts caveats separately", () => {
    const signals = cleanSignals();
    signals.dns = {
      status: "error",
      error: "DNS timed out.",
      data: null,
      durationMs: 2_000,
    };
    if (signals.whois.data) signals.whois.data.ageDays = 3;
    signals.ssl = {
      status: "skipped",
      error: "No TLS for this target.",
      data: null,
      durationMs: 0,
    };

    const selection = selectSummarySignals(signals);

    expect(selection.drivers).toEqual(["whois", "dns"]);
    expect(describeQuietChecks(selection)).toBe(
      "5 other checks found nothing and 1 couldn't give a full answer.",
    );
  });

  it("counts checks still running while a scan streams", () => {
    const signals = createPendingSignalResults();
    signals.virusTotal = cleanSignals().virusTotal;

    const selection = selectSummarySignals(signals);

    expect(selection.drivers).toEqual([]);
    expect(describeQuietChecks(selection)).toBe(
      "1 check found nothing and 7 are still running.",
    );
  });

  it("uses singular agreement for one running check", () => {
    const signals = cleanSignals();
    signals.dns = createPendingSignalResults().dns;

    expect(describeQuietChecks(selectSummarySignals(signals))).toBe(
      "7 checks found nothing and 1 is still running.",
    );
  });
});

/** A lure: two hops, the last one to plain HTTP on another site. */
function withLureRedirect(
  signals: SignalResults,
  options: { passwordForm?: boolean; hiddenIframe?: boolean } = {},
) {
  signals.redirectChain = {
    status: "success",
    error: null,
    durationMs: 8,
    data: {
      finalUrl: "http://lure.example/landing",
      totalHops: 2,
      httpsUpgraded: false,
      reachable: true,
      terminalStatus: 200,
      terminalError: null,
      hops: [
        {
          url: "https://short.example/a",
          status: 301,
          location: "https://short.example/b",
        },
        {
          url: "https://short.example/b",
          status: 302,
          location: "http://lure.example/landing",
        },
        { url: "http://lure.example/landing", status: 200 },
      ],
      observations: [],
      content: {
        title: "Sign in",
        crossOriginFormHosts: options.passwordForm ? ["collect.example"] : [],
        crossOriginPasswordFormHosts: options.passwordForm
          ? ["collect.example"]
          : [],
        passwordInputCount: options.passwordForm ? 1 : 0,
        iframeCount: options.hiddenIframe ? 1 : 0,
        hiddenIframeCount: options.hiddenIframe ? 1 : 0,
        obfuscationHints: [],
        metaRefreshTarget: null,
      },
    },
  };
}

function withDomainAge(signals: SignalResults, ageDays: number) {
  if (signals.whois.data) signals.whois.data.ageDays = ageDays;
}

/** The selection the live view computes for a finished scan. */
function finishedSelection(signals: SignalResults) {
  const { threatInfo } = buildThreatAssessment(signals);
  return selectSummarySignals(signals, threatInfo?.scoredSignals);
}

describe("Summary drivers follow the verdict engine", () => {
  it("shows the redirect and domain-age checks that made a link Suspicious", () => {
    // The review bug: per-signal thresholds called these "clear", so a
    // Suspicious verdict showed no rows and "All 8 checks found nothing."
    const signals = cleanSignals();
    withLureRedirect(signals, { hiddenIframe: true });
    withDomainAge(signals, 100);

    expect(buildThreatAssessment(signals).verdict).toBe("suspicious");
    const selection = finishedSelection(signals);

    expect(selection.drivers).toEqual(["redirectChain", "whois"]);
    expect(describeQuietChecks(selection)).toBe(
      "6 other checks found nothing.",
    );
  });

  it("keeps the drivers with or without a cross-site password form", () => {
    for (const passwordForm of [false, true]) {
      const signals = cleanSignals();
      withLureRedirect(signals, { passwordForm });
      withDomainAge(signals, 90);

      const selection = finishedSelection(signals);
      expect(selection.drivers).toEqual(["redirectChain", "whois"]);
      expect(describeQuietChecks(selection)).toBe(
        "6 other checks found nothing.",
      );
    }
  });

  it("lists a minor warning sign under a Safe verdict", () => {
    const signals = cleanSignals();
    withDomainAge(signals, 100);

    const { verdict, threatInfo } = buildThreatAssessment(signals);
    expect(verdict).toBe("safe");
    expect(threatInfo?.hasPositiveEvidence).toBe(true);
    expect(finishedSelection(signals).drivers).toEqual(["whois"]);
  });

  it("never shows a scored check with the gray found-nothing dot", () => {
    const signals = cleanSignals();
    withLureRedirect(signals, { hiddenIframe: true });
    withDomainAge(signals, 100);

    const scored = getScoredSignals(signals);
    expect([...scored].sort()).toEqual(["redirectChain", "whois"]);
    for (const name of scored) {
      const signal = signals[name];
      expect(
        getSignalSeverity(signal.status, signal.data, name, true),
      ).not.toBe("clear");
    }
  });

  it("falls back to severity alone while a scan streams", () => {
    const signals = cleanSignals();
    withDomainAge(signals, 100);

    // No verdict yet: 100 days is below the row's own warning threshold.
    expect(selectSummarySignals(signals).drivers).toEqual([]);
  });

  it("shows a driver whenever the verdict found something", async () => {
    const scenarios: SignalResults[] = [];
    for (const host of fixtureHosts) {
      scenarios.push(await fixtureSignals(host));
    }
    const lure = cleanSignals();
    withLureRedirect(lure, { hiddenIframe: true, passwordForm: true });
    withDomainAge(lure, 12);
    scenarios.push(lure);
    const young = cleanSignals();
    withDomainAge(young, 20);
    scenarios.push(young);

    for (const signals of scenarios) {
      const { verdict, threatInfo } = buildThreatAssessment(signals);
      const selection = selectSummarySignals(
        signals,
        threatInfo?.scoredSignals,
      );

      for (const name of getScoredSignals(signals)) {
        expect(selection.drivers).toContain(name);
      }
      if (
        (verdict !== "safe" && verdict !== "unknown") ||
        threatInfo?.hasPositiveEvidence
      ) {
        expect(selection.drivers.length).toBeGreaterThan(0);
        expect(describeQuietChecks(selection)).not.toMatch(/^All \d+ checks/);
      }
    }
  });

  it("matches the stored scored list to the engine for every signal", () => {
    const signals = cleanSignals();
    withLureRedirect(signals, { hiddenIframe: true });
    const { threatInfo } = buildThreatAssessment(signals);
    const scored = getScoredSignals(signals);

    expect(threatInfo?.scoredSignals).toEqual(
      signalNames.filter((name) => scored.has(name)),
    );
  });
});
