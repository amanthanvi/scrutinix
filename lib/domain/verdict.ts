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

  const score = clamp(
    contributions.reduce((total, item) => total + item.score, 0),
    0,
    100,
  );
  const verdict = threatScoreToVerdict(score);
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
    hasPositiveEvidence: reasons.length > 0,
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

function scoreVirusTotal(signals: SignalResults): Contribution[] {
  const signal = signals.virusTotal;
  if (signal.status !== "success" || !signal.data) {
    return [];
  }

  const { malicious, suspicious } = signal.data;
  const contributions: Contribution[] = [];

  if (malicious > 0) {
    contributions.push({
      score: clamp(malicious * 7, 18, 52),
      category: "Reputation",
      reason: `${malicious} VirusTotal engines marked the URL as malicious.`,
      quality: "high",
    });
  }

  if (suspicious > 0) {
    contributions.push({
      score: clamp(suspicious * 4, 8, 20),
      category: "Reputation",
      reason: `${suspicious} VirusTotal engines marked the URL as suspicious.`,
      quality: "high",
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

  const matchCount = signal.data.matches?.length ?? 0;
  return [
    {
      score: 45,
      category: "Google Safe Browsing",
      reason: `Google Safe Browsing reported ${matchCount} threat match${matchCount === 1 ? "" : "es"}.`,
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

  return (signal.data.matches ?? []).map((match) => ({
    score: match.confidence === "high" ? 32 : 20,
    category: "Threat Feed",
    reason: `${match.feed} listed the URL as ${match.detail}.`,
    quality: "high" as const,
  }));
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
      score: clamp(Math.round(signal.data.consensusScore * 40), 25, 40),
      category: "Behavioral Model",
      reason:
        consensusReason ??
        "The ML ensemble flagged the URL as malicious with strong model agreement.",
      quality: "medium",
    });
  } else if (signal.data.consensusLabel === "risky") {
    contributions.push({
      score: Math.round(signal.data.consensusScore * 14),
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

  const contributions: Contribution[] = [];

  if (signal.data.totalHops >= 3) {
    contributions.push({
      score: 8,
      category: "Redirects",
      reason: `The URL redirected through ${signal.data.totalHops} hops before settling.`,
      quality: "low",
    });
  }

  const downgradedToHttp = (signal.data.hops ?? []).some((hop) =>
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

  return contributions;
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
      .filter((item) => item.quality !== "low")
      .map((item) => item.category),
  ).size;

  let confidence = 0.18;
  confidence += dataRichSignals * 0.06;
  confidence += Math.max(0, successfulSignals - dataRichSignals) * 0.02;
  confidence += skippedSignals * 0.01;
  confidence -= failedSignals * 0.08;
  confidence -= Math.min(0.12, limitations.length * 0.02);

  if (verdict === "safe") {
    confidence += cleanHighConfidenceSources * 0.14;
    confidence -= unavailableHighConfidenceSources.length * 0.1;
  } else {
    confidence += positiveHighConfidenceSources * 0.16;
    confidence -= Math.min(0.12, cleanHighConfidenceSources * 0.04);
    confidence -= unavailableHighConfidenceSources.length * 0.05;
  }

  confidence += modelAgreement * 0.08;

  if (verdict !== "safe" && corroboratedRiskCategories >= 2) {
    confidence += 0.08;
  }

  if (verdict === "safe" && cleanHighConfidenceSources === 0) {
    confidence -= 0.15;
  }

  if (verdict === "safe" && unavailableHighConfidenceSources.length > 0) {
    confidence = Math.min(
      confidence,
      unavailableHighConfidenceSources.length >= 2 ? 0.69 : 0.79,
    );
  }

  if (verdict === "error") {
    confidence = 0.15;
  }

  return clamp(confidence, 0.15, verdict === "safe" ? 0.97 : 0.99);
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

  if (verdict === "safe") {
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
    (signals.threatFeeds.data.matches?.length ?? 0) > 0
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

  if (signals.threatFeeds.status !== "success") {
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
