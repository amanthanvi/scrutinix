import type { ClassificationFinding } from "@/lib/domain/types";

/**
 * Combine the transformer classifier with the lexical heuristics into one
 * ensemble finding. The notes it adds are shown to people in the Link
 * Pattern Model's details, so they use the same two plain names as that
 * panel's rows (`components/shared/signal-utils.ts`) and the verdict
 * reasons (`lib/domain/verdict.ts`): "link pattern model" and "structure
 * checks", never "transformer" or "lexical heuristics". The transformer
 * carries more weight, but benign
 * transformer calls never suppress strong structural evidence from the
 * lexical side - phishing URLs frequently look "clean" to a text model
 * while tripping structural checks.
 */
export function classifyConsensus(
  transformer: ClassificationFinding | null,
  lexical: ClassificationFinding,
): ClassificationFinding {
  if (!transformer) {
    return lexical;
  }

  const combinedRisk =
    transformer.score * labelRiskWeight(transformer.label) * 0.7 +
    lexical.score * labelRiskWeight(lexical.label) * 0.3;

  let effectiveRisk = combinedRisk;
  if (transformer.label === "benign" && lexical.label !== "benign") {
    if (lexical.label === "malicious") {
      effectiveRisk = Math.max(
        combinedRisk,
        Math.min(0.95, lexical.score * 0.97),
      );
    } else {
      effectiveRisk = Math.max(combinedRisk, lexical.score * 0.78);
    }
  }

  const disagreementNote =
    transformer.label !== lexical.label
      ? transformer.label === "benign" && lexical.label !== "benign"
        ? [
            "The link pattern model read this link as normal, but its structure looked risky, so the risk was raised to match the structure.",
          ]
        : [
            "The link pattern model and the structure checks disagreed, so this result is less certain.",
          ]
      : ["The link pattern model and the structure checks agreed."];

  return {
    label:
      (transformer.label === "malicious" &&
        lexical.label !== "benign" &&
        effectiveRisk >= 0.55) ||
      effectiveRisk >= 0.74
        ? "malicious"
        : effectiveRisk >= 0.38
          ? "risky"
          : "benign",
    score: Number(effectiveRisk.toFixed(2)),
    reasons: [
      ...new Set([
        ...transformer.reasons,
        ...lexical.reasons,
        ...disagreementNote,
      ]),
    ],
    model: "ensemble",
  } satisfies ClassificationFinding;
}

function labelRiskWeight(label: ClassificationFinding["label"]) {
  switch (label) {
    case "malicious":
      return 1;
    case "risky":
      return 0.6;
    default:
      return 0.08;
  }
}
