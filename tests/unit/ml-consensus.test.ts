import { describe, expect, it } from "vitest";

import { classifyConsensus } from "@/lib/domain/ml-consensus";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { createPendingSignalResults } from "@/lib/domain/types";

describe("classifyConsensus", () => {
  it("floors ensemble risk when the transformer is benign but lexical is malicious", () => {
    const result = classifyConsensus(
      {
        label: "benign",
        score: 0.9,
        reasons: ["Transformer model predicted benign."],
        model: "urlbert-tiny-v4-phishing-q8",
      },
      {
        label: "malicious",
        score: 0.8,
        reasons: ["Literal IP and script path."],
        model: "lexical-heuristic",
      },
    );

    expect(result.label).toBe("malicious");
    expect(result.score).toBeGreaterThanOrEqual(0.74);
    expect(result.reasons.join(" ")).toMatch(
      /risk was raised to match the structure/i,
    );
    expect(result.reasons.join(" ")).not.toMatch(
      /disagreed, so this result is less certain/i,
    );
  });

  it("floors ensemble risk when the transformer is benign but lexical is risky with meaningful score", () => {
    const result = classifyConsensus(
      {
        label: "benign",
        score: 0.7,
        reasons: ["Transformer model predicted benign."],
        model: "urlbert-tiny-v4-phishing-q8",
      },
      {
        label: "risky",
        score: 0.52,
        reasons: ["Structural cues."],
        model: "lexical-heuristic",
      },
    );

    expect(result.label).toBe("risky");
    expect(result.score).toBeGreaterThanOrEqual(0.38);
    expect(result.reasons.join(" ")).toMatch(
      /risk was raised to match the structure/i,
    );
  });

  it("does not elevate when transformer and lexical both agree on benign", () => {
    const result = classifyConsensus(
      {
        label: "benign",
        score: 0.6,
        reasons: ["Transformer model predicted benign."],
        model: "urlbert-tiny-v4-phishing-q8",
      },
      {
        label: "benign",
        score: 0.08,
        reasons: ["No suspicious lexical patterns were found."],
        model: "lexical-heuristic",
      },
    );

    expect(result.label).toBe("benign");
    expect(result.reasons.join(" ")).toMatch(/structure checks agreed/i);
  });

  it("uses reduced-certainty wording when models disagree without the benign-transformer lexical boost", () => {
    const result = classifyConsensus(
      {
        label: "malicious",
        score: 0.85,
        reasons: ["Transformer model predicted malicious."],
        model: "urlbert-tiny-v4-phishing-q8",
      },
      {
        label: "benign",
        score: 0.1,
        reasons: ["No suspicious lexical patterns were found."],
        model: "lexical-heuristic",
      },
    );

    expect(result.reasons.join(" ")).toMatch(
      /disagreed, so this result is less certain/i,
    );
    expect(result.reasons.join(" ")).not.toMatch(
      /risk was raised to match the structure/i,
    );
  });

  it("returns the lexical finding untouched when no transformer result exists", () => {
    const lexical = {
      label: "risky" as const,
      score: 0.5,
      reasons: ["Structural cues."],
      model: "lexical-heuristic",
    };

    expect(classifyConsensus(null, lexical)).toBe(lexical);
  });

  it("treats benign transformer plus structural malicious lexical as suspicious via buildThreatAssessment", () => {
    const signals = createPendingSignalResults();
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 12,
      data: {
        transformerModel: {
          label: "benign",
          score: 0.59,
          reasons: ["Transformer model predicted benign with 59% confidence."],
          model: "urlbert-tiny-v4-phishing-q8",
        },
        lexicalModel: {
          label: "malicious",
          score: 0.76,
          reasons: [
            "The URL targets a literal IP address instead of a domain.",
            "The URL references script or shell content such as .sh.",
            "The URL uses a non-standard HTTPS port (38376), which is uncommon for typical web services.",
          ],
          model: "lexical-heuristic",
        },
        consensusLabel: "malicious",
        consensusScore: 0.74,
        reasons: [
          "Transformer model predicted benign with 59% confidence.",
          "The URL targets a literal IP address instead of a domain.",
          "The URL references script or shell content such as .sh.",
          "The transformer model scored this link benign, but lexical heuristics disagreed; effective risk was raised to reflect structural evidence.",
        ],
        warnings: [],
      },
    };

    const result = buildThreatAssessment(signals);

    expect(result.verdict).toBe("suspicious");
    expect(result.threatInfo?.score).toBeGreaterThanOrEqual(25);
  });
});

describe("classifyConsensus with the model's score as a distance from its bar", () => {
  const structure = (
    label: "benign" | "risky" | "malicious",
    score: number,
  ) => ({
    label,
    score,
    reasons: ["The URL targets a literal IP address instead of a domain."],
    model: "lexical-heuristic",
  });
  const model = (label: "benign" | "malicious", score: number) => ({
    label,
    score,
    reasons: [
      `The link pattern model read this link as ${label === "benign" ? "normal" : "phishing"}.`,
    ],
    model: "urlbert-tiny-v4-phishing-q8",
  });

  it("never scores a model flag below the structure checks alone", () => {
    // A flag just past the bar has a score near 0.5. Before the floor
    // applied to flags too, agreeing with risky structure scored less
    // than reading the link as normal (0.59 against 0.78 here).
    for (const lexical of [
      structure("risky", 0.5),
      structure("risky", 0.7),
      structure("malicious", 0.8),
      structure("malicious", 0.95),
    ]) {
      const normal = classifyConsensus(model("benign", 0.99), lexical);
      for (const score of [0.5, 0.55, 0.62, 0.8, 1]) {
        const flagged = classifyConsensus(model("malicious", score), lexical);
        expect(flagged.score).toBeGreaterThanOrEqual(normal.score);
      }
    }
  });

  it("leads with the structure checks' reasons when only they flag the link", () => {
    const result = classifyConsensus(
      model("benign", 0.9),
      structure("risky", 0.52),
    );
    expect(result.label).toBe("risky");
    expect(result.reasons[0]).toBe(
      "The URL targets a literal IP address instead of a domain.",
    );

    const signals = createPendingSignalResults();
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 1,
      data: {
        transformerModel: model("benign", 0.9),
        lexicalModel: structure("risky", 0.52),
        consensusLabel: result.label,
        consensusScore: result.score,
        reasons: result.reasons,
        warnings: [],
      },
    };
    // The verdict states why the score went up, not the model's "normal".
    expect(buildThreatAssessment(signals).threatInfo?.reasons).toEqual([
      "The URL targets a literal IP address instead of a domain.",
    ]);
  });

  it("leads with the model's reading when the model flags the link", () => {
    const result = classifyConsensus(
      model("malicious", 0.9),
      structure("risky", 0.5),
    );
    expect(result.reasons[0]).toBe(
      "The link pattern model read this link as phishing.",
    );
  });
});

describe("one plain name per ensemble member", () => {
  it("uses the same names in the details rows and the consensus notes", async () => {
    const { getSignalDetailEntries } =
      await import("@/components/shared/signal-utils");
    const lexical = {
      label: "benign" as const,
      score: 0.05,
      reasons: [],
      model: "lexical-heuristic",
    };
    const transformer = { ...lexical, model: "urlbert" };
    const consensus = classifyConsensus(transformer, lexical);
    const labels = getSignalDetailEntries("mlEnsemble", {
      transformerModel: transformer,
      lexicalModel: lexical,
      consensusLabel: consensus.label,
      consensusScore: consensus.score,
      reasons: consensus.reasons,
      warnings: [],
    }).map((entry) => entry.label);

    expect(labels).toContain("Structure checks");
    // The signal is "Link Pattern Model": its own part is not named after it.
    expect(labels).toContain("Model reading");
    expect(labels).not.toContain("Link pattern model");
    const notes = consensus.reasons.join(" ").toLowerCase();
    expect(notes).toContain("structure checks");
    expect(notes).toContain("link pattern model");
    expect(notes).not.toMatch(/transformer|lexical|rule-based/);
  });
});
