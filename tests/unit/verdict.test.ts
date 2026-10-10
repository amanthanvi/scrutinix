import { describe, expect, it } from "vitest";

import { selectSummarySignals } from "@/components/shared/signal-selection";
import { analyzePageContent } from "@/lib/domain/content-analysis";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import {
  getCoverageCaveat,
  getVerdictGuidance,
} from "@/lib/domain/verdict-guidance";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";
import {
  createPendingSignalResults,
  type SignalResults,
  type ThreatFeedsData,
  type VirusTotalData,
} from "@/lib/domain/types";

function withVirusTotal(signals: SignalResults, data: Partial<VirusTotalData>) {
  signals.virusTotal = {
    status: "success",
    error: null,
    durationMs: 20,
    data: {
      malicious: 0,
      suspicious: 0,
      harmless: 0,
      undetected: 0,
      timeout: 0,
      results: [],
      permalink: "https://www.virustotal.com/gui/url/example",
      ...data,
    },
  };
}

function withThreatFeedMatches(
  signals: SignalResults,
  matches: ThreatFeedsData["matches"],
) {
  signals.threatFeeds = {
    status: "success",
    error: null,
    durationMs: 8,
    data: {
      checkedAt: "2026-03-06T00:00:00.000Z",
      matches,
      observations: [],
      warnings: [],
    },
  };
}

function markUnreachable(signals: SignalResults) {
  signals.ssl = {
    status: "success",
    error: null,
    durationMs: 12,
    data: {
      protocol: null,
      available: false,
      validationState: "unavailable",
      authorized: false,
      authorizationError: null,
      issuer: null,
      subject: null,
      validFrom: null,
      validTo: null,
      daysRemaining: null,
      selfSigned: false,
      fingerprint256: null,
      observations: ["The host did not complete a TLS handshake."],
    },
  };
  signals.redirectChain = {
    status: "success",
    error: null,
    durationMs: 12,
    data: {
      finalUrl: "https://dead.example/",
      totalHops: 0,
      httpsUpgraded: false,
      reachable: false,
      terminalStatus: null,
      terminalError: "The host did not respond to the redirect probe.",
      hops: [],
      observations: ["The host did not respond to the redirect probe."],
    },
  };
  signals.dns = {
    status: "success",
    error: null,
    durationMs: 12,
    data: {
      subjectType: "hostname",
      addresses: [],
      cnames: [],
      mx: [],
      txt: [],
      nameservers: [],
      reverseHostnames: [],
      anomalies: [],
      observations: ["The hostname did not resolve to address records."],
    },
  };
}

describe("buildThreatAssessment", () => {
  it("returns error when every signal fails", () => {
    const signals = createPendingSignalResults();
    for (const signal of Object.values(signals)) {
      signal.status = "error";
      signal.error = "failed";
    }

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("error");
    expect(result.threatInfo).toBeNull();
  });

  it("returns safe when only low-risk local signals succeed", () => {
    const signals = createPendingSignalResults();
    signals.ssl = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        protocol: "TLSv1.3",
        available: true,
        validationState: "trusted",
        authorized: true,
        authorizationError: null,
        issuer: "Example CA",
        subject: "example.com",
        validFrom: "2025-01-01T00:00:00.000Z",
        validTo: "2027-01-01T00:00:00.000Z",
        daysRemaining: 180,
        selfSigned: false,
        fingerprint256: "abc",
        observations: [],
      },
    };
    signals.dns = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "hostname",
        addresses: ["93.184.216.34"],
        cnames: [],
        mx: ["mx.example.com"],
        txt: [],
        nameservers: ["ns1.example.com"],
        reverseHostnames: [],
        anomalies: [],
        observations: [],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("safe");
    expect(result.threatInfo?.summary).toBe("No check flagged this link.");
  });

  it("promotes high-confidence reputation signals to malicious or critical", () => {
    const signals = createPendingSignalResults();
    signals.virusTotal = {
      status: "success",
      error: null,
      durationMs: 20,
      data: {
        malicious: 9,
        suspicious: 2,
        harmless: 1,
        undetected: 12,
        timeout: 0,
        results: [],
        permalink: "https://www.virustotal.com/gui/url/example",
      },
    };
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [
          {
            threatType: "SOCIAL_ENGINEERING",
            platformType: "ANY_PLATFORM",
            threatEntryType: "URL",
          },
        ],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(["malicious", "critical"]).toContain(result.verdict);
    expect(result.threatInfo?.reasons.join(" ")).toMatch(
      /VirusTotal|Safe Browsing/,
    );
  });

  it("reduces confidence when high-confidence sources disagree with a risk verdict", () => {
    const signals = createPendingSignalResults();
    signals.virusTotal = {
      status: "success",
      error: null,
      durationMs: 20,
      data: {
        malicious: 12,
        suspicious: 1,
        harmless: 10,
        undetected: 20,
        timeout: 0,
        results: [],
        permalink: "https://www.virustotal.com/gui/url/example",
      },
    };
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [],
      },
    };
    signals.threatFeeds = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [],
        observations: [],
        warnings: [],
      },
    };
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        transformerModel: {
          label: "malicious",
          score: 0.81,
          reasons: ["Hosted model predicted malware with 81% confidence."],
          model: "huggingface",
        },
        lexicalModel: {
          label: "benign",
          score: 0.08,
          reasons: ["No suspicious lexical patterns were found."],
          model: "lexical-heuristic",
        },
        consensusLabel: "risky",
        consensusScore: 0.57,
        reasons: [
          "Hosted model predicted malware with 81% confidence.",
          "No suspicious lexical patterns were found.",
          "Model disagreement reduced the ensemble certainty.",
        ],
        warnings: [],
      },
    };
    signals.ssl = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        protocol: null,
        available: false,
        validationState: "unavailable",
        authorized: false,
        authorizationError: null,
        issuer: null,
        subject: null,
        validFrom: null,
        validTo: null,
        daysRemaining: null,
        selfSigned: false,
        fingerprint256: null,
        observations: ["The host did not complete a TLS handshake."],
      },
    };
    signals.whois = {
      status: "skipped",
      error: "Registration lookups are not applicable to literal IP targets.",
      durationMs: 2,
      data: null,
    };
    signals.redirectChain = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        finalUrl: "https://45.151.155.223/x86_64",
        totalHops: 0,
        httpsUpgraded: false,
        reachable: false,
        terminalStatus: null,
        terminalError: "The host did not respond to the redirect probe.",
        hops: [],
        observations: ["The host did not respond to the redirect probe."],
      },
    };
    signals.dns = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "ip",
        addresses: ["45.151.155.223"],
        cnames: [],
        mx: [],
        txt: [],
        nameservers: [],
        reverseHostnames: [],
        anomalies: [],
        observations: ["DNS zone records do not apply to literal IP targets."],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(["malicious", "critical"]).toContain(result.verdict);
    expect(result.threatInfo?.confidence).toBeLessThan(0.85);
    expect(result.threatInfo?.confidenceReasons.join(" ")).toMatch(
      /other major reputation source.* found nothing|partial results/,
    );
  });

  it("raises invalid TLS endpoints into the suspicious band", () => {
    const signals = createPendingSignalResults();
    signals.virusTotal = {
      status: "success",
      error: null,
      durationMs: 20,
      data: {
        malicious: 0,
        suspicious: 0,
        harmless: 8,
        undetected: 24,
        timeout: 0,
        results: [],
        permalink: "https://www.virustotal.com/gui/url/example",
      },
    };
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [],
      },
    };
    signals.threatFeeds = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [],
        observations: [],
        warnings: [],
      },
    };
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        transformerModel: {
          label: "benign",
          score: 0.12,
          reasons: ["Hosted model did not detect malware patterns."],
          model: "huggingface",
        },
        lexicalModel: {
          label: "benign",
          score: 0.09,
          reasons: ["No suspicious lexical patterns were found."],
          model: "lexical-heuristic",
        },
        consensusLabel: "benign",
        consensusScore: 0.1,
        reasons: ["The ensemble found no direct malicious indicators."],
        warnings: [],
      },
    };
    signals.ssl = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        protocol: "TLSv1.2",
        available: true,
        validationState: "invalid",
        authorized: false,
        authorizationError: "CERT_HAS_EXPIRED",
        issuer: "Example CA",
        subject: "expired.example",
        validFrom: "2025-01-01T00:00:00.000Z",
        validTo: "2025-01-31T00:00:00.000Z",
        daysRemaining: -30,
        selfSigned: false,
        fingerprint256: "abc",
        observations: [
          "TLS validation failed: CERT_HAS_EXPIRED.",
          "The TLS certificate is expired.",
        ],
      },
    };
    signals.redirectChain = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        finalUrl: "https://expired.example/",
        totalHops: 0,
        httpsUpgraded: false,
        reachable: true,
        terminalStatus: 200,
        terminalError: null,
        hops: [{ url: "https://expired.example/", status: 200 }],
        observations: [],
      },
    };
    signals.whois = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "domain",
        available: true,
        registrar: "Example Registrar",
        registeredAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        ageDays: 365,
        country: "US",
        handle: "12345",
        rdapUrl: "https://rdap.example.com/domain/expired.example",
        observations: [],
      },
    };
    signals.dns = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "hostname",
        addresses: ["203.0.113.10"],
        cnames: [],
        mx: ["mx.example.com"],
        txt: [],
        nameservers: ["ns1.example.com"],
        reverseHostnames: [],
        anomalies: [],
        observations: [],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("suspicious");
    expect(result.threatInfo?.score).toBeGreaterThanOrEqual(25);
    expect(result.threatInfo?.reasons.join(" ")).toMatch(/CERT_HAS_EXPIRED/);
  });

  it("treats a strong malicious ML verdict as suspicious even without reputation hits", () => {
    const signals = createPendingSignalResults();
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        transformerModel: null,
        lexicalModel: {
          label: "malicious",
          score: 0.82,
          reasons: [
            "The URL targets a literal IP address instead of a domain.",
            "The path or query references executable-style content such as x86_64, setup.",
          ],
          model: "lexical-heuristic",
        },
        consensusLabel: "malicious",
        consensusScore: 0.82,
        reasons: [
          "The URL targets a literal IP address instead of a domain.",
          "The path or query references executable-style content such as x86_64, setup.",
        ],
        warnings: ["Hosted classifier failed with status 502."],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("suspicious");
    expect(result.threatInfo?.score).toBeGreaterThanOrEqual(25);
  });

  it("caps clean-result confidence when a primary reputation source is incomplete", () => {
    const signals = createPendingSignalResults();
    signals.virusTotal = {
      status: "error",
      error: "VirusTotal timed out.",
      durationMs: 20,
      data: null,
    };
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [],
      },
    };
    signals.threatFeeds = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [],
        observations: [],
        warnings: [],
      },
    };
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        transformerModel: {
          label: "benign",
          score: 0.12,
          reasons: ["Hosted model did not detect malware patterns."],
          model: "huggingface",
        },
        lexicalModel: {
          label: "benign",
          score: 0.07,
          reasons: ["No suspicious lexical patterns were found."],
          model: "lexical-heuristic",
        },
        consensusLabel: "benign",
        consensusScore: 0.09,
        reasons: ["The ensemble found no direct malicious indicators."],
        warnings: [],
      },
    };
    signals.ssl = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        protocol: "TLSv1.3",
        available: true,
        validationState: "trusted",
        authorized: true,
        authorizationError: null,
        issuer: "Example CA",
        subject: "example.com",
        validFrom: "2025-01-01T00:00:00.000Z",
        validTo: "2027-01-01T00:00:00.000Z",
        daysRemaining: 365,
        selfSigned: false,
        fingerprint256: "abc",
        observations: [],
      },
    };
    signals.whois = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "domain",
        available: true,
        registrar: "Example Registrar",
        registeredAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        ageDays: 365,
        country: "US",
        handle: "12345",
        rdapUrl: "https://rdap.example.com/domain/example.com",
        observations: [],
      },
    };
    signals.dns = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "hostname",
        addresses: ["93.184.216.34"],
        cnames: [],
        mx: ["mx.example.com"],
        txt: [],
        nameservers: ["ns1.example.com"],
        reverseHostnames: [],
        anomalies: [],
        observations: [],
      },
    };
    signals.redirectChain = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        finalUrl: "https://example.com/",
        totalHops: 0,
        httpsUpgraded: false,
        reachable: true,
        terminalStatus: 200,
        terminalError: null,
        hops: [{ url: "https://example.com/", status: 200 }],
        observations: [],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("safe");
    expect(result.threatInfo?.confidenceLabel).toBe("moderate");
    expect(result.threatInfo?.confidence).toBeLessThanOrEqual(0.79);
    expect(result.threatInfo?.confidenceReasons.join(" ")).toMatch(
      /VirusTotal didn't finish, which capped confidence/i,
    );

    withVirusTotal(signals, { harmless: 8, undetected: 12 });
    signals.threatFeeds.data!.warnings = [
      "spamhaus-dbl lookups are unavailable from this runtime's DNS resolver.",
    ];

    const partialFeedResult = buildThreatAssessment(signals);

    expect(partialFeedResult.verdict).toBe("safe");
    expect(partialFeedResult.threatInfo?.confidence).toBeLessThanOrEqual(0.79);
    expect(partialFeedResult.threatInfo?.confidenceReasons.join(" ")).toMatch(
      /Threat Feeds only partly finished, which capped confidence/i,
    );
  });

  it("returns unknown instead of safe for an unreachable host", () => {
    const signals = createPendingSignalResults();
    markUnreachable(signals);
    withVirusTotal(signals, { harmless: 3, undetected: 5 });

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("unknown");
    expect(result.threatInfo?.summary).toBe(
      "The site didn't respond, so we couldn't look at the page itself.",
    );
    expect(result.threatInfo?.confidence).toBeLessThanOrEqual(0.4);
    expect(result.threatInfo?.confidenceLabel).toBe("low");
    expect(result.threatInfo?.hasPositiveEvidence).toBe(false);
  });

  it("does not treat redirect-budget exhaustion after HTTP responses as an unreachable host", () => {
    const signals = createPendingSignalResults();
    markUnreachable(signals);
    const terminalError =
      "The redirect chain exceeded the maximum of 5 redirects before reaching a terminal response.";
    signals.redirectChain = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        finalUrl: "http://loop.example/hop-4",
        totalHops: 5,
        httpsUpgraded: false,
        reachable: false,
        terminalStatus: 302,
        terminalError,
        hops: Array.from({ length: 5 }, (_, index) => ({
          url: `http://loop.example/hop-${index}`,
          status: 302,
          location: `http://loop.example/hop-${index + 1}`,
        })),
        observations: [terminalError],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("safe");
    expect(result.threatInfo?.summary).not.toMatch(/didn't respond/i);
    expect(result.threatInfo?.limitations).toContain(
      `Redirect Chain: ${terminalError}`,
    );
  });

  it("never downgrades a positive verdict to unknown for a dead host", () => {
    const signals = createPendingSignalResults();
    markUnreachable(signals);
    withThreatFeedMatches(signals, [
      {
        feed: "urlhaus",
        matchedUrl: "https://dead.example/payload",
        detail: "malware_download",
        confidence: "high",
        matchType: "url",
      },
    ]);

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("malicious");
  });

  it("lets a Google Safe Browsing match convict on its own", () => {
    const signals = createPendingSignalResults();
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [
          {
            threatType: "SOCIAL_ENGINEERING",
            platformType: "ANY_PLATFORM",
            threatEntryType: "URL",
          },
        ],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("malicious");
    expect(result.threatInfo?.score).toBeGreaterThanOrEqual(55);
  });

  it("lets five VirusTotal engines convict, while one or two stay sub-suspicious and distinct", () => {
    const five = createPendingSignalResults();
    withVirusTotal(five, { malicious: 5, harmless: 40 });
    expect(buildThreatAssessment(five).verdict).toBe("malicious");

    const one = createPendingSignalResults();
    withVirusTotal(one, { malicious: 1, harmless: 40 });
    const two = createPendingSignalResults();
    withVirusTotal(two, { malicious: 2, harmless: 40 });

    const oneScore = buildThreatAssessment(one).threatInfo?.score ?? 0;
    const twoScore = buildThreatAssessment(two).threatInfo?.score ?? 0;

    // The old floor of 18 made 1 and 2 detections indistinguishable.
    expect(oneScore).toBeLessThan(twoScore);
    expect(twoScore).toBeLessThan(25);
  });

  it("grants the registration-age discount only to the registered domain itself", () => {
    const withAge = (subdomainOf?: string) => {
      const signals = createPendingSignalResults();
      signals.whois = {
        status: "success",
        error: null,
        durationMs: 12,
        data: {
          subjectType: "domain",
          available: true,
          registrar: "Example Registrar",
          registeredAt: "2010-01-01T00:00:00.000Z",
          updatedAt: null,
          expiresAt: null,
          ageDays: 365 * 15,
          country: null,
          handle: null,
          rdapUrl: "https://rdap.example.com/domain/example.com",
          ...(subdomainOf ? { subdomainOf } : {}),
          observations: [],
        },
      };
      return buildThreatAssessment(signals).threatInfo?.reasons.join(" ") ?? "";
    };

    expect(withAge()).toContain("years of registration history");
    expect(withAge("example.com")).not.toContain(
      "years of registration history",
    );
  });

  it("gives shared platforms neither an age discount nor a clean-feed credit", () => {
    const platform = createPendingSignalResults();
    withThreatFeedMatches(platform, []);
    expect(
      buildThreatAssessment(platform).threatInfo?.confidenceReasons,
    ).toContain("1 major reputation source found nothing.");

    if (platform.threatFeeds.data) {
      platform.threatFeeds.data.sharedPlatformListingsIgnored = true;
    }
    platform.whois = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "domain",
        available: true,
        registrar: "MarkMonitor Inc.",
        registeredAt: "2007-10-09T00:00:00.000Z",
        updatedAt: null,
        expiresAt: null,
        ageDays: 365 * 18,
        country: null,
        handle: null,
        rdapUrl: "https://rdap.verisign.com/com/v1/domain/github.com",
        sharedPlatform: true,
        observations: [],
      },
    };
    const info = buildThreatAssessment(platform).threatInfo;
    expect(info?.reasons.join(" ")).not.toContain(
      "years of registration history",
    );
    expect(info?.confidenceReasons.join(" ")).not.toContain(
      "returned clean results",
    );
  });

  it("convicts on an exact URLhaus listing but not on a host-level listing", () => {
    const exact = createPendingSignalResults();
    withThreatFeedMatches(exact, [
      {
        feed: "urlhaus",
        matchedUrl: "https://bad.example/payload",
        detail: "malware_download",
        confidence: "high",
        matchType: "url",
      },
    ]);
    const exactResult = buildThreatAssessment(exact);
    expect(exactResult.verdict).toBe("malicious");
    expect(exactResult.threatInfo?.score).toBe(55);

    const hostLevel = createPendingSignalResults();
    withThreatFeedMatches(hostLevel, [
      {
        feed: "urlhaus",
        matchedUrl: "bad.example",
        detail: "host has 12 malware URL listings in URLhaus",
        confidence: "medium",
        matchType: "host",
      },
    ]);
    const hostResult = buildThreatAssessment(hostLevel);
    expect(hostResult.verdict).toBe("suspicious");
    expect(hostResult.threatInfo?.score).toBe(25);
  });

  it("does not convict a shared host on listings of its other URLs", () => {
    // Production regression: github.com/vercel/next.js scanned as critical.
    const shared = createPendingSignalResults();
    withThreatFeedMatches(shared, [
      {
        feed: "urlhaus",
        matchedUrl: "github.com",
        detail: "host has 8006 malware URL listings in URLhaus",
        confidence: "medium",
        matchType: "host",
      },
      {
        feed: "threatfox",
        matchedUrl: "github.com",
        detail:
          "host has another URL listed as a payload_delivery indicator in ThreatFox",
        confidence: "medium",
        matchType: "host",
        listedElsewhereOnHost: true,
      },
    ]);
    const result = buildThreatAssessment(shared);
    expect(result.verdict).toBe("suspicious");
    expect(result.threatInfo?.score).toBe(50);
  });

  it("still weighs a medium ThreatFox host IOC above host corroboration", () => {
    const hostIoc = createPendingSignalResults();
    withThreatFeedMatches(hostIoc, [
      {
        feed: "threatfox",
        matchedUrl: "evil.example",
        detail: "botnet_cc indicator in ThreatFox",
        confidence: "medium",
        matchType: "host",
      },
    ]);
    expect(buildThreatAssessment(hostIoc).threatInfo?.score).toBe(40);
  });

  it("counts exact feed evidence, but not hostname fallbacks, as high-confidence support", () => {
    const googleMatch = {
      status: "success" as const,
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [
          {
            threatType: "SOCIAL_ENGINEERING",
            platformType: "ANY_PLATFORM",
            threatEntryType: "URL",
          },
        ],
      },
    };
    const exact = createPendingSignalResults();
    exact.googleSafeBrowsing = googleMatch;
    withThreatFeedMatches(exact, [
      {
        feed: "urlhaus",
        matchedUrl: "https://bad.example/payload",
        detail: "malware_download",
        confidence: "high",
        matchType: "url",
      },
    ]);

    const hostLevel = createPendingSignalResults();
    hostLevel.googleSafeBrowsing = googleMatch;
    withThreatFeedMatches(hostLevel, [
      {
        feed: "urlhaus",
        matchedUrl: "bad.example",
        detail: "host has 12 malware URL listings in URLhaus",
        confidence: "medium",
        matchType: "host",
      },
    ]);

    const exactResult = buildThreatAssessment(exact);
    const hostResult = buildThreatAssessment(hostLevel);

    expect(exactResult.threatInfo?.confidence).toBeCloseTo(
      (hostResult.threatInfo?.confidence ?? 0) + 0.16,
    );
    expect(exactResult.threatInfo?.confidenceReasons.join(" ")).toMatch(
      /2 major reputation sources independently flagged this link/,
    );
    expect(hostResult.threatInfo?.confidenceReasons.join(" ")).toMatch(
      /1 major reputation source independently flagged this link/,
    );
  });

  it("scores a Spamhaus DBL phishing listing into the suspicious band", () => {
    const signals = createPendingSignalResults();
    withThreatFeedMatches(signals, [
      {
        feed: "spamhaus-dbl",
        matchedUrl: "phish.example",
        detail: "listed as a phishing domain by Spamhaus DBL",
        confidence: "high",
        matchType: "host",
      },
    ]);

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("suspicious");
    expect(result.threatInfo?.score).toBe(45);
  });

  it("offsets weak heuristic-only positives with exculpatory evidence", () => {
    const signals = createPendingSignalResults();
    withVirusTotal(signals, { harmless: 70, undetected: 10 });
    signals.whois = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "domain",
        available: true,
        registrar: "Example Registrar",
        registeredAt: "2015-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        ageDays: 4_000,
        country: "US",
        handle: "12345",
        rdapUrl: "https://rdap.example.com/domain/old.example",
        observations: [],
      },
    };
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        transformerModel: null,
        lexicalModel: {
          label: "risky",
          score: 0.5,
          reasons: ["The URL contains high-risk terms such as login."],
          model: "lexical-heuristic",
        },
        consensusLabel: "risky",
        consensusScore: 0.5,
        reasons: ["The URL contains high-risk terms such as login."],
        warnings: [],
      },
    };

    const result = buildThreatAssessment(signals);

    // risky ML alone contributes 8; -10 (VT harmless) and -8 (domain age)
    // pull the total to the floor.
    expect(result.verdict).toBe("safe");
    expect(result.threatInfo?.score).toBe(0);
    expect(result.threatInfo?.reasons.join(" ")).toMatch(
      /rate this URL harmless/,
    );
  });

  it("does not haggle down a confirmed hit with exculpatory evidence", () => {
    const signals = createPendingSignalResults();
    withVirusTotal(signals, { harmless: 70, undetected: 10 });
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 8,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [
          {
            threatType: "MALWARE",
            platformType: "ANY_PLATFORM",
            threatEntryType: "URL",
          },
        ],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("malicious");
    expect(result.threatInfo?.score).toBeGreaterThanOrEqual(55);
    expect(result.threatInfo?.reasons.join(" ")).not.toMatch(
      /rate this URL harmless/,
    );
  });

  it("scores cross-domain redirects and credential-harvesting page content", () => {
    const signals = createPendingSignalResults();
    signals.redirectChain = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        finalUrl: "https://landing.evil/login",
        totalHops: 1,
        httpsUpgraded: false,
        reachable: true,
        terminalStatus: 200,
        terminalError: null,
        hops: [
          {
            url: "https://short.example/x",
            status: 302,
            location: "https://landing.evil/login",
          },
          { url: "https://landing.evil/login", status: 200 },
        ],
        observations: [],
        content: {
          title: "Account Login",
          crossOriginFormHosts: ["collector.other"],
          crossOriginPasswordFormHosts: ["collector.other"],
          passwordInputCount: 1,
          iframeCount: 0,
          hiddenIframeCount: 0,
          obfuscationHints: ["eval() call", "atob() base64 decoding"],
          metaRefreshTarget: null,
        },
      },
    };

    const result = buildThreatAssessment(signals);

    // 14 (cross-domain) + 20 (cross-origin credential form) + 10 (obfuscation)
    expect(result.threatInfo?.score).toBe(44);
    expect(result.verdict).toBe("suspicious");
    expect(result.threatInfo?.reasons.join(" ")).toMatch(
      /crosses domains.*short\.example.*landing\.evil/,
    );
    expect(result.threatInfo?.reasons.join(" ")).toMatch(
      /submits its form to a different domain/,
    );
  });

  it("does not conflate a local password form with an unrelated cross-origin form", () => {
    const signals = createPendingSignalResults();
    signals.redirectChain = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        finalUrl: "https://landing.example/login",
        totalHops: 0,
        httpsUpgraded: false,
        reachable: true,
        terminalStatus: 200,
        terminalError: null,
        hops: [{ url: "https://landing.example/login", status: 200 }],
        observations: [],
        content: analyzePageContent(
          `
            <form action="/login"><input type="password"></form>
            <form action="https://newsletter.other/subscribe"><input type="email"></form>
          `,
          "https://landing.example/login",
        ),
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.threatInfo?.score).toBe(0);
    expect(result.threatInfo?.reasons.join(" ")).not.toMatch(
      /submits its form to a different domain/,
    );
  });

  it("scores a cross-origin submit-control override on a password form", () => {
    const signals = createPendingSignalResults();
    signals.redirectChain = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        finalUrl: "https://landing.example/login",
        totalHops: 0,
        httpsUpgraded: false,
        reachable: true,
        terminalStatus: 200,
        terminalError: null,
        hops: [{ url: "https://landing.example/login", status: 200 }],
        observations: [],
        content: analyzePageContent(
          `
            <form action="/login">
              <input type="password">
              <button formaction="https://collector.evil/capture">Continue</button>
            </form>
          `,
          "https://landing.example/login",
        ),
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.threatInfo?.score).toBe(20);
    expect(result.threatInfo?.reasons.join(" ")).toMatch(
      /different domain \(collector\.evil\)/,
    );
  });

  it("flags a stale VirusTotal analysis and caps clean confidence", () => {
    const signals = createPendingSignalResults();
    const staleDate = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();
    withVirusTotal(signals, {
      harmless: 40,
      undetected: 20,
      lastAnalysisDate: staleDate,
    });

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("safe");
    expect(result.threatInfo?.limitations.join(" ")).toMatch(
      /VirusTotal analysis from \d+ days ago/,
    );
    expect(result.threatInfo?.confidence).toBeLessThanOrEqual(0.85);
  });

  it("names a stale VirusTotal analysis whenever the summary says checks were limited", async () => {
    const signals = await fixtureSignals("example.com");
    const vt = signals.virusTotal.data;
    if (signals.virusTotal.status !== "success" || !vt) {
      throw new Error("fixture lost its VirusTotal data");
    }
    vt.lastAnalysisDate = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { verdict, threatInfo } = buildThreatAssessment(signals);
    expect(threatInfo?.summary).toMatch(/some checks were limited/);
    const caveat = getCoverageCaveat({ verdict, signals });
    expect(caveat).not.toBeNull();
    expect(caveat).toMatch(/VirusTotal/);
  });

  it("does not subtract clean-score points from stale VirusTotal harmless counts", () => {
    const signals = createPendingSignalResults();
    withVirusTotal(signals, {
      harmless: 70,
      undetected: 10,
      lastAnalysisDate: "2000-01-01T00:00:00.000Z",
    });
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        transformerModel: null,
        lexicalModel: {
          label: "risky",
          score: 0.5,
          reasons: ["The URL contains high-risk terms such as login."],
          model: "lexical-heuristic",
        },
        consensusLabel: "risky",
        consensusScore: 0.5,
        reasons: ["The URL contains high-risk terms such as login."],
        warnings: [],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.threatInfo?.score).toBe(8);
    expect(result.threatInfo?.reasons.join(" ")).not.toMatch(
      /rate this URL harmless/,
    );
    expect(result.threatInfo?.confidence).toBeLessThanOrEqual(0.85);
  });

  it("flags a fresh certificate on a brand-new domain", () => {
    const signals = createPendingSignalResults();
    signals.whois = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        subjectType: "domain",
        available: true,
        registrar: "Example Registrar",
        registeredAt: new Date(
          Date.now() - 10 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updatedAt: null,
        expiresAt: null,
        ageDays: 10,
        country: null,
        handle: null,
        rdapUrl: "https://rdap.example.com/domain/new.example",
        observations: [],
      },
    };
    signals.ssl = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        protocol: "TLSv1.3",
        available: true,
        validationState: "trusted",
        authorized: true,
        authorizationError: null,
        issuer: "Example CA",
        subject: "new.example",
        validFrom: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        validTo: new Date(Date.now() + 88 * 24 * 60 * 60 * 1000).toISOString(),
        daysRemaining: 88,
        selfSigned: false,
        fingerprint256: "abc",
        observations: [],
      },
    };

    const result = buildThreatAssessment(signals);

    // 12 (fresh cert on new domain) + 15 (domain age < 30d)
    expect(result.threatInfo?.score).toBe(27);
    expect(result.verdict).toBe("suspicious");
    expect(result.threatInfo?.reasons.join(" ")).toMatch(/phishing setup/);
  });
});

describe("verdict copy", () => {
  /** Every user-facing string a result carries. */
  function allCopy(signals: SignalResults) {
    const info = buildThreatAssessment(signals).threatInfo;
    return [
      info?.summary ?? "",
      ...(info?.reasons ?? []),
      ...(info?.confidenceReasons ?? []),
      ...(info?.recommendations ?? []),
      ...(info?.limitations ?? []),
    ];
  }

  it("names the evidence in the summary instead of category jargon", () => {
    const signals = createPendingSignalResults();
    withVirusTotal(signals, { malicious: 7, suspicious: 2, harmless: 40 });
    withThreatFeedMatches(signals, [
      {
        feed: "urlhaus",
        matchedUrl: "https://evil.example/",
        detail: "lists this link as a malware download",
        confidence: "high",
        matchType: "url",
      },
    ]);

    const info = buildThreatAssessment(signals).threatInfo;

    // The D3 bug: "Malicious risk based on Reputation signals."
    expect(info?.summary).toBe(
      "7 VirusTotal engines and URLhaus flagged this link.",
    );
    expect(info?.summary).not.toMatch(/signals|Reputation|risk based/);
    expect(info?.reasons).toContain(
      "URLhaus lists this link as a malware download.",
    );
  });

  it("names warning signs when no reputation source flagged the link", () => {
    const signals = createPendingSignalResults();
    signals.ssl = {
      status: "success",
      error: null,
      durationMs: 9,
      data: {
        protocol: "TLSv1.2",
        available: true,
        validationState: "untrusted",
        authorized: false,
        authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
        issuer: null,
        subject: null,
        validFrom: null,
        validTo: null,
        daysRemaining: null,
        selfSigned: true,
        fingerprint256: null,
        observations: [],
      },
    };

    const info = buildThreatAssessment(signals).threatInfo;

    expect(info?.summary).toBe(
      "An untrusted certificate makes this link look risky.",
    );
  });

  describe("a VirusTotal domain flag is about the domain, not this link", () => {
    const flaggedDomain = {
      malicious: 5,
      suspicious: 0,
      harmless: 0,
      reputation: -20,
      categories: [],
    };

    it("never says VirusTotal flagged the link", () => {
      const signals = createPendingSignalResults();
      withVirusTotal(signals, { domain: flaggedDomain });
      signals.mlEnsemble = {
        status: "success",
        error: null,
        durationMs: 12,
        data: {
          transformerModel: null,
          lexicalModel: {
            label: "risky",
            score: 0.9,
            reasons: [],
            model: "lexical-heuristic",
          },
          consensusLabel: "risky",
          consensusScore: 0.9,
          reasons: [],
          warnings: [],
        },
      };

      const { verdict, threatInfo } = buildThreatAssessment(signals);

      // Scoring is unchanged: 15 (domain) + 14 (model).
      expect(verdict).toBe("suspicious");
      expect(threatInfo?.score).toBe(29);
      expect(threatInfo?.summary).toBe(
        "The link pattern model flagged this link.",
      );
      expect(threatInfo?.summary).not.toMatch(/VirusTotal.*flagged this link/);
      expect(threatInfo?.reasons).toContain(
        "VirusTotal flags this domain beyond this URL (5 engines mark the domain malicious).",
      );
    });

    it("does not hide a URL-level VirusTotal detection", () => {
      const signals = createPendingSignalResults();
      withVirusTotal(signals, { malicious: 1, domain: flaggedDomain });

      const { verdict, threatInfo } = buildThreatAssessment(signals);

      // 12 (one engine) + 15 (domain), as before.
      expect(verdict).toBe("suspicious");
      expect(threatInfo?.score).toBe(27);
      expect(threatInfo?.summary).toBe(
        "1 VirusTotal engine flagged this link.",
      );
    });

    it("reads as a warning sign beside other signs", () => {
      const signals = createPendingSignalResults();
      withVirusTotal(signals, { domain: flaggedDomain });
      signals.ssl = {
        status: "success",
        error: null,
        durationMs: 9,
        data: {
          protocol: "TLSv1.2",
          available: true,
          validationState: "untrusted",
          authorized: false,
          authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
          issuer: null,
          subject: null,
          validFrom: null,
          validTo: null,
          daysRemaining: null,
          selfSigned: true,
          fingerprint256: null,
          observations: [],
        },
      };

      const { verdict, threatInfo } = buildThreatAssessment(signals);

      expect(verdict).toBe("suspicious");
      expect(threatInfo?.score).toBe(41);
      expect(threatInfo?.summary).toBe(
        "An untrusted certificate and a VirusTotal warning about this link's domain make this link look risky.",
      );
      expect(threatInfo?.summary).not.toMatch(/flagged this link/);
    });
  });

  it("does not repeat the safe summary in the recommendations", () => {
    const signals = createPendingSignalResults();
    withVirusTotal(signals, { harmless: 70, undetected: 10 });
    withThreatFeedMatches(signals, []);

    const info = buildThreatAssessment(signals).threatInfo;

    expect(info?.summary).toBe("No check flagged this link.");
    for (const item of info?.recommendations ?? []) {
      expect(item).not.toMatch(/indicators|flagged/i);
    }
  });

  it("agrees every count with its noun", () => {
    const signals = createPendingSignalResults();
    withVirusTotal(signals, { malicious: 1, suspicious: 1 });
    withThreatFeedMatches(signals, []);
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 5,
      data: {
        checkedAt: "2026-10-06T00:00:00.000Z",
        matches: [
          {
            threatType: "SOCIAL_ENGINEERING",
            platformType: "ANY_PLATFORM",
            threatEntryType: "URL",
          },
        ],
      },
    };
    signals.dns = {
      status: "error",
      error: "DNS timed out.",
      data: null,
      durationMs: 2_000,
    };

    const copy = allCopy(signals);

    expect(copy).toContain(
      "1 VirusTotal engine marked this link as malicious.",
    );
    expect(copy).toContain(
      "1 VirusTotal engine marked this link as suspicious.",
    );
    expect(copy.join(" ")).toMatch(/DNS Profile.*didn't finish/);
    expect(copy.join(" ")).toMatch(/1 other major reputation source found/);
    // The D2 bug: "1 high-confidence sources".
    for (const line of copy) {
      expect(line).not.toMatch(
        /\b1 (?:[a-z-]+ ){0,3}(?:engines|sources|signals|checks|days|hops|matches|iframes|links|listings)\b/i,
      );
      expect(line).not.toMatch(/data-rich|lexical model|ML ensemble/i);
    }
  });
});

describe("confidence reasons and coverage", () => {
  const COUNT =
    /(\d+) (?:of \d+ )?(?:other )?(?:checks?|major reputation sources?)/g;

  it("states the Unknown cause once and never calls clean sources 'other'", async () => {
    const signals = await fixtureSignals("unreachable.scrutinix.test");
    const { verdict, threatInfo } = buildThreatAssessment(signals);
    const reasons = threatInfo?.confidenceReasons ?? [];

    expect(verdict).toBe("unknown");
    expect(threatInfo?.summary).toBe(
      "The site didn't respond, so we couldn't look at the page itself.",
    );
    expect(threatInfo?.summary).not.toMatch(/most checks/);
    for (const reason of reasons) {
      expect(reason).not.toMatch(/didn't respond/);
      expect(reason).not.toMatch(/\bother\b|lowers certainty|tempered/);
      expect(reason).not.toMatch(/returned full results|of 8 checks/);
    }
    expect(reasons).toContain(
      "VirusTotal, Google Safe Browsing, and Threat Feeds found nothing, but they can't vouch for the page itself.",
    );

    // Any count left in the reasons agrees with the Summary line's counts.
    const selection = selectSummarySignals(signals, threatInfo?.scoredSignals);
    const allowed = new Set([
      selection.clear,
      selection.limited,
      selection.drivers.length,
    ]);
    for (const reason of reasons) {
      for (const [, count] of reason.matchAll(COUNT)) {
        expect(allowed).toContain(Number(count));
      }
    }
  });

  it("only says 'other' sources when a previous line named one", () => {
    const signals = createPendingSignalResults();
    withVirusTotal(signals, { harmless: 50 });
    withThreatFeedMatches(signals, [
      {
        feed: "spamhaus-dbl",
        matchedUrl: "evil.example",
        detail: "lists this domain as a phishing domain",
        confidence: "medium",
        matchType: "host",
      },
    ]);
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 5,
      data: { checkedAt: "", matches: [] },
    };
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 5,
      data: {
        transformerModel: null,
        lexicalModel: {
          label: "risky",
          score: 0.7,
          reasons: [],
          model: "lexical-heuristic",
        },
        consensusLabel: "risky",
        consensusScore: 0.7,
        reasons: [],
        warnings: [],
      },
    };

    const { verdict, threatInfo } = buildThreatAssessment(signals);
    expect(verdict).toBe("suspicious");
    const reasons = threatInfo?.confidenceReasons ?? [];
    expect(reasons.join(" ")).not.toMatch(/\bother\b/);
    expect(reasons).toContain(
      "2 major reputation sources found nothing, which lowers certainty.",
    );
  });

  it("words a partial Threat Feeds result the same as the coverage caveat", () => {
    const signals = createPendingSignalResults();
    withVirusTotal(signals, { harmless: 8, undetected: 12 });
    withThreatFeedMatches(signals, []);
    signals.threatFeeds.data!.warnings = ["SURBL is unavailable."];
    const { verdict, threatInfo } = buildThreatAssessment(signals);
    const caveat = getCoverageCaveat({ verdict, signals });

    expect(caveat).toMatch(/Threat Feeds only partly finished/);
    expect(threatInfo?.confidenceReasons.join(" ")).toMatch(
      /Threat Feeds only partly finished, which capped confidence\./,
    );
    for (const text of [
      caveat ?? "",
      ...(threatInfo?.confidenceReasons ?? []),
    ]) {
      expect(text).not.toMatch(/did not complete/);
    }
  });

  it("says nothing about coverage when every check finished in full", async () => {
    const { threatInfo } = buildThreatAssessment(
      await fixtureSignals("example.com"),
    );
    for (const reason of threatInfo?.confidenceReasons ?? []) {
      expect(reason).not.toMatch(
        /of 8 checks finished|returned full results|didn't finish|partial results/,
      );
    }
    expect(threatInfo?.limitations).toEqual([]);
  });

  it("names the checks that fell short, with agreement", async () => {
    const signals = await fixtureSignals("example.com");
    signals.dns = {
      status: "error",
      error: "timeout",
      data: null,
      durationMs: 1,
    };
    let reasons = buildThreatAssessment(signals).threatInfo?.confidenceReasons;
    expect(reasons).toContain(
      "DNS Profile didn't finish, which lowers confidence.",
    );

    signals.virusTotal = {
      status: "error",
      error: "timeout",
      data: null,
      durationMs: 1,
    };
    reasons = buildThreatAssessment(signals).threatInfo?.confidenceReasons;
    expect(reasons).toContain(
      "VirusTotal and DNS Profile didn't finish, which capped confidence.",
    );

    signals.virusTotal = (await fixtureSignals("example.com")).virusTotal;
    signals.mlEnsemble.data!.warnings = ["The local model was unavailable."];
    reasons = buildThreatAssessment(signals).threatInfo?.confidenceReasons;
    expect(reasons).toContain(
      "Link Pattern Model returned only partial results.",
    );
  });
});

describe("Safe recommendations", () => {
  async function safeResult(edit: (signals: SignalResults) => void) {
    const signals = await fixtureSignals("example.com");
    edit(signals);
    const assessment = buildThreatAssessment(signals);
    return { ...assessment, url: "https://example.com/", signals };
  }

  it("does not repeat a provisional imperative as the first thing to do", async () => {
    const limited = await safeResult((signals) => {
      signals.virusTotal = {
        status: "error",
        error: "timeout",
        data: null,
        durationMs: 1,
      };
    });
    const moderate = await safeResult((signals) => {
      signals.googleSafeBrowsing = {
        status: "skipped",
        error: "No API key.",
        data: null,
        durationMs: 0,
      };
      signals.threatFeeds = {
        status: "skipped",
        error: "No feeds.",
        data: null,
        durationMs: 0,
      };
    });

    for (const result of [limited, moderate]) {
      expect(result.verdict).toBe("safe");
      expect(getVerdictGuidance(result).imperative).toMatch(/who sent/i);
      for (const item of result.threatInfo?.recommendations ?? []) {
        expect(item).not.toMatch(/who sent/i);
      }
    }
    expect(moderate.threatInfo?.confidenceLabel).not.toBe("high");
  });

  it("keeps the sender check for a confident, fully covered Safe", async () => {
    const result = await safeResult(() => {});
    expect(result.threatInfo?.confidenceLabel).toBe("high");
    expect(getVerdictGuidance(result).imperative).toBe("Looks safe to open.");
    expect(result.threatInfo?.recommendations).toContain(
      "Still check who sent the link before you sign in or pay.",
    );
  });
});

describe("limited coverage: summary and caveat agree", () => {
  const LIMITED = /some checks were limited/;

  /**
   * Builds the verdict, then checks the agreement both ways: the summary
   * claims a limit exactly when the caveat names one, and the caveat
   * names the expected check.
   */
  function assess(signals: SignalResults) {
    const { verdict, threatInfo } = buildThreatAssessment(signals);
    const summary = threatInfo?.summary ?? "";
    const caveat = getCoverageCaveat({ verdict, signals });
    expect(LIMITED.test(summary)).toBe(caveat !== null);
    return { verdict, threatInfo, summary, caveat };
  }

  it("claims no limit and names nothing when every check ran in full", async () => {
    const { verdict, summary, caveat } = assess(
      await fixtureSignals("example.com"),
    );
    expect(verdict).toBe("safe");
    expect(summary).not.toMatch(LIMITED);
    expect(caveat).toBeNull();
  });

  it("names an SSL certificate that couldn't be fully verified", async () => {
    const signals = await fixtureSignals("example.com");
    const baseline = buildThreatAssessment(signals);
    if (!signals.ssl.data) throw new Error("fixture lost its SSL data");
    signals.ssl.data.validationState = "warning";
    signals.ssl.data.observations = [
      "The certificate chain could not be fully verified.",
    ];

    const { verdict, threatInfo, summary, caveat } = assess(signals);
    expect(verdict).toBe("safe");
    expect(threatInfo?.score).toBe(baseline.threatInfo?.score);
    expect(summary).toMatch(LIMITED);
    expect(caveat).toBe("TLS Certificate couldn't be fully verified.");
  });

  it("names an SSL warning even when it carries no observation text", async () => {
    const signals = await fixtureSignals("example.com");
    if (!signals.ssl.data) throw new Error("fixture lost its SSL data");
    signals.ssl.data.validationState = "warning";
    signals.ssl.data.observations = [];

    const { summary, caveat } = assess(signals);
    expect(summary).toMatch(LIMITED);
    expect(caveat).toBe("TLS Certificate couldn't be fully verified.");
  });

  it("names a redirect chain that couldn't reach the site", async () => {
    const signals = await fixtureSignals("example.com");
    if (!signals.redirectChain.data) {
      throw new Error("fixture lost its redirect data");
    }
    signals.redirectChain.data.reachable = false;
    signals.redirectChain.data.terminalStatus = null;
    signals.redirectChain.data.observations = [
      "The site did not answer the redirect probe.",
    ];

    // TLS still answered, so the host isn't Unknown.
    const { verdict, summary, caveat } = assess(signals);
    expect(verdict).toBe("safe");
    expect(summary).toMatch(LIMITED);
    expect(caveat).toBe("Redirect Chain couldn't reach the site.");
  });

  it("names a WHOIS lookup that was unavailable", async () => {
    const signals = await fixtureSignals("example.com");
    if (!signals.whois.data) throw new Error("fixture lost its WHOIS data");
    signals.whois.data.available = false;
    signals.whois.data.observations = ["RDAP returned no record."];

    const { verdict, summary, caveat } = assess(signals);
    expect(verdict).toBe("safe");
    expect(summary).toMatch(LIMITED);
    expect(caveat).toBe("Domain Registration couldn't be looked up.");
  });

  it("names a stale VirusTotal analysis", async () => {
    const signals = await fixtureSignals("example.com");
    if (!signals.virusTotal.data) {
      throw new Error("fixture lost its VirusTotal data");
    }
    signals.virusTotal.data.lastAnalysisDate = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { verdict, summary, caveat } = assess(signals);
    expect(verdict).toBe("safe");
    expect(summary).toMatch(LIMITED);
    expect(caveat).toBe("VirusTotal's analysis is 90 days old.");
  });

  it("names a check that errored", async () => {
    const signals = await fixtureSignals("example.com");
    signals.dns = {
      status: "error",
      data: null,
      error: "DNS lookup timed out.",
      durationMs: 5_000,
    };

    const { verdict, summary, caveat } = assess(signals);
    expect(verdict).toBe("safe");
    expect(summary).toMatch(LIMITED);
    expect(caveat).toBe("DNS Profile didn't finish.");
  });

  it("names a skipped check", async () => {
    const signals = await fixtureSignals("example.com");
    signals.googleSafeBrowsing = {
      status: "skipped",
      data: null,
      error: "Google Safe Browsing is not configured.",
      durationMs: 0,
    };

    const { verdict, summary, caveat } = assess(signals);
    expect(verdict).toBe("safe");
    expect(summary).toMatch(LIMITED);
    expect(caveat).toBe("Google Safe Browsing doesn't apply to this link.");
  });

  it("names every limited check at once, in one sentence", async () => {
    const signals = await fixtureSignals("example.com");
    if (!signals.ssl.data || !signals.whois.data) {
      throw new Error("fixture lost its SSL or WHOIS data");
    }
    signals.ssl.data.validationState = "warning";
    signals.whois.data.available = false;
    signals.dns = { status: "error", data: null, error: "x", durationMs: 1 };

    const { summary, caveat } = assess(signals);
    expect(summary).toMatch(LIMITED);
    expect(caveat).toBe(
      "DNS Profile didn't finish; TLS Certificate couldn't be fully verified; Domain Registration couldn't be looked up.",
    );
  });

  it("lets Unknown's summary alone say the site didn't respond", async () => {
    const signals = await fixtureSignals("unreachable.scrutinix.test");
    const { verdict, threatInfo } = buildThreatAssessment(signals);
    const summary = threatInfo?.summary;
    expect(verdict).toBe("unknown");
    expect(summary).toMatch(/didn't respond/);
    expect(summary).not.toMatch(/some checks were limited/);
    expect(getCoverageCaveat({ verdict, signals }) ?? "").not.toMatch(
      /couldn't reach the site/,
    );
  });
});
