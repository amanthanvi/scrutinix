import { isIP } from "node:net";

import { getEnv } from "@/lib/config/env";
import type { ClassificationFinding, MLSignalData } from "@/lib/domain/types";
import { getUrlStructureRisk } from "@/lib/domain/url-structure-risk";
import { classifyConsensus } from "@/lib/domain/verdict";
import { normalizeUrlInput } from "@/lib/domain/url";
import { fetchWithTimeout } from "@/lib/server/http";
import { getErrorMessage } from "@/lib/server/signal-error";

const HUGGING_FACE_ROUTER_BASE =
  "https://router.huggingface.co/hf-inference/models";

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

export async function runMlEnsembleProvider(
  url: string,
  signal?: AbortSignal,
): Promise<MLSignalData> {
  const lexicalModel = buildLexicalModel(url);
  const warnings: string[] = [];
  let hostedModel: ClassificationFinding | null = null;

  try {
    hostedModel = await runHostedModel(url, signal);
  } catch (error) {
    warnings.push(getErrorMessage(error, "Hosted classifier failed."));
  }

  const consensus = classifyConsensus(hostedModel, lexicalModel);

  return {
    hostedModel,
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

async function runHostedModel(
  url: string,
  signal?: AbortSignal,
): Promise<ClassificationFinding> {
  const env = getEnv();
  if (!env.HUGGINGFACE_API_KEY) {
    throw new Error("Hugging Face API key is not configured.");
  }

  const response = await fetchWithTimeout(
    `${HUGGING_FACE_ROUTER_BASE}/${env.HUGGINGFACE_URL_MODEL}`,
    {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${env.HUGGINGFACE_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ inputs: url }),
    },
    12_000,
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Hosted classifier model "${env.HUGGINGFACE_URL_MODEL}" is not available from the Hugging Face router.`,
      );
    }

    if (response.status === 410) {
      throw new Error(
        `Hosted classifier model "${env.HUGGINGFACE_URL_MODEL}" is deprecated by the Hugging Face provider.`,
      );
    }

    throw new Error(`Hosted classifier failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const predictions = Array.isArray(payload?.[0])
    ? payload[0]
    : Array.isArray(payload)
      ? payload
      : [];
  const topPrediction = predictions.reduce(
    (
      best: { label?: string; score?: number } | null,
      item: { label?: string; score?: number },
    ) => (!best || (item.score ?? 0) > (best.score ?? 0) ? item : best),
    null,
  );

  if (!topPrediction?.label) {
    throw new Error("Hosted classifier returned an unexpected payload.");
  }

  const normalizedLabel = topPrediction.label.toLowerCase();
  const label =
    normalizedLabel.includes("malicious") ||
    normalizedLabel.includes("phish") ||
    normalizedLabel.includes("malware") ||
    normalizedLabel.includes("deface")
      ? "malicious"
      : normalizedLabel.includes("benign") ||
          normalizedLabel.includes("safe") ||
          normalizedLabel.includes("clean")
        ? "benign"
        : normalizedLabel.includes("risk") ||
            normalizedLabel.includes("suspicious")
          ? "risky"
          : topPrediction.score && topPrediction.score > 0.45
            ? "risky"
            : "benign";

  return {
    label,
    score: Number((topPrediction.score ?? 0).toFixed(2)),
    reasons: [
      `Hosted model predicted ${topPrediction.label} with ${((topPrediction.score ?? 0) * 100).toFixed(0)}% confidence.`,
    ],
    model: "huggingface",
  };
}
