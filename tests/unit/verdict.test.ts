import { describe, expect, it } from "vitest";

import { buildThreatAssessment } from "@/lib/domain/verdict";
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
    expect(result.threatInfo?.summary).toMatch(
      /No strong malicious indicators/,
    );
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
      /stayed clean|partial coverage/,
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
      /VirusTotal did not complete/i,
    );

    withVirusTotal(signals, { harmless: 8, undetected: 12 });
    signals.threatFeeds.data!.warnings = [
      "spamhaus-dbl lookups are unavailable from this runtime's DNS resolver.",
    ];

    const partialFeedResult = buildThreatAssessment(signals);

    expect(partialFeedResult.verdict).toBe("safe");
    expect(partialFeedResult.threatInfo?.confidence).toBeLessThanOrEqual(0.79);
    expect(partialFeedResult.threatInfo?.confidenceReasons.join(" ")).toMatch(
      /Threat Feeds did not complete/i,
    );
  });

  it("returns unknown instead of safe for an unreachable host", () => {
    const signals = createPendingSignalResults();
    markUnreachable(signals);
    withVirusTotal(signals, { harmless: 3, undetected: 5 });

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("unknown");
    expect(result.threatInfo?.summary).toMatch(
      /unreachable.*not evidence of safety/i,
    );
    expect(result.threatInfo?.confidence).toBeLessThanOrEqual(0.4);
    expect(result.threatInfo?.confidenceLabel).toBe("low");
    expect(result.threatInfo?.hasPositiveEvidence).toBe(false);
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
    expect(buildThreatAssessment(exact).verdict).toBe("malicious");

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
    expect(result.threatInfo?.reasons.join(" ")).toMatch(
      /phishing setup pattern/,
    );
  });
});
