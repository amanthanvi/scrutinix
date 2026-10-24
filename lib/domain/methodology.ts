import type { Verdict } from "@/lib/domain/types";

/**
 * The scoring method as /about states it: every weight, threshold, and rule
 * the verdict engine applies (`lib/domain/verdict.ts`, `reputation.ts`,
 * `score-bands.ts`), in plain words plus numbers. This module is copy only;
 * the engine keeps its own constants. `tests/unit/methodology.test.ts` runs
 * every row and number here through the engine, so the page can't drift
 * from what it describes. Change both together.
 */

export interface ScoringRow {
  /** Stable key; the test keys its engine scenarios by it. */
  id: string;
  finding: string;
  /** Points as shown. Negative points start with a real minus sign. */
  points: string;
  /** Enough on its own to make a link Malicious. */
  convicts?: true;
}

export interface ScoringTable {
  id: "lists" | "link" | "discounts";
  caption: string;
  note: string;
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

/** Confidence, as a percentage, and the caps that keep it honest. */
export const CONFIDENCE = {
  /** "High confidence" from here. */
  high: 85,
  /** "Moderate confidence" from here; "Low" below. */
  moderate: 50,
  /** Safe with one of the three major lists missing goes no higher. */
  safeOneListMissing: 79,
  /** Safe with two or more of them missing goes no higher. */
  safeListsMissing: 69,
  /** Unknown never goes above this. */
  unknown: 40,
} as const;

export const SCORING_TABLES: readonly ScoringTable[] = [
  {
    id: "lists",
    caption: "Lists of known bad links",
    note: "Each listing counts separately, so two lists naming the same link add up.",
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
        finding:
          "ThreatFox lists the link or its site, at 75% confidence or more",
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
        finding: "Spamhaus DBL lists the domain for spam",
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
        finding: "One to four VirusTotal engines call it malicious",
        points: "12, 22, 32, or 42",
      },
      {
        id: "vt-malicious-many",
        finding: "Five or more VirusTotal engines call it malicious",
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
    note: `No single one of these can make a link Malicious: the most any one adds is ${LINK_CHECK_MAX}. Several together can.`,
    rows: [
      {
        id: "ml-malicious",
        finding: "The link pattern model calls it malicious",
        points: "25 to 45, by how sure it is",
      },
      {
        id: "ml-risky",
        finding: "The link pattern model calls it risky",
        points: "Up to 16, by how sure it is",
      },
      {
        id: "cert-invalid",
        finding: "The site's certificate is invalid",
        points: "28",
      },
      {
        id: "cert-untrusted",
        finding: "The site's certificate is untrusted or self-signed",
        points: "26",
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
      },
      {
        id: "dns-punycode",
        finding: "The name is punycode, which can hide look-alike letters",
        points: "8",
      },
      {
        id: "dns-addresses",
        finding: "The name points to 6 or more addresses",
        points: "4",
      },
      {
        id: "redirect-hops",
        finding: "The link redirects 3 or more times",
        points: "8",
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
        finding: "The final page hides its code (two or more signs)",
        points: "10",
      },
      {
        id: "page-iframes",
        finding: "The final page embeds a hidden frame, or 3 or more frames",
        points: "8",
      },
      {
        id: "page-refresh",
        finding: "The final page jumps to another site on its own",
        points: "8",
      },
    ],
  },
  {
    id: "discounts",
    caption: "What lowers the score",
    note: `Neither applies when any single finding is worth ${DISCOUNTS_OFF_AT} or more, so a good record never talks down a serious listing.`,
    rows: [
      {
        id: "vt-harmless",
        finding:
          "60 or more VirusTotal engines call it harmless, none flag it, and the analysis isn't more than 30 days old",
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
