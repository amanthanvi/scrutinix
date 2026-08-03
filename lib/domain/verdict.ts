import { getRegistrableDomain } from "@/lib/domain/registrable-domain";
import type {
  AnalysisResult,
  SignalResults,
  ThreatInfo,
  Verdict,
} from "@/lib/domain/types";
import { signalLabels, signalNames } from "@/lib/domain/types";
import { threatScoreToVerdict } from "@/lib/domain/score-bands";

interface Contribution {
  score: number;
  category: string;
  reason: string;
  quality: "high" | "medium" | "low";
}

/** Days after which a stored VirusTotal analysis is considered stale. */
const VT_STALE_ANALYSIS_DAYS = 30;

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

  const contributions = [
    ...scoreVirusTotal(signals),
    ...scoreGoogleSafeBrowsing(signals),
    ...scoreThreatFeeds(signals),
    ...scoreMlEnsemble(signals),
    ...scoreSsl(signals),
    ...scoreDns(signals),
    ...scoreRedirects(signals),
    ...scoreWhois(signals),
  ];

  applyExculpatoryEvidence(signals, contributions);

  const score = clamp(
    contributions.reduce((total, item) => total + item.score, 0),
    0,
    100,
  );
  const bandedVerdict = threatScoreToVerdict(score);
  // A dead host must not read as "Safe": nothing was inspected, so nothing
  // was cleared. Positive-scored verdicts are never downgraded - threat
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

  const threatInfo: ThreatInfo = {
    verdict,
    confidence: Number(confidence.toFixed(2)),
    confidenceLabel: scoreToConfidenceLabel(confidence),
    hasPositiveEvidence: contributions.some((item) => item.score > 0),
    confidenceReasons: buildConfidenceReasons(
      signals,
      verdict,
      successfulSignals,
      dataRichSignals,
      skippedSignals,
      failedSignals,
      contributions,
      limitations,
    ),
    score,
    summary: buildSummary(verdict, categories, reasons, limitations.length > 0),
    categories,
    reasons: reasons.length
      ? reasons
      : ["No direct malicious indicators were found in the completed signals."],
    recommendations: buildRecommendations(verdict, limitations.length > 0),
    limitations,
  };

  return {
    verdict,
    threatInfo,
  };
}

/**
 * True when no live probe got anything out of the host: the redirect probe
 * failed or found it unreachable AND no TLS service answered. (A host that
 * doesn't resolve at all fails both probes by construction.)
 */
function isUnreachable(signals: SignalResults): boolean {
  const redirect = signals.redirectChain;
  const redirectUnreachable =
    redirect.status === "error" ||
    (redirect.status === "success" && redirect.data
      ? !redirect.data.reachable
      : false);

  const ssl = signals.ssl;
  const sslUnavailable =
    ssl.status === "error" ||
    (ssl.status === "success" && ssl.data ? !ssl.data.available : false);

  return redirectUnreachable && sslUnavailable;
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
    whois.data.ageDays >= 365 * 5
  ) {
    contributions.push({
      score: -8,
      category: "Domain Age",
      reason: `The domain has ${Math.floor(whois.data.ageDays / 365)} years of registration history, which weighs against impersonation.`,
      quality: "medium",
    });
  }
}

/** Age of the VirusTotal analysis backing the verdict, in whole days. */
function vtAnalysisAgeDays(signals: SignalResults): number | null {
  const vt = signals.virusTotal;
  if (vt.status !== "success" || !vt.data?.lastAnalysisDate) {
    return null;
  }

  const analyzedAt = new Date(vt.data.lastAnalysisDate).getTime();
  if (Number.isNaN(analyzedAt) || analyzedAt > Date.now()) {
    return null;
  }

  return Math.floor((Date.now() - analyzedAt) / (1000 * 60 * 60 * 24));
}

/** Sub-conviction ladder: one detection and two detections must differ. */
const VT_MALICIOUS_LADDER = [12, 22, 32, 42] as const;

function scoreVirusTotal(signals: SignalResults): Contribution[] {
  const signal = signals.virusTotal;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const { malicious, suspicious, domain } = signal.data;
  const contributions: Contribution[] = [];

  if (malicious > 0) {
    // >= 5 corroborating engines convict on their own (55+); below that the
    // ladder rises steadily instead of the old flat floor of 18.
    const score =
      malicious >= 5
        ? Math.min(55 + (malicious - 5) * 5, 85)
        : (VT_MALICIOUS_LADDER[malicious - 1] ?? 12);
    contributions.push({
      score,
      category: "Reputation",
      reason: `${malicious} VirusTotal engines marked the URL as malicious.`,
      quality: "high",
    });
  }

  if (suspicious > 0) {
    contributions.push({
      score: Math.min(suspicious * 4, 16),
      category: "Reputation",
      reason: `${suspicious} VirusTotal engines marked the URL as suspicious.`,
      quality: "high",
    });
  }

  if (domain && domain.malicious >= 3) {
    contributions.push({
      score: 15,
      category: "Reputation",
      reason: `VirusTotal flags this domain beyond this URL (${domain.malicious} engines mark the domain malicious).`,
      quality: "medium",
    });
  }

  return contributions;
}

function scoreGoogleSafeBrowsing(signals: SignalResults): Contribution[] {
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
      reason: `Google Safe Browsing reported ${matches.length} threat match${matches.length === 1 ? "" : "es"} (${[...threatTypes].join(", ")}).`,
      quality: "high",
    },
  ];
}

function scoreThreatFeeds(signals: SignalResults): Contribution[] {
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
      reason: `${match.feed} listed the URL as ${match.detail}.`,
      quality,
    };
  });
}

type FeedMatch = NonNullable<
  SignalResults["threatFeeds"]["data"]
>["matches"][number];

function feedMatchWeight(match: FeedMatch): {
  score: number;
  quality: Contribution["quality"];
} {
  switch (match.feed) {
    case "urlhaus":
    case "openphish":
      // An exact-URL listing convicts; a host-level listing corroborates.
      return match.matchType === "host"
        ? { score: 25, quality: "medium" }
        : { score: 55, quality: "high" };
    case "threatfox":
      return match.confidence === "high"
        ? { score: 55, quality: "high" }
        : { score: 40, quality: "medium" };
    case "spamhaus-dbl":
      if (match.confidence === "high") {
        return { score: 45, quality: "high" };
      }
      return match.detail.includes("abused")
        ? { score: 15, quality: "medium" }
        : { score: 25, quality: "medium" };
    case "surbl":
      return match.confidence === "high"
        ? { score: 35, quality: "high" }
        : { score: 20, quality: "medium" };
  }
}

function scoreMlEnsemble(signals: SignalResults): Contribution[] {
  const signal = signals.mlEnsemble;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const contributions: Contribution[] = [];
  const consensusReason = (signal.data.reasons ?? []).find(Boolean);

  if (signal.data.consensusLabel === "malicious") {
    contributions.push({
      score: clamp(Math.round(signal.data.consensusScore * 45), 25, 45),
      category: "Behavioral Model",
      reason:
        consensusReason ??
        "The ML ensemble flagged the URL as malicious with strong model agreement.",
      quality: "medium",
    });
  } else if (signal.data.consensusLabel === "risky") {
    contributions.push({
      score: Math.round(signal.data.consensusScore * 16),
      category: "Behavioral Model",
      reason:
        consensusReason ??
        "The ML ensemble raised a cautious risk signal for the URL.",
      quality: "medium",
    });
  }

  return contributions;
}

function scoreSsl(signals: SignalResults): Contribution[] {
  const signal = signals.ssl;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const contributions: Contribution[] = [];

  if (signal.data.validationState === "invalid") {
    contributions.push({
      score: 28,
      category: "TLS",
      reason:
        signal.data.observations?.[0] ??
        "The TLS certificate could not be validated cleanly.",
      quality: "low",
    });
  }

  if (signal.data.validationState === "untrusted") {
    contributions.push({
      score: 26,
      category: "TLS",
      reason:
        "The endpoint appears to use an untrusted or self-signed certificate.",
      quality: "low",
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
        reason: `A TLS certificate issued ${certAgeDays} day${certAgeDays === 1 ? "" : "s"} ago on a domain registered ${domainAgeDays} day${domainAgeDays === 1 ? "" : "s"} ago matches a common phishing setup pattern.`,
        quality: "medium",
      });
    }
  }

  return contributions;
}

function scoreDns(signals: SignalResults): Contribution[] {
  const signal = signals.dns;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  return (signal.data.anomalies ?? []).map((anomaly) => ({
    score: anomaly.includes("punycode") ? 8 : 4,
    category: "DNS",
    reason: anomaly,
    quality: "low" as const,
  }));
}

function scoreRedirects(signals: SignalResults): Contribution[] {
  const signal = signals.redirectChain;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const data = signal.data;
  const contributions: Contribution[] = [];

  if (data.totalHops >= 3) {
    contributions.push({
      score: 8,
      category: "Redirects",
      reason: `The URL redirected through ${data.totalHops} hops before settling.`,
      quality: "low",
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
      });
    }
  }

  const content = data.content;
  if (content) {
    if (
      content.passwordInputCount > 0 &&
      content.crossOriginFormHosts.length > 0
    ) {
      contributions.push({
        score: 20,
        category: "Page Content",
        reason: `The final page asks for credentials but submits its form to a different domain (${content.crossOriginFormHosts[0]}).`,
        quality: "medium",
      });
    }

    if (content.obfuscationHints.length >= 2) {
      contributions.push({
        score: 10,
        category: "Page Content",
        reason: `The final page contains obfuscated script (${content.obfuscationHints.slice(0, 2).join(", ")}).`,
        quality: "low",
      });
    }

    if (content.hiddenIframeCount >= 1 || content.iframeCount >= 3) {
      contributions.push({
        score: 8,
        category: "Page Content",
        reason:
          content.hiddenIframeCount >= 1
            ? `The final page embeds ${content.hiddenIframeCount} hidden iframe${content.hiddenIframeCount === 1 ? "" : "s"}.`
            : `The final page embeds ${content.iframeCount} iframes.`,
        quality: "low",
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

function scoreWhois(signals: SignalResults): Contribution[] {
  const signal = signals.whois;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const contributions: Contribution[] = [];

  if (signal.data.ageDays !== null && signal.data.ageDays < 30) {
    contributions.push({
      score: 15,
      category: "Domain Age",
      reason: `The domain is only ${signal.data.ageDays} day${signal.data.ageDays === 1 ? "" : "s"} old.`,
      quality: "medium",
    });
  } else if (signal.data.ageDays !== null && signal.data.ageDays < 180) {
    contributions.push({
      score: 8,
      category: "Domain Age",
      reason: `The domain is relatively new at ${signal.data.ageDays} days old.`,
      quality: "low",
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
      `${formatSignalName("virusTotal")}: The verdict draws on a VirusTotal analysis from ${vtAgeDays} days ago.`,
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

function buildRecommendations(verdict: Verdict, limitedCoverage: boolean) {
  switch (verdict) {
    case "critical":
    case "malicious":
      return [
        "Do not open the link outside an isolated environment.",
        "Do not enter credentials, payment details, or MFA codes.",
        "If you already visited it, clear browser state and run a device malware scan.",
      ];
    case "suspicious":
      return [
        "Verify the sender and business context before opening the link.",
        "Open only in a disposable browser profile or sandbox if you must inspect it.",
        "Avoid submitting credentials or downloading files until trust is established.",
      ];
    case "safe":
      return limitedCoverage
        ? [
            "No strong malicious indicators were found in the completed signals.",
            "Treat this result as provisional until the skipped or unavailable checks are understood.",
          ]
        : [
            "No high-confidence malicious indicators were found in this scan.",
            "Continue normal caution for unfamiliar links, especially shortened or time-sensitive ones.",
          ];
    case "unknown":
      return [
        "The host could not be reached, so most signals had nothing to inspect.",
        "Treat the link with caution; re-scan later or verify the address before visiting.",
      ];
    default:
      return [
        "The scan could not gather enough data to determine a safe verdict.",
      ];
  }
}

function buildSummary(
  verdict: Verdict,
  categories: string[],
  reasons: string[],
  limitedCoverage: boolean,
) {
  if (verdict === "unknown") {
    return "The host was unreachable during this scan; the absence of findings is not evidence of safety.";
  }

  if (verdict === "safe") {
    return limitedCoverage
      ? "No strong malicious indicators were found, but some signals were unavailable or only partially verified."
      : "No strong malicious indicators were found across the available signals.";
  }

  if (verdict === "error") {
    return "The scan failed before enough signals completed.";
  }

  if (categories.length > 0) {
    return `${capitalize(verdict)} risk based on ${categories.slice(0, 2).join(" and ")} signals.`;
  }

  return reasons[0] ?? "The scan found suspicious behavior.";
}

function buildConfidenceReasons(
  signals: SignalResults,
  verdict: Verdict,
  successfulSignals: number,
  dataRichSignals: number,
  skippedSignals: number,
  failedSignals: number,
  contributions: Contribution[],
  limitations: string[],
) {
  const completedSignals = successfulSignals + skippedSignals;
  const limitedSignals = Math.max(0, successfulSignals - dataRichSignals);
  const reasons = [
    `${completedSignals}/8 signals completed, with ${dataRichSignals} producing data-rich results.`,
  ];

  const cleanHighConfidenceSources = countCleanHighConfidenceSources(signals);
  const positiveHighConfidenceSources =
    countPositiveHighConfidenceSources(signals);
  const unavailableHighConfidenceSources =
    getUnavailableHighConfidenceSources(signals);

  if (verdict === "unknown") {
    reasons.push(
      "The host was unreachable, so the active probes had nothing to inspect.",
    );
  } else if (verdict === "safe") {
    if (cleanHighConfidenceSources > 0) {
      reasons.push(
        `${cleanHighConfidenceSources} high-confidence reputation sources returned clean results.`,
      );
    } else {
      reasons.push(
        "The clean verdict relies more on local observations than on external reputation sources.",
      );
    }
  } else if (positiveHighConfidenceSources > 0) {
    reasons.push(
      `${positiveHighConfidenceSources} high-confidence sources independently supported the risk verdict.`,
    );
  }

  if (verdict !== "safe" && cleanHighConfidenceSources > 0) {
    reasons.push(
      `${cleanHighConfidenceSources} other high-confidence sources stayed clean, which tempered certainty.`,
    );
  }

  if (unavailableHighConfidenceSources.length > 0) {
    reasons.push(
      `${formatSourceList(unavailableHighConfidenceSources)} did not complete, which capped confidence.`,
    );
  }

  if (signals.mlEnsemble.status === "success" && signals.mlEnsemble.data) {
    const { transformerModel, lexicalModel } = signals.mlEnsemble.data;
    if (transformerModel && transformerModel.label !== lexicalModel.label) {
      reasons.push(
        "The ML models disagreed, so the ensemble confidence was reduced.",
      );
    } else if (transformerModel) {
      reasons.push(
        "The transformer and lexical models agreed on the ensemble direction.",
      );
    }
  }

  if (failedSignals > 0) {
    reasons.push(
      `${failedSignals} signal${failedSignals === 1 ? "" : "s"} failed and reduced certainty.`,
    );
  }

  if (limitedSignals > 0) {
    reasons.push(
      `${limitedSignals} completed signal${limitedSignals === 1 ? "" : "s"} returned only partial coverage.`,
    );
  }

  if (limitations.length > 0 && failedSignals === 0) {
    reasons.push(
      "Some signals completed with caveats that slightly reduced confidence.",
    );
  }

  return reasons.slice(0, 4);
}

function countCleanHighConfidenceSources(signals: SignalResults) {
  let count = 0;

  if (
    signals.virusTotal.status === "success" &&
    signals.virusTotal.data &&
    signals.virusTotal.data.malicious === 0 &&
    signals.virusTotal.data.suspicious === 0
  ) {
    count += 1;
  }

  if (
    signals.googleSafeBrowsing.status === "success" &&
    signals.googleSafeBrowsing.data &&
    (signals.googleSafeBrowsing.data.matches?.length ?? 0) === 0
  ) {
    count += 1;
  }

  if (
    signals.threatFeeds.status === "success" &&
    signals.threatFeeds.data &&
    (signals.threatFeeds.data.matches?.length ?? 0) === 0 &&
    (signals.threatFeeds.data.warnings?.length ?? 0) === 0
  ) {
    count += 1;
  }

  return count;
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

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatSourceList(values: string[]) {
  if (values.length <= 1) {
    return values[0] ?? "A primary source";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
