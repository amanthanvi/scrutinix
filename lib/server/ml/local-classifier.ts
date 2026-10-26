import path from "node:path";

import { IMPERSONATED_BRANDS } from "@/lib/domain/impersonated-brands";
import { HIGH_RISK_KEYWORDS } from "@/lib/domain/lure-words";
import { PublicError } from "@/lib/domain/public-error";
import type { ClassificationFinding } from "@/lib/domain/types";
import { withTimeout } from "@/lib/server/http";

/**
 * Bundled URL classifier: CrabInHoney/urlbert-tiny-v4-phishing-classifier
 * (Apache-2.0, 3.69M params), exported to int8 ONNX in-repo - see
 * lib/server/ml/model/README.md for provenance and verification. Runs fully
 * offline via @huggingface/transformers: no API key, no network, ~150ms
 * cold init and single-digit-ms inference.
 *
 * The classifier is one ensemble member (classifyConsensus). How it reads a
 * link and the bar it must clear come from an offline evaluation on
 * ordinary and phishing links (README, "Reading and bar"): read raw, it
 * flagged about a third of popular sites and nearly every official short
 * link.
 */
const MODEL_DIR = "model";
const MODEL_NAME = "urlbert-tiny-v4-phishing-q8";

const INIT_TIMEOUT_MS = 10_000;
const INFERENCE_TIMEOUT_MS = 2_000;

/**
 * The bar, in the model's own units: the log-odds of phishing over benign,
 * averaged over the two writings. Set on the calibration half of the benign
 * corpus (popular sites, deep links, short links, sign-in and account
 * links) so the model flags at most 2 in 100 of those links; the README has
 * the corpus and the held-out rates. Change it only with a new evaluation,
 * and update /about's figures (PATTERN_MODEL_EVALUATION in
 * lib/domain/methodology.ts, whose `bar` a test holds equal to this).
 */
export const PATTERN_MODEL_BAR = 6.44;

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
 * A run of letters and digits that is an ID rather than a word: six or more
 * characters that switch between letters and digits at least twice
 * (jNQXAC9IVRw, B0C4X2LMQZ), or lowercase with two or more capitals after
 * the first letter (camel-cased random ids). Words, numbers, and a word
 * with a number on one end ("login", "WordPress", "2026", "office365",
 * "oauth2") stay.
 */
function isIdLike(token: string): boolean {
  if (token.length < 6) {
    return false;
  }
  // Runs of letters and of digits: "jNQXAC9IVRw" is three, "office365" two.
  const runs = token.replace(/[A-Za-z]+/g, "a").replace(/\d+/g, "0").length;
  if (runs >= 3) {
    return true;
  }
  return (
    /[a-z]/.test(token) && (token.slice(1).match(/[A-Z]/g)?.length ?? 0) >= 2
  );
}

/**
 * What an ID-like run is kept for: a listed brand or a lure word, five
 * letters or more (shorter ones, "hsbc" or "auth", turn up inside random
 * ids). The lure words are the structure checks' own, plus the sign-in,
 * account, mail and file-sharing words (and the stems of "verification"
 * and "security") that the model's training links tie to phishing: in
 * their paths, 76% (suspend) to 100% (docusign), against 47% of all its
 * links.
 */
const KEPT_WORDS: readonly string[] = [
  ...IMPERSONATED_BRANDS,
  ...HIGH_RISK_KEYWORDS,
  "signin",
  "signon",
  "logon",
  "account",
  "confirm",
  "validate",
  "verif",
  "secur",
  "billing",
  "suspend",
  "upgrade",
  "webmail",
  "mailbox",
  "docusign",
  "sharepoint",
  "onedrive",
  "wetransfer",
].filter((word) => /^[a-z\d]{5,}$/.test(word));

/** Digits that stand in for letters ("P4yPa1" spells paypal). */
const LETTER_DIGITS: Record<string, string> = {
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

/**
 * Whether a run spells a brand or lure word, in any case, with digits
 * between its letters ("paypal2verify"), for letters ("L0g1n"), or both
 * ("P4y2P4l"): a phishing path written to look like an ID still reaches
 * the model. A run of hex digits never does: it is a hash, and with digits
 * read as letters, hashes spell "adobe" ("ad0be").
 */
function spellsKeptWord(token: string): boolean {
  if (/^[\da-f]+$/i.test(token)) {
    return false;
  }
  const lower = token.toLowerCase();
  const lettersOnly = (one: string) =>
    lower
      .replace(/\d/g, (digit) =>
        digit === "1" ? one : (LETTER_DIGITS[digit] ?? digit),
      )
      .replace(/\d+/g, "");
  const readings = [
    lower,
    lower.replace(/\d+/g, ""),
    lettersOnly("l"),
    lettersOnly("i"),
  ];
  return KEPT_WORDS.some((word) =>
    readings.some((reading) => reading.includes(word)),
  );
}

/** A UUID, removed whole: split on "-" its pieces read as stray fragments. */
const UUID = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi;

/**
 * The two writings of a link the model reads: its host and path, once as
 * written and once without its scheme and a leading "www.". The query is
 * left out. A fragment is left out unless it is a route ("#/signin",
 * "#!/login"), which reads as the path it names; scans never carry a
 * fragment (normalizeUrlInput drops it before any check), so in a scan
 * this applies only if that changes. In the path, UUIDs are left out
 * whole, and so are ID-like runs, unless they spell a brand or lure word
 * (`spellsKeptWord`).
 *
 * Why: the model's training links were mostly written without a scheme,
 * and its phishing examples came from feeds full of bare "https://site/"
 * links and random ids, so it reads a bare "https://site/", and any id
 * (YouTube, Zoom, Google Docs, every link shortener), as phishing. Its
 * benign examples almost never carry a long query (over 100 characters:
 * 91% phishing; "redirect" in it: 93%), so it reads every OAuth sign-in
 * link as phishing. Without the kept words, a phisher could hide a lure
 * from the model by writing it as an ID ("/PayPalSecureLogin",
 * "/paypal2verify"). The structure checks still read the whole link,
 * query included. Every link gets the same two writings, whatever it is.
 */
export function modelWritings(url: string): [string, string] {
  const route = /^[^#]*#!?(\/[^?#]*)/.exec(url)?.[1];
  const page = url.replace(/[?#].*$/, "");
  const link = route ? page.replace(/\/$/, "") + route : page;
  const pathStart = link.indexOf("/", link.indexOf("//") + 2);
  const written =
    pathStart === -1
      ? link
      : link.slice(0, pathStart) +
        link
          .slice(pathStart)
          .replace(UUID, "")
          .replace(/[A-Za-z0-9]+/g, (token) =>
            isIdLike(token) && !spellsKeptWord(token) ? "" : token,
          );
  return [written, written.replace(/^https?:\/\//, "").replace(/^www\./, "")];
}

/** The model's log-odds of phishing over benign for one writing. */
async function phishingLogOdds(
  classifier: UrlClassifier,
  text: string,
): Promise<number> {
  const output = await classifier(text, { top_k: 2 });
  const predictions = (
    Array.isArray(output[0]) ? output[0] : output
  ) as Prediction[];
  const scoreOf = (name: string) =>
    predictions.find((item) => CLASS_NAMES[item.label] === name)?.score;
  const phishing = scoreOf("phishing");
  const benign = scoreOf("benign");

  if (phishing === undefined || benign === undefined) {
    throw new PublicError(
      "lookup_failed",
      "The local URL classifier returned no predictions.",
    );
  }

  // Softmax keeps the smaller class's probability precise even when the
  // larger one rounds to 1, so this stays finite in practice; the clamp
  // covers an underflow to 0.
  const logOdds = Math.log(phishing) - Math.log(benign);
  return Math.max(-30, Math.min(30, logOdds));
}

/**
 * Classify a URL with the bundled transformer. Initialization and inference
 * errors throw so the ensemble caller can degrade to lexical-only in its catch.
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

  const classifier = await withTimeout(
    pending,
    INIT_TIMEOUT_MS,
    "Local URL classifier initialization",
  );

  const [written, bare] = modelWritings(url);
  const reading = await withTimeout(
    (async () =>
      ((await phishingLogOdds(classifier, written)) +
        (await phishingLogOdds(classifier, bare))) /
      2)(),
    INFERENCE_TIMEOUT_MS,
    "Local URL classifier inference",
  );

  // At or past the bar the model reads phishing. The score is the distance
  // from the bar on the same logistic scale (0.5 on it, near 1 far from
  // it), so the ensemble weighs a reading just past the bar less than one
  // well past it. It is not a calibrated probability, so the copy states
  // no percentage.
  const fromBar = reading - PATTERN_MODEL_BAR;
  const phishing = fromBar >= 0;

  return {
    label: phishing ? "malicious" : "benign",
    score: Number((1 / (1 + Math.exp(-Math.abs(fromBar)))).toFixed(2)),
    reasons: [
      `The link pattern model read this link as ${phishing ? "phishing" : "normal"}.`,
    ],
    model: MODEL_NAME,
  };
}
