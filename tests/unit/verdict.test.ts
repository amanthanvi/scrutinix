import { describe, expect, it } from "vitest";

import { buildThreatAssessment, classifyConsensus } from "@/lib/domain/verdict";
import { createPendingSignalResults } from "@/lib/domain/types";

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
        hostedModel: {
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

    expect(result.verdict).toBe("malicious");
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
        hostedModel: {
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
        hostedModel: null,
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

  it("caps clean-result confidence when a primary reputation source fails", () => {
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
        hostedModel: {
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
  });
});

describe("classifyConsensus", () => {
  it("floors ensemble risk when hosted is benign but lexical is malicious", () => {
    const result = classifyConsensus(
      {
        label: "benign",
        score: 0.9,
        reasons: ["Hosted model predicted benign."],
        model: "huggingface",
      },
      {
        label: "malicious",
        score: 0.8,
        reasons: ["Literal IP and script path."],
        model: "lexical-heuristic",
      },
    );

    expect(result.label).toBe("malicious");
    expect(result.score).toBeGreaterThanOrEqual(0.74);
    expect(result.reasons.join(" ")).toMatch(/effective risk was raised/i);
    expect(result.reasons.join(" ")).not.toMatch(
      /disagreement reduced the ensemble certainty/i,
    );
  });

  it("floors ensemble risk when hosted is benign but lexical is risky with meaningful score", () => {
    const result = classifyConsensus(
      {
        label: "benign",
        score: 0.7,
        reasons: ["Hosted model predicted benign."],
        model: "huggingface",
      },
      {
        label: "risky",
        score: 0.52,
        reasons: ["Structural cues."],
        model: "lexical-heuristic",
      },
    );

    expect(result.label).toBe("risky");
    expect(result.score).toBeGreaterThanOrEqual(0.38);
    expect(result.reasons.join(" ")).toMatch(/effective risk was raised/i);
  });

  it("does not elevate when hosted and lexical both agree on benign", () => {
    const result = classifyConsensus(
      {
        label: "benign",
        score: 0.6,
        reasons: ["Hosted model predicted benign."],
        model: "huggingface",
      },
      {
        label: "benign",
        score: 0.08,
        reasons: ["No suspicious lexical patterns were found."],
        model: "lexical-heuristic",
      },
    );

    expect(result.label).toBe("benign");
    expect(result.reasons.join(" ")).toMatch(
      /agreed on the classification direction/i,
    );
  });

  it("uses reduced-certainty wording when models disagree without benign-hosted lexical boost", () => {
    const result = classifyConsensus(
      {
        label: "malicious",
        score: 0.85,
        reasons: ["Hosted model predicted malicious."],
        model: "huggingface",
      },
      {
        label: "benign",
        score: 0.1,
        reasons: ["No suspicious lexical patterns were found."],
        model: "lexical-heuristic",
      },
    );

    expect(result.reasons.join(" ")).toMatch(
      /Model disagreement reduced the ensemble certainty/i,
    );
    expect(result.reasons.join(" ")).not.toMatch(/effective risk was raised/i);
  });

  it("treats benign hosted plus structural malicious lexical as suspicious via buildThreatAssessment", () => {
    const signals = createPendingSignalResults();
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        hostedModel: {
          label: "benign",
          score: 0.59,
          reasons: ["Hosted model predicted benign with 59% confidence."],
          model: "huggingface",
        },
        lexicalModel: {
          label: "malicious",
          score: 0.76,
          reasons: [
            "The URL targets a literal IP address instead of a domain.",
            "The URL references script or shell content such as .sh.",
            "The URL uses a non-standard HTTPS port (38376), which is uncommon for typical web services.",
          ],
          model: "lexical-heuristic",
        },
        consensusLabel: "malicious",
        consensusScore: 0.74,
        reasons: [
          "Hosted model predicted benign with 59% confidence.",
          "The URL targets a literal IP address instead of a domain.",
          "The URL references script or shell content such as .sh.",
          "The hosted model scored this link benign, but lexical heuristics disagreed; effective risk was raised to reflect structural evidence.",
        ],
        warnings: [],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("suspicious");
    expect(result.threatInfo?.score).toBeGreaterThanOrEqual(25);
  });
});
