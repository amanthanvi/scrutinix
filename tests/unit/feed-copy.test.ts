import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getSignalDetailEntries,
  getSignalFinding,
  getSignalSummary,
} from "@/components/shared/signal-utils";
import { formatAge } from "@/lib/domain/copy";
import {
  describeFeedFinding,
  describeFeedMatch,
  describeSafeBrowsingThreat,
  feedDisplayName,
  feedDisplayNames,
  humanizeThreatType,
  isElsewhereOnHost,
  safeBrowsingThreatNames,
  threatIndicatorPhrase,
  type FeedMatch,
} from "@/lib/domain/feed-copy";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import {
  createPendingSignalResults,
  type SignalResults,
} from "@/lib/domain/types";

function match(
  feed: FeedMatch["feed"],
  detail: string,
  matchType: FeedMatch["matchType"] = "url",
): FeedMatch {
  return {
    feed,
    matchedUrl: "https://evil.example/",
    detail,
    confidence: "high",
    matchType,
  };
}

/** Every `detail` the current providers can produce. */
const CURRENT_DETAILS: FeedMatch[] = [
  match("openphish", "lists this exact link as phishing"),
  match("openphish", "lists a different link on this host as phishing", "host"),
  match("urlhaus", "lists this link as a malware download"),
  match("urlhaus", "lists this link as malware (online)"),
  match("urlhaus", "lists this link as malware"),
  match("urlhaus", "lists 1 malware link on this host", "host"),
  match("urlhaus", "lists 12 malware links on this host", "host"),
  match("urlhaus", "lists this link as active malware distribution"),
  match(
    "threatfox",
    `lists this link as ${threatIndicatorPhrase("payload_delivery", "AgentTesla")}`,
  ),
  match(
    "threatfox",
    `lists this host as ${threatIndicatorPhrase("botnet_cc", null)}`,
    "host",
  ),
  match(
    "threatfox",
    `lists another link on this host as ${threatIndicatorPhrase("payload", "Stealer")}`,
    "host",
  ),
  match("threatfox", `lists this link as ${threatIndicatorPhrase(null, null)}`),
  match("spamhaus-dbl", "lists this domain as a spam domain", "host"),
  match("spamhaus-dbl", "lists this domain as a phishing domain", "host"),
  match("spamhaus-dbl", "lists this domain as a malware domain", "host"),
  match(
    "spamhaus-dbl",
    "lists this domain as a botnet command-and-control domain",
    "host",
  ),
  match(
    "spamhaus-dbl",
    "lists this domain as a legitimate domain that has been abused",
    "host",
  ),
  match("surbl", "lists this domain for phishing", "host"),
  match("surbl", "lists this domain for malware", "host"),
  match("surbl", "lists this domain for cracked software", "host"),
  match("surbl", "lists this domain as abused", "host"),
];

/** Free-form strings stored in cached results and history before the contract. */
const LEGACY_DETAILS: FeedMatch[] = [
  match("openphish", "listed in the OpenPhish community feed"),
  match(
    "openphish",
    "hostname appears in the OpenPhish community feed (different path)",
    "host",
  ),
  match("urlhaus", "listed in URLhaus"),
  match("urlhaus", "malware_download"),
  match("urlhaus", "online"),
  match("urlhaus", "host has 12 malware URL listings in URLhaus", "host"),
  match("urlhaus", "listed as active malware distribution"),
  match("urlhaus", "listed"),
  match("threatfox", "payload_delivery indicator for AgentTesla in ThreatFox"),
  match(
    "threatfox",
    "host has another URL listed as a payload_delivery indicator in ThreatFox",
    "host",
  ),
  match("spamhaus-dbl", "listed as a phishing domain by Spamhaus DBL", "host"),
  match(
    "spamhaus-dbl",
    "listed by Spamhaus DBL as an abused legitimate domain",
    "host",
  ),
  match("surbl", "listed as phishing by SURBL", "host"),
];

function expectGrammatical(sentence: string, feed: FeedMatch["feed"]) {
  const name = feedDisplayNames[feed];
  expect(sentence.startsWith(`${name} `)).toBe(true);
  expect(sentence.endsWith(".")).toBe(true);
  expect(sentence.endsWith("..")).toBe(false);
  // The D1 bug: "openphish listed the URL as listed in the OpenPhish feed."
  expect(sentence).not.toMatch(/\blist(ed|s)\b.*\blist(ed|s)\b/i);
  // The feed is named once, by its proper name.
  expect(sentence.split(name).length - 1).toBe(1);
  expect(sentence).not.toMatch(/\b(openphish|urlhaus|threatfox|surbl)\b/);
  expect(sentence).not.toMatch(/spamhaus-dbl/);
  expect(sentence).not.toMatch(/_/);
  expect(sentence).not.toMatch(/\s{2,}/);
}

describe("feed display names", () => {
  it("maps every feed id to its proper name", () => {
    expect(feedDisplayName("urlhaus")).toBe("URLhaus");
    expect(feedDisplayName("openphish")).toBe("OpenPhish");
    expect(feedDisplayName("threatfox")).toBe("ThreatFox");
    expect(feedDisplayName("spamhaus-dbl")).toBe("Spamhaus DBL");
    expect(feedDisplayName("surbl")).toBe("SURBL");
  });

  it("humanizes abuse.ch threat types", () => {
    expect(humanizeThreatType("botnet_cc")).toBe("botnet command-and-control");
    expect(humanizeThreatType("payload_delivery")).toBe("malware delivery");
    expect(humanizeThreatType("something_new")).toBe("something new");
  });
});

describe("describeFeedMatch", () => {
  it.each(CURRENT_DETAILS.map((item) => [item.detail, item] as const))(
    "reads as one sentence for the current detail %s",
    (_detail, item) => {
      expectGrammatical(describeFeedMatch(item), item.feed);
    },
  );

  it.each(LEGACY_DETAILS.map((item) => [item.detail, item] as const))(
    "rewrites the legacy detail %s instead of stacking it",
    (_detail, item) => {
      expectGrammatical(describeFeedMatch(item), item.feed);
    },
  );

  it("produces the expected sentences for representative listings", () => {
    expect(
      describeFeedMatch(
        match("openphish", "lists this exact link as phishing"),
      ),
    ).toBe("OpenPhish lists this exact link as phishing.");
    expect(
      describeFeedMatch(
        match("openphish", "listed in the OpenPhish community feed"),
      ),
    ).toBe("OpenPhish lists this link.");
    expect(
      describeFeedMatch(
        match(
          "spamhaus-dbl",
          "listed as a phishing domain by Spamhaus DBL",
          "host",
        ),
      ),
    ).toBe("Spamhaus DBL lists this host as a phishing domain.");
    expect(
      describeFeedFinding(
        match("urlhaus", "lists this link as a malware download"),
      ),
    ).toBe("Lists this link as a malware download.");
  });

  it("is what the verdict engine uses as the feed reason", () => {
    for (const item of [...CURRENT_DETAILS, ...LEGACY_DETAILS]) {
      const signals = createPendingSignalResults();
      signals.threatFeeds = {
        status: "success",
        error: null,
        durationMs: 5,
        data: {
          checkedAt: "2026-10-06T00:00:00.000Z",
          matches: [item],
          observations: [],
          warnings: [],
        },
      };

      const reasons = buildThreatAssessment(signals).threatInfo?.reasons ?? [];
      expect(reasons).toContain(describeFeedMatch(item));
      for (const reason of reasons) {
        expect(reason).not.toMatch(/\blisted\b.*\blisted\b/i);
      }
    }
  });
});

describe("provider detail contract", () => {
  // Guards the D1 regression at its source: a provider that starts writing
  // "listed ..." again would double the verb once the feed name is added.
  const providerFiles = [
    "lib/server/providers/dnsbl.ts",
    "lib/server/providers/openphish-feed.ts",
    "lib/server/providers/threat-feeds.ts",
    "lib/server/providers/threatfox.ts",
    "lib/server/test-fixtures.ts",
  ];

  it("writes every literal detail as a clause that follows the feed name", () => {
    const details: string[] = [];
    for (const file of providerFiles) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const found of source.matchAll(/detail:\s*["`]([^"`]+)["`]/g)) {
        details.push(found[1] ?? "");
      }
      for (const found of source.matchAll(
        /\["127\.[\d.]+",\s*"([^"]+)",\s*"(?:medium|high)"\]/g,
      )) {
        details.push(found[1] ?? "");
      }
    }

    expect(details.length).toBeGreaterThanOrEqual(12);
    for (const detail of details) {
      expect(detail).toMatch(/^(lists|reports)\b/);
      expect(detail).not.toMatch(
        /\b(URLhaus|OpenPhish|ThreatFox|Spamhaus|SURBL)\b/,
      );
    }
  });
});

function feedSignals(matches: FeedMatch[]): SignalResults {
  const signals = createPendingSignalResults();
  signals.threatFeeds = {
    status: "success",
    error: null,
    durationMs: 5,
    data: { checkedAt: "", matches, observations: [], warnings: [] },
  };
  return signals;
}

describe("listings of other links on the same host", () => {
  const elsewhere: FeedMatch[] = [
    match(
      "openphish",
      "lists a different link on this host as phishing",
      "host",
    ),
    match("urlhaus", "lists 12 malware links on this host", "host"),
    {
      ...match(
        "threatfox",
        `lists another link on this host as ${threatIndicatorPhrase("payload", "Stealer")}`,
        "host",
      ),
      listedElsewhereOnHost: true,
    },
  ];

  it("never reads as if this link were listed", () => {
    for (const item of elsewhere) {
      expect(isElsewhereOnHost(item)).toBe(true);
      const signals = feedSignals([item]);
      const info = buildThreatAssessment(signals).threatInfo;

      expect(info?.summary).not.toMatch(/flagged this link/);
      expect(info?.summary).toMatch(
        /^Another link on this site listed by .+ makes this link look risky\.$/,
      );
      const finding = getSignalSummary(
        "threatFeeds",
        signals.threatFeeds.data!,
      );
      expect(finding).not.toMatch(/^Listed by/);
      expect(finding).toBe(
        `No listing for this link; ${feedDisplayName(item.feed)} lists other links on this site.`,
      );
    }
  });

  it("separates a direct listing from a neighbour listing", () => {
    const signals = feedSignals([
      match("urlhaus", "lists this link as a malware download"),
      match(
        "openphish",
        "lists a different link on this host as phishing",
        "host",
      ),
    ]);
    expect(getSignalSummary("threatFeeds", signals.threatFeeds.data!)).toBe(
      "URLhaus lists this link as a malware download. OpenPhish lists other links on this site.",
    );
  });

  it("keeps DNSBL zones and ThreatFox host IOCs as direct listings", () => {
    const direct = [
      match("spamhaus-dbl", "lists this domain as a phishing domain", "host"),
      match("surbl", "lists this domain for phishing", "host"),
      match(
        "threatfox",
        `lists this host as ${threatIndicatorPhrase("botnet_cc", null)}`,
        "host",
      ),
    ];
    for (const item of direct) {
      expect(isElsewhereOnHost(item)).toBe(false);
      const signals = feedSignals([item]);
      expect(buildThreatAssessment(signals).threatInfo?.summary).toBe(
        `${feedDisplayName(item.feed)} flagged this link.`,
      );
      expect(getSignalSummary("threatFeeds", signals.threatFeeds.data!)).toBe(
        describeFeedMatch(item),
      );
    }
  });
});

describe("Google Safe Browsing wording", () => {
  const ENUM_TOKEN = /_|\b[A-Z]{2,}_?[A-Z]+\b/;
  const tokens = [...Object.keys(safeBrowsingThreatNames), "SOME_NEW_TYPE"];

  function gsbSignals(threatTypes: string[]): SignalResults {
    const signals = createPendingSignalResults();
    signals.googleSafeBrowsing = {
      status: "success",
      error: null,
      durationMs: 5,
      data: {
        checkedAt: "",
        matches: threatTypes.map((threatType) => ({
          threatType,
          platformType: "ANY_PLATFORM",
          threatEntryType: "URL",
        })),
      },
    };
    return signals;
  }

  it("never shows a raw API enum to people", () => {
    for (const token of tokens) {
      const signals = gsbSignals([token]);
      const finding = getSignalFinding(
        "googleSafeBrowsing",
        signals.googleSafeBrowsing,
      );
      const reasons = buildThreatAssessment(signals).threatInfo?.reasons ?? [];
      const labels = getSignalDetailEntries(
        "googleSafeBrowsing",
        signals.googleSafeBrowsing.data!,
      ).flatMap((entry) => [entry.label, entry.value]);

      for (const text of [finding, ...reasons, ...labels]) {
        expect(text).not.toMatch(ENUM_TOKEN);
      }
      expect(finding).toContain(describeSafeBrowsingThreat(token));
    }
  });

  it("says phishing for social engineering", () => {
    const signals = gsbSignals(["SOCIAL_ENGINEERING", "MALWARE"]);
    expect(
      getSignalFinding("googleSafeBrowsing", signals.googleSafeBrowsing),
    ).toBe(
      "Google lists this link for phishing or a deceptive site and malware.",
    );
    expect(buildThreatAssessment(signals).threatInfo?.reasons).toContain(
      "Google Safe Browsing lists this link for phishing or a deceptive site and malware.",
    );
    expect(describeSafeBrowsingThreat("SOME_NEW_TYPE")).toBe("some new type");
  });

  it("lowercases unknown abuse.ch threat types too", () => {
    expect(humanizeThreatType("NEW_THING")).toBe("new thing");
  });
});

describe("formatAge", () => {
  it("words ages the way people say them", () => {
    expect(formatAge(0)).toBe("less than a day");
    expect(formatAge(1)).toBe("1 day");
    expect(formatAge(59)).toBe("59 days");
    expect(formatAge(60)).toBe("about 2 months");
    expect(formatAge(100)).toBe("about 3 months");
    expect(formatAge(729)).toBe("about 24 months");
    expect(formatAge(730)).toBe("about 2 years");
    expect(formatAge(3_100)).toBe("about 8 years");
    expect(formatAge(365)).toBe("about 12 months");
  });
});
