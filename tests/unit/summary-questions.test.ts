import { parse } from "tldts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRIVATE_ADDRESSES_OMITTED } from "@/lib/domain/blocked-address";
import { registrableDomainOf } from "@/lib/domain/link-anatomy";
import { classifyConsensus } from "@/lib/domain/ml-consensus";
import { sanitizeHistoryEntry } from "@/lib/domain/runtime-safety";
import {
  evidenceTimeOf,
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
  type ClassificationFinding,
  type PageContentFindings,
  type RedirectData,
  type SignalResults,
} from "@/lib/domain/types";
import {
  buildThreatAssessment,
  getScoredFindings,
  getScoredSignals,
} from "@/lib/domain/verdict";
import {
  cleanSignals,
  withDomainAge,
  withLureRedirect,
} from "@/tests/fixtures/lure-signals";
import {
  fixtureHosts,
  fixtureSignals,
} from "@/tests/fixtures/scenario-signals";

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
    now: NOW,
    registeredDomainOf,
    ...options,
  });
}

/** A redirect chain from its hops: [url, status, location?]. */
function chain(
  hops: [string, number, string?][],
  overrides: Partial<RedirectData> = {},
): RedirectData {
  const last = hops.at(-1);
  return {
    finalUrl: last?.[2] ?? last?.[0] ?? "",
    totalHops: hops.filter(([, , location]) => location).length,
    httpsUpgraded: false,
    reachable: true,
    terminalStatus: last?.[1] ?? null,
    terminalError: overrides.reachable === false ? "Timed out." : null,
    hops: hops.map(([url, status, location]) => ({ url, status, location })),
    observations: [],
    ...overrides,
  };
}

/** The final page's findings; nothing notable unless overridden. */
function page(overrides: Partial<PageContentFindings> = {}) {
  return {
    title: null,
    crossOriginFormHosts: [],
    crossOriginPasswordFormHosts: [],
    passwordInputCount: 0,
    iframeCount: 0,
    hiddenIframeCount: 0,
    obfuscationHints: [],
    metaRefreshTarget: null,
    ...overrides,
  };
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
        "24 of 70 VirusTotal engines flag it as malicious and 4 as suspicious. Safe Browsing lists it for phishing or a deceptive site and malware. URLhaus lists this link as active malware distribution (listed 6 hours ago).",
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
        "We found no address for this name.",
        "Without an address, we couldn't look at the site itself.",
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

  it("changes no verdict or score", async () => {
    const signals = await scenario("feed-hit.scrutinix.test");
    const before = structuredClone(signals);
    const assessment = buildThreatAssessment(signals);
    ask(signals);
    expect(signals).toEqual(before);
    expect(buildThreatAssessment(signals)).toEqual(assessment);
  });
});

describe("the clock ages count from", () => {
  it("is the result's check time, then its completion time", () => {
    expect(
      evidenceTimeOf({
        checkedAt: "2026-10-01T00:00:00.000Z",
        completedAt: "2026-10-06T00:00:00.000Z",
      }),
    ).toBe(Date.parse("2026-10-01T00:00:00.000Z"));
    // In-memory records may lack checkedAt; a garbled one falls through.
    for (const checkedAt of [undefined, "", "not a date"]) {
      expect(
        evidenceTimeOf({ checkedAt, completedAt: "2026-10-06T00:00:00.000Z" }),
      ).toBe(Date.parse("2026-10-06T00:00:00.000Z"));
    }
    expect(evidenceTimeOf({})).toBeUndefined();
  });
});

describe("pending questions", () => {
  it("are all pending before any check lands", () => {
    const questions = ask(createPendingSignalResults());
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

    const questions = ask(signals);
    expect(byId(questions, "https").state).toBe("settled");
    // Two of its three lists answered: still waiting on the feeds.
    expect(byId(questions, "reported").state).toBe("pending");
    expect(byId(questions, "concern").state).toBe("pending");

    signals.threatFeeds = clean.threatFeeds;
    expect(byId(ask(signals), "reported")).toMatchObject({
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

    expect(byId(ask(signals), "reported").disagreement).toBeNull();
    signals.whois = clean.whois;
    expect(byId(ask(signals), "reported").disagreement).toMatch(
      /^Blocklists usually lag/,
    );
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

    // Weeks old is past the lag: no sentence hedging a clean result.
    withDomainAge(signals, 20);
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
    // The age counts from the time it is given (a result's check time).
    expect(
      byId(ask(signals, { now: NOW + 3 * 24 * HOUR }), "reported").answer,
    ).toContain("(listed 3 days ago)");

    if (signals.virusTotal.data) signals.virusTotal.data.malicious = 2;
    expect(byId(ask(signals), "reported").disagreement).toBe(lag);

    // A listing weeks old is no longer a lag.
    signals.virusTotal.data!.malicious = 0;
    for (const match of signals.threatFeeds.data!.matches) {
      match.listedAt = new Date(NOW - 30 * 24 * HOUR).toISOString();
    }
    expect(byId(ask(signals), "reported").disagreement).toBeNull();
    for (const match of signals.threatFeeds.data!.matches) {
      delete match.listedAt;
    }
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
    // Only the structure checks flagged it, so they are the ones named.
    expect(byId(questions, "concern").answer).toMatch(
      /^The structure checks find the link risky; the link pattern model didn't run\./,
    );
    expect(byId(questions, "concern").disagreement).toBe(
      "The structure checks read the link itself, so they can flag a new scam before any list does.",
    );
    signals.mlEnsemble.data!.transformerModel = {
      label: "malicious",
      score: 0.9,
      reasons: [],
      model: "fixture",
    };
    signals.mlEnsemble.data!.lexicalModel.label = "benign";
    expect(byId(ask(signals), "concern").disagreement).toBe(
      "The link pattern model reads the link itself, so it can flag a new scam before any list does.",
    );
    signals.mlEnsemble.data!.transformerModel = null;
    signals.mlEnsemble.data!.lexicalModel.label = "risky";
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

  it("says when a plain HTTP link moves to HTTPS, and still gives the certificate", () => {
    const signals = cleanSignals();
    signals.redirectChain.data = {
      ...signals.redirectChain.data!,
      finalUrl: "https://example.com/",
    };
    expect(
      byId(ask(signals, { url: "http://example.com/" }), "https").answer,
    ).toBe(
      "No. This link starts on plain HTTP, then moves to HTTPS. The site has a valid certificate.",
    );
  });

  it("says so when the link stays on plain HTTP", () => {
    const signals = cleanSignals();
    signals.redirectChain.data = {
      ...signals.redirectChain.data!,
      finalUrl: "http://example.com/",
    };
    expect(
      byId(ask(signals, { url: "http://example.com/" }), "https"),
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
        "It ends on lure.example, a different site, after 2 redirects. Part of the way uses plain HTTP, without encryption. The page has 1 hidden frame.",
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
        "It ends on lure.example, a different site, after 2 redirects. Part of the way uses plain HTTP, without encryption. Its page asks for a password and sends it to collect.example.",
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
    ).toBe("It ends on www.example.com after 1 redirect.");
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
      answer:
        "It passes through example.net and comes back to this site after 2 redirects.",
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

  it("keeps the hops it saw when it couldn't finish the chain", () => {
    const signals = cleanSignals();
    // Three redirects answered, one over plain HTTP; the next one timed out.
    signals.redirectChain.data = chain(
      [
        ["https://example.com/", 301, "http://track.example.net/a"],
        ["http://track.example.net/a", 302, "https://track.example.net/b"],
        ["https://track.example.net/b", 302, "https://next.example/c"],
      ],
      { reachable: false, finalUrl: "https://track.example.net/b" },
    );
    // The engine scores what was seen, and the strip marks Redirects.
    expect(getScoredSignals(signals).has("redirectChain")).toBe(true);

    const destination = byId(ask(signals), "destination");
    expect(destination).toMatchObject({
      answer:
        "We followed 3 redirects, through example.net, but couldn't reach the end, so we can't confirm where it finally leads. Part of the way uses plain HTTP, without encryption.",
      why: "Without encryption, others on the network can read or change what you see.",
    });
    // Where it was heading is never named as where it ends.
    expect(destination.answer).not.toMatch(/next\.example|ends on/);

    // No response at all: nothing seen, so nothing to describe.
    signals.redirectChain.data = chain([], {
      reachable: false,
      terminalStatus: null,
    });
    expect(byId(ask(signals), "destination")).toMatchObject({
      answer: "We couldn't reach the site, so we can't say where it leads.",
      why: "If we can't open the page, we can't vouch for it.",
    });
  });

  it("names a page built from several frames, hidden or not", () => {
    const signals = cleanSignals();
    signals.redirectChain.data = chain([["https://example.com/", 200]], {
      content: page({ iframeCount: 3 }),
    });
    expect(getScoredSignals(signals).has("redirectChain")).toBe(true);
    expect(byId(ask(signals), "destination")).toMatchObject({
      answer:
        "It opens this site directly, without redirects. The page embeds 3 frames.",
      why: "Frames can show another site's content inside this page.",
    });

    // Two visible frames aren't scored, and aren't mentioned.
    signals.redirectChain.data.content = page({ iframeCount: 2 });
    expect(getScoredSignals(signals).has("redirectChain")).toBe(false);
    expect(byId(ask(signals), "destination").answer).toBe(
      "It opens this site directly, without redirects.",
    );
  });

  it("names a long chain that stays on the site, with a calm why", () => {
    const signals = cleanSignals();
    signals.redirectChain.data = chain([
      ["https://example.com/", 301, "https://example.com/a"],
      ["https://example.com/a", 302, "https://example.com/b"],
      ["https://example.com/b", 302, "https://example.com/c"],
      ["https://example.com/c", 200],
    ]);
    expect(byId(ask(signals), "destination")).toMatchObject({
      answer: "It stays on this site after 3 redirects.",
      why: "A long chain of redirects is a weak sign on its own.",
    });
  });
});

type Reading = [ClassificationFinding["label"], number];

/** The ensemble as the server builds it: each member's own reading, and the real consensus. */
function withMembers(
  signals: SignalResults,
  model: Reading | null,
  structure: Reading,
) {
  const finding = ([label, score]: Reading, name: string) => ({
    label,
    score,
    reasons: [],
    model: name,
  });
  const transformerModel = model ? finding(model, "fixture") : null;
  const lexicalModel = finding(structure, "lexical-heuristic");
  const consensus = classifyConsensus(transformerModel, lexicalModel);
  signals.mlEnsemble.data = {
    ...signals.mlEnsemble.data!,
    transformerModel,
    lexicalModel,
    consensusLabel: consensus.label,
    consensusScore: consensus.score,
  };
  return consensus.label;
}

describe("What else raises concern?", () => {
  const concernOf = (signals: SignalResults) =>
    byId(ask(signals), "concern").answer!.split(" Its domain")[0];

  it("describes each member by its own reading, and claims agreement only when they match", () => {
    const signals = cleanSignals();
    // A benign consensus doesn't mean both members were benign.
    expect(withMembers(signals, ["malicious", 0.52], ["benign", 0.1])).toBe(
      "benign",
    );
    expect(concernOf(signals)).toBe(
      "The link pattern model finds the link malicious-looking; the structure checks don't flag it. Their combined reading doesn't flag it.",
    );
    // The disagreement with the lists isn't suppressed either.
    expect(byId(ask(signals), "concern").disagreement).toBe(
      "The link pattern model reads the link itself, so it can flag a new scam before any list does.",
    );

    // Malicious plus risky is not "both malicious-looking".
    expect(withMembers(signals, ["malicious", 0.9], ["risky", 0.6])).toBe(
      "malicious",
    );
    expect(concernOf(signals)).toBe(
      "The link pattern model finds the link malicious-looking; the structure checks find it risky. Their combined reading is malicious-looking.",
    );

    expect(withMembers(signals, ["benign", 0.1], ["risky", 0.7])).toBe("risky");
    expect(concernOf(signals)).toBe(
      "The link pattern model doesn't flag it; the structure checks find it risky. Their combined reading is risky.",
    );

    // Agreement, said once, only when both readings and the aggregate match.
    expect(withMembers(signals, ["risky", 0.9], ["risky", 0.9])).toBe("risky");
    expect(concernOf(signals)).toBe(
      "The link pattern model and structure checks both find the link risky.",
    );
    expect(withMembers(signals, ["benign", 0.1], ["benign", 0.1])).toBe(
      "benign",
    );
    expect(concernOf(signals)).toBe(
      "The link pattern model and structure checks didn't flag it.",
    );
    // Two weak risky readings can combine below the line; the aggregate says so.
    expect(withMembers(signals, ["risky", 0.4], ["risky", 0.4])).toBe("benign");
    expect(concernOf(signals)).toBe(
      "The link pattern model and structure checks both find the link risky. Their combined reading doesn't flag it.",
    );

    // Without the model, the structure checks are the whole reading.
    expect(withMembers(signals, null, ["risky", 0.6])).toBe("risky");
    expect(concernOf(signals)).toBe(
      "The structure checks find the link risky; the link pattern model didn't run.",
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

  it("never cites threat reports under a weak, unconfirmed hit", () => {
    const signals = cleanSignals();
    signals.virusTotal.data!.suspicious = 1;
    expect(buildThreatAssessment(signals).verdict).toBe("safe");
    expect(byId(ask(signals), "other").why).toBe(
      "Ordinary DNS is common to good and bad sites alike.",
    );
  });

  it("says a name points only to private addresses, not nowhere", () => {
    const signals = cleanSignals();
    signals.dns.data = {
      ...signals.dns.data!,
      addresses: [],
      cnames: [],
      observations: [
        "No A, AAAA, or CNAME records were returned for the hostname.",
        PRIVATE_ADDRESSES_OMITTED,
      ],
    };
    expect(byId(ask(signals), "other")).toMatchObject({
      answer: "It points only to private or reserved addresses.",
      why: "A private address can only be reached inside one network.",
    });
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
    const questions = ask(legacy!.signals, { url: legacy!.url });
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

describe("every scored finding", () => {
  // The fresh-certificate rule reads the clock when it scores.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const answerOf = (question: SummaryQuestion) => question.answer ?? "";
  const statesReason = (question: SummaryQuestion, reason: string) =>
    answerOf(question).includes(reason.replace(/\.$/, ""));

  /**
   * How the citing question names each finding, by the group the engine
   * files it under. A finding with no rule here fails the walk, so a new
   * scorer can't land without its Summary wording.
   */
  const named: Record<
    string,
    (question: SummaryQuestion, reason: string) => boolean
  > = {
    virusTotal: (q) => /VirusTotal engines? flags? it as/.test(answerOf(q)),
    googleSafeBrowsing: (q) => /Safe Browsing lists it for/.test(answerOf(q)),
    feed: statesReason,
    "feed-host": (q) => /lists? other links on this site/.test(answerOf(q)),
    ml: (q) =>
      /find(?:s)? (?:the link|it) (?:risky|malicious-looking)|combined reading is/.test(
        answerOf(q),
      ),
    tls: (q) => /certificate isn't trusted/.test(answerOf(q)),
    // The answer dates it; the why says what that pairing means, unless a
    // certificate error (scored too) is the bigger story.
    "tls-fresh": (q) =>
      /This certificate was issued .+ ago/.test(answerOf(q)) &&
      (/brand-new certificate on a brand-new domain/.test(q.why ?? "") ||
        /isn't trusted/.test(answerOf(q))),
    "dns-punycode": statesReason,
    dns: statesReason,
    "redirect-hops": (q) => /\b\d+ redirects\b/.test(answerOf(q)),
    "redirect-http": (q) => /plain HTTP/.test(answerOf(q)),
    "redirect-cross": (q) => /, a different site\b/.test(answerOf(q)),
    "page-password": (q) =>
      /asks for a password and sends it to/.test(answerOf(q)),
    "page-obfuscation": (q) => /hard to read/.test(answerOf(q)),
    "page-iframes": (q) => /\bframes?\b/.test(answerOf(q)),
    "page-refresh": (q) => /moves you on to/.test(answerOf(q)),
    "domain-age": (q) => /registered .+ ago/.test(answerOf(q)),
  };
  const ruleFor = (group: string) =>
    group.startsWith("feed:") ? "feed" : group;

  /** Every scorer branch, both sides of each threshold where it has one. */
  async function cases(): Promise<[string, SignalResults, string?][]> {
    const list: [string, SignalResults, string?][] = [];
    const add = (
      label: string,
      change: (signals: SignalResults) => void,
      url?: string,
    ) => {
      const signals = cleanSignals();
      change(signals);
      list.push([label, signals, url]);
    };

    for (const host of fixtureHosts) list.push([host, await scenario(host)]);
    list.push([
      "critical",
      await scenario("critical.scrutinix.test"),
      "https://critical.scrutinix.test/",
    ]);

    for (const [malicious, suspicious] of [
      [1, 0],
      [4, 0],
      [5, 0],
      [0, 1],
      [0, 3],
      [2, 2],
    ]) {
      add(`virusTotal ${malicious}/${suspicious}`, (s) => {
        s.virusTotal.data!.malicious = malicious!;
        s.virusTotal.data!.suspicious = suspicious!;
      });
    }
    add("safe browsing", (s) => {
      s.googleSafeBrowsing.data!.matches = [
        {
          threatType: "MALWARE",
          platformType: "ANY_PLATFORM",
          threatEntryType: "URL",
        },
      ];
    });
    add("feed elsewhere on the host", (s) => {
      s.threatFeeds.data!.matches = [
        {
          feed: "openphish",
          matchedUrl: "https://example.com/other",
          detail: "lists another link on this host",
          confidence: "medium",
          matchType: "host",
        },
      ];
    });

    const readings: (Reading | null)[] = [
      null,
      ["benign", 0.9],
      ["risky", 0.5],
      ["risky", 0.9],
      ["malicious", 0.52],
      ["malicious", 0.95],
    ];
    const structures: Reading[] = [
      ["benign", 0.1],
      ["risky", 0.5],
      ["risky", 0.9],
      ["malicious", 0.6],
      ["malicious", 0.95],
    ];
    for (const model of readings) {
      for (const structure of structures) {
        add(
          `model ${model?.join(" ")} / structure ${structure.join(" ")}`,
          (s) => withMembers(s, model, structure),
        );
      }
    }

    for (const validationState of ["invalid", "untrusted"] as const) {
      add(`certificate ${validationState}`, (s) => {
        s.ssl.data!.validationState = validationState;
      });
    }
    for (const [certHours, domainDays] of [
      [2, 3],
      [6 * 24 + 23, 29],
      [7 * 24, 3],
      [2, 30],
    ] as const) {
      add(`certificate ${certHours}h on a ${domainDays}-day domain`, (s) => {
        s.ssl.data!.validFrom = new Date(NOW - certHours * HOUR).toISOString();
        withDomainAge(s, domainDays);
      });
    }
    add("fresh untrusted certificate on a new domain", (s) => {
      s.ssl.data!.validationState = "untrusted";
      s.ssl.data!.validFrom = new Date(NOW - 2 * HOUR).toISOString();
      withDomainAge(s, 3);
    });

    add("punycode", (s) => {
      s.dns.data!.anomalies = ["The hostname uses punycode encoding."];
    });
    add("many addresses", (s) => {
      s.dns.data!.anomalies = [
        "The hostname resolves to an unusually high number of address records.",
      ];
    });
    add("punycode with no address", (s) => {
      s.dns.data!.addresses = [];
      s.dns.data!.anomalies = ["The hostname uses punycode encoding."];
    });

    const onSite = (count: number): [string, number, string?][] => [
      ...Array.from({ length: count }, (_, index): [string, number, string] => [
        `https://example.com/${index}`,
        302,
        `https://example.com/${index + 1}`,
      ]),
      [`https://example.com/${count}`, 200],
    ];
    for (const count of [2, 3, 5]) {
      add(
        `${count} redirects on the site`,
        (s) => {
          s.redirectChain.data = chain(onSite(count));
        },
        "https://example.com/0",
      );
    }
    add(
      "3 redirects to another site",
      (s) => {
        s.redirectChain.data = chain([
          ["https://example.com/", 301, "https://a.example.net/"],
          ["https://a.example.net/", 302, "https://b.example.org/"],
          ["https://b.example.org/", 302, "https://lure.example/"],
          ["https://lure.example/", 200],
        ]);
      },
      "https://example.com/",
    );
    add(
      "lure",
      (s) => withLureRedirect(s, { passwordForm: true }),
      "https://short.example/a",
    );
    add(
      "downgrade that stays on the site",
      (s) => {
        s.redirectChain.data = chain([
          ["https://example.com/", 301, "http://example.com/"],
          ["http://example.com/", 200],
        ]);
      },
      "https://example.com/",
    );
    add(
      "unfinished chain",
      (s) => {
        s.redirectChain.data = chain(
          [
            ["https://example.com/", 301, "http://example.com/a"],
            ["http://example.com/a", 302, "https://example.com/b"],
            ["https://example.com/b", 302, "https://example.com/c"],
          ],
          { reachable: false, finalUrl: "https://example.com/b" },
        );
      },
      "https://example.com/",
    );
    const pages: [string, Partial<PageContentFindings>][] = [
      ["obfuscated", { obfuscationHints: ["eval", "atob"] }],
      ["one obfuscation hint", { obfuscationHints: ["eval"] }],
      ["hidden frame", { iframeCount: 1, hiddenIframeCount: 1 }],
      ["three visible frames", { iframeCount: 3 }],
      ["two visible frames", { iframeCount: 2 }],
      [
        "refresh elsewhere",
        { metaRefreshTarget: "https://elsewhere.example/" },
      ],
      [
        "refresh on the site",
        { metaRefreshTarget: "https://www.example.com/" },
      ],
    ];
    for (const [label, content] of pages) {
      add(
        `page: ${label}`,
        (s) => {
          s.redirectChain.data = chain([["https://example.com/", 200]], {
            content: page(content),
          });
        },
        "https://example.com/",
      );
    }

    for (const days of [3, 29, 30, 179, 180]) {
      add(`domain ${days} days old`, (s) => withDomainAge(s, days));
    }
    add("shared platform registered 3 days ago", (s) => {
      s.whois.data = { ...s.whois.data!, ageDays: 3, sharedPlatform: true };
    });
    return list;
  }

  it("is named by the question citing its check", async () => {
    const reached = new Set<string>();
    const unexplained: string[] = [];
    for (const [label, signals, url] of await cases()) {
      const questions = ask(signals, url ? { url } : {});
      for (const finding of getScoredFindings(signals)) {
        const rule = ruleFor(finding.group);
        reached.add(rule);
        const isNamed = named[rule];
        const question = byId(questions, questionCiting(finding.signal));
        if (!isNamed) {
          unexplained.push(`${label}: no Summary wording for ${rule}`);
        } else if (
          question.state !== "settled" ||
          !isNamed(question, finding.reason)
        ) {
          unexplained.push(
            `${label}: "${question.question}" doesn't explain "${finding.reason}" | ${question.answer} | ${question.why}`,
          );
        }
      }
    }
    expect(unexplained).toEqual([]);
    // The cases reach every rule the engine scores by.
    expect([...reached].sort()).toEqual(Object.keys(named).sort());
  });
});
