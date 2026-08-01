import path from "node:path";

import type { ClassificationFinding } from "@/lib/domain/types";
import { withTimeout } from "@/lib/server/http";

/**
 * Bundled URL classifier: CrabInHoney/urlbert-tiny-v4-phishing-classifier
 * (Apache-2.0, 3.69M params), exported to int8 ONNX in-repo - see
 * lib/server/ml/model/README.md for provenance and verification. Runs fully
 * offline via @huggingface/transformers: no API key, no network, ~150ms
 * cold init and single-digit-ms inference.
 *
 * The classifier is one ensemble member, deliberately dampened by
 * classifyConsensus - its occasional false positives (URL shorteners, some
 * SSO endpoints) surface as "risky" contributions, never a conviction.
 */
const MODEL_DIR = "model";
const MODEL_NAME = "urlbert-tiny-v4-phishing-q8";

const INIT_TIMEOUT_MS = 10_000;
const INFERENCE_TIMEOUT_MS = 2_000;

/** config.json ships generic LABEL_n ids; this is the documented mapping. */
const CLASS_NAMES: Record<string, string> = {
  LABEL_0: "benign",
  LABEL_1: "phishing",
};

interface Prediction {
  label: string;
  score: number;
}

type UrlClassifier = (
  input: string,
  options: { top_k: number },
) => Promise<Prediction[] | Prediction[][]>;

declare global {
  var __sxUrlClassifier: Promise<UrlClassifier> | null | undefined;
}

async function initClassifier(): Promise<UrlClassifier> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.localModelPath = path.join(process.cwd(), "lib", "server", "ml");

  const classifier = await pipeline("text-classification", MODEL_DIR, {
    dtype: "q8",
  });
  return classifier as unknown as UrlClassifier;
}

export function resetLocalClassifierForTests() {
  globalThis.__sxUrlClassifier = undefined;
}

/**
 * Classify a URL with the bundled transformer. Returns null (never throws
 * past its caller's catch) so a broken runtime degrades to lexical-only.
 */
export async function classifyUrlLocally(
  url: string,
): Promise<ClassificationFinding> {
  // Lazy shared init: the first scan per instance pays model load once; a
  // failed init resets so a later scan can retry.
  const pending = (globalThis.__sxUrlClassifier ??= initClassifier().catch(
    (error: unknown) => {
      globalThis.__sxUrlClassifier = null;
      throw error;
    },
  ));

  if (pending === null) {
    globalThis.__sxUrlClassifier = undefined;
    return classifyUrlLocally(url);
  }

  const classifier = await withTimeout(
    pending,
    INIT_TIMEOUT_MS,
    "Local URL classifier initialization",
  );

  const output = await withTimeout(
    classifier(url, { top_k: 2 }),
    INFERENCE_TIMEOUT_MS,
    "Local URL classifier inference",
  );

  const predictions = (
    Array.isArray(output[0]) ? output[0] : output
  ) as Prediction[];
  const top = predictions.reduce<Prediction | null>(
    (best, item) => (!best || item.score > best.score ? item : best),
    null,
  );

  if (!top) {
    throw new Error("The local URL classifier returned no predictions.");
  }

  const className = CLASS_NAMES[top.label] ?? top.label;
  const label: ClassificationFinding["label"] =
    className === "benign" ? "benign" : "malicious";

  return {
    label,
    score: Number(top.score.toFixed(2)),
    reasons: [
      `The local URL model classified this link as ${className} with ${(top.score * 100).toFixed(0)}% confidence.`,
    ],
    model: MODEL_NAME,
  };
}
