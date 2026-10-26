import type { ClassificationFinding } from "@/lib/domain/types";

/**
 * Combine the transformer classifier with the lexical heuristics into one
 * ensemble finding. The notes it adds are shown to people in the Link
 * Pattern Model's details, so they use the same two plain names as that
 * panel's rows (`components/shared/signal-utils.ts`) and the verdict
 * reasons (`lib/domain/verdict.ts`): "link pattern model" and "structure
 * checks", never "transformer" or "lexical heuristics". The transformer
 * carries more weight, but no transformer reading suppresses strong
 * structural evidence from the lexical side - phishing URLs frequently look
 * "clean" to a text model while tripping structural checks - and a
 * transformer flag never scores below the structure checks alone (its
 * score is its distance from its bar, so a flag just past the bar is
 * small).
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

  const structureFloor =
    lexical.label === "malicious"
      ? Math.min(0.95, lexical.score * 0.97)
      : lexical.label === "risky"
        ? lexical.score * 0.78
        : 0;
  const effectiveRisk = Math.max(combinedRisk, structureFloor);

  // When only the structure checks flag the link, they set the label, so
  // their reasons lead (the verdict states the first one).
  const structureLed =
    transformer.label === "benign" && lexical.label !== "benign";
  const disagreementNote =
    transformer.label !== lexical.label
      ? structureLed
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
      ...new Set(
        structureLed
          ? [...lexical.reasons, ...disagreementNote, ...transformer.reasons]
          : [...transformer.reasons, ...lexical.reasons, ...disagreementNote],
      ),
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
