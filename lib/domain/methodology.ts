import { formatList } from "@/lib/domain/copy";
import {
  THREATFOX_HIGH_CONFIDENCE,
  VT_CONVICTION_ENGINES,
  VT_STALE_ANALYSIS_DAYS,
} from "@/lib/domain/reputation";
import type { Verdict } from "@/lib/domain/types";
import { CONFIDENCE_POLICY } from "@/lib/domain/verdict";
import { LOOK_ALIKE_WORD } from "@/lib/domain/verdict-guidance";

/**
 * The scoring method as /about states it: every weight, threshold, and rule
 * the verdict engine applies (`lib/domain/verdict.ts`, `reputation.ts`,
 * `score-bands.ts`, and the provider thresholds they rely on), in plain
 * words plus numbers.
 *
 * The points tables are copy: `tests/unit/methodology.test.ts` runs every
 * row through the engine, checks every number a row prints against the
 * numbers it declares, and tests both sides of each threshold. The
 * confidence figures are the engine's own `CONFIDENCE_POLICY`, printed
 * directly. Change a weight and its row together.
 */

export interface ScoringRow {
  /** Stable key; the test keys its engine scenarios by it. */
  id: string;
  finding: string;
  /** Points as shown. Negative points start with a real minus sign. */
  points: string;
  /** Enough on its own to make a link at least Malicious. */
  convicts?: true;
  /**
   * A weak sign (the engine's low-quality evidence), named this way in the
   * confidence arithmetic. Weak signs add points but never count as a
   * second kind of evidence backing a risky verdict.
   */
  weak?: string;
}

export interface ScoringTable {
  id: "lists" | "link" | "discounts";
  caption: string;
  notes: readonly string[];
  rows: readonly ScoringRow[];
}

/** Scores at or above this read Malicious; one finding can get there alone. */
export const CONVICTS_AT = 55;

/** The most any single check of the link itself adds. */
export const LINK_CHECK_MAX = 45;

/** Any single finding worth this much switches both discounts off. */
export const DISCOUNTS_OFF_AT = 45;

export const SCORE_BANDS: ReadonlyArray<{
  min: number;
  max: number;
  verdict: Extract<Verdict, "safe" | "suspicious" | "malicious" | "critical">;
  label: string;
}> = [
  { min: 0, max: 24, verdict: "safe", label: "Safe" },
  { min: 25, max: 54, verdict: "suspicious", label: "Suspicious" },
  { min: 55, max: 79, verdict: "malicious", label: "Malicious" },
  { min: 80, max: 100, verdict: "critical", label: "Critical" },
];

export const SCORING_TABLES: readonly ScoringTable[] = [
  {
    id: "lists",
    caption: "Lists of known bad links",
    notes: [
      "Each listing counts separately, so two lists naming the same link add up.",
      "On shared platforms where anyone can publish, such as github.com or docs.google.com, a listing of the whole site doesn't count; a listing of this exact link still does.",
    ],
    rows: [
      {
        id: "gsb",
        finding: "Google Safe Browsing lists the link",
        points: "62, plus 6 for each further kind of threat, up to 74",
        convicts: true,
      },
      {
        id: "feed-url",
        finding: "URLhaus or OpenPhish lists this exact link",
        points: "55",
        convicts: true,
      },
      {
        id: "feed-host",
        finding: "URLhaus or OpenPhish lists the site, not this exact link",
        points: "25",
      },
      {
        id: "threatfox-high",
        finding: `ThreatFox lists the link or its site, at ${THREATFOX_HIGH_CONFIDENCE}% confidence or more`,
        points: "55",
        convicts: true,
      },
      {
        id: "threatfox-medium",
        finding: "ThreatFox lists the link or its site, at lower confidence",
        points: "40",
      },
      {
        id: "threatfox-elsewhere",
        finding: "ThreatFox lists a different link on the same site",
        points: "25",
      },
      {
        id: "dbl-high",
        finding:
          "Spamhaus DBL lists the domain for phishing, malware, or botnet control",
        points: "45",
      },
      {
        id: "dbl-spam",
        finding: "Spamhaus DBL lists the domain only as low-reputation",
        points: "25",
      },
      {
        id: "dbl-abused",
        finding:
          "Spamhaus DBL lists the domain as a legitimate site that has been abused",
        points: "15",
      },
      {
        id: "surbl-high",
        finding:
          "SURBL lists the domain for phishing, malware, or cracked software",
        points: "35",
      },
      {
        id: "surbl-abused",
        finding: "SURBL lists the domain as abused",
        points: "20",
      },
      {
        id: "vt-malicious-few",
        finding: `1 to ${VT_CONVICTION_ENGINES - 1} VirusTotal engines call it malicious`,
        points: "12, 22, 32, or 42",
      },
      {
        id: "vt-malicious-many",
        finding: `${VT_CONVICTION_ENGINES} or more VirusTotal engines call it malicious`,
        points: "55, plus 5 for each further engine, up to 85",
        convicts: true,
      },
      {
        id: "vt-suspicious",
        finding: "VirusTotal engines call it suspicious",
        points: "4 for each engine, up to 16",
      },
    ],
  },
  {
    id: "link",
    caption: "Checks of the link itself",
    notes: [
      `No single one of these can make a link Malicious: the most any one adds is ${LINK_CHECK_MAX}. Several together can.`,
      "The page checks read the page's HTML as it downloads; they don't run its scripts.",
    ],
    rows: [
      {
        id: "ml-malicious",
        finding: "The link pattern model calls it malicious",
        points: "45 × the model's score (0 to 1), rounded, but at least 25",
      },
      {
        id: "ml-risky",
        finding: "The link pattern model calls it risky",
        points: "16 × the model's score, rounded",
      },
      {
        id: "cert-invalid",
        finding: "The site's certificate is invalid",
        points: "28",
        weak: "an invalid certificate",
      },
      {
        id: "cert-untrusted",
        finding: "The site's certificate is untrusted or self-signed",
        points: "26",
        weak: "an untrusted certificate",
      },
      {
        id: "cert-fresh",
        finding: "A certificate under 7 days old on a domain under 30 days old",
        points: "12",
      },
      {
        id: "age-month",
        finding: "The domain was registered less than 30 days ago",
        points: "15",
      },
      {
        id: "age-young",
        finding: "The domain was registered 30 to 179 days ago",
        points: "8",
        weak: "a domain 30 to 179 days old",
      },
      {
        id: "dns-punycode",
        finding: "The name is punycode, which can hide look-alike letters",
        points: "8",
        weak: "unusual DNS records",
      },
      {
        id: "dns-addresses",
        finding:
          "The name points to 6 or more addresses of one kind (IPv4 or IPv6)",
        points: "4",
        weak: "unusual DNS records",
      },
      {
        id: "redirect-hops",
        finding: "The link redirects 3 or more times",
        points: "8",
        weak: "a long redirect chain",
      },
      {
        id: "redirect-http",
        finding: "A redirect goes over plain, unencrypted HTTP",
        points: "10",
      },
      {
        id: "redirect-cross",
        finding: "The redirects end on a different site",
        points: "14",
      },
      {
        id: "page-password",
        finding:
          "The final page asks for a password and sends it to another site",
        points: "20",
      },
      {
        id: "page-obfuscation",
        finding: "The final page hides its code (2 or more signs)",
        points: "10",
        weak: "hidden page code",
      },
      {
        id: "page-iframes",
        finding: "The final page embeds a hidden frame, or 3 or more frames",
        points: "8",
        weak: "embedded frames",
      },
      {
        id: "page-refresh",
        finding:
          "The final page's HTML sends you to another site automatically (a meta refresh)",
        points: "8",
        weak: "an automatic jump",
      },
    ],
  },
  {
    id: "discounts",
    caption: "What lowers the score",
    notes: [
      `Neither applies when any single finding is worth ${DISCOUNTS_OFF_AT} or more, so a good record never talks down a serious listing.`,
    ],
    rows: [
      {
        id: "vt-harmless",
        finding:
          "60 or more VirusTotal engines call it harmless, none flag it, and its analysis is no more than 30 days old (or has no date)",
        points: "−10",
      },
      {
        id: "domain-history",
        finding:
          "The domain is 5 or more years old, no list or VirusTotal engine flagged it, and the link is on the domain itself (or its www), not a deeper subdomain or a shared platform",
        points: "−8",
      },
    ],
  },
];

/** The rules beside the tables: what convicts, what can't erase a hit. */
export const RULES: ReadonlyArray<{ term: string; text: string }> = [
  {
    term: "Convicts on its own",
    text: `Any single finding worth ${CONVICTS_AT} or more makes a link at least Malicious by itself: a Google Safe Browsing listing, an exact-link listing on URLhaus or OpenPhish, a ThreatFox listing of the link or its site at ${THREATFOX_HIGH_CONFIDENCE}% confidence or more, or ${VT_CONVICTION_ENGINES} or more VirusTotal engines.`,
  },
  {
    term: "Can't erase a hit",
    text: `Only the two discounts subtract, and both switch off when any single finding is worth ${DISCOUNTS_OFF_AT} or more. The domain-age discount also switches off when any list or VirusTotal engine flagged the link.`,
  },
  {
    term: "Unknown",
    text: "A total that would read Safe becomes Unknown when the site didn't answer at all: no web response and no secure connection. We couldn't look at it, so we don't clear it. A higher total stands, because lists can rightly flag a site that's offline.",
  },
  {
    term: LOOK_ALIKE_WORD,
    text: `When we recognise another site's address in a Safe link's subdomain or login name, as in paypal.com.secure-login.xyz, the result reads ${LOOK_ALIKE_WORD} instead. The score doesn't change, and the details still show it. We look for addresses with common endings such as .com or .co.uk, not every possible name, and never in the page part of a link. Your browser does this check; if it can't load the part that does, a Safe result reads Unconfirmed instead of Safe, with no score.`,
  },
];

/** A share of 1 as a whole or one-decimal percentage: 0.044 → "4.4". */
function percent(share: number): string {
  return String(Math.round(share * 1000) / 10);
}

function signed(share: number, sign: "+" | "−"): string {
  return `${sign}${percent(share)}`;
}

const policy = CONFIDENCE_POLICY;

const weakSigns = [
  ...new Set(
    SCORING_TABLES.flatMap((table) => table.rows)
      .map((row) => row.weak)
      .filter((weak): weak is string => Boolean(weak)),
  ),
];

/** Confidence as /about states it: the engine's own figures. */
export const CONFIDENCE = {
  high: percent(policy.labels.high),
  moderate: percent(policy.labels.moderate),
  caps: [
    `A Safe result with one of VirusTotal, Google Safe Browsing, or the threat feeds missing, or answering only in part, goes no higher than ${percent(policy.caps.safeOneListMissing)}%; with ${policy.caps.manyListsMissing} or more, no higher than ${percent(policy.caps.safeListsMissing)}%. Either way it can't be High.`,
    `A Safe result resting on a VirusTotal analysis more than ${VT_STALE_ANALYSIS_DAYS} days old goes no higher than ${percent(policy.caps.safeStaleVirusTotal)}%.`,
    `Unknown goes no higher than ${percent(policy.caps.unknown)}%, so it's always Low.`,
    `Every result stays between ${percent(policy.floor)}% and ${percent(policy.safeCeiling)}% (Safe) or ${percent(policy.riskyCeiling)}% (everything else).`,
  ],
  /** Under the arithmetic: what "major list" and "answered clean" mean. */
  footnote:
    "The major lists are VirusTotal, Google Safe Browsing, and the threat feeds. The threat feeds count as answering clean only when every feed answered and none listed the site, not even with a shared-platform listing set aside from the score. “Otherwise” means any verdict but Safe and Unknown; Unknown is worked out like Safe, then capped.",
  /** How the figure adds up, before the caps. */
  steps: [
    { step: "Start", value: `${percent(policy.start)}%` },
    {
      step: "Each check that came back with something to go on",
      value: signed(policy.perDataRichCheck, "+"),
    },
    {
      step: "Each check that finished without much (no certificate, no registration record, no answer from the site, or threat feeds that answered only in part and found nothing)",
      value: signed(policy.perThinCheck, "+"),
    },
    {
      step: "Each check that didn't apply",
      value: signed(policy.perSkippedCheck, "+"),
    },
    {
      step: "Each check that failed",
      value: signed(policy.perFailedCheck, "−"),
    },
    {
      step: "Each note about something that couldn't be checked",
      value: `${signed(policy.perLimitation, "−")}, at most ${signed(policy.maxLimitations, "−")} in all`,
    },
    {
      step: "The link pattern model's two members agree / only one answered / they disagree",
      value: [
        policy.modelAgreementShare.agree,
        policy.modelAgreementShare.oneMember,
        policy.modelAgreementShare.disagree,
      ]
        .map((share) => signed(policy.modelAgreement * share, "+"))
        .join(" / "),
    },
    {
      step: "Safe: each major list that answered clean",
      value: signed(policy.safe.perCleanList, "+"),
    },
    {
      step: "Safe: each major list missing or answering only in part",
      value: signed(policy.safe.perMissingList, "−"),
    },
    {
      step: "Safe: no major list answered clean",
      value: signed(policy.safe.noCleanList, "−"),
    },
    {
      step: "Otherwise: each major list that flagged it (for the threat feeds, a listing strong enough to convict, or a high-confidence Spamhaus DBL or SURBL listing)",
      value: signed(policy.risky.perFlaggingList, "+"),
    },
    {
      step: "Otherwise: each major list that answered clean",
      value: `${signed(policy.risky.perCleanList, "−")}, at most ${signed(policy.risky.maxCleanLists, "−")} in all`,
    },
    {
      step: "Otherwise: each major list missing or answering only in part",
      value: signed(policy.risky.perMissingList, "−"),
    },
    {
      step: `Otherwise: ${policy.risky.corroboratedKinds} or more different kinds of finding back it up (say, a list and the link pattern model), not counting weak signs (${formatList(weakSigns)})`,
      value: signed(policy.risky.corroborated, "+"),
    },
  ],
} as const;
