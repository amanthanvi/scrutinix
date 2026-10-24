import { parse } from "tldts";
import { describe, expect, it } from "vitest";

import { registrableDomainOf } from "@/lib/domain/link-anatomy";
import { sanitizeHistoryEntry } from "@/lib/domain/runtime-safety";
import {
  getSummaryQuestions,
  questionCiting,
  questionSources,
  summaryQuestionIds,
  type SummaryQuestion,
  type SummaryQuestionId,
  type SummaryQuestionInput,
} from "@/lib/domain/summary-questions";
import {
  createPendingSignalResults,
  signalNames,
  type SignalResults,
} from "@/lib/domain/types";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import {
  cleanSignals,
  withDomainAge,
  withLureRedirect,
} from "@/tests/fixtures/lure-signals";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const registeredDomainOf = (host: string) => registrableDomainOf(parse, host);

/** The fixture's signals with its relative listing date pinned to NOW. */
async function scenario(host: string): Promise<SignalResults> {
  const signals = await fixtureSignals(host);
  for (const match of signals.threatFeeds.data?.matches ?? []) {
    if (match.listedAt) {
      match.listedAt = new Date(NOW - 6 * HOUR).toISOString();
    }
  }
  return signals;
}

function ask(
  signals: SignalResults,
  options: Partial<SummaryQuestionInput> = {},
): SummaryQuestion[] {
  return getSummaryQuestions({
    url: "https://example.com/",
    signals,
    threatInfo: buildThreatAssessment(signals).threatInfo,
    now: NOW,
    registeredDomainOf,
    ...options,
  });
}

function byId(questions: SummaryQuestion[], id: SummaryQuestionId) {
  const question = questions.find((entry) => entry.id === id);
  if (!question) throw new Error(`missing question ${id}`);
  return question;
}

/** [answer, why, disagreement] for each question, in order. */
function table(questions: SummaryQuestion[]) {
  return Object.fromEntries(
    questions.map((question) => [
      question.id,
      [question.answer, question.why, question.disagreement],
    ]),
  );
}

const CLEAN_DESTINATION = [
  "It opens this site directly, without redirects.",
  "Scam links often bounce through other sites to hide where they end.",
  null,
];
const CLEAN_CONCERN = [
  "The link pattern model and structure checks didn't flag it. Its domain was registered about 8 years ago.",
  "Age and wording are hints; they can't clear a link on their own.",
  null,
];
const VALID_HTTPS = [
  "No. The site has a valid certificate. This certificate was issued about 10 months ago.",
  "Encryption protects the connection, not your trust in the site.",
  null,
];
const FLAGGED_NETWORK =
  "Nothing unusual in its DNS records. Its address belongs to network AS64500 EXAMPLE-NET, registered in NL.";
const REPORTS_STAND = "These findings don't cancel the threat reports.";

describe("the fixture scenarios", () => {
  it("answers a clean link", async () => {
    const host = "example.com";
    const questions = ask(await scenario(host), { url: `https://${host}/` });
    expect(table(questions)).toEqual({
      reported: [
        "Not on any list we checked.",
        "Lists only know threats that someone has already reported.",
        null,
      ],
      destination: CLEAN_DESTINATION,
      concern: CLEAN_CONCERN,
      https: VALID_HTTPS,
      other: [
        "Nothing unusual in its DNS records. Its address belongs to network AS64496 FIXTURE-HOSTING, registered in US.",
        "Ordinary DNS is common to good and bad sites alike.",
        null,
      ],
    });
  });

  it("answers a VirusTotal conviction", async () => {
    const host = "malicious.scrutinix.test";
    const questions = ask(await scenario(host), { url: `https://${host}/` });
    expect(table(questions)).toEqual({
      reported: [
        "7 of 70 VirusTotal engines flag it as malicious and 2 as suspicious. Safe Browsing and the threat feeds have no match.",
        "Direct threat reports are a reason to stay away.",
        "Each source is kept separately, so one can catch a link the others haven't reached yet.",
      ],
      destination: CLEAN_DESTINATION,
      concern: CLEAN_CONCERN,
      https: VALID_HTTPS,
      other: [FLAGGED_NETWORK, REPORTS_STAND, null],
    });
  });

  it("answers a threat-feed listing, with its age", async () => {
    const host = "feed-hit.scrutinix.test";
    const questions = ask(await scenario(host), {
      url: `https://${host}/payload.exe`,
    });
    expect(table(questions)).toEqual({
      reported: [
        "URLhaus lists this link as active malware distribution (listed 6 hours ago). VirusTotal and Safe Browsing have no match.",
        "Direct threat reports are a reason to stay away.",
        "Lists often name a threat before VirusTotal's engines catch up.",
      ],
      destination: CLEAN_DESTINATION,
      concern: CLEAN_CONCERN,
      https: VALID_HTTPS,
      other: [FLAGGED_NETWORK, REPORTS_STAND, null],
    });
  });

  it("answers a critical result with every list agreeing", async () => {
    const host = "critical.scrutinix.test";
    const questions = ask(await scenario(host), { url: `https://${host}/` });
    expect(table(questions)).toEqual({
      reported: [
        "24 of 70 VirusTotal engines flag it as malicious and 4 as suspicious. Google Safe Browsing lists it for phishing or a deceptive site and malware. URLhaus lists this link as active malware distribution (listed 6 hours ago).",
        "Direct threat reports are a reason to stay away.",
        null,
      ],
      destination: CLEAN_DESTINATION,
      concern: CLEAN_CONCERN,
      https: VALID_HTTPS,
      other: [FLAGGED_NETWORK, REPORTS_STAND, null],
    });
  });

  it("answers an unreachable link honestly", async () => {
    const host = "unreachable.scrutinix.test";
    const signals = await scenario(host);
    expect(buildThreatAssessment(signals).verdict).toBe("unknown");
    const questions = ask(signals, { url: `https://${host}/` });
    expect(table(questions)).toEqual({
      reported: [
        "Not on any list we checked.",
        "Lists only know threats that someone has already reported.",
        null,
      ],
      destination: [
        "We couldn't reach the site, so we can't say where it leads.",
        "If we can't open the page, we can't vouch for it.",
        null,
      ],
      concern: CLEAN_CONCERN,
      https: [
        "No. We couldn't check the certificate.",
        "Even a valid certificate only protects the connection.",
        null,
      ],
      other: [
        "The name doesn't point to any server.",
        "A name that points nowhere can't be opened right now.",
        null,
      ],
    });
  });

  it("never repeats a look-alike's owner, which the anatomy states", async () => {
    const url = "https://paypal.com.secure-login.xyz/verify";
    const questions = ask(await scenario("paypal.com.secure-login.xyz"), {
      url,
    });
    const text = questions
      .map((question) => `${question.answer} ${question.why}`)
      .join(" ");
    expect(text).not.toMatch(
      /secure-login\.xyz|paypal|belongs to (?!network)|look-alike/i,
    );
    expect(byId(questions, "destination").answer).toBe(CLEAN_DESTINATION[0]);
  });
});

describe("the fixed mapping", () => {
  it("cites each of the eight checks in exactly one question", () => {
    const cited = summaryQuestionIds.flatMap((id) => [...questionSources[id]]);
    expect([...cited].sort()).toEqual([...signalNames].sort());
    for (const name of signalNames) {
      const citing = summaryQuestionIds.filter((id) =>
        (questionSources[id] as readonly string[]).includes(name),
      );
      expect(citing).toEqual([questionCiting(name)]);
    }
  });

  it("keeps sources in strip order and the questions in fixed order", () => {
    const questions = ask(cleanSignals());
    expect(questions.map((question) => question.id)).toEqual([
      "reported",
      "destination",
      "concern",
      "https",
      "other",
    ]);
    for (const question of questions) {
      const order = question.sources.map((name) => signalNames.indexOf(name));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("never lets the verdict engine's scored list move a check", () => {
    const signals = cleanSignals();
    const unscored = ask(signals, { threatInfo: { scoredSignals: [] } });
    const allScored = ask(signals, {
      threatInfo: { scoredSignals: [...signalNames] },
    });
    expect(allScored.map((question) => question.sources)).toEqual(
      unscored.map((question) => question.sources),
    );
  });

  it("changes no verdict or score", async () => {
    const signals = await scenario("feed-hit.scrutinix.test");
    const before = structuredClone(signals);
    const assessment = buildThreatAssessment(signals);
    ask(signals);
    expect(signals).toEqual(before);
    expect(buildThreatAssessment(signals)).toEqual(assessment);
  });
});

describe("pending questions", () => {
  it("are all pending before any check lands", () => {
    const questions = ask(createPendingSignalResults(), { threatInfo: null });
    for (const question of questions) {
      expect(question).toMatchObject({
        state: "pending",
        answer: null,
        why: null,
        disagreement: null,
      });
      expect(question.sources.length).toBeGreaterThan(0);
    }
  });

  it("settle as their own checks land, and wait for every one", () => {
    const clean = cleanSignals();
    const signals = createPendingSignalResults();
    signals.ssl = clean.ssl;
    signals.virusTotal = clean.virusTotal;
    signals.googleSafeBrowsing = clean.googleSafeBrowsing;

    const questions = ask(signals, { threatInfo: null });
    expect(byId(questions, "https").state).toBe("settled");
    // Two of its three lists answered: still waiting on the feeds.
    expect(byId(questions, "reported").state).toBe("pending");
    expect(byId(questions, "concern").state).toBe("pending");

    signals.threatFeeds = clean.threatFeeds;
    expect(byId(ask(signals, { threatInfo: null }), "reported")).toMatchObject({
      state: "settled",
      answer: "Not on any list we checked.",
    });
  });

  it("hold a disagreement until every check it compares has answered", () => {
    const clean = cleanSignals();
    withDomainAge(clean, 3);
    const signals = createPendingSignalResults();
    signals.virusTotal = clean.virusTotal;
    signals.googleSafeBrowsing = clean.googleSafeBrowsing;
    signals.threatFeeds = clean.threatFeeds;

    expect(
      byId(ask(signals, { threatInfo: null }), "reported").disagreement,
    ).toBeNull();
    signals.whois = clean.whois;
    expect(
      byId(ask(signals, { threatInfo: null }), "reported").disagreement,
    ).toMatch(/^Blocklists usually lag/);
  });
});

describe("disagreement sentences", () => {
  it("explains clean lists on a very new domain", () => {
    const signals = cleanSignals();
    withDomainAge(signals, 3);
    expect(byId(ask(signals), "reported").disagreement).toBe(
      "Blocklists usually lag new sites by a day or two; this one is 3 days old.",
    );

    withDomainAge(signals, 0);
    expect(byId(ask(signals), "reported").disagreement).toBe(
      "Blocklists usually lag new sites by a day or two; this one is less than a day old.",
    );

    withDomainAge(signals, 20);
    expect(byId(ask(signals), "reported").disagreement).toBe(
      "Blocklists can miss new sites; this one is only 20 days old.",
    );

    withDomainAge(signals, 100);
    expect(byId(ask(signals), "reported").disagreement).toBeNull();
  });

  it("explains a list hit while VirusTotal shows few or no engines", async () => {
    const signals = await scenario("feed-hit.scrutinix.test");
    const lag =
      "Lists often name a threat before VirusTotal's engines catch up.";
    const reported = byId(ask(signals), "reported");
    expect(reported.disagreement).toBe(lag);
    // The listing's age is stated once, in the answer.
    expect(reported.answer).toContain("(listed 6 hours ago)");
    expect(reported.disagreement).not.toMatch(/hour|listed/);
    // Reopened later, the age counts from now, like the Full row.
    expect(
      byId(ask(signals, { now: NOW + 3 * 24 * HOUR }), "reported").answer,
    ).toContain("(listed 3 days ago)");

    if (signals.virusTotal.data) signals.virusTotal.data.malicious = 2;
    expect(byId(ask(signals), "reported").disagreement).toBe(lag);

    if (signals.virusTotal.data) signals.virusTotal.data.malicious = 7;
    expect(byId(ask(signals), "reported").disagreement).toBeNull();
  });

  it("explains a Safe Browsing hit that VirusTotal hasn't caught", () => {
    const signals = cleanSignals();
    signals.googleSafeBrowsing.data = {
      checkedAt: "",
      matches: [
        {
          threatType: "SOCIAL_ENGINEERING",
          platformType: "ANY_PLATFORM",
          threatEntryType: "URL",
        },
      ],
    };
    expect(byId(ask(signals), "reported").disagreement).toBe(
      "Lists often name a threat before VirusTotal's engines catch up.",
    );
  });

  it("explains the link pattern model flagging a link every list passed", () => {
    const signals = cleanSignals();
    if (signals.mlEnsemble.data) {
      signals.mlEnsemble.data.consensusLabel = "risky";
      signals.mlEnsemble.data.lexicalModel.label = "risky";
    }
    const questions = ask(signals);
    expect(byId(questions, "concern").disagreement).toBe(
      "The link pattern model reads the link itself, so it can flag a new scam before any list does.",
    );
    expect(byId(questions, "reported").disagreement).toBeNull();

    // Said once: on a brand-new domain the lists-lag sentence covers it.
    withDomainAge(signals, 3);
    const young = ask(signals);
    expect(byId(young, "concern").disagreement).toBeNull();
    expect(byId(young, "reported").disagreement).toMatch(/^Blocklists/);

    // A feed that didn't answer didn't pass the link.
    withDomainAge(signals, 3_100);
    signals.threatFeeds.data!.warnings = ["URLhaus timed out."];
    expect(byId(ask(signals), "concern").disagreement).toBeNull();
  });

  it("explains a VirusTotal conviction no list shares", async () => {
    const questions = ask(await scenario("malicious.scrutinix.test"));
    expect(byId(questions, "reported").disagreement).toBe(
      "Each source is kept separately, so one can catch a link the others haven't reached yet.",
    );
  });

  it("stays quiet when nothing conflicts", async () => {
    for (const host of ["example.com", "critical.scrutinix.test"]) {
      for (const question of ask(await scenario(host))) {
        expect(question.disagreement, `${host} ${question.id}`).toBeNull();
      }
    }
  });
});

describe("Does HTTPS make it safe?", () => {
  const states = ["trusted", "warning", "untrusted", "invalid"] as const;

  it("always answers No first, and never calls the link safe", () => {
    const variants: SummaryQuestion[] = [];
    for (const validationState of states) {
      const signals = cleanSignals();
      signals.ssl.data!.validationState = validationState;
      variants.push(byId(ask(signals), "https"));
    }
    const unavailable = cleanSignals();
    unavailable.ssl.data!.available = false;
    const failed = cleanSignals();
    failed.ssl = { status: "error", data: null, error: "x", durationMs: 1 };
    const skipped = cleanSignals();
    skipped.ssl = { status: "skipped", data: null, error: "x", durationMs: 0 };
    for (const signals of [unavailable, failed, skipped]) {
      variants.push(byId(ask(signals), "https"));
    }
    variants.push(
      byId(ask(cleanSignals(), { url: "http://example.com/" }), "https"),
    );

    for (const { answer, why } of variants) {
      expect(answer).toMatch(/^No\. /);
      expect(`${answer} ${why}`).not.toMatch(/\bsafe\b/i);
    }
  });

  it("states a valid certificate as encryption, not trust", () => {
    expect(byId(ask(cleanSignals()), "https").why).toBe(
      "Encryption protects the connection, not your trust in the site.",
    );
  });

  it("dates the leaf certificate it read, and never claims it was the first", () => {
    const signals = cleanSignals();
    signals.ssl.data!.validFrom = new Date(NOW - 2 * HOUR).toISOString();
    const https = byId(ask(signals), "https");
    expect(https.answer).toBe(
      "No. The site has a valid certificate. This certificate was issued 2 hours ago.",
    );
    expect(https.answer).not.toMatch(/first/i);

    // A certificate dated in the future gets no age.
    signals.ssl.data!.validFrom = new Date(NOW + HOUR).toISOString();
    expect(byId(ask(signals), "https").answer).toBe(
      "No. The site has a valid certificate.",
    );
  });

  it("says so when the link uses plain HTTP", () => {
    expect(
      byId(ask(cleanSignals(), { url: "http://example.com/" }), "https"),
    ).toMatchObject({
      answer:
        "No. This link doesn't use HTTPS, so the connection isn't encrypted.",
      why: "Without encryption, what you send can be read on the way.",
    });
  });
});

describe("Where would it take me?", () => {
  it("names a different final site, the plain-HTTP leg, and hidden frames", () => {
    const signals = cleanSignals();
    withLureRedirect(signals, { hiddenIframe: true });
    withDomainAge(signals, 100);
    // The verdict this replaced once hid: Suspicious from these two checks.
    expect(buildThreatAssessment(signals).verdict).toBe("suspicious");

    const questions = ask(signals, { url: "https://short.example/a" });
    expect(byId(questions, "destination")).toMatchObject({
      answer:
        "It ends on lure.example, a different site. Part of the way uses plain HTTP, without encryption. The page has 1 hidden frame.",
      why: "The site you land on is the one you'd be trusting.",
    });
    expect(byId(questions, "concern")).toMatchObject({
      answer:
        "The structure checks didn't flag it; the link pattern model didn't run. Its domain was registered about 3 months ago.",
      why: "A fairly new domain is a mild warning sign.",
    });
  });

  it("names where a password form sends the password", () => {
    const signals = cleanSignals();
    withLureRedirect(signals, { passwordForm: true });
    expect(
      byId(ask(signals, { url: "https://short.example/a" }), "destination"),
    ).toMatchObject({
      answer:
        "It ends on lure.example, a different site. Part of the way uses plain HTTP, without encryption. Its page asks for a password and sends it to collect.example.",
      why: "Your password would leave the site you reached.",
    });
  });

  it("stays on the site after redirects, and never calls www a different site", () => {
    const signals = cleanSignals();
    signals.redirectChain.data = {
      ...signals.redirectChain.data!,
      finalUrl: "https://www.example.com/home",
      totalHops: 1,
      hops: [
        {
          url: "https://example.com/",
          status: 301,
          location: "https://www.example.com/home",
        },
        { url: "https://www.example.com/home", status: 200 },
      ],
    };
    expect(byId(ask(signals), "destination").answer).toBe(
      "It stays on this site after 1 redirect.",
    );
    // Without the parser, a different host is named but not judged.
    expect(
      byId(ask(signals, { registeredDomainOf: null }), "destination").answer,
    ).toBe("It ends on www.example.com.");
  });

  it("names a detour through another site that comes back", () => {
    const signals = cleanSignals();
    signals.redirectChain.data = {
      ...signals.redirectChain.data!,
      finalUrl: "https://example.com/done",
      totalHops: 2,
      hops: [
        {
          url: "https://example.com/",
          status: 302,
          location: "https://track.example.net/r",
        },
        {
          url: "https://track.example.net/r",
          status: 302,
          location: "https://example.com/done",
        },
        { url: "https://example.com/done", status: 200 },
      ],
    };
    expect(byId(ask(signals), "destination")).toMatchObject({
      answer: "It passes through example.net and comes back to this site.",
      why: "Detours through other sites can hide where a link really goes.",
    });
    // Without the parser no host is judged a detour.
    expect(
      byId(ask(signals, { registeredDomainOf: null }), "destination").answer,
    ).toBe("It stays on this site after 2 redirects.");
  });

  it("says when it couldn't follow the link", () => {
    const signals = cleanSignals();
    signals.redirectChain = {
      status: "error",
      data: null,
      error: "Timed out.",
      durationMs: 1,
    };
    expect(byId(ask(signals), "destination").answer).toBe(
      "We couldn't follow the link to see where it leads.",
    );
  });
});

describe("Has it been reported?", () => {
  it("says which list didn't answer", () => {
    const signals = cleanSignals();
    signals.virusTotal = {
      status: "error",
      data: null,
      error: "Timed out.",
      durationMs: 1,
    };
    signals.googleSafeBrowsing = {
      status: "skipped",
      data: null,
      error: "Google Safe Browsing API key is not configured.",
      durationMs: 0,
    };
    expect(byId(ask(signals), "reported")).toMatchObject({
      answer:
        "The threat feeds have no match. VirusTotal didn't answer. Safe Browsing wasn't checked.",
      why: "A list that didn't answer can't rule out a known threat.",
    });

    signals.threatFeeds.data!.warnings = ["URLhaus timed out."];
    expect(byId(ask(signals), "reported").answer).toBe(
      "The feeds that answered have no match. VirusTotal didn't answer. Safe Browsing wasn't checked. Some threat feeds didn't answer.",
    );

    signals.threatFeeds = {
      status: "error",
      data: null,
      error: "x",
      durationMs: 1,
    };
    expect(byId(ask(signals), "reported").answer).toBe(
      "None of these lists could be checked.",
    );
  });

  it("keeps a listing of another link on the host from reading as this link's", () => {
    const signals = cleanSignals();
    signals.threatFeeds.data!.matches = [
      {
        feed: "openphish",
        matchedUrl: "https://example.com/other",
        detail: "lists another link on this host",
        confidence: "medium",
        matchType: "host",
      },
    ];
    expect(byId(ask(signals), "reported")).toMatchObject({
      answer:
        "OpenPhish lists other links on this site. VirusTotal and Safe Browsing have no match.",
      why: "A listed link elsewhere on the same site is a warning sign, not proof about this one.",
    });
  });

  it("counts a single engine in the singular", () => {
    const signals = cleanSignals();
    signals.virusTotal.data!.malicious = 1;
    expect(byId(ask(signals), "reported").answer).toMatch(
      /^1 of 81 VirusTotal engines flags it as malicious\./,
    );
  });
});

describe("What did the other checks find?", () => {
  it("words the network's country as its registration, never a location", async () => {
    const signals = await scenario("malicious.scrutinix.test");
    const other = byId(ask(signals), "other").answer!;
    expect(other).toContain("network AS64500 EXAMPLE-NET, registered in NL");
    expect(other).not.toMatch(/located|hosted in|based in/i);

    signals.dns.data!.hosting = {
      ip: "203.0.113.66",
      asn: null,
      asName: null,
      prefix: null,
      registeredCountry: null,
    };
    expect(byId(ask(signals), "other").answer).toBe(
      "Nothing unusual in its DNS records. No network publicly routes its address.",
    );
  });

  it("states unusual records with a calm why", () => {
    const signals = cleanSignals();
    signals.dns.data!.anomalies = ["The hostname uses punycode encoding."];
    expect(byId(ask(signals), "other")).toMatchObject({
      answer: "The hostname uses punycode encoding.",
      why: "Look-alike letters can make a fake name read like a real one.",
    });
  });
});

describe("old and legacy records", () => {
  it("answers sensibly without the hosting network, listing dates, or page content", async () => {
    const signals = await scenario("feed-hit.scrutinix.test");
    delete signals.dns.data!.hosting;
    for (const match of signals.threatFeeds.data!.matches) {
      delete match.listedAt;
    }
    signals.redirectChain.data!.content = undefined;

    const questions = ask(signals, { url: "https://feed-hit.scrutinix.test/" });
    expect(byId(questions, "other").answer).toBe(
      "Nothing unusual in its DNS records.",
    );
    expect(byId(questions, "reported").answer).toBe(
      "URLhaus lists this link as active malware distribution. VirusTotal and Safe Browsing have no match.",
    );
    expect(byId(questions, "destination").answer).toBe(CLEAN_DESTINATION[0]);
    for (const question of questions) expect(question.state).toBe("settled");
  });

  it("never throws on a record saved before checks were kept", () => {
    const legacy = sanitizeHistoryEntry({
      id: "legacy",
      url: "https://old.example/",
      verdict: "safe",
      signals: {},
      metadata: { scanId: "legacy" },
      savedAt: "2025-01-01T00:00:00.000Z",
    });
    const questions = ask(legacy!.signals, {
      url: legacy!.url,
      threatInfo: null,
    });
    expect(byId(questions, "reported").answer).toBe(
      "None of these lists could be checked.",
    );
    expect(byId(questions, "https").answer).toBe(
      "No. We couldn't check the certificate.",
    );
  });
});

describe("copy hygiene", () => {
  it("counts in the singular, names the model members, and never second-guesses", async () => {
    const scenarios: SignalResults[] = [];
    for (const host of [
      "example.com",
      "malicious.scrutinix.test",
      "feed-hit.scrutinix.test",
      "critical.scrutinix.test",
      "unreachable.scrutinix.test",
    ]) {
      scenarios.push(await scenario(host));
    }
    const lure = cleanSignals();
    withLureRedirect(lure, { hiddenIframe: true, passwordForm: true });
    withDomainAge(lure, 1);
    scenarios.push(lure);

    for (const signals of scenarios) {
      for (const question of ask(signals, {
        url: "https://short.example/a",
      })) {
        for (const text of [
          question.answer,
          question.why,
          question.disagreement,
        ]) {
          if (!text) continue;
          expect(text).not.toMatch(
            /\b1 (?:[a-z-]+ ){0,2}(?:engines|frames|redirects|days|hours)\b/i,
          );
          expect(text).not.toMatch(/lexical|transformer|ensemble/i);
          expect(text).not.toMatch(/listed.*listed/i);
          expect(text).not.toMatch(/\bsafe\b(?! Browsing)/i);
        }
      }
    }
  });
});
