import { isIP } from "node:net";

import { classifyConsensus } from "@/lib/domain/ml-consensus";
import type { ClassificationFinding, MLSignalData } from "@/lib/domain/types";
import { getUrlStructureRisk } from "@/lib/domain/url-structure-risk";
import { normalizeUrlInput } from "@/lib/domain/url";
import { classifyUrlLocally } from "@/lib/server/ml/local-classifier";
import { getErrorMessage } from "@/lib/server/signal-error";

const HIGH_RISK_KEYWORDS = [
  "login",
  "verify",
  "secure",
  "wallet",
  "reset",
  "invoice",
  "update",
  "banking",
  "mfa",
  "gift-card",
  "airdrop",
  "auth",
];

const EXECUTABLE_INDICATORS = [
  "x86_64",
  "x64",
  "arm64",
  ".exe",
  ".msi",
  ".pkg",
  ".dmg",
  ".apk",
  ".jar",
  ".iso",
  ".scr",
  ".bat",
  "payload",
  "setup",
  "download",
];

const RISKY_TLDS = new Set(["zip", "click", "top", "gq", "work", "country"]);

// No AbortSignal: inference is local, offline, and bounded by its own
// init/inference timeouts.
export async function runMlEnsembleProvider(
  url: string,
): Promise<MLSignalData> {
  const lexicalModel = buildLexicalModel(url);
  const warnings: string[] = [];
  let transformerModel: ClassificationFinding | null = null;

  try {
    transformerModel = await classifyUrlLocally(url);
  } catch (error) {
    warnings.push(
      `${getErrorMessage(error, "The local URL classifier failed.")} Falling back to lexical heuristics only.`,
    );
  }

  const consensus = classifyConsensus(transformerModel, lexicalModel);

  return {
    transformerModel,
    lexicalModel,
    consensusLabel: consensus.label,
    consensusScore: consensus.score,
    reasons: consensus.reasons,
    warnings,
  };
}

function buildLexicalModel(url: string): ClassificationFinding {
  const parsed = normalizeUrlInput(url);
  const reasons: string[] = [];

  if (!parsed.ok) {
    return {
      label: "risky",
      score: 0.5,
      reasons: ["The input required repair before it could be normalized."],
      model: "lexical-heuristic",
    };
  }

  const parsedUrl = new URL(parsed.value.normalizedUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname.toLowerCase();
  const query = parsedUrl.search.toLowerCase();
  const combinedText = `${hostname}${path}${query}`;
  let score = 0.08;

  if (hostname.includes("xn--")) {
    score += 0.18;
    reasons.push("The hostname uses punycode encoding.");
  }

  if (hostname.split(".").length >= 5) {
    score += 0.12;
    reasons.push("The hostname has an unusual number of subdomains.");
  }

  const keywordMatches = HIGH_RISK_KEYWORDS.filter((keyword) =>
    combinedText.includes(keyword),
  );
  if (keywordMatches.length > 0) {
    score += Math.min(0.25, keywordMatches.length * 0.06);
    reasons.push(
      `The URL contains high-risk terms such as ${keywordMatches.slice(0, 3).join(", ")}.`,
    );
  }

  if (parsedUrl.username || parsedUrl.password) {
    score += 0.1;
    reasons.push("The URL includes embedded credentials.");
  }

  if (parsedUrl.search.includes("%")) {
    score += 0.08;
    reasons.push("The query string contains encoded characters.");
  }

  if (isIP(hostname)) {
    score += 0.3;
    reasons.push("The URL targets a literal IP address instead of a domain.");
  }

  const executableMatches = EXECUTABLE_INDICATORS.filter((indicator) =>
    combinedText.includes(indicator),
  );
  if (executableMatches.length > 0) {
    score += Math.min(0.36, executableMatches.length * 0.14);
    reasons.push(
      `The path or query references executable-style content such as ${executableMatches.slice(0, 3).join(", ")}.`,
    );
  }

  const tld = hostname.split(".").at(-1);
  if (tld && RISKY_TLDS.has(tld)) {
    score += 0.12;
    reasons.push(`The domain uses a high-risk top-level domain (${tld}).`);
  }

  if (parsed.value.normalizedUrl.length > 120) {
    score += 0.08;
    reasons.push("The URL is unusually long.");
  }

  const structure = getUrlStructureRisk(url);
  score += structure.scoreDelta;
  reasons.push(...structure.reasons);

  const label =
    score >= 0.74 ? "malicious" : score >= 0.45 ? "risky" : "benign";

  return {
    label,
    score: Number(Math.min(score, 0.95).toFixed(2)),
    reasons: reasons.length
      ? reasons
      : ["No suspicious lexical patterns were found."],
    model: "lexical-heuristic",
  };
}
