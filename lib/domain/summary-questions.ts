import {
  capitalize,
  countOf,
  formatAge,
  formatElapsed,
  formatList,
} from "@/lib/domain/copy";
import {
  describeSafeBrowsingThreats,
  feedDisplayName,
  feedMatchClause,
  isElsewhereOnHost,
  type FeedMatch,
} from "@/lib/domain/feed-copy";
import { PRIVATE_ADDRESSES_OMITTED } from "@/lib/domain/blocked-address";
import { hostOf } from "@/lib/domain/link-anatomy";
import {
  hasConfirmedReputationHit,
  VT_CONVICTION_ENGINES,
} from "@/lib/domain/reputation";
import {
  NEW_DOMAIN_DAYS,
  YOUNG_DOMAIN_DAYS,
} from "@/lib/domain/signal-severity";
import type {
  ClassificationFinding,
  SignalName,
  SignalResults,
  VirusTotalData,
} from "@/lib/domain/types";

/**
 * The Summary view: five plain questions people ask about a link, each
 * with a short answer, one clause on why it matters, the checks it rests
 * on, and, when checks conflict in a way a reader would notice, one
 * sentence on why. Every Summary string lives here.
 *
 * Presentation only: nothing here changes a verdict or a score. The newer
 * facts (hosting network, listing dates, certificate age) are evidence for
 * answers and disagreement sentences, never scored. The link anatomy
 * already states who owns the link and any look-alike, so no answer
 * repeats that.
 *
 * Client-safe and small: no verdict engine, no Public Suffix List. The
 * registered-domain lookup is passed in, as `link-anatomy.ts` does.
 */

export const summaryQuestionIds = [
  "reported",
  "destination",
  "concern",
  "https",
  "other",
] as const;

export type SummaryQuestionId = (typeof summaryQuestionIds)[number];

/**
 * The checks each question cites, in `signalNames` order. Every check is
 * cited by exactly one question, so a strip cell always has one question
 * to move to.
 */
export const questionSources = {
  reported: ["virusTotal", "googleSafeBrowsing", "threatFeeds"],
  destination: ["redirectChain"],
  concern: ["mlEnsemble", "whois"],
  https: ["ssl"],
  other: ["dns"],
} as const satisfies Record<SummaryQuestionId, readonly SignalName[]>;

const questionText: Record<SummaryQuestionId, string> = {
  reported: "Has it been reported?",
  destination: "Where would it take me?",
  concern: "What else raises concern?",
  https: "Does HTTPS make it safe?",
  other: "What did the other checks find?",
};

/** How long a lag between lists and a new site or listing is plausible. */
const LISTS_LAG_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What an unanswered question shows while its checks run. */
export const PENDING_ANSWER = "Checking…";

/** "Source" or "Sources", before the cell names a question cites. */
export function sourcesLabel(count: number): string {
  return count === 1 ? "Source" : "Sources";
}

/** The question that cites a check. */
export function questionCiting(name: SignalName): SummaryQuestionId {
  return summaryQuestionIds.find((id) =>
    (questionSources[id] as readonly SignalName[]).includes(name),
  )!;
}

export interface SummaryQuestion {
  id: SummaryQuestionId;
  question: string;
  /** Pending while any check it cites is still running. */
  state: "pending" | "settled";
  /** Null while pending. */
  answer: string | null;
  /** What the finding means for the reader; null while pending. */
  why: string | null;
  /** The checks it cites, in `signalNames` order. */
  sources: readonly SignalName[];
  /** Why two checks disagree, when a reader would notice; else null. */
  disagreement: string | null;
}

export interface SummaryQuestionInput {
  url: string;
  signals: SignalResults;
  /**
   * Anchors "issued 2 hours ago" and "listed 6 hours ago", as the Full
   * rows do. Tests pass a fixed time.
   */
  now?: number;
  /**
   * A hostname's registered domain (tldts, passed in). Without it the
   * final host is named but never called "a different site".
   */
  registeredDomainOf?: ((hostname: string) => string) | null;
}

interface Answer {
  answer: string;
  why: string;
}

interface Context extends SummaryQuestionInput {
  now: number;
  lists: ListReading[];
}

export function getSummaryQuestions(
  input: SummaryQuestionInput,
): SummaryQuestion[] {
  const now = input.now ?? Date.now();
  const context: Context = {
    ...input,
    now,
    lists: readLists(input.signals),
  };

  return summaryQuestionIds.map((id) => {
    const sources = questionSources[id];
    const base = { id, question: questionText[id], sources };
    if (sources.some((name) => !isSettled(input.signals, name))) {
      return {
        ...base,
        state: "pending",
        answer: null,
        why: null,
        disagreement: null,
      };
    }
    return {
      ...base,
      state: "settled",
      ...answerFor(id, context),
      disagreement: disagreementFor(id, context),
    };
  });
}

function answerFor(id: SummaryQuestionId, context: Context): Answer {
  switch (id) {
    case "reported":
      return answerReported(context);
    case "destination":
      return answerDestination(context);
    case "concern":
      return answerConcern(context);
    case "https":
      return answerHttps(context);
    case "other":
      return answerOther(context);
  }
}

function isSettled(signals: SignalResults, name: SignalName): boolean {
  return signals[name].status !== "pending";
}

const sentences = (parts: readonly (string | null | false)[]) =>
  parts.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Has it been reported? (VirusTotal, Safe Browsing, threat feeds)

type ListState = "hit" | "clean" | "partial" | "failed" | "skipped";

interface ListReading {
  name: (typeof questionSources.reported)[number];
  /** How the list is named mid-sentence. */
  label: string;
  plural: boolean;
  state: ListState;
}

function readLists(signals: SignalResults): ListReading[] {
  const stateOf = (
    status: SignalResults[ListReading["name"]]["status"],
    hasData: boolean,
    hit: () => boolean,
  ): ListState => {
    if (status === "skipped") return "skipped";
    if (status !== "success" || !hasData) return "failed";
    return hit() ? "hit" : "clean";
  };

  const vt = signals.virusTotal;
  const gsb = signals.googleSafeBrowsing;
  const feeds = signals.threatFeeds;
  let feedState = stateOf(feeds.status, Boolean(feeds.data), () =>
    Boolean(feeds.data?.matches.length),
  );
  if (feedState === "clean" && (feeds.data?.warnings.length ?? 0) > 0) {
    feedState = "partial";
  }

  return [
    {
      name: "virusTotal",
      label: "VirusTotal",
      plural: false,
      state: stateOf(vt.status, Boolean(vt.data), () =>
        Boolean(vt.data && (vt.data.malicious > 0 || vt.data.suspicious > 0)),
      ),
    },
    {
      name: "googleSafeBrowsing",
      label: "Safe Browsing",
      plural: false,
      state: stateOf(gsb.status, Boolean(gsb.data), () =>
        Boolean(gsb.data?.matches.length),
      ),
    },
    {
      name: "threatFeeds",
      label:
        feedState === "partial"
          ? "the feeds that answered"
          : "the threat feeds",
      plural: true,
      state: feedState,
    },
  ];
}

function listPhrase(lists: readonly ListReading[]): {
  text: string;
  plural: boolean;
} {
  return {
    text: capitalize(formatList(lists.map((list) => list.label))),
    plural: lists.length > 1 || lists.some((list) => list.plural),
  };
}

/** "7 of 70 VirusTotal engines flag it as malicious and 2 as suspicious." */
function describeVirusTotal(d: VirusTotalData): string {
  const total = d.malicious + d.suspicious + d.harmless + d.undetected;
  const engines = (count: number) =>
    total >= count && total > 0
      ? `${count} of ${countOf(total, "VirusTotal engine")}`
      : countOf(count, "VirusTotal engine");
  const flag = (count: number) => (count === 1 ? "flags" : "flag");

  if (d.malicious > 0 && d.suspicious > 0) {
    return `${engines(d.malicious)} ${flag(d.malicious)} it as malicious and ${d.suspicious} as suspicious.`;
  }
  const count = d.malicious > 0 ? d.malicious : d.suspicious;
  return `${engines(count)} ${flag(count)} it as ${d.malicious > 0 ? "malicious" : "suspicious"}.`;
}

function listedAtOf(match: FeedMatch): number | null {
  const listedAt = match.listedAt ? Date.parse(match.listedAt) : Number.NaN;
  return Number.isFinite(listedAt) ? listedAt : null;
}

/** Feed listings: direct ones in the feed's own words, then other links on the host. */
function describeFeeds(matches: readonly FeedMatch[], now: number): string[] {
  const direct = [
    ...new Set(
      matches
        .filter((match) => !isElsewhereOnHost(match))
        .map((match) => {
          const listedAt = listedAtOf(match);
          const age =
            listedAt === null
              ? ""
              : ` (listed ${formatElapsed(now - listedAt)} ago)`;
          return `${feedDisplayName(match.feed)} ${feedMatchClause(match)}${age}.`;
        }),
    ),
  ];
  const elsewhere = [
    ...new Set(
      matches
        .filter((match) => isElsewhereOnHost(match))
        .map((match) => feedDisplayName(match.feed)),
    ),
  ];
  return elsewhere.length > 0
    ? [
        ...direct,
        `${formatList(elsewhere)} ${elsewhere.length === 1 ? "lists" : "list"} other links on this site.`,
      ]
    : direct;
}

function answerReported({ signals, lists, now }: Context): Answer {
  const hits = lists.filter((list) => list.state === "hit");
  const clean = lists.filter(
    (list) => list.state === "clean" || list.state === "partial",
  );
  const failed = lists.filter((list) => list.state === "failed");
  const skipped = lists.filter((list) => list.state === "skipped");

  const findings: string[] = [];
  const vt = signals.virusTotal.data;
  if (vt && lists[0]?.state === "hit") findings.push(describeVirusTotal(vt));
  const gsb = signals.googleSafeBrowsing.data;
  if (gsb && gsb.matches.length > 0) {
    findings.push(
      `Safe Browsing lists it for ${describeSafeBrowsingThreats(gsb.matches)}.`,
    );
  }
  const feeds = signals.threatFeeds.data;
  if (feeds && feeds.matches.length > 0) {
    findings.push(...describeFeeds(feeds.matches, now));
  }

  const unanswered = [
    failed.length > 0 && `${listPhrase(failed).text} didn't answer.`,
    skipped.length > 0 &&
      `${listPhrase(skipped).text} ${listPhrase(skipped).plural ? "weren't" : "wasn't"} checked.`,
    (feeds?.warnings.length ?? 0) > 0 && "Some threat feeds didn't answer.",
  ];

  if (hits.length > 0) {
    const cleanPhrase = listPhrase(clean);
    const onlyElsewhere =
      hits.length === 1 &&
      hits[0]?.name === "threatFeeds" &&
      (feeds?.matches ?? []).every(isElsewhereOnHost);
    return {
      answer: sentences([
        ...findings,
        clean.length > 0 &&
          `${cleanPhrase.text} ${cleanPhrase.plural ? "have" : "has"} no match.`,
        ...unanswered,
      ]),
      why: hasConfirmedReputationHit(signals)
        ? "Direct threat reports are a reason to stay away."
        : onlyElsewhere
          ? "A listed link elsewhere on the same site is a warning sign, not proof about this one."
          : "One report can be a mistake; several that agree are stronger evidence.",
    };
  }

  if (clean.length === lists.length && lists[2]?.state === "clean") {
    return {
      answer: "Not on any list we checked.",
      why: "Lists only know threats that someone has already reported.",
    };
  }

  if (clean.length === 0) {
    return {
      answer: "None of these lists could be checked.",
      why: "A list that didn't answer can't rule out a known threat.",
    };
  }

  const cleanPhrase = listPhrase(clean);
  return {
    answer: sentences([
      `${cleanPhrase.text} ${cleanPhrase.plural ? "have" : "has"} no match.`,
      ...unanswered,
    ]),
    why: "A list that didn't answer can't rule out a known threat.",
  };
}

// ---------------------------------------------------------------------------
// Where would it take me? (redirect chain, including the final page)

const UNSEEN_PAGE = "If we can't open the page, we can't vouch for it.";

function answerDestination({
  url,
  signals,
  registeredDomainOf,
}: Context): Answer {
  const signal = signals.redirectChain;
  if (signal.status === "skipped") {
    return { answer: "We didn't open this link.", why: UNSEEN_PAGE };
  }
  if (signal.status !== "success" || !signal.data) {
    return {
      answer: "We couldn't follow the link to see where it leads.",
      why: UNSEEN_PAGE,
    };
  }

  const data = signal.data;
  if (!data.reachable) {
    return {
      answer: "We couldn't reach the site, so we can't say where it leads.",
      why: UNSEEN_PAGE,
    };
  }

  // Sites by registered domain when the parser is here; hosts otherwise,
  // and then a different host is never claimed to be a different site.
  const siteOf = (link: string | null | undefined) => {
    const host = link ? hostOf(link) : null;
    return host && registeredDomainOf ? registeredDomainOf(host) : host;
  };
  const start = siteOf(url);
  const end = siteOf(data.finalUrl) ?? start;
  // Sites passed through need the parser: www.example.com is not a detour.
  const via = registeredDomainOf
    ? [
        ...new Set(
          (data.hops ?? [])
            .map((hop) => siteOf(hop.url))
            .filter(
              (site): site is string =>
                site !== null && site !== start && site !== end,
            ),
        ),
      ]
    : [];
  const endsElsewhere = Boolean(start && end && start !== end);

  let route: string;
  if (endsElsewhere) {
    const ending = registeredDomainOf
      ? `It ends on ${end}, a different site`
      : `It ends on ${end}`;
    route =
      via.length > 0
        ? `${ending}, after passing through ${formatList(via)}.`
        : `${ending}.`;
  } else if (via.length > 0) {
    route = `It passes through ${formatList(via)} and comes back to this site.`;
  } else if (data.totalHops === 0) {
    route = "It opens this site directly, without redirects.";
  } else {
    route = `It stays on this site after ${countOf(data.totalHops, "redirect")}.`;
  }

  const downgraded = (data.hops ?? []).some((hop) =>
    hop.location?.startsWith("http://"),
  );
  const content = data.content ?? null;
  const passwordHosts =
    content && content.passwordInputCount > 0
      ? (content.crossOriginPasswordFormHosts ?? [])
      : [];
  const refreshSite = content?.metaRefreshTarget
    ? siteOf(content.metaRefreshTarget)
    : null;
  const refreshesElsewhere = Boolean(refreshSite && end && refreshSite !== end);
  const hidden = [
    content && content.hiddenIframeCount > 0
      ? countOf(content.hiddenIframeCount, "hidden frame")
      : null,
    content && content.obfuscationHints.length > 0
      ? "code written to be hard to read"
      : null,
  ].filter((part): part is string => part !== null);

  const answer = sentences([
    route,
    downgraded && "Part of the way uses plain HTTP, without encryption.",
    passwordHosts.length > 0 &&
      `Its page asks for a password and sends it to ${formatList(passwordHosts)}.`,
    refreshesElsewhere &&
      `The page then moves you on to ${refreshSite} by itself.`,
    hidden.length > 0 && `The page has ${formatList(hidden)}.`,
  ]);

  let why: string;
  if (passwordHosts.length > 0) {
    why = "Your password would leave the site you reached.";
  } else if ((endsElsewhere && registeredDomainOf) || refreshesElsewhere) {
    why = "The site you land on is the one you'd be trusting.";
  } else if (downgraded) {
    why =
      "Without encryption, others on the network can read or change what you see.";
  } else if (hidden.length > 0) {
    why = "Hidden parts of a page can do things you don't see.";
  } else if (via.length > 0) {
    why = "Detours through other sites can hide where a link really goes.";
  } else {
    why = "Scam links often bounce through other sites to hide where they end.";
  }
  return { answer, why };
}

// ---------------------------------------------------------------------------
// What else raises concern? (link pattern model, registration)

function labelWord(label: ClassificationFinding["label"]): string {
  return label === "malicious" ? "malicious-looking" : "risky";
}

/** The link pattern model and structure checks, by name, as CLAUDE.md requires. */
function describePattern(signals: SignalResults): {
  text: string;
  flags: boolean;
  ran: boolean;
  /** Who flagged it, as a sentence subject; null when nothing did. */
  flaggedBy: { subject: string; plural: boolean } | null;
} {
  const signal = signals.mlEnsemble;
  if (signal.status !== "success" || !signal.data) {
    return {
      text: "The link pattern model and structure checks couldn't run.",
      flags: false,
      ran: false,
      flaggedBy: null,
    };
  }

  const { consensusLabel, lexicalModel, transformerModel } = signal.data;
  const structureFlags = lexicalModel.label !== "benign";
  const modelFlags = Boolean(
    transformerModel && transformerModel.label !== "benign",
  );
  const modelMissing = transformerModel
    ? "the link pattern model doesn't"
    : "the link pattern model didn't run";

  if (consensusLabel === "benign") {
    return {
      text: transformerModel
        ? "The link pattern model and structure checks didn't flag it."
        : "The structure checks didn't flag it; the link pattern model didn't run.",
      flags: false,
      ran: true,
      flaggedBy: null,
    };
  }

  const both = {
    subject: "The link pattern model and structure checks",
    plural: true,
  };
  if (modelFlags && structureFlags) {
    return {
      text: `The link pattern model and structure checks both find the link ${labelWord(consensusLabel)}.`,
      flags: true,
      ran: true,
      flaggedBy: both,
    };
  }
  if (modelFlags && transformerModel) {
    return {
      text: `The link pattern model finds the link ${labelWord(transformerModel.label)}; the structure checks don't.`,
      flags: true,
      ran: true,
      flaggedBy: { subject: "The link pattern model", plural: false },
    };
  }
  if (structureFlags) {
    return {
      text: `The structure checks find the link ${labelWord(lexicalModel.label)}; ${modelMissing}.`,
      flags: true,
      ran: true,
      flaggedBy: { subject: "The structure checks", plural: true },
    };
  }
  return {
    text: `The link pattern model and structure checks find the link ${labelWord(consensusLabel)}.`,
    flags: true,
    ran: true,
    flaggedBy: both,
  };
}

/** The registered domain's age in days, when the registration tells it. */
function domainAgeDays(signals: SignalResults): number | null {
  const whois = signals.whois;
  return whois.status === "success" &&
    whois.data?.available &&
    !whois.data.sharedPlatform
    ? whois.data.ageDays
    : null;
}

function describeRegistration(signals: SignalResults): string {
  const whois = signals.whois;
  if (whois.status === "skipped") {
    return "Domain registration doesn't apply to this link.";
  }
  if (whois.status !== "success" || !whois.data) {
    return "We couldn't look up its registration.";
  }
  const data = whois.data;
  if (!data.available) {
    return "Its registration records weren't available.";
  }
  if (data.sharedPlatform) {
    return "Its registration belongs to the shared platform it's on, not to whoever made this page.";
  }
  return data.ageDays === null
    ? "Its registration records don't say when it was registered."
    : `Its domain was registered ${formatAge(data.ageDays)} ago.`;
}

function answerConcern({ signals }: Context): Answer {
  const pattern = describePattern(signals);
  const ageDays = domainAgeDays(signals);
  const young = ageDays !== null && ageDays < YOUNG_DOMAIN_DAYS;
  const registrationKnown = signals.whois.status === "success";

  let why: string;
  if (pattern.flags && young) {
    why = "Neither detail proves fraud on its own.";
  } else if (young) {
    why =
      ageDays < NEW_DOMAIN_DAYS
        ? "Scam sites are usually only days old."
        : "A fairly new domain is a mild warning sign.";
  } else if (pattern.flags) {
    why = "A pattern match is a hint, not proof.";
  } else if (!pattern.ran && !registrationKnown) {
    why = "Without these, the answer rests on the other checks.";
  } else {
    why = "Age and wording are hints; they can't clear a link on their own.";
  }

  return {
    answer: sentences([pattern.text, describeRegistration(signals)]),
    why,
  };
}

// ---------------------------------------------------------------------------
// Does HTTPS make it safe? (certificate) Always "No" first: a padlock is
// evidence of encryption, never of a trustworthy site.

const ONLY_THE_CONNECTION =
  "Even a valid certificate only protects the connection.";

function answerHttps({ url, signals, now }: Context): Answer {
  const redirect = signals.redirectChain.data;
  if (url.toLowerCase().startsWith("http://")) {
    // Plain HTTP that moves to HTTPS: only the first request is exposed.
    if (!redirect?.finalUrl.toLowerCase().startsWith("https://")) {
      return {
        answer:
          "No. This link doesn't use HTTPS, so the connection isn't encrypted.",
        why: "Without encryption, what you send can be read on the way.",
      };
    }
    const secured = answerCertificate(signals, now);
    return {
      answer: sentences([
        "No. This link starts on plain HTTP, then moves to HTTPS.",
        secured.state,
        secured.issued,
      ]),
      why: secured.why,
    };
  }

  const secured = answerCertificate(signals, now);
  return {
    answer: sentences([`No. ${secured.state}`, secured.issued]),
    why: secured.why,
  };
}

/** The certificate's state, its age, and why, after the leading "No.". */
function answerCertificate(
  signals: SignalResults,
  now: number,
): { state: string; issued: string | null; why: string } {
  const signal = signals.ssl;
  if (signal.status === "skipped") {
    return {
      state: "We didn't check a certificate for this link.",
      issued: null,
      why: ONLY_THE_CONNECTION,
    };
  }
  if (signal.status !== "success" || !signal.data || !signal.data.available) {
    return {
      state: "We couldn't check the certificate.",
      issued: null,
      why: ONLY_THE_CONNECTION,
    };
  }

  const data = signal.data;
  const issuedAt = data.validFrom ? Date.parse(data.validFrom) : Number.NaN;
  // The certificate we read (the leaf), never the domain's first one.
  const issued =
    Number.isFinite(issuedAt) && issuedAt <= now
      ? `This certificate was issued ${formatElapsed(now - issuedAt)} ago.`
      : null;

  switch (data.validationState) {
    case "trusted":
      return {
        state: "The site has a valid certificate.",
        issued,
        why: "Encryption protects the connection, not your trust in the site.",
      };
    case "warning":
      return {
        state: "We couldn't fully verify the site's certificate.",
        issued,
        why: ONLY_THE_CONNECTION,
      };
    default:
      return {
        state: "The site's certificate isn't trusted.",
        issued,
        why: "With a certificate error, even the connection may not be private.",
      };
  }
}

// ---------------------------------------------------------------------------
// What did the other checks find? (DNS, with the hosting network)

function answerOther({ signals }: Context): Answer {
  const signal = signals.dns;
  if (signal.status === "skipped") {
    return {
      answer: "DNS lookups don't apply to this link.",
      why: "The other checks carry the answer here.",
    };
  }
  if (signal.status !== "success" || !signal.data) {
    return {
      answer: "We couldn't look up its DNS records.",
      why: "The other checks carry the answer here.",
    };
  }

  const data = signal.data;
  const noAddress =
    data.subjectType !== "ip" &&
    data.addresses.length === 0 &&
    data.cnames.length === 0;
  // Private and reserved addresses are dropped before they reach us.
  const onlyPrivate =
    noAddress && data.observations.includes(PRIVATE_ADDRESSES_OMITTED);
  const anomalies = data.anomalies;

  const records =
    data.subjectType === "ip"
      ? "The link uses a raw IP address instead of a domain name."
      : onlyPrivate
        ? "It points only to private or reserved addresses."
        : noAddress
          ? "We found no address for this name."
          : anomalies.length > 0
            ? anomalies.join(" ")
            : "Nothing unusual in its DNS records.";

  // The network's registered country, never where the server is.
  const hosting = data.hosting;
  let network: string | null = null;
  if (hosting && hosting.asn === null) {
    network = "No network publicly routes its address.";
  } else if (hosting) {
    const name = hosting.asName
      ? `AS${hosting.asn} ${hosting.asName}`
      : `AS${hosting.asn}`;
    const country = hosting.registeredCountry
      ? `, registered in ${hosting.registeredCountry}`
      : "";
    network = `Its address belongs to network ${name}${country}.`;
  }

  // Only a confirmed report: a single engine or a listing elsewhere on
  // the host can sit under a Safe verdict, and this must not contradict it.
  const reportsStand = hasConfirmedReputationHit(signals);

  let why: string;
  if (anomalies.some((anomaly) => /punycode/i.test(anomaly))) {
    why = "Look-alike letters can make a fake name read like a real one.";
  } else if (anomalies.length > 0) {
    why = "Unusual records are a weak sign on their own.";
  } else if (onlyPrivate) {
    why = "A private address can only be reached inside one network.";
  } else if (noAddress) {
    why = "Without an address, we couldn't look at the site itself.";
  } else if (reportsStand) {
    why = "These findings don't cancel the threat reports.";
  } else {
    why = "Ordinary DNS is common to good and bad sites alike.";
  }

  return { answer: sentences([records, network]), why };
}

// ---------------------------------------------------------------------------
// Why checks disagree: one plain sentence, under the question where the
// conflict shows, only once every check involved has answered.

function disagreementFor(
  id: SummaryQuestionId,
  context: Context,
): string | null {
  const { signals, lists, now } = context;
  const listsAnswered = lists.every((list) => isSettled(signals, list.name));
  const noHits =
    listsAnswered &&
    lists.every((list) => list.state !== "hit") &&
    lists.some((list) => list.state === "clean" || list.state === "partial");
  const everyListPassed = lists.every((list) => list.state === "clean");
  const ageDays = isSettled(signals, "whois") ? domainAgeDays(signals) : null;
  // Days, not weeks: blocklists lag a new site by a day or two.
  const listsLagNewSite =
    noHits && ageDays !== null && ageDays < LISTS_LAG_DAYS;

  if (id === "reported") {
    if (listsLagNewSite) {
      return `Blocklists usually lag new sites by a day or two; this one is ${formatAge(ageDays)} old.`;
    }

    const vt = signals.virusTotal;
    const gsbMatches = signals.googleSafeBrowsing.data?.matches ?? [];
    const directFeeds = (signals.threatFeeds.data?.matches ?? []).filter(
      (match) => !isElsewhereOnHost(match),
    );
    if (vt.status !== "success" || !vt.data) return null;

    // A list names it while VirusTotal shows few or no engines. The
    // answer already dates the listing; this says why they differ, and
    // only while the listing is fresh enough for engines to lag it.
    const listedLongAgo =
      directFeeds.length > 0 &&
      gsbMatches.length === 0 &&
      directFeeds.every((match) => {
        const listedAt = listedAtOf(match);
        return listedAt !== null && now - listedAt > LISTS_LAG_DAYS * DAY_MS;
      });
    if (
      (gsbMatches.length > 0 || directFeeds.length > 0) &&
      vt.data.malicious < VT_CONVICTION_ENGINES &&
      !listedLongAgo
    ) {
      return "Lists often name a threat before VirusTotal's engines catch up.";
    }

    // VirusTotal convicts while every list answered with no match.
    const othersClean = lists
      .filter((list) => list.name !== "virusTotal")
      .every((list) => list.state === "clean");
    if (vt.data.malicious >= VT_CONVICTION_ENGINES && othersClean) {
      return "Each source is kept separately, so one can catch a link the others haven't reached yet.";
    }
    return null;
  }

  if (id === "concern") {
    // Said once: the "lists lag new sites" sentence already covers it.
    const { flaggedBy } = describePattern(signals);
    if (everyListPassed && !listsLagNewSite && flaggedBy) {
      return flaggedBy.plural
        ? `${flaggedBy.subject} read the link itself, so they can flag a new scam before any list does.`
        : `${flaggedBy.subject} reads the link itself, so it can flag a new scam before any list does.`;
    }
  }

  return null;
}
