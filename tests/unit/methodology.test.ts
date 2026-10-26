import { parse } from "tldts";
import { describe, expect, it } from "vitest";

import { splitLinkAnatomy } from "@/lib/domain/link-anatomy";
import {
  CONFIDENCE,
  CONVICTS_AT,
  DISCOUNTS_OFF_AT,
  LINK_CHECK_MAX,
  PATTERN_MODEL_EVALUATION,
  RULES,
  SCORE_BANDS,
  SCORING_TABLES,
} from "@/lib/domain/methodology";
import {
  THREATFOX_HIGH_CONFIDENCE,
  VT_CONVICTION_ENGINES,
  VT_STALE_ANALYSIS_DAYS,
} from "@/lib/domain/reputation";
import type {
  PageContentFindings,
  RedirectData,
  SSLData,
  ThreatFeedsData,
  VirusTotalData,
  WhoisData,
} from "@/lib/domain/schemas";
import { threatScoreToVerdict } from "@/lib/domain/score-bands";
import { isSharedPlatformHost } from "@/lib/domain/shared-platforms";
import {
  createPendingSignalResults,
  type SignalResults,
} from "@/lib/domain/types";
import {
  buildThreatAssessment,
  CONFIDENCE_POLICY,
  scoredFindings,
  scoreToConfidenceLabel,
} from "@/lib/domain/verdict";
import { MANY_ADDRESS_RECORDS } from "@/lib/server/signals/dns";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

/**
 * /about prints the scoring method from `lib/domain/methodology.ts`. Every
 * row runs through the real engine: `add` on top of `base` must move the
 * score by exactly `points`, including just past each threshold the row
 * names. Every number a row prints must be one it declares in `NUMBERS`,
 * so a changed weight, step, or threshold fails until page and engine
 * agree. The confidence section prints `CONFIDENCE_POLICY` itself.
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
    // "plus 6 for each further kind": 62 + 6.
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
        detail: "lists this domain as a low-reputation domain",
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
    // "plus 5 for each further engine": 55 + 5.
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
    // 45 × 0.9 = 40.5, rounded to 41; 45 × 0.55 = 24.75, rounded to 25.
    { add: ml("malicious", 0.9), points: 41, stated: false },
    { add: ml("malicious", 0.55), points: 25 },
    // 45 × 0.1 = 4.5, rounded to 5, but at least 25.
    { add: ml("malicious", 0.1), points: 25 },
  ],
  "ml-risky": [
    { add: ml("risky", 1), points: 16 },
    { add: ml("risky", 0.5), points: 8, stated: false },
    { add: ml("risky", 0.03), points: 0, stated: false },
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
    { base: whois(29), add: ssl({ validFrom: daysAgo(6.5) }), points: 12 },
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
    {
      // A relative location on a plain-HTTP hop stays on HTTP too.
      add: redirect({
        totalHops: 1,
        finalUrl: "http://site.com/b",
        hops: [{ url: "http://site.com/a", status: 301, location: "/b" }],
      }),
      points: 10,
    },
    {
      // A response that doesn't redirect isn't one, whatever its Location.
      add: redirect({
        totalHops: 0,
        finalUrl: "http://site.com/a",
        hops: [{ url: "http://site.com/a", status: 200, location: "/b" }],
      }),
      points: 0,
      stated: false,
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
      add: vt({ harmless: 60, lastAnalysisDate: daysAgo(30.9) }),
      points: -10,
    },
    // "(or has no date)": a missing or unreadable date doesn't count as old.
    { base: invalidCert, add: vt({ harmless: 60 }), points: -10 },
    {
      base: invalidCert,
      add: vt({ harmless: 60, lastAnalysisDate: "not a date" }),
      points: -10,
    },
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
    {
      base: invalidCert,
      add: vt({ harmless: 80, suspicious: 1, lastAnalysisDate: daysAgo(1) }),
      // The suspicious engine adds 4; no discount.
      points: 4,
      stated: false,
    },
  ],
  "domain-history": [
    { base: invalidCert, add: whois(365 * 5), points: -8 },
    { base: invalidCert, add: whois(365 * 5 - 1), points: 0, stated: false },
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

/**
 * Every number each row prints, in the order it prints them (finding, then
 * points), so a changed figure or two thresholds swapped fail here; a
 * changed figure in the engine fails its scenario above. Thresholds are
 * written as digits for this reason.
 */
const NUMBERS: Record<string, number[]> = {
  gsb: [62, 6, 74],
  "feed-url": [55],
  "feed-host": [25],
  "threatfox-high": [THREATFOX_HIGH_CONFIDENCE, 55],
  "threatfox-medium": [40],
  "threatfox-elsewhere": [25],
  "dbl-high": [45],
  "dbl-spam": [25],
  "dbl-abused": [15],
  "surbl-high": [35],
  "surbl-abused": [20],
  "vt-malicious-few": [1, VT_CONVICTION_ENGINES - 1, 12, 22, 32, 42],
  "vt-malicious-many": [VT_CONVICTION_ENGINES, 55, 5, 85],
  "vt-suspicious": [4, 16],
  "ml-malicious": [45, 0, 1, 25],
  "ml-risky": [16],
  "cert-invalid": [28],
  "cert-untrusted": [26],
  "cert-fresh": [7, 30, 12],
  "age-month": [30, 15],
  "age-young": [30, 179, 8],
  "dns-punycode": [8],
  // The threshold, "IPv4 or IPv6" (per family, not a threshold), then points.
  "dns-addresses": [MANY_ADDRESS_RECORDS, 4, 6, 4],
  "redirect-hops": [3, 8],
  "redirect-http": [10],
  "redirect-cross": [14],
  "page-password": [20],
  "page-obfuscation": [2, 10],
  "page-iframes": [3, 8],
  "page-refresh": [8],
  "vt-harmless": [60, 30, 10],
  "domain-history": [5, 8],
};

const rows = SCORING_TABLES.flatMap((table) =>
  table.rows.map((row) => ({ ...row, table: table.id })),
);

function printedNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe("/about scoring tables", () => {
  it("has engine scenarios and declared numbers for exactly the rows it prints", () => {
    const ids = rows.map((row) => row.id).sort();
    expect(Object.keys(SCENARIOS).sort()).toEqual(ids);
    expect(Object.keys(NUMBERS).sort()).toEqual(ids);
  });

  it.each(rows)(
    "$id prints exactly the numbers it declares, in order",
    (row) => {
      expect(printedNumbers(`${row.finding} ${row.points}`)).toEqual(
        NUMBERS[row.id],
      );
    },
  );

  it.each(rows)("$id: the engine adds what the page says", (row) => {
    for (const scenario of SCENARIOS[row.id] ?? []) {
      const base = scenario.base ?? (() => {});
      expect(scoreOf(base, scenario.add) - scoreOf(base)).toBe(scenario.points);
      if (scenario.stated !== false) {
        expect(NUMBERS[row.id]).toContain(Math.abs(scenario.points));
        expect(row.points.startsWith("−")).toBe(scenario.points < 0);
      }
    }
  });

  it("marks exactly the rows that convict on their own", () => {
    for (const row of rows) {
      const alone = (SCENARIOS[row.id] ?? []).map((scenario) =>
        scoreOf(scenario.add),
      );
      expect(alone.every((score) => score >= CONVICTS_AT)).toBe(
        Boolean(row.convicts),
      );
      if (!row.convicts) {
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

  it("calls weak signs exactly the findings the engine weighs as weak", () => {
    for (const row of rows.filter((row) => row.table !== "discounts")) {
      for (const scenario of SCENARIOS[row.id] ?? []) {
        if (scenario.points <= 0) continue;
        const signals = createPendingSignalResults();
        all(scenario.base ?? (() => {}), scenario.add)(signals);
        const before = createPendingSignalResults();
        (scenario.base ?? (() => {}))(before);
        // What the row's finding added: everything not already in the base.
        const remaining = [...scoredFindings(before)];
        const added = scoredFindings(signals).filter((finding) => {
          const index = remaining.findIndex(
            (existing) =>
              existing.signal === finding.signal &&
              existing.category === finding.category &&
              existing.score === finding.score &&
              existing.quality === finding.quality,
          );
          if (index === -1) return true;
          remaining.splice(index, 1);
          return false;
        });
        expect(added.length).toBeGreaterThan(0);
        for (const finding of added) {
          expect([row.id, finding.quality === "low"]).toEqual([
            row.id,
            Boolean(row.weak),
          ]);
        }
      }
    }
  });

  it("names real shared platforms and a real provider threshold", () => {
    // The provider-level filter itself is covered by
    // tests/integration/threat-feeds-provider.test.ts.
    expect(isSharedPlatformHost("github.com")).toBe(true);
    expect(isSharedPlatformHost("docs.google.com")).toBe(true);
    const lists = SCORING_TABLES.find((table) => table.id === "lists");
    expect(lists?.notes.join(" ")).toContain("github.com or docs.google.com");
  });

  it("states the link pattern model's measured bar, and only that", () => {
    const link = SCORING_TABLES.find((table) => table.id === "link");
    const note = link?.notes.find((text) =>
      text.startsWith("The link pattern model"),
    );
    // The bar itself is in the model's own units; the page states what it
    // flagged at that bar, per kind of link (lib/server/ml/model/README.md).
    // tests/unit/local-classifier.test.ts holds the bar to the one these
    // figures were measured at, and checks a sample against the real model.
    expect(printedNumbers(note ?? "")).toEqual([
      PATTERN_MODEL_EVALUATION.sitesPer100,
      100,
      PATTERN_MODEL_EVALUATION.shortLinksPer100,
      100,
      PATTERN_MODEL_EVALUATION.accountLinksPer100,
      100,
      PATTERN_MODEL_EVALUATION.phishingPer100,
      100,
    ]);
    expect(note).toContain("with and without https:// and www.");
    expect(note).toContain("not what follows a ? or #");
  });
});

describe("/about rules", () => {
  it("prints the engine's thresholds in the rules", () => {
    expect(RULES.map((rule) => printedNumbers(rule.text))).toEqual([
      [CONVICTS_AT, THREATFOX_HIGH_CONFIDENCE, VT_CONVICTION_ENGINES],
      [DISCOUNTS_OFF_AT],
      [],
      [],
    ]);
  });

  it("switches both discounts off at the stated single-finding size", () => {
    const listedAt45 = feed({
      feed: "spamhaus-dbl",
      confidence: "high",
      detail: "lists this domain as a phishing domain",
    });
    const modelAt45 = ml("malicious", 1);
    const modelAt44 = ml("malicious", 0.98);
    expect(scoreOf(listedAt45)).toBe(DISCOUNTS_OFF_AT);
    expect(scoreOf(modelAt45)).toBe(DISCOUNTS_OFF_AT);
    expect(scoreOf(modelAt44)).toBe(DISCOUNTS_OFF_AT - 1);

    expect(scoreOf(listedAt45, harmlessVt)).toBe(DISCOUNTS_OFF_AT);
    expect(scoreOf(modelAt45, whois(365 * 5))).toBe(DISCOUNTS_OFF_AT);
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

  it("recognises the look-alike the page shows, and not what it says it skips", () => {
    const impersonates = (url: string) =>
      splitLinkAnatomy(parse, url)?.impersonates ?? null;
    expect(impersonates("https://paypal.com.secure-login.xyz/")).toBe(
      "paypal.com",
    );
    expect(impersonates("https://paypal.co.uk.secure-login.xyz/")).toBe(
      "paypal.co.uk",
    );
    expect(impersonates("https://paypal.com@secure-login.xyz/")).toBe(
      "paypal.com",
    );
    // Not every name, and never the page part.
    expect(impersonates("https://paypal.app.secure-login.xyz/")).toBeNull();
    expect(impersonates("https://example.com/paypal.com")).toBeNull();
  });
});

describe("/about confidence", () => {
  it("prints the engine's own cut-offs", () => {
    expect(CONFIDENCE.high).toBe("85");
    expect(CONFIDENCE.moderate).toBe("50");
    const { labels } = CONFIDENCE_POLICY;
    expect(scoreToConfidenceLabel(labels.high)).toBe("high");
    expect(scoreToConfidenceLabel(labels.high - 0.01)).toBe("moderate");
    expect(scoreToConfidenceLabel(labels.moderate)).toBe("moderate");
    expect(scoreToConfidenceLabel(labels.moderate - 0.01)).toBe("low");
  });

  it("caps a Safe result when a major list is missing or answers only in part", async () => {
    const clean = await fixtureSignals("example.com");
    const full = buildThreatAssessment(clean);
    expect(full.verdict).toBe("safe");
    expect(full.threatInfo?.confidenceLabel).toBe("high");

    // Unconfigured, not failed: the most a Safe result can have with a list
    // missing, so the cap is what binds.
    const skipped = {
      status: "skipped" as const,
      error: "Not configured.",
      durationMs: 0,
      data: null,
    };
    const one = buildThreatAssessment({ ...clean, virusTotal: skipped });
    expect(one.threatInfo?.confidence).toBe(
      CONFIDENCE_POLICY.caps.safeOneListMissing,
    );
    expect(one.threatInfo?.confidenceLabel).not.toBe("high");

    const feeds = clean.threatFeeds;
    if (feeds.status !== "success" || !feeds.data) throw new Error("fixture");
    const partial = buildThreatAssessment({
      ...clean,
      threatFeeds: {
        ...feeds,
        data: { ...feeds.data, warnings: ["One feed didn't answer."] },
      },
    });
    expect(partial.threatInfo?.confidence).toBe(
      CONFIDENCE_POLICY.caps.safeOneListMissing,
    );

    const two = buildThreatAssessment({
      ...clean,
      virusTotal: skipped,
      googleSafeBrowsing: skipped,
    });
    expect(two.threatInfo?.confidence).toBeLessThanOrEqual(
      CONFIDENCE_POLICY.caps.safeListsMissing,
    );
  });

  it("caps a Safe result on a stale VirusTotal analysis", async () => {
    const clean = await fixtureSignals("example.com");
    const vtSignal = clean.virusTotal;
    if (vtSignal.status !== "success" || !vtSignal.data) {
      throw new Error("fixture");
    }
    const stale = buildThreatAssessment({
      ...clean,
      virusTotal: {
        ...vtSignal,
        data: { ...vtSignal.data, lastAnalysisDate: daysAgo(31) },
      },
    });
    expect(stale.threatInfo?.confidence).toBe(
      CONFIDENCE_POLICY.caps.safeStaleVirusTotal,
    );
  });

  it("caps Unknown", async () => {
    const unknown = buildThreatAssessment(
      await fixtureSignals("unreachable.scrutinix.test"),
    );
    expect(unknown.verdict).toBe("unknown");
    expect(unknown.threatInfo?.confidence).toBeLessThanOrEqual(
      CONFIDENCE_POLICY.caps.unknown,
    );
    expect(unknown.threatInfo?.confidenceLabel).toBe("low");
  });

  it("prints each step's figure from its own policy field", () => {
    const policy = CONFIDENCE_POLICY;
    const pct = (share: number) => String(Math.round(share * 1000) / 10);
    const agreement = policy.modelAgreementShare;
    expect(CONFIDENCE.steps.map((row) => row.value)).toEqual([
      `${pct(policy.start)}%`,
      `+${pct(policy.perDataRichCheck)}`,
      `+${pct(policy.perThinCheck)}`,
      `+${pct(policy.perSkippedCheck)}`,
      `−${pct(policy.perFailedCheck)}`,
      `−${pct(policy.perLimitation)}, at most −${pct(policy.maxLimitations)} in all`,
      [agreement.agree, agreement.oneMember, agreement.disagree]
        .map((share) => `+${pct(policy.modelAgreement * share)}`)
        .join(" / "),
      `+${pct(policy.safe.perCleanList)}`,
      `−${pct(policy.safe.perMissingList)}`,
      `−${pct(policy.safe.noCleanList)}`,
      `+${pct(policy.risky.perFlaggingList)}`,
      `−${pct(policy.risky.perCleanList)}, at most −${pct(policy.risky.maxCleanLists)} in all`,
      `−${pct(policy.risky.perMissingList)}`,
      `+${pct(policy.risky.corroborated)}`,
    ]);
    expect(CONFIDENCE.steps.map((row) => printedNumbers(row.step))).toEqual([
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [policy.risky.corroboratedKinds, 30, 179],
    ]);
  });

  it("prints each cap from its own policy field", () => {
    const policy = CONFIDENCE_POLICY;
    const pct = (share: number) => Math.round(share * 1000) / 10;
    expect(CONFIDENCE.caps.map(printedNumbers)).toEqual([
      [
        pct(policy.caps.safeOneListMissing),
        policy.caps.manyListsMissing,
        pct(policy.caps.safeListsMissing),
      ],
      [VT_STALE_ANALYSIS_DAYS, pct(policy.caps.safeStaleVirusTotal)],
      [pct(policy.caps.unknown)],
      [pct(policy.floor), pct(policy.safeCeiling), pct(policy.riskyCeiling)],
    ]);
    // The two exceptions a review found missing: keep them stated.
    expect(CONFIDENCE.footnote).toContain(
      "not even with a shared-platform listing set aside",
    );
    expect(
      CONFIDENCE.steps.find((row) =>
        row.step.startsWith("Each check that finished without much"),
      )?.step,
    ).toContain("answered only in part and found nothing");
  });

  it("gives no clean-feed credit for a set-aside shared-platform listing, and full credit to a partial answer with a hit", async () => {
    // A risky result, so neither Safe's caps nor its 97% ceiling hide the
    // difference.
    const clean = await fixtureSignals("example.com");
    gsb("MALWARE")(clean);
    const feeds = clean.threatFeeds;
    if (feeds.status !== "success" || !feeds.data) throw new Error("fixture");
    const confidenceWith = (data: typeof feeds.data) =>
      buildThreatAssessment({ ...clean, threatFeeds: { ...feeds, data } })
        .threatInfo?.confidence ?? Number.NaN;
    const policy = CONFIDENCE_POLICY;

    // The footnote: with a listing set aside, the feeds didn't answer clean.
    expect(
      confidenceWith({ ...feeds.data, sharedPlatformListingsIgnored: true }) -
        confidenceWith(feeds.data),
    ).toBeCloseTo(policy.risky.perCleanList, 5);

    // The thin-check row: a partial answer is thin only when it found
    // nothing. With a hit it counts in full (and, being a second kind of
    // finding beside Google's, corroborates).
    const abused = {
      feed: "spamhaus-dbl" as const,
      matchedUrl: "example.com",
      detail: "lists this domain as a legitimate domain that has been abused",
      confidence: "medium" as const,
      matchType: "host" as const,
    };
    expect(
      confidenceWith({
        ...feeds.data,
        matches: [abused],
        warnings: ["Down."],
      }) - confidenceWith({ ...feeds.data, matches: [], warnings: ["Down."] }),
    ).toBeCloseTo(
      policy.perDataRichCheck - policy.perThinCheck + policy.risky.corroborated,
      5,
    );
  });
});
