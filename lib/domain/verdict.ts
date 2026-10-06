import { capitalize, countOf, formatAge, formatList } from "@/lib/domain/copy";
import {
  describeFeedMatch,
  describeSafeBrowsingThreats,
  feedDisplayName,
  isElsewhereOnHost,
} from "@/lib/domain/feed-copy";
import { getRegistrableDomain } from "@/lib/domain/registrable-domain";
import {
  feedMatchWeight,
  VT_CONVICTION_ENGINES,
  VT_STALE_ANALYSIS_DAYS,
  vtAnalysisAgeDays,
} from "@/lib/domain/reputation";
import { getSignalSeverity } from "@/lib/domain/signal-severity";
import type {
  AnalysisResult,
  SignalName,
  SignalResults,
  ThreatInfo,
  Verdict,
} from "@/lib/domain/types";
import { signalLabels, signalNames } from "@/lib/domain/types";
import { threatScoreToVerdict } from "@/lib/domain/score-bands";

export { hasConfirmedReputationHit } from "@/lib/domain/reputation";

interface Contribution {
  /** The check this evidence came from; drives the Summary row selection. */
  signal: SignalName;
  score: number;
  category: string;
  reason: string;
  quality: "high" | "medium" | "low";
  /**
   * How the one-line summary names this evidence. "source" subjects are
   * reputation sources that flagged the link ("7 VirusTotal engines");
   * "sign" subjects are warning signs found in the link itself ("a newly
   * registered domain"). Contributions sharing a group collapse to the
   * highest-scoring subject. Negative (exculpatory) evidence has none.
   */
  subject?: { text: string; kind: "source" | "sign"; group: string };
}

/** What a scorer returns; `collectContributions` tags it with its signal. */
type ScoredItem = Omit<Contribution, "signal">;

/** One scorer per signal, so every contribution knows its source check. */
const SCORERS: ReadonlyArray<
  readonly [SignalName, (signals: SignalResults) => ScoredItem[]]
> = [
  ["virusTotal", scoreVirusTotal],
  ["googleSafeBrowsing", scoreGoogleSafeBrowsing],
  ["threatFeeds", scoreThreatFeeds],
  ["mlEnsemble", scoreMlEnsemble],
  ["ssl", scoreSsl],
  ["dns", scoreDns],
  ["redirectChain", scoreRedirects],
  ["whois", scoreWhois],
];

function collectContributions(signals: SignalResults): Contribution[] {
  return SCORERS.flatMap(([signal, score]) =>
    score(signals).map((item) => ({ ...item, signal })),
  );
}

/**
 * The checks that added score to the verdict. The Summary view shows
 * exactly these (plus failures), so it can never say "All 8 checks found
 * nothing." under a verdict those checks raised. Exculpatory (negative)
 * evidence is not a driver.
 */
export function getScoredSignals(
  signals: SignalResults,
): ReadonlySet<SignalName> {
  return new Set(
    collectContributions(signals)
      .filter((item) => item.score > 0)
      .map((item) => item.signal),
  );
}

export function buildThreatAssessment(
  signals: SignalResults,
): Pick<AnalysisResult, "verdict" | "threatInfo"> {
  const statuses = Object.values(signals);
  const successfulSignals = statuses.filter(
    (signal) => signal.status === "success",
  ).length;
  const dataRichSignals = countDataRichSignals(signals);
  const skippedSignals = statuses.filter(
    (signal) => signal.status === "skipped",
  ).length;
  const failedSignals = statuses.filter(
    (signal) => signal.status === "error",
  ).length;

  if (successfulSignals === 0) {
    return {
      verdict: "error",
      threatInfo: null,
    };
  }

  const contributions = collectContributions(signals);

  applyExculpatoryEvidence(signals, contributions);

  const score = clamp(
    contributions.reduce((total, item) => total + item.score, 0),
    0,
    100,
  );
  const bandedVerdict = threatScoreToVerdict(score);
  // A dead host must not read as "Safe": the site itself could not be
  // inspected, so it was not cleared. Positive-scored verdicts are never downgraded - threat
  // feeds can rightfully convict a currently-unreachable domain.
  const verdict: Verdict =
    bandedVerdict === "safe" && isUnreachable(signals)
      ? "unknown"
      : bandedVerdict;
  const reasons = [...new Set(contributions.map((item) => item.reason))];
  const categories = [...new Set(contributions.map((item) => item.category))];
  const limitations = buildLimitations(signals);
  const confidence = calculateConfidence({
    signals,
    verdict,
    contributions,
    successfulSignals,
    dataRichSignals,
    skippedSignals,
    failedSignals,
    limitations,
  });

  const confidenceLabel = scoreToConfidenceLabel(confidence);
  const hasPositiveEvidence = contributions.some((item) => item.score > 0);
  const threatInfo: ThreatInfo = {
    verdict,
    confidence: Number(confidence.toFixed(2)),
    confidenceLabel,
    hasPositiveEvidence,
    scoredSignals: signalNames.filter((name) =>
      contributions.some((item) => item.signal === name && item.score > 0),
    ),
    confidenceReasons: buildConfidenceReasons(signals, verdict, limitations),
    score,
    summary: buildSummary(
      verdict,
      contributions,
      reasons,
      limitations.length > 0,
    ),
    categories,
    reasons: reasons.length ? reasons : ["No check flagged this link."],
    recommendations: buildRecommendations(verdict, {
      limitedCoverage: limitations.length > 0,
      // Same rule as the "Probably safe" imperative, so the first "What
      // to do" item never repeats it.
      provisional: confidenceLabel !== "high" || hasPositiveEvidence,
    }),
    limitations,
  };

  return {
    verdict,
    threatInfo,
  };
}

/**
 * True when no live probe got anything out of the host: the redirect probe
 * failed or received no HTTP status AND no TLS service answered. (A host
 * that doesn't resolve at all fails both probes by construction.)
 */
function isUnreachable(signals: SignalResults): boolean {
  const redirect = signals.redirectChain;
  const redirectUninspectable =
    redirect.status === "error" ||
    (redirect.status === "success" && redirect.data
      ? !redirect.data.reachable && redirect.data.terminalStatus === null
      : false);

  const ssl = signals.ssl;
  const sslUnavailable =
    ssl.status === "error" ||
    (ssl.status === "success" && ssl.data ? !ssl.data.available : false);

  return redirectUninspectable && sslUnavailable;
}

/**
 * Negative evidence: overwhelming clean reputation and long domain history
 * subtract from the score - but never haggle down a confirmed hit (any
 * single contribution >= 45 disables the discounts).
 */
function applyExculpatoryEvidence(
  signals: SignalResults,
  contributions: Contribution[],
) {
  const maxPositive = contributions.reduce(
    (max, item) => Math.max(max, item.score),
    0,
  );
  if (maxPositive >= 45) {
    return;
  }

  const vt = signals.virusTotal;
  const vtAgeDays = vtAnalysisAgeDays(signals);
  if (
    vt.status === "success" &&
    vt.data &&
    (vtAgeDays === null || vtAgeDays <= VT_STALE_ANALYSIS_DAYS) &&
    vt.data.harmless >= 60 &&
    vt.data.malicious === 0 &&
    vt.data.suspicious === 0
  ) {
    contributions.push({
      signal: "virusTotal",
      score: -10,
      category: "Reputation",
      reason: `${vt.data.harmless} VirusTotal engines independently rate this URL harmless.`,
      quality: "high",
    });
  }

  const hasReputationHit = contributions.some(
    (item) =>
      item.score > 0 &&
      (item.category === "Reputation" ||
        item.category === "Google Safe Browsing" ||
        item.category === "Threat Feed"),
  );
  const whois = signals.whois;
  if (
    !hasReputationHit &&
    whois.status === "success" &&
    whois.data &&
    whois.data.ageDays !== null &&
    whois.data.ageDays >= 365 * 5 &&
    !whois.data.subdomainOf &&
    !whois.data.sharedPlatform
  ) {
    contributions.push({
      signal: "whois",
      score: -8,
      category: "Domain Age",
      reason: `The domain has ${Math.floor(whois.data.ageDays / 365)} years of registration history, which weighs against impersonation.`,
      quality: "medium",
    });
  }
}

/** Sub-conviction ladder: one detection and two detections must differ. */
const VT_MALICIOUS_LADDER = [12, 22, 32, 42] as const;

function scoreVirusTotal(signals: SignalResults): ScoredItem[] {
  const signal = signals.virusTotal;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const { malicious, suspicious, domain } = signal.data;
  const contributions: ScoredItem[] = [];

  if (malicious > 0) {
    // >= 5 corroborating engines convict on their own (55+); below that the
    // ladder rises steadily instead of the old flat floor of 18.
    const score =
      malicious >= VT_CONVICTION_ENGINES
        ? Math.min(55 + (malicious - VT_CONVICTION_ENGINES) * 5, 85)
        : (VT_MALICIOUS_LADDER[malicious - 1] ?? 12);
    contributions.push({
      score,
      category: "Reputation",
      reason: `${countOf(malicious, "VirusTotal engine")} marked this link as malicious.`,
      quality: "high",
      subject: {
        text: countOf(malicious, "VirusTotal engine"),
        kind: "source",
        group: "virusTotal",
      },
    });
  }

  if (suspicious > 0) {
    contributions.push({
      score: Math.min(suspicious * 4, 16),
      category: "Reputation",
      reason: `${countOf(suspicious, "VirusTotal engine")} marked this link as suspicious.`,
      quality: "high",
      subject: {
        text: countOf(suspicious, "VirusTotal engine"),
        kind: "source",
        group: "virusTotal",
      },
    });
  }

  if (domain && domain.malicious >= 3) {
    contributions.push({
      score: 15,
      category: "Reputation",
      reason: `VirusTotal flags this domain beyond this URL (${countOf(domain.malicious, "engine")} mark the domain malicious).`,
      quality: "medium",
      subject: {
        text: "VirusTotal's domain reputation",
        kind: "source",
        group: "virusTotal",
      },
    });
  }

  return contributions;
}

function scoreGoogleSafeBrowsing(signals: SignalResults): ScoredItem[] {
  const signal = signals.googleSafeBrowsing;
  if (
    signal.status !== "success" ||
    !signal.data ||
    (signal.data.matches?.length ?? 0) === 0
  ) {
    return [];
  }

  const matches = signal.data.matches ?? [];
  const threatTypes = new Set(matches.map((match) => match.threatType));
  // A confirmed Google match convicts by itself (62 > malicious threshold);
  // additional distinct threat types stack toward critical.
  return [
    {
      score: Math.min(62 + (threatTypes.size - 1) * 6, 74),
      category: "Google Safe Browsing",
      reason: `Google Safe Browsing lists this link for ${describeSafeBrowsingThreats(matches)}.`,
      quality: "high",
      subject: {
        text: "Google Safe Browsing",
        kind: "source",
        group: "googleSafeBrowsing",
      },
    },
  ];
}

function scoreThreatFeeds(signals: SignalResults): ScoredItem[] {
  const signal = signals.threatFeeds;
  if (
    signal.status !== "success" ||
    !signal.data ||
    (signal.data.matches?.length ?? 0) === 0
  ) {
    return [];
  }

  return (signal.data.matches ?? []).map((match) => {
    const { score, quality } = feedMatchWeight(match);
    return {
      score,
      category: "Threat Feed",
      reason: describeFeedMatch(match),
      quality,
      // A listing of a different link on this host is a warning sign, not
      // the feed vouching that this link is bad.
      subject: isElsewhereOnHost(match)
        ? {
            text: `another link on this site listed by ${feedDisplayName(match.feed)}`,
            kind: "sign",
            group: "feed-host",
          }
        : {
            text: feedDisplayName(match.feed),
            kind: "source",
            group: `feed:${match.feed}`,
          },
    };
  });
}

function scoreMlEnsemble(signals: SignalResults): ScoredItem[] {
  const signal = signals.mlEnsemble;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const contributions: ScoredItem[] = [];
  const consensusReason = (signal.data.reasons ?? []).find(Boolean);

  if (signal.data.consensusLabel === "malicious") {
    contributions.push({
      score: clamp(Math.round(signal.data.consensusScore * 45), 25, 45),
      category: "Behavioral Model",
      reason:
        consensusReason ??
        "The link pattern model flagged this link as malicious.",
      quality: "medium",
      subject: { text: "the link pattern model", kind: "source", group: "ml" },
    });
  } else if (signal.data.consensusLabel === "risky") {
    contributions.push({
      score: Math.round(signal.data.consensusScore * 16),
      category: "Behavioral Model",
      reason:
        consensusReason ?? "The link pattern model found this link risky.",
      quality: "medium",
      subject: { text: "the link pattern model", kind: "source", group: "ml" },
    });
  }

  return contributions;
}

function scoreSsl(signals: SignalResults): ScoredItem[] {
  const signal = signals.ssl;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const contributions: ScoredItem[] = [];

  if (signal.data.validationState === "invalid") {
    contributions.push({
      score: 28,
      category: "TLS",
      reason:
        signal.data.observations?.[0] ??
        "The site's security certificate isn't trusted.",
      quality: "low",
      subject: { text: "an invalid certificate", kind: "sign", group: "tls" },
    });
  }

  if (signal.data.validationState === "untrusted") {
    contributions.push({
      score: 26,
      category: "TLS",
      reason: "The site uses an untrusted or self-signed security certificate.",
      quality: "low",
      subject: { text: "an untrusted certificate", kind: "sign", group: "tls" },
    });
  }

  // Fresh certificate on a brand-new domain: a classic phishing setup
  // pattern. The certificate age alone is deliberately NOT scored -
  // short-lived certificates (Let's Encrypt renewals) make young certs
  // routine on legitimate sites.
  const validFrom = signal.data.validFrom;
  const whois = signals.whois;
  const domainAgeDays =
    whois.status === "success" && whois.data ? whois.data.ageDays : null;
  if (validFrom && domainAgeDays !== null && domainAgeDays < 30) {
    const issuedAt = new Date(validFrom).getTime();
    const certAgeDays = Number.isNaN(issuedAt)
      ? null
      : Math.floor((Date.now() - issuedAt) / (1000 * 60 * 60 * 24));
    if (certAgeDays !== null && certAgeDays >= 0 && certAgeDays < 7) {
      contributions.push({
        score: 12,
        category: "TLS",
        reason: `A security certificate issued ${formatAge(certAgeDays)} ago on a domain registered ${formatAge(domainAgeDays)} ago matches a common phishing setup.`,
        quality: "medium",
        subject: {
          text: "a brand-new certificate on a brand-new domain",
          kind: "sign",
          group: "tls-fresh",
        },
      });
    }
  }

  return contributions;
}

function scoreDns(signals: SignalResults): ScoredItem[] {
  const signal = signals.dns;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  return (signal.data.anomalies ?? []).map((anomaly) => ({
    score: anomaly.includes("punycode") ? 8 : 4,
    category: "DNS",
    reason: anomaly,
    quality: "low" as const,
    subject: anomaly.includes("punycode")
      ? {
          text: "a look-alike domain name",
          kind: "sign" as const,
          group: "dns-punycode",
        }
      : { text: "unusual DNS records", kind: "sign" as const, group: "dns" },
  }));
}

function scoreRedirects(signals: SignalResults): ScoredItem[] {
  const signal = signals.redirectChain;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const data = signal.data;
  const contributions: ScoredItem[] = [];

  if (data.totalHops >= 3) {
    contributions.push({
      score: 8,
      category: "Redirects",
      reason: `The URL redirected through ${countOf(data.totalHops, "hop")} before settling.`,
      quality: "low",
      subject: {
        text: "a long redirect chain",
        kind: "sign",
        group: "redirect-hops",
      },
    });
  }

  const downgradedToHttp = (data.hops ?? []).some((hop) =>
    hop.location?.startsWith("http://"),
  );
  if (downgradedToHttp) {
    contributions.push({
      score: 10,
      category: "Redirects",
      reason: "The redirect chain downgrades or stays on HTTP.",
      quality: "medium",
      subject: {
        text: "a redirect over unencrypted HTTP",
        kind: "sign",
        group: "redirect-http",
      },
    });
  }

  // The classic shortener/lure pattern: any redirect that lands on a
  // different registrable domain than it started on.
  if (data.reachable && data.totalHops >= 1) {
    const fromDomain = registrableDomainOf(data.hops?.[0]?.url);
    const toDomain = registrableDomainOf(data.finalUrl);
    if (fromDomain && toDomain && fromDomain !== toDomain) {
      contributions.push({
        score: 14,
        category: "Redirects",
        reason: `The redirect chain crosses domains, from ${fromDomain} to ${toDomain}.`,
        quality: "medium",
        subject: {
          text: "a redirect to a different site",
          kind: "sign",
          group: "redirect-cross",
        },
      });
    }
  }

  const content = data.content;
  if (content) {
    const crossOriginPasswordHost = content.crossOriginPasswordFormHosts?.[0];
    if (content.passwordInputCount > 0 && crossOriginPasswordHost) {
      contributions.push({
        score: 20,
        category: "Page Content",
        reason: `The final page asks for credentials but submits its form to a different domain (${crossOriginPasswordHost}).`,
        quality: "medium",
        subject: {
          text: "a password form that sends to another site",
          kind: "sign",
          group: "page-password",
        },
      });
    }

    if (content.obfuscationHints.length >= 2) {
      contributions.push({
        score: 10,
        category: "Page Content",
        reason: `The final page contains obfuscated script (${content.obfuscationHints.slice(0, 2).join(", ")}).`,
        quality: "low",
        subject: {
          text: "deliberately hidden page code",
          kind: "sign",
          group: "page-obfuscation",
        },
      });
    }

    if (content.hiddenIframeCount >= 1 || content.iframeCount >= 3) {
      contributions.push({
        score: 8,
        category: "Page Content",
        reason:
          content.hiddenIframeCount >= 1
            ? `The final page embeds ${countOf(content.hiddenIframeCount, "hidden iframe")}.`
            : `The final page embeds ${countOf(content.iframeCount, "iframe")}.`,
        quality: "low",
        subject: {
          text: "hidden embedded frames",
          kind: "sign",
          group: "page-iframes",
        },
      });
    }

    if (content.metaRefreshTarget) {
      const pageDomain = registrableDomainOf(data.finalUrl);
      const refreshDomain = registrableDomainOf(content.metaRefreshTarget);
      if (pageDomain && refreshDomain && pageDomain !== refreshDomain) {
        contributions.push({
          score: 8,
          category: "Page Content",
          reason: `The final page meta-refreshes to another domain (${refreshDomain}).`,
          quality: "low",
          subject: {
            text: "an automatic jump to another site",
            kind: "sign",
            group: "page-refresh",
          },
        });
      }
    }
  }

  return contributions;
}

function registrableDomainOf(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return getRegistrableDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

function scoreWhois(signals: SignalResults): ScoredItem[] {
  const signal = signals.whois;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const contributions: ScoredItem[] = [];

  if (signal.data.ageDays !== null && signal.data.ageDays < 30) {
    contributions.push({
      score: 15,
      category: "Domain Age",
      reason: `The domain is only ${formatAge(signal.data.ageDays)} old.`,
      quality: "medium",
      subject: {
        text: "a domain less than a month old",
        kind: "sign",
        group: "domain-age",
      },
    });
  } else if (signal.data.ageDays !== null && signal.data.ageDays < 180) {
    contributions.push({
      score: 8,
      category: "Domain Age",
      reason: `The domain is fairly new: registered ${formatAge(signal.data.ageDays)} ago.`,
      quality: "low",
      subject: {
        text: "a recently registered domain",
        kind: "sign",
        group: "domain-age",
      },
    });
  }

  return contributions;
}

function buildLimitations(signals: SignalResults) {
  const limitations: string[] = [];

  for (const signalName of signalNames) {
    const signal = signals[signalName];

    if (signal.status === "error" && signal.error) {
      limitations.push(`${formatSignalName(signalName)}: ${signal.error}`);
      continue;
    }

    if (signal.status === "skipped" && signal.error) {
      limitations.push(`${formatSignalName(signalName)}: ${signal.error}`);
      continue;
    }

    if (signal.status === "success" && signal.data) {
      const data = signal.data as {
        warnings?: string[];
        observations?: string[];
      };

      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        limitations.push(
          ...data.warnings.map(
            (warning) => `${formatSignalName(signalName)}: ${warning}`,
          ),
        );
      }

      if (
        signalName === "ssl" &&
        "validationState" in signal.data &&
        signal.data.validationState === "warning" &&
        Array.isArray(data.observations)
      ) {
        limitations.push(
          ...data.observations.map(
            (item) => `${formatSignalName(signalName)}: ${item}`,
          ),
        );
      }

      if (
        signalName === "redirectChain" &&
        "reachable" in signal.data &&
        signal.data.reachable === false &&
        Array.isArray(data.observations)
      ) {
        limitations.push(
          ...data.observations.map(
            (item) => `${formatSignalName(signalName)}: ${item}`,
          ),
        );
      }

      if (
        signalName === "whois" &&
        "available" in signal.data &&
        signal.data.available === false &&
        Array.isArray(data.observations)
      ) {
        limitations.push(
          ...data.observations.map(
            (item) => `${formatSignalName(signalName)}: ${item}`,
          ),
        );
      }
    }
  }

  const vtAgeDays = vtAnalysisAgeDays(signals);
  if (vtAgeDays !== null && vtAgeDays > VT_STALE_ANALYSIS_DAYS) {
    limitations.push(
      `${formatSignalName("virusTotal")}: The verdict draws on a VirusTotal analysis from ${countOf(vtAgeDays, "day")} ago.`,
    );
  }

  return [...new Set(limitations)];
}

function calculateConfidence({
  signals,
  verdict,
  contributions,
  successfulSignals,
  dataRichSignals,
  skippedSignals,
  failedSignals,
  limitations,
}: {
  signals: SignalResults;
  verdict: Verdict;
  contributions: Contribution[];
  successfulSignals: number;
  dataRichSignals: number;
  skippedSignals: number;
  failedSignals: number;
  limitations: string[];
}) {
  const cleanHighConfidenceSources = countCleanHighConfidenceSources(signals);
  const positiveHighConfidenceSources =
    countPositiveHighConfidenceSources(signals);
  const unavailableHighConfidenceSources =
    getUnavailableHighConfidenceSources(signals);
  const modelAgreement = getModelAgreement(signals);
  const corroboratedRiskCategories = new Set(
    contributions
      .filter((item) => item.score > 0 && item.quality !== "low")
      .map((item) => item.category),
  ).size;
  // Unknown means "banded safe but nothing was reachable" - use the
  // clean-verdict math, then cap hard below.
  const effectiveVerdict = verdict === "unknown" ? "safe" : verdict;

  let confidence = 0.18;
  confidence += dataRichSignals * 0.06;
  confidence += Math.max(0, successfulSignals - dataRichSignals) * 0.02;
  confidence += skippedSignals * 0.01;
  confidence -= failedSignals * 0.08;
  confidence -= Math.min(0.12, limitations.length * 0.02);

  if (effectiveVerdict === "safe") {
    confidence += cleanHighConfidenceSources * 0.14;
    confidence -= unavailableHighConfidenceSources.length * 0.1;
  } else {
    confidence += positiveHighConfidenceSources * 0.16;
    confidence -= Math.min(0.12, cleanHighConfidenceSources * 0.04);
    confidence -= unavailableHighConfidenceSources.length * 0.05;
  }

  confidence += modelAgreement * 0.08;

  if (effectiveVerdict !== "safe" && corroboratedRiskCategories >= 2) {
    confidence += 0.08;
  }

  if (effectiveVerdict === "safe" && cleanHighConfidenceSources === 0) {
    confidence -= 0.15;
  }

  if (
    effectiveVerdict === "safe" &&
    unavailableHighConfidenceSources.length > 0
  ) {
    confidence = Math.min(
      confidence,
      unavailableHighConfidenceSources.length >= 2 ? 0.69 : 0.79,
    );
  }

  const vtAgeDays = vtAnalysisAgeDays(signals);
  if (
    effectiveVerdict === "safe" &&
    vtAgeDays !== null &&
    vtAgeDays > VT_STALE_ANALYSIS_DAYS
  ) {
    confidence = Math.min(confidence, 0.85);
  }

  if (verdict === "unknown") {
    confidence = Math.min(confidence, 0.4);
  }

  if (verdict === "error") {
    confidence = 0.15;
  }

  return clamp(confidence, 0.15, effectiveVerdict === "safe" ? 0.97 : 0.99);
}

function buildRecommendations(
  verdict: Verdict,
  {
    limitedCoverage,
    provisional,
  }: { limitedCoverage: boolean; provisional: boolean },
) {
  // Actions only: the verdict line already says what the result means.
  switch (verdict) {
    case "critical":
    case "malicious":
      return [
        "Don't enter passwords, payment details, or one-time codes on this site.",
        "Delete the message the link came in, or report it as phishing.",
        "If you already opened it, change any password you typed there and run a malware scan.",
      ];
    case "suspicious":
      return [
        "Confirm with the sender another way, such as a call or a message you start yourself.",
        "Don't download files from this site.",
      ];
    case "safe":
      // A provisional Safe already says "still check who sent it" in its
      // imperative; don't repeat it as the first thing to do.
      if (limitedCoverage) {
        return [
          "Re-scan later — some checks were limited this time.",
          "Be extra careful with shortened or urgent-sounding links.",
        ];
      }
      return provisional
        ? ["Be extra careful with shortened or urgent-sounding links."]
        : [
            "Still check who sent the link before you sign in or pay.",
            "Be extra careful with shortened or urgent-sounding links.",
          ];
    case "unknown":
      return [
        "Don't open it until the site responds and a re-scan finds nothing.",
        "Check the address for typos, or ask the sender to confirm it.",
      ];
    default:
      return ["Check your connection, then run the scan again."];
  }
}

/** Most evidence named in the one-line summary. */
const SUMMARY_SUBJECT_LIMIT = 3;

/**
 * One plain sentence naming what drove the verdict, e.g. "7 VirusTotal
 * engines and URLhaus flagged this link." The reasons list carries the
 * detail; this line must not repeat the verdict word or the score.
 */
function buildSummary(
  verdict: Verdict,
  contributions: Contribution[],
  reasons: string[],
  limitedCoverage: boolean,
) {
  const hasPositiveEvidence = contributions.some((item) => item.score > 0);

  if (verdict === "unknown") {
    return "The site didn't respond, so we couldn't look at the page itself.";
  }

  if (verdict === "safe") {
    if (hasPositiveEvidence) {
      return limitedCoverage
        ? "Only minor warning signs turned up, and some checks were limited."
        : "Only minor warning signs turned up.";
    }

    return limitedCoverage
      ? "No check flagged this link, but some checks were limited."
      : "No check flagged this link.";
  }

  if (verdict === "error") {
    return "The scan failed before enough checks finished.";
  }

  const subjects = summarySubjects(contributions);
  const sources = subjects.filter((subject) => subject.kind === "source");
  if (sources.length > 0) {
    return `${capitalize(formatList(sources.map((subject) => subject.text)))} flagged this link.`;
  }

  const signs = subjects.filter((subject) => subject.kind === "sign");
  if (signs.length > 0) {
    return `${capitalize(formatList(signs.map((subject) => subject.text)))} ${
      signs.length === 1 ? "makes" : "make"
    } this link look risky.`;
  }

  return reasons[0] ?? "Several checks found warning signs.";
}

function summarySubjects(contributions: Contribution[]) {
  const byGroup = new Map<
    string,
    { text: string; kind: "source" | "sign"; score: number }
  >();

  for (const item of contributions) {
    if (item.score <= 0 || !item.subject) {
      continue;
    }

    const existing = byGroup.get(item.subject.group);
    if (!existing || item.score > existing.score) {
      byGroup.set(item.subject.group, {
        text: item.subject.text,
        kind: item.subject.kind,
        score: item.score,
      });
    }
  }

  const ranked = [...byGroup.values()].sort((a, b) => b.score - a.score);
  const sources = ranked.filter((subject) => subject.kind === "source");
  const signs = ranked.filter((subject) => subject.kind === "sign");
  return [
    ...sources.slice(0, SUMMARY_SUBJECT_LIMIT),
    ...signs.slice(0, SUMMARY_SUBJECT_LIMIT),
  ];
}

/**
 * Why confidence sits where it does. Only shortfalls and evidence earn a
 * line - a fully finished scan says nothing about coverage, because the
 * check count already shows under Details.
 */
function buildConfidenceReasons(
  signals: SignalResults,
  verdict: Verdict,
  limitations: string[],
) {
  const reasons: string[] = [];
  const cleanSources = getCleanHighConfidenceSourceLabels(signals);
  const positiveHighConfidenceSources =
    countPositiveHighConfidenceSources(signals);

  if (verdict === "unknown") {
    // The summary already says the site didn't respond; say only what the
    // reputation sources can and can't vouch for.
    if (cleanSources.length > 0) {
      reasons.push(
        `${formatList(cleanSources)} found nothing, but ${
          cleanSources.length === 1 ? "it can't" : "they can't"
        } vouch for the page itself.`,
      );
    }
  } else if (verdict === "safe") {
    reasons.push(
      cleanSources.length > 0
        ? `${countOf(cleanSources.length, "major reputation source")} found nothing.`
        : "This result leans on checks of the link itself more than on reputation sources.",
    );
  } else {
    if (positiveHighConfidenceSources > 0) {
      reasons.push(
        `${countOf(positiveHighConfidenceSources, "major reputation source")} independently flagged this link.`,
      );
    }
    if (cleanSources.length > 0) {
      // "other" only has a referent when the previous line named sources.
      reasons.push(
        `${countOf(
          cleanSources.length,
          positiveHighConfidenceSources > 0
            ? "other major reputation source"
            : "major reputation source",
        )} found nothing, which lowers certainty.`,
      );
    }
  }

  const shortfalls = getCoverageShortfalls(signals);
  if (shortfalls.failed.length > 0) {
    reasons.push(
      `${formatList(shortfalls.failed)} didn't finish, which ${
        shortfalls.reputationFailed ? "capped" : "lowers"
      } confidence.`,
    );
  }
  if (shortfalls.partial.length > 0) {
    reasons.push(
      `${formatList(shortfalls.partial)} only partly finished, which capped confidence.`,
    );
  }
  // An Unknown summary already explains why the live checks came back
  // empty; naming them again adds nothing.
  if (verdict !== "unknown" && shortfalls.limited.length > 0) {
    reasons.push(
      `${formatList(shortfalls.limited)} returned only partial results.`,
    );
  }
  if (
    shortfalls.failed.length === 0 &&
    shortfalls.partial.length === 0 &&
    shortfalls.limited.length === 0 &&
    limitations.length > 0
  ) {
    reasons.push(
      "Some checks finished with caveats that slightly lower confidence.",
    );
  }

  if (signals.mlEnsemble.status === "success" && signals.mlEnsemble.data) {
    const { transformerModel, lexicalModel } = signals.mlEnsemble.data;
    if (transformerModel && transformerModel.label !== lexicalModel.label) {
      reasons.push(
        "The link pattern model and its rule-based check disagreed, so that signal counts for less.",
      );
    } else if (transformerModel) {
      reasons.push("The link pattern model and its rule-based check agreed.");
    }
  }

  return reasons.slice(0, 4);
}

const REPUTATION_SIGNALS: ReadonlySet<SignalName> = new Set([
  "virusTotal",
  "googleSafeBrowsing",
  "threatFeeds",
]);

/**
 * The checks that limited coverage, by label: `failed` didn't finish,
 * `partial` finished with warnings (worded like the coverage caveat), and
 * `limited` finished without a full answer (the same "neutral" rule the
 * signal rows and the Summary count use).
 */
function getCoverageShortfalls(signals: SignalResults) {
  const failed: string[] = [];
  const partial: string[] = [];
  const limited: string[] = [];
  let reputationFailed = false;

  for (const name of signalNames) {
    const signal = signals[name];
    if (signal.status === "error" || signal.status === "pending") {
      failed.push(signalLabels[name]);
      reputationFailed ||= REPUTATION_SIGNALS.has(name);
      continue;
    }
    if (signal.status !== "success" || !signal.data) {
      continue;
    }
    const warnings = (signal.data as { warnings?: unknown }).warnings;
    if (
      REPUTATION_SIGNALS.has(name) &&
      Array.isArray(warnings) &&
      warnings.length > 0
    ) {
      partial.push(signalLabels[name]);
    } else if (
      getSignalSeverity(signal.status, signal.data, name) === "neutral"
    ) {
      limited.push(signalLabels[name]);
    }
  }

  return { failed, partial, limited, reputationFailed };
}

function getCleanHighConfidenceSourceLabels(signals: SignalResults) {
  const labels: string[] = [];

  if (
    signals.virusTotal.status === "success" &&
    signals.virusTotal.data &&
    signals.virusTotal.data.malicious === 0 &&
    signals.virusTotal.data.suspicious === 0
  ) {
    labels.push(signalLabels.virusTotal);
  }

  if (
    signals.googleSafeBrowsing.status === "success" &&
    signals.googleSafeBrowsing.data &&
    (signals.googleSafeBrowsing.data.matches?.length ?? 0) === 0
  ) {
    labels.push(signalLabels.googleSafeBrowsing);
  }

  if (
    signals.threatFeeds.status === "success" &&
    signals.threatFeeds.data &&
    (signals.threatFeeds.data.matches?.length ?? 0) === 0 &&
    (signals.threatFeeds.data.warnings?.length ?? 0) === 0 &&
    // Set-aside platform listings are neither evidence nor a clean bill.
    !signals.threatFeeds.data.sharedPlatformListingsIgnored
  ) {
    labels.push(signalLabels.threatFeeds);
  }

  return labels;
}

function countCleanHighConfidenceSources(signals: SignalResults) {
  return getCleanHighConfidenceSourceLabels(signals).length;
}

function countPositiveHighConfidenceSources(signals: SignalResults) {
  let count = 0;

  if (
    signals.virusTotal.status === "success" &&
    signals.virusTotal.data &&
    (signals.virusTotal.data.malicious > 0 ||
      signals.virusTotal.data.suspicious > 0)
  ) {
    count += 1;
  }

  if (
    signals.googleSafeBrowsing.status === "success" &&
    signals.googleSafeBrowsing.data &&
    (signals.googleSafeBrowsing.data.matches?.length ?? 0) > 0
  ) {
    count += 1;
  }

  if (
    signals.threatFeeds.status === "success" &&
    signals.threatFeeds.data &&
    (signals.threatFeeds.data.matches ?? []).some(
      (match) => feedMatchWeight(match).quality === "high",
    )
  ) {
    count += 1;
  }

  return count;
}

function getUnavailableHighConfidenceSources(signals: SignalResults) {
  const unavailable: string[] = [];

  if (signals.virusTotal.status !== "success") {
    unavailable.push("VirusTotal");
  }

  if (signals.googleSafeBrowsing.status !== "success") {
    unavailable.push("Google Safe Browsing");
  }

  if (
    signals.threatFeeds.status !== "success" ||
    !signals.threatFeeds.data ||
    (signals.threatFeeds.data.warnings?.length ?? 0) > 0
  ) {
    unavailable.push("Threat Feeds");
  }

  return unavailable;
}

function getModelAgreement(signals: SignalResults) {
  const signal = signals.mlEnsemble;
  if (signal.status !== "success" || !signal.data) {
    return 0;
  }

  if (!signal.data.transformerModel) {
    return 0.55;
  }

  return signal.data.transformerModel.label === signal.data.lexicalModel?.label
    ? 1
    : 0.45;
}

function countDataRichSignals(signals: SignalResults) {
  return signalNames.filter((signalName) => {
    switch (signalName) {
      case "ssl": {
        const signal = signals.ssl;
        return (
          signal.status === "success" && !!signal.data && signal.data.available
        );
      }
      case "whois": {
        const signal = signals.whois;
        return (
          signal.status === "success" && !!signal.data && signal.data.available
        );
      }
      case "redirectChain": {
        const signal = signals.redirectChain;
        return (
          signal.status === "success" && !!signal.data && signal.data.reachable
        );
      }
      case "threatFeeds": {
        const signal = signals.threatFeeds;
        return (
          signal.status === "success" &&
          !!signal.data &&
          ((signal.data.matches?.length ?? 0) > 0 ||
            (signal.data.warnings?.length ?? 0) === 0)
        );
      }
      default:
        return signals[signalName].status === "success" &&
          signals[signalName].data
          ? true
          : false;
    }
  }).length;
}

function scoreToConfidenceLabel(
  confidence: number,
): ThreatInfo["confidenceLabel"] {
  if (confidence >= 0.85) {
    return "high";
  }

  if (confidence >= 0.5) {
    return "moderate";
  }

  return "low";
}

function formatSignalName(signalName: (typeof signalNames)[number]) {
  return signalLabels[signalName] ?? signalName;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
