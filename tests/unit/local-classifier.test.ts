import { beforeEach, describe, expect, it } from "vitest";

import { PATTERN_MODEL_EVALUATION } from "@/lib/domain/methodology";
import { createPendingSignalResults } from "@/lib/domain/types";
import { normalizeUrlInput } from "@/lib/domain/url";
import { scoredFindings } from "@/lib/domain/verdict";
import {
  classifyUrlLocally,
  modelWritings,
  PATTERN_MODEL_BAR,
  resetLocalClassifierForTests,
} from "@/lib/server/ml/local-classifier";
import { runMlEnsembleProvider } from "@/lib/server/providers/ml-ensemble";
import { ORDINARY_LINKS, SIGN_IN_LINKS } from "@/tests/fixtures/ordinary-links";

/** The link as a scan hands it to the model. */
function scanned(input: string): string {
  const parsed = normalizeUrlInput(input);
  if (!parsed.ok) throw new Error(`not a scannable link: ${input}`);
  return parsed.value.normalizedUrl;
}

/**
 * Exercises the REAL bundled model (no mocks, no network): this is the
 * regression gate proving the in-repo ONNX artifacts load and classify.
 */
describe("classifyUrlLocally (bundled model)", () => {
  beforeEach(() => {
    resetLocalClassifierForTests();
  });

  it("classifies an obvious credential-phish URL as malicious", async () => {
    const finding = await classifyUrlLocally(
      "http://secure-paypa1-login.com/verify/account.php",
    );

    expect(finding.label).toBe("malicious");
    expect(finding.score).toBeGreaterThan(0.9);
    expect(finding.model).toBe("urlbert-tiny-v4-phishing-q8");
    expect(finding.reasons).toEqual([
      "The link pattern model read this link as phishing.",
    ]);
  });

  it("classifies a mainstream URL as benign", async () => {
    const finding = await classifyUrlLocally("https://www.wikipedia.org/");

    expect(finding.label).toBe("benign");
    expect(finding.score).toBeGreaterThan(0.5);
    expect(finding.reasons).toEqual([
      "The link pattern model read this link as normal.",
    ]);
  });

  it("reuses the initialized pipeline across calls", async () => {
    await classifyUrlLocally("https://example.org/");
    const started = performance.now();
    await classifyUrlLocally("https://example.net/");

    // Warm inference is single-digit milliseconds; anything near init time
    // means the singleton was rebuilt.
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("is measured at the bar /about's figures were measured at", () => {
    // A new bar needs a new evaluation and new figures on /about
    // (lib/server/ml/model/README.md, "Reading and bar").
    expect(PATTERN_MODEL_BAR).toBe(PATTERN_MODEL_EVALUATION.bar);
  });

  // Round one's live false positives: read raw, the model called each of
  // these phishing at 64% to 100% and the ensemble added 7 to 11 points
  // (youtu.be landed Suspicious with a redirect and a DNS count). Then
  // sign-in links: the first fix still read every Microsoft OAuth link as
  // phishing, and Microsoft's own documented tenant example newly so.
  it.each([
    "https://example.com/",
    "https://www.example.com/",
    "https://youtu.be/jNQXAC9IVRw",
    "https://dbltest.com/",
    "https://badssl.com/",
    "https://expired.badssl.com/",
    "https://self-signed.badssl.com/",
    "https://wrong.host.badssl.com/",
    "https://untrusted-root.badssl.com/",
    "https://scrutinix-check.invalid/",
    "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/authorize?client_id=6731de76-14a6-49ae-97bc-6eba6914391e&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%2Fmyapp%2F&response_mode=query&scope=https%3A%2F%2Fgraph.microsoft.com%2Fmail.read&state=12345",
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=6731de76-14a6-49ae-97bc-6eba6914391e&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%2Fmyapp%2F&response_mode=query&scope=offline_access%20user.read&state=12345",
  ])("reads %s as normal, and the ensemble adds nothing", async (url) => {
    const finding = await classifyUrlLocally(scanned(url));
    expect(finding.label).toBe("benign");

    const signals = createPendingSignalResults();
    signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 1,
      data: await runMlEnsembleProvider(scanned(url)),
    };
    expect(signals.mlEnsemble.data?.consensusLabel).toBe("benign");
    expect(
      scoredFindings(signals).filter(({ signal }) => signal === "mlEnsemble"),
    ).toEqual([]);
  });

  it.each([
    "https://appleid.apple.com-verify-account.info/signin",
    "https://login-microsoftonline-secure.com/common/oauth2/authorize",
    "https://chase-online-verification.net/auth/login.php",
    "https://wellsfargo.secure-signin.xyz/login",
    "https://dhl-parcel-redelivery.top/track",
  ])("still reads the made-up phishing shape %s as phishing", async (url) => {
    const finding = await classifyUrlLocally(scanned(url));

    expect(finding.label).toBe("malicious");
  });

  it(`flags no more than ${PATTERN_MODEL_EVALUATION.targetPer100} in 100 of a held-out sample of ordinary links`, async () => {
    const flagged: string[] = [];
    for (const url of ORDINARY_LINKS) {
      const finding = await classifyUrlLocally(scanned(url));
      if (finding.label !== "benign") flagged.push(url);
    }

    // The bar was set on the other half of the corpus; this sample of
    // the held-out half read none flagged when it was drawn.
    expect(ORDINARY_LINKS.length).toBeGreaterThan(200);
    expect(flagged.length).toBeLessThanOrEqual(
      Math.floor(
        (ORDINARY_LINKS.length * PATTERN_MODEL_EVALUATION.targetPer100) / 100,
      ),
    );
  }, 60_000);

  it("reads a held-out sample of sign-in pages as normal", async () => {
    const flagged: string[] = [];
    for (const url of SIGN_IN_LINKS) {
      const finding = await classifyUrlLocally(scanned(url));
      if (finding.label !== "benign") flagged.push(url);
    }

    // None of the held-out sign-in links read phishing when this sample
    // was drawn; the highest read more than 2 below the bar.
    expect(SIGN_IN_LINKS.length).toBeGreaterThanOrEqual(25);
    expect(flagged).toEqual([]);
  }, 60_000);
});

describe("modelWritings", () => {
  it("reads the link with and without its scheme and www.", () => {
    expect(modelWritings("https://www.example.com/about")).toEqual([
      "https://www.example.com/about",
      "example.com/about",
    ]);
    expect(modelWritings("http://example.com/")).toEqual([
      "http://example.com/",
      "example.com/",
    ]);
  });

  it("reads the site and path only, never the query or fragment", () => {
    expect(
      modelWritings("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42"),
    ).toEqual(["https://www.youtube.com/watch", "youtube.com/watch"]);
    expect(
      modelWritings("https://docs.google.com/spreadsheets/d/x/edit#gid=0")[1],
    ).toBe("docs.google.com/spreadsheets/d/x/edit");
    expect(modelWritings("https://example.com/?next=%2Flogin")[1]).toBe(
      "example.com/",
    );
  });

  it("leaves IDs out of the path", () => {
    expect(modelWritings("https://youtu.be/jNQXAC9IVRw")).toEqual([
      "https://youtu.be/",
      "youtu.be/",
    ]);
    expect(modelWritings("https://www.amazon.com/dp/B0C4X2LMQZ")[1]).toBe(
      "amazon.com/dp/",
    );
    // Camel-cased random ids, with no digits to give them away.
    expect(modelWritings("https://t.co/AbCdEfGhIj")[1]).toBe("t.co/");
  });

  it("leaves a UUID out whole, not as stray pieces", () => {
    expect(
      modelWritings(
        "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/authorize?client_id=6731de76-14a6-49ae-97bc-6eba6914391e",
      )[1],
    ).toBe("login.microsoftonline.com//oauth2/v2.0/authorize");
    expect(
      modelWritings(
        "https://example.com/account/confirm/A1B2C3D4-0000-4000-8000-00000000BEEF",
      )[1],
    ).toBe("example.com/account/confirm/");
  });

  it("keeps words, numbers, and a word with a number on one end", () => {
    for (const url of [
      "https://example.com/office365/login",
      "https://example.com/oauth2/authorize/2026",
      "https://example.com/WordPress/wp-admin",
      "https://example.com/verify-account",
    ]) {
      expect(modelWritings(url)[0]).toBe(url);
    }
  });

  it("never touches the host", () => {
    expect(modelWritings("https://a1b2c3d4.example/x9y8z7w6")).toEqual([
      "https://a1b2c3d4.example/",
      "a1b2c3d4.example/",
    ]);
  });
});
