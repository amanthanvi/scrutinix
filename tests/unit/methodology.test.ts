import { describe, expect, it } from "vitest";

import {
  CONFIDENCE,
  CONVICTS_AT,
  DISCOUNTS_OFF_AT,
  LINK_CHECK_MAX,
  SCORE_BANDS,
  SCORING_TABLES,
} from "@/lib/domain/methodology";
import type {
  PageContentFindings,
  RedirectData,
  SSLData,
  ThreatFeedsData,
  VirusTotalData,
  WhoisData,
} from "@/lib/domain/schemas";
import { threatScoreToVerdict } from "@/lib/domain/score-bands";
import {
  createPendingSignalResults,
  type SignalResults,
} from "@/lib/domain/types";
import {
  buildThreatAssessment,
  scoreToConfidenceLabel,
} from "@/lib/domain/verdict";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

/**
 * /about prints the scoring method from `lib/domain/methodology.ts`. Every
 * row here runs through the real engine: `add` on top of `base` must move
 * the score by exactly `points`, and unless `stated` is false the row's
 * text must print that number. A changed weight fails until the page says
 * the same thing.
 */

type Edit = (signals: SignalResults) => void;

interface Scenario {
  add: Edit;
  base?: Edit;
  points: number;
  /** The row's text prints this number (false for in-between values). */
  stated?: false;
}

const DAY = 86_400_000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY).toISOString();

function ok<T>(data: T) {
  return { status: "success" as const, error: null, durationMs: 5, data };
}

const vt =
  (data: Partial<VirusTotalData>): Edit =>
  (signals) => {
    signals.virusTotal = ok({
      malicious: 0,
      suspicious: 0,
      harmless: 0,
      undetected: 0,
      timeout: 0,
      results: [],
      permalink: "",
      ...data,
    });
  };

const gsb =
  (...threatTypes: string[]): Edit =>
  (signals) => {
    signals.googleSafeBrowsing = ok({
      checkedAt: "",
      matches: threatTypes.map((threatType) => ({
        threatType,
        platformType: "ANY_PLATFORM",
        threatEntryType: "URL",
      })),
    });
  };

type FeedMatch = ThreatFeedsData["matches"][number];

const feed =
  (match: Partial<FeedMatch> & Pick<FeedMatch, "feed">): Edit =>
  (signals) => {
    signals.threatFeeds = ok({
      checkedAt: "",
      matches: [
        {
          matchedUrl: "https://bad.example/",
          detail: "lists this link",
          confidence: "medium" as const,
          ...match,
        },
      ],
      observations: [],
      warnings: [],
    });
  };

const ml =
  (consensusLabel: "risky" | "malicious", consensusScore: number): Edit =>
  (signals) => {
    signals.mlEnsemble = ok({
      transformerModel: null,
      lexicalModel: {
        label: consensusLabel,
        score: consensusScore,
        reasons: [],
        model: "lexical-heuristic",
      },
      consensusLabel,
      consensusScore,
      reasons: [],
      warnings: [],
    });
  };

const ssl =
  (data: Partial<SSLData>): Edit =>
  (signals) => {
    signals.ssl = ok({
      protocol: "TLSv1.3",
      available: true,
      validationState: "trusted" as const,
      authorized: true,
      authorizationError: null,
      issuer: null,
      subject: null,
      validFrom: null,
      validTo: null,
      daysRemaining: null,
      selfSigned: false,
      fingerprint256: null,
      observations: [],
      ...data,
    });
  };

const whois =
  (ageDays: number, data: Partial<WhoisData> = {}): Edit =>
  (signals) => {
    signals.whois = ok({
      subjectType: "domain" as const,
      available: true,
      registrar: null,
      registeredAt: null,
      updatedAt: null,
      expiresAt: null,
      ageDays,
      country: null,
      handle: null,
      rdapUrl: "",
      observations: [],
      ...data,
    });
  };

const dns =
  (anomaly: string): Edit =>
  (signals) => {
    signals.dns = ok({
      subjectType: "hostname" as const,
      addresses: [],
      cnames: [],
      mx: [],
      txt: [],
      nameservers: [],
      reverseHostnames: [],
      anomalies: [anomaly],
      observations: [],
    });
  };

const redirect =
  (data: Partial<RedirectData>): Edit =>
  (signals) => {
    signals.redirectChain = ok({
      finalUrl: "https://site.com/",
      totalHops: 0,
      httpsUpgraded: false,
      reachable: true,
      terminalStatus: 200,
      terminalError: null,
      hops: [],
      observations: [],
      ...data,
    });
  };

const page = (content: Partial<PageContentFindings>): Edit =>
  redirect({
    content: {
      title: null,
      crossOriginFormHosts: [],
      passwordInputCount: 0,
      iframeCount: 0,
      hiddenIframeCount: 0,
      obfuscationHints: [],
      metaRefreshTarget: null,
      ...content,
    },
  });

const all =
  (...edits: Edit[]): Edit =>
  (signals) => {
    for (const edit of edits) edit(signals);
  };

function scoreOf(...edits: Edit[]) {
  const signals = createPendingSignalResults();
  all(...edits)(signals);
  // No finished check means no score at all: count it as nothing added.
  return buildThreatAssessment(signals).threatInfo?.score ?? 0;
}

const invalidCert = ssl({ validationState: "invalid" });
const harmlessVt = vt({ harmless: 60, lastAnalysisDate: daysAgo(30) });

const SCENARIOS: Record<string, Scenario[]> = {
  gsb: [
    { add: gsb("MALWARE"), points: 62 },
    { add: gsb("MALWARE", "SOCIAL_ENGINEERING"), points: 68, stated: false },
    {
      add: gsb("MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"),
      points: 74,
    },
    {
      add: gsb(
        "MALWARE",
        "SOCIAL_ENGINEERING",
        "UNWANTED_SOFTWARE",
        "POTENTIALLY_HARMFUL_APPLICATION",
      ),
      points: 74,
    },
  ],
  "feed-url": [
    {
      add: feed({ feed: "urlhaus", confidence: "high", matchType: "url" }),
      points: 55,
    },
    {
      add: feed({ feed: "openphish", confidence: "high", matchType: "url" }),
      points: 55,
    },
  ],
  "feed-host": [
    { add: feed({ feed: "urlhaus", matchType: "host" }), points: 25 },
    { add: feed({ feed: "openphish", matchType: "host" }), points: 25 },
  ],
  "threatfox-high": [
    { add: feed({ feed: "threatfox", confidence: "high" }), points: 55 },
  ],
  "threatfox-medium": [
    { add: feed({ feed: "threatfox", confidence: "medium" }), points: 40 },
  ],
  "threatfox-elsewhere": [
    {
      add: feed({
        feed: "threatfox",
        confidence: "high",
        listedElsewhereOnHost: true,
      }),
      points: 25,
    },
  ],
  // Spamhaus and SURBL wording is `lib/server/providers/dnsbl.ts`'s.
  "dbl-high": [
    {
      add: feed({
        feed: "spamhaus-dbl",
        confidence: "high",
        detail: "lists this domain as a phishing domain",
      }),
      points: 45,
    },
  ],
  "dbl-spam": [
    {
      add: feed({
        feed: "spamhaus-dbl",
        detail: "lists this domain as a spam domain",
      }),
      points: 25,
    },
  ],
  "dbl-abused": [
    {
      add: feed({
        feed: "spamhaus-dbl",
        detail: "lists this domain as a legitimate domain that has been abused",
      }),
      points: 15,
    },
  ],
  "surbl-high": [
    {
      add: feed({
        feed: "surbl",
        confidence: "high",
        detail: "lists this domain for phishing",
      }),
      points: 35,
    },
  ],
  "surbl-abused": [
    {
      add: feed({ feed: "surbl", detail: "lists this domain as abused" }),
      points: 20,
    },
  ],
  "vt-malicious-few": [
    { add: vt({ malicious: 1 }), points: 12 },
    { add: vt({ malicious: 2 }), points: 22 },
    { add: vt({ malicious: 3 }), points: 32 },
    { add: vt({ malicious: 4 }), points: 42 },
  ],
  "vt-malicious-many": [
    { add: vt({ malicious: 5 }), points: 55 },
    { add: vt({ malicious: 6 }), points: 60, stated: false },
    { add: vt({ malicious: 11 }), points: 85 },
    { add: vt({ malicious: 40 }), points: 85 },
  ],
  "vt-suspicious": [
    { add: vt({ suspicious: 1 }), points: 4 },
    { add: vt({ suspicious: 3 }), points: 12, stated: false },
    { add: vt({ suspicious: 4 }), points: 16 },
    { add: vt({ suspicious: 9 }), points: 16 },
  ],

  "ml-malicious": [
    { add: ml("malicious", 1), points: 45 },
    { add: ml("malicious", 0.8), points: 36, stated: false },
    { add: ml("malicious", 0.1), points: 25 },
  ],
  "ml-risky": [
    { add: ml("risky", 1), points: 16 },
    { add: ml("risky", 0.5), points: 8, stated: false },
  ],
  "cert-invalid": [{ add: invalidCert, points: 28 }],
  "cert-untrusted": [
    {
      add: ssl({ validationState: "untrusted", selfSigned: true }),
      points: 26,
    },
  ],
  "cert-fresh": [
    { base: whois(10), add: ssl({ validFrom: daysAgo(2) }), points: 12 },
    {
      base: whois(10),
      add: ssl({ validFrom: daysAgo(7) }),
      points: 0,
      stated: false,
    },
    {
      base: whois(30),
      add: ssl({ validFrom: daysAgo(2) }),
      points: 0,
      stated: false,
    },
  ],
  "age-month": [
    { add: whois(0), points: 15 },
    { add: whois(29), points: 15 },
  ],
  "age-young": [
    { add: whois(30), points: 8 },
    { add: whois(179), points: 8 },
    { add: whois(180), points: 0, stated: false },
  ],
  "dns-punycode": [
    { add: dns("The hostname uses punycode encoding."), points: 8 },
  ],
  "dns-addresses": [
    {
      add: dns(
        "The hostname resolves to an unusually high number of address records.",
      ),
      points: 4,
    },
  ],
  "redirect-hops": [
    { add: redirect({ totalHops: 3 }), points: 8 },
    { add: redirect({ totalHops: 2 }), points: 0, stated: false },
  ],
  "redirect-http": [
    {
      add: redirect({
        totalHops: 1,
        finalUrl: "http://site.com/",
        hops: [
          {
            url: "https://site.com/",
            status: 301,
            location: "http://site.com/",
          },
        ],
      }),
      points: 10,
    },
  ],
  "redirect-cross": [
    {
      add: redirect({
        totalHops: 1,
        finalUrl: "https://landing-page.com/",
        hops: [
          {
            url: "https://short-link.com/x",
            status: 301,
            location: "https://landing-page.com/",
          },
        ],
      }),
      points: 14,
    },
  ],
  "page-password": [
    {
      add: page({
        passwordInputCount: 1,
        crossOriginPasswordFormHosts: ["collect.com"],
      }),
      points: 20,
    },
  ],
  "page-obfuscation": [
    { add: page({ obfuscationHints: ["eval", "atob"] }), points: 10 },
    { add: page({ obfuscationHints: ["eval"] }), points: 0, stated: false },
  ],
  "page-iframes": [
    { add: page({ hiddenIframeCount: 1, iframeCount: 1 }), points: 8 },
    { add: page({ iframeCount: 3 }), points: 8 },
    { add: page({ iframeCount: 2 }), points: 0, stated: false },
  ],
  "page-refresh": [
    {
      add: page({ metaRefreshTarget: "https://elsewhere.com/" }),
      points: 8,
    },
  ],

  "vt-harmless": [
    { base: invalidCert, add: harmlessVt, points: -10 },
    {
      base: invalidCert,
      add: vt({ harmless: 59, lastAnalysisDate: daysAgo(1) }),
      points: 0,
      stated: false,
    },
    {
      base: invalidCert,
      add: vt({ harmless: 60, lastAnalysisDate: daysAgo(31) }),
      points: 0,
      stated: false,
    },
  ],
  "domain-history": [
    { base: invalidCert, add: whois(365 * 5), points: -8 },
    {
      base: invalidCert,
      add: whois(365 * 5, { subdomainOf: "example.com" }),
      points: 0,
      stated: false,
    },
    {
      base: invalidCert,
      add: whois(365 * 5, { sharedPlatform: true }),
      points: 0,
      stated: false,
    },
  ],
};

const rows = SCORING_TABLES.flatMap((table) =>
  table.rows.map((row) => ({ ...row, table: table.id })),
);

function statesNumber(text: string, points: number) {
  const sign = points < 0 ? "−" : "";
  return new RegExp(`(^|[^\\d])${sign}${Math.abs(points)}(?!\\d)`).test(text);
}

describe("/about scoring tables", () => {
  it("has engine scenarios for exactly the rows it prints", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(
      rows.map((row) => row.id).sort(),
    );
  });

  it.each(rows)("$id: the engine adds what the page says", (row) => {
    for (const scenario of SCENARIOS[row.id] ?? []) {
      const base = scenario.base ?? (() => {});
      expect(scoreOf(base, scenario.add) - scoreOf(base)).toBe(scenario.points);
      if (scenario.stated !== false) {
        expect(statesNumber(row.points, scenario.points)).toBe(true);
      }
    }
  });

  it("marks exactly the rows that convict on their own", () => {
    for (const row of rows) {
      const scenarios = SCENARIOS[row.id] ?? [];
      const alone = scenarios.map((scenario) => scoreOf(scenario.add));
      if (row.convicts) {
        expect(alone.every((score) => score >= CONVICTS_AT)).toBe(true);
      } else {
        expect(alone.every((score) => score < CONVICTS_AT)).toBe(true);
      }
    }
    expect(threatScoreToVerdict(CONVICTS_AT)).toBe("malicious");
    expect(threatScoreToVerdict(CONVICTS_AT - 1)).toBe("suspicious");
  });

  it("caps every check of the link itself at the stated maximum", () => {
    const linkPoints = rows
      .filter((row) => row.table === "link")
      .flatMap((row) => SCENARIOS[row.id] ?? [])
      .map((scenario) => scenario.points);
    expect(Math.max(...linkPoints)).toBe(LINK_CHECK_MAX);
    expect(LINK_CHECK_MAX).toBeLessThan(CONVICTS_AT);
  });
});

describe("/about rules", () => {
  it("switches both discounts off at the stated single-finding size", () => {
    const listedAt45 = feed({
      feed: "spamhaus-dbl",
      confidence: "high",
      detail: "lists this domain as a phishing domain",
    });
    const modelAt44 = ml("malicious", 0.98);
    expect(scoreOf(listedAt45)).toBe(DISCOUNTS_OFF_AT);
    expect(scoreOf(modelAt44)).toBe(DISCOUNTS_OFF_AT - 1);

    expect(scoreOf(listedAt45, harmlessVt)).toBe(DISCOUNTS_OFF_AT);
    expect(scoreOf(modelAt44, harmlessVt)).toBe(DISCOUNTS_OFF_AT - 1 - 10);
    expect(scoreOf(modelAt44, whois(365 * 5))).toBe(DISCOUNTS_OFF_AT - 1 - 8);
  });

  it("switches the domain-age discount off when any list flagged the link", () => {
    expect(scoreOf(invalidCert, vt({ suspicious: 1 }), whois(365 * 5))).toBe(
      28 + 4,
    );
  });

  it("states the score bands the engine uses", () => {
    expect(SCORE_BANDS[0]?.min).toBe(0);
    expect(SCORE_BANDS.at(-1)?.max).toBe(100);
    SCORE_BANDS.forEach((band, index) => {
      expect(threatScoreToVerdict(band.min)).toBe(band.verdict);
      expect(threatScoreToVerdict(band.max)).toBe(band.verdict);
      const next = SCORE_BANDS[index + 1];
      if (next) expect(next.min).toBe(band.max + 1);
    });
  });
});

describe("/about confidence", () => {
  it("states the cut-offs between the confidence words", () => {
    expect(scoreToConfidenceLabel(CONFIDENCE.high / 100)).toBe("high");
    expect(scoreToConfidenceLabel((CONFIDENCE.high - 1) / 100)).toBe(
      "moderate",
    );
    expect(scoreToConfidenceLabel(CONFIDENCE.moderate / 100)).toBe("moderate");
    expect(scoreToConfidenceLabel((CONFIDENCE.moderate - 1) / 100)).toBe("low");
  });

  it("caps a Safe result at the stated figures when major lists are missing", async () => {
    const clean = await fixtureSignals("example.com");
    const full = buildThreatAssessment(clean);
    expect(full.verdict).toBe("safe");
    expect(full.threatInfo?.confidenceLabel).toBe("high");

    // Unconfigured, not failed: the most a Safe result can have with a
    // list missing, so the cap is what binds.
    const skipped = {
      status: "skipped" as const,
      error: "Not configured.",
      durationMs: 0,
      data: null,
    };
    const oneMissing = { ...clean, virusTotal: skipped };
    const one = buildThreatAssessment(oneMissing).threatInfo;
    expect(one?.confidence).toBe(CONFIDENCE.safeOneListMissing / 100);
    expect(one?.confidenceLabel).not.toBe("high");

    const two = buildThreatAssessment({
      ...oneMissing,
      googleSafeBrowsing: skipped,
    }).threatInfo;
    expect(two?.confidence).toBeLessThanOrEqual(
      CONFIDENCE.safeListsMissing / 100,
    );
    expect(two?.confidenceLabel).not.toBe("high");
  });

  it("stops Unknown at the stated cap", async () => {
    const unknown = buildThreatAssessment(
      await fixtureSignals("unreachable.scrutinix.test"),
    );
    expect(unknown.verdict).toBe("unknown");
    expect(unknown.threatInfo?.confidence).toBeLessThanOrEqual(
      CONFIDENCE.unknown / 100,
    );
    expect(unknown.threatInfo?.confidenceLabel).toBe("low");
  });
});
