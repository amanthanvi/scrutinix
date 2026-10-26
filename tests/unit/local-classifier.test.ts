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

  // Ordinary pages whose ID-like names spell a kept word now reach the
  // model whole; each read at least 2 below the bar when this was written.
  it.each([
    "https://www.nuget.org/Account/ForgotPasswordConfirmation",
    "https://example-store.com/Identity/Account/ResetPasswordConfirmation",
    "https://example-store.com/Account/ExternalLoginConfirmation",
    "https://developers.google.com/identity/sign-in/android/reference/com/google/android/gms/auth/api/signin/GoogleSignInClient",
    "https://github.com/firebase/quickstart-android/blob/master/auth/app/src/main/java/com/google/firebase/quickstart/auth/java/GoogleSignInActivity.java",
    "https://developer.apple.com/documentation/authenticationservices/ASAuthorizationAppleIDButton",
    "https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_ConfirmSignUp.html",
    "https://developer.android.com/reference/android/accounts/AccountManagerFuture",
    "https://github.com/pnp/PnP-JS-Core/blob/master/src/sharepoint/SharePointQueryable.ts",
  ])("reads the ordinary page %s as normal", async (url) => {
    expect((await classifyUrlLocally(scanned(url))).label).toBe("benign");
  });

  it("reads a lure written to look like an ID", async () => {
    // Left out as an ID, this lure reached the model as the bare site,
    // which reads normal; kept, it reads phishing (about 1.5 past the bar
    // when this was written, against at most 0.32 between architectures).
    expect(
      (await classifyUrlLocally(scanned("https://shop-example.com/"))).label,
    ).toBe("benign");
    expect(
      (
        await classifyUrlLocally(
          scanned("https://shop-example.com/PayPalSecureLogin"),
        )
      ).label,
    ).toBe("malicious");
  });

  it.each([
    "https://shop-example.com/P4y7P4l",
    "https://shop-example.com/L0g7in",
  ])(
    "reads the lure %s, a digit for a letter and another between letters, as phishing",
    async (url) => {
      // Read as a whole, each run took its 7 for a "t" and spelled
      // nothing, so the model read the bare site. Kept, these read about 1
      // past the bar (7.41 and 7.53) when this was written.
      expect((await classifyUrlLocally(scanned(url))).label).toBe("malicious");
    },
  );

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

  it("keeps an ID-like run that spells a brand or lure word", () => {
    for (const url of [
      // Camel case, digits between words, a brand and "ID", digits for
      // letters ("1" as l or as i), and both at once.
      "https://shop-example.com/PayPalSecureLogin",
      "https://shop-example.com/paypal2verify",
      "https://shop-example.com/AppleIDVerify",
      "https://shop-example.com/P4yP4lL0g1n",
      "https://shop-example.com/MyS1gn1nPage",
      "https://shop-example.com/P4y2P4l",
      "https://shop-example.com/SharePoint2Document",
      "https://shop-example.com/x/MyAccountUpdate9",
    ]) {
      expect(modelWritings(url)[0]).toBe(url);
    }
    // Each digit is read on its own, as a letter or as noise between
    // letters, so one run can mix the two: 7 sits between letters in
    // "P4y7P4l" though it can stand for "t", and "10g1ns" reads 1 as l and
    // as i. The last four are from phishing links (Phishing.Database and
    // the model's training set).
    for (const url of [
      "https://shop-example.com/P4y7P4l",
      "https://shop-example.com/L0g7in",
      "https://shop-example.com/p4ypal2verify",
      "https://shop-example.com/10g1ns",
      "https://shop-example.com/0ffice365",
      "https://shop-example.com/Payp44lle",
      "https://shop-example.com/micr0sof0t",
    ]) {
      expect(modelWritings(url)[0]).toBe(url);
    }
    // The same shapes spelling nothing are IDs, and go.
    for (const id of [
      "PxyPzlSqcureLxgin",
      "pqypql2vxrify",
      "Q4zP4kK0r9n",
      "MyQ1gn1nPage",
      "Q4y7P4k",
      "K0g7in",
      "Pqyp44kle",
    ]) {
      expect(modelWritings(`https://shop-example.com/${id}`)[1]).toBe(
        "shop-example.com/",
      );
    }
  });

  it("keeps no ID for a short word, a short brand, or a hash", () => {
    // "auth" and "hsbc" turn up inside random ids; a hex hash with digits
    // read as letters spells "adobe".
    for (const id of [
      "xAuth9Qz2",
      "1qKhsBCdL0J",
      "65e3da15f4e1d64395ad0beefc10a653",
    ]) {
      expect(modelWritings(`https://shop-example.com/${id}`)[1]).toBe(
        "shop-example.com/",
      );
    }
  });

  it("keeps a word written nearly all in digits only if no look-alike is noise", () => {
    // One letter as itself and the rest as look-alikes still spells the
    // word, with 2, 6, 8 or 9 between ("steam").
    for (const id of ["x5734m9", "x52734m9"]) {
      const url = `https://shop-example.com/${id}`;
      expect(modelWritings(url)[0]).toBe(url);
    }
    // A long number with one letter in it spells a word by chance when
    // any digit may be noise: "w" then 4, 1, 1, 3, 7 ("wallet"), "r" then
    // 3, 5, 3, 7 ("reset").
    for (const id of ["9w0401103070x", "x40r30591387"]) {
      expect(modelWritings(`https://shop-example.com/${id}`)[1]).toBe(
        "shop-example.com/",
      );
    }
    // The known limit that rule leaves (AGENTS.md): "r3537x" spells reset
    // and stays, but one inserted digit ("r35037x") hides it, since only
    // the r is written as itself. Changing it needs the evaluation rerun.
    expect(modelWritings("https://shop-example.com/r3537x")[1]).toBe(
      "shop-example.com/r3537x",
    );
    expect(modelWritings("https://shop-example.com/r35037x")[1]).toBe(
      "shop-example.com/",
    );
  });

  it("reads a long run of look-alike digits in one pass", () => {
    // Digits that could each be a letter or noise ("5734" over and over
    // nearly spells "steam"): a backtracking match takes many seconds on
    // a path this long; one pass takes about 10 milliseconds.
    const id = `x${"5734".repeat(500)}x`;
    const started = performance.now();
    expect(modelWritings(`https://shop-example.com/${id}`)[1]).toBe(
      "shop-example.com/",
    );
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("still leaves out IDs that spell nothing", () => {
    expect(modelWritings(scanned("https://youtu.be/jNQXAC9IVRw"))[1]).toBe(
      "youtu.be/",
    );
    expect(
      modelWritings(
        scanned(
          "https://docs.google.com/document/d/b4bta4LN15qPczmYHzQ2rcoJdkec5zn8KiKGXRpNZfqD/edit",
        ),
      )[1],
    ).toBe("docs.google.com/document/d//edit");
    // The meeting number is a number, which stays; the passcode is an ID
    // in the query, which the model never reads.
    expect(
      modelWritings(
        scanned(
          "https://zoom.us/j/45777122070?pwd=kbbjn7nYAb10oqt8gN6XYdm8eTvKwUBz",
        ),
      )[1],
    ).toBe("zoom.us/j/45777122070");
    // Microsoft's documented tenant link: the UUID goes whole.
    expect(
      modelWritings(
        scanned(
          "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/authorize?client_id=6731de76-14a6-49ae-97bc-6eba6914391e&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%2Fmyapp%2F&response_mode=query&scope=https%3A%2F%2Fgraph.microsoft.com%2Fmail.read&state=12345",
        ),
      )[1],
    ).toBe("login.microsoftonline.com//oauth2/v2.0/authorize");
  });

  it("reads a fragment route as path, and only a route", () => {
    expect(modelWritings("https://shop-example.com/#/signin")).toEqual([
      "https://shop-example.com/signin",
      "shop-example.com/signin",
    ]);
    expect(
      modelWritings("https://shop-example.com/app/#!/PayPal2Login?next=x")[1],
    ).toBe("shop-example.com/app/PayPal2Login");
    expect(modelWritings("https://shop-example.com/faq#returns")[1]).toBe(
      "shop-example.com/faq",
    );
    // A scan never carries the fragment: normalizeUrlInput drops it
    // before any check, so in a scan neither member sees "#/signin".
    expect(scanned("https://shop-example.com/#/signin")).toBe(
      "https://shop-example.com/",
    );
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
