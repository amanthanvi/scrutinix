import {
  createPendingSignalResults,
  type SignalResults,
} from "@/lib/domain/types";

/** All eight checks finished and found nothing. */
export function cleanSignals(): SignalResults {
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

/** A lure: two hops, the last one to plain HTTP on another site. */
export function withLureRedirect(
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

export function withDomainAge(signals: SignalResults, ageDays: number) {
  if (signals.whois.data) signals.whois.data.ageDays = ageDays;
}
