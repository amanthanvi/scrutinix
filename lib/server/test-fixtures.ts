import type { SignalName, SignalPayloadMap } from "@/lib/domain/types";
import type { NormalizedUrl } from "@/lib/domain/url";

/**
 * Deterministic offline signal fixtures for end-to-end tests.
 *
 * When SCRUTINIX_TEST_FIXTURES=1 the analyze orchestrator swaps its real
 * provider table for one of these per-hostname scenarios, so the e2e suite
 * never touches the network and always sees the same verdicts:
 *
 *   malicious.scrutinix.test    -> VirusTotal conviction (malicious)
 *   unreachable.scrutinix.test  -> dead host (unknown)
 *   feed-hit.scrutinix.test     -> URLhaus exact listing (malicious)
 *   anything else               -> clean (safe)
 *
 * This module is inert in production: it only activates through the explicit
 * environment flag, and it exports pure data behind one function.
 */

export type SignalProviderTable = {
  [K in SignalName]: () => Promise<SignalPayloadMap[K]>;
};

export function getFixtureSignalProviders(
  target: NormalizedUrl,
): SignalProviderTable | null {
  if (process.env.SCRUTINIX_TEST_FIXTURES !== "1") {
    return null;
  }

  const signals = buildFixtureSignals(target);
  return {
    virusTotal: async () => signals.virusTotal,
    mlEnsemble: async () => signals.mlEnsemble,
    googleSafeBrowsing: async () => signals.googleSafeBrowsing,
    threatFeeds: async () => signals.threatFeeds,
    ssl: async () => signals.ssl,
    whois: async () => signals.whois,
    dns: async () => signals.dns,
    redirectChain: async () => signals.redirectChain,
  };
}

function buildFixtureSignals(target: NormalizedUrl): SignalPayloadMap {
  const clean = buildCleanSignals(target);

  switch (target.hostname) {
    case "malicious.scrutinix.test":
      return {
        ...clean,
        virusTotal: {
          ...clean.virusTotal,
          malicious: 7,
          suspicious: 2,
          harmless: 40,
          undetected: 21,
          results: [
            { engine: "FixtureAV", category: "malicious", result: "phishing" },
            {
              engine: "FixtureGuard",
              category: "malicious",
              result: "malware",
            },
          ],
        },
      };
    case "unreachable.scrutinix.test":
      return {
        ...clean,
        ssl: {
          ...clean.ssl,
          protocol: null,
          available: false,
          validationState: "unavailable",
          authorized: false,
          issuer: null,
          subject: null,
          validFrom: null,
          validTo: null,
          daysRemaining: null,
          fingerprint256: null,
          observations: ["No TLS handshake could be completed."],
        },
        dns: {
          ...clean.dns,
          addresses: [],
          nameservers: [],
          mx: [],
          observations: ["No addresses resolved for this hostname."],
        },
        redirectChain: {
          ...clean.redirectChain,
          finalUrl: target.normalizedUrl,
          reachable: false,
          terminalStatus: null,
          terminalError: "The host did not respond.",
          hops: [],
          content: null,
        },
      };
    case "feed-hit.scrutinix.test":
      return {
        ...clean,
        threatFeeds: {
          ...clean.threatFeeds,
          matches: [
            {
              feed: "urlhaus",
              matchedUrl: target.normalizedUrl,
              detail: "listed as active malware distribution",
              confidence: "high",
              matchType: "url",
            },
          ],
        },
      };
    default:
      return clean;
  }
}

function buildCleanSignals(target: NormalizedUrl): SignalPayloadMap {
  const checkedAt = new Date().toISOString();

  return {
    virusTotal: {
      malicious: 0,
      suspicious: 0,
      harmless: 70,
      undetected: 20,
      timeout: 0,
      results: [],
      permalink: `https://www.virustotal.com/gui/url/fixture-${target.hostname}`,
      lastAnalysisDate: checkedAt,
      domain: null,
    },
    mlEnsemble: {
      transformerModel: {
        label: "benign",
        score: 0.04,
        reasons: ["Fixture classifier saw no phishing patterns."],
        model: "fixture-transformer",
      },
      lexicalModel: {
        label: "benign",
        score: 0.05,
        reasons: ["No suspicious lexical patterns were found."],
        model: "lexical-heuristic",
      },
      consensusLabel: "benign",
      consensusScore: 0.05,
      reasons: ["No suspicious lexical patterns were found."],
      warnings: [],
    },
    googleSafeBrowsing: {
      checkedAt,
      matches: [],
    },
    threatFeeds: {
      checkedAt,
      matches: [],
      observations: [],
      warnings: [],
    },
    ssl: {
      protocol: "TLSv1.3",
      available: true,
      validationState: "trusted",
      authorized: true,
      authorizationError: null,
      issuer: "Fixture CA",
      subject: target.hostname,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-01-01T00:00:00.000Z",
      daysRemaining: 200,
      selfSigned: false,
      fingerprint256: "fixture-fingerprint",
      observations: [],
    },
    whois: {
      subjectType: "domain",
      available: true,
      registrar: "Fixture Registrar",
      registeredAt: "2018-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      ageDays: 3_100,
      country: "US",
      handle: "FIXTURE-DOMAIN",
      rdapUrl: `https://rdap.example.test/domain/${target.hostname}`,
      observations: [],
    },
    dns: {
      subjectType: "hostname",
      addresses: ["203.0.113.10"],
      cnames: [],
      mx: [`mx.${target.hostname}`],
      txt: [],
      nameservers: [`ns1.${target.hostname}`],
      reverseHostnames: [],
      anomalies: [],
      observations: [],
    },
    redirectChain: {
      finalUrl: target.normalizedUrl,
      totalHops: 0,
      httpsUpgraded: false,
      reachable: true,
      terminalStatus: 200,
      terminalError: null,
      hops: [{ url: target.normalizedUrl, status: 200 }],
      observations: [],
      content: {
        title: `Fixture page for ${target.hostname}`,
        crossOriginFormHosts: [],
        passwordInputCount: 0,
        iframeCount: 0,
        hiddenIframeCount: 0,
        obfuscationHints: [],
        metaRefreshTarget: null,
      },
    },
  };
}
