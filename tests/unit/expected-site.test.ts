import { parse } from "tldts";
import { describe, expect, it } from "vitest";

import { compareExpectedSite } from "@/lib/domain/expected-site";
import { splitLinkAnatomy } from "@/lib/domain/link-anatomy";

function anatomyOf(url: string) {
  const anatomy = splitLinkAnatomy(parse, url);
  if (!anatomy) throw new Error(`no anatomy for ${url}`);
  return anatomy;
}

const lookAlike = anatomyOf("https://paypal.com.secure-login.xyz/verify");
const real = anatomyOf("https://www.paypal.com/signin");

describe("compareExpectedSite", () => {
  it("says nothing until something is typed", () => {
    expect(compareExpectedSite(parse, lookAlike, "   ")).toBeNull();
  });

  it("compares an expected domain with the site the link belongs to", () => {
    expect(
      compareExpectedSite(
        parse,
        anatomyOf("https://secure-login.xyz/"),
        "paypal.com",
      ),
    ).toEqual({
      outcome: "mismatch",
      sentence: "This link belongs to secure-login.xyz, not paypal.com.",
    });
    expect(compareExpectedSite(parse, real, "paypal.com")).toEqual({
      outcome: "match",
      sentence: "Matches paypal.com.",
    });
  });

  it("doesn't repeat the owner when the link spells out the expected site", () => {
    // The anatomy beside the answer already says "This link belongs to
    // secure-login.xyz, not paypal.com.": the answer must not say it again.
    expect(compareExpectedSite(parse, lookAlike, "paypal.com")).toEqual({
      outcome: "mismatch",
      sentence: "No. The link only spells out paypal.com.",
    });
    expect(compareExpectedSite(parse, lookAlike, "apple.com")).toEqual({
      outcome: "mismatch",
      sentence: "This link belongs to secure-login.xyz, not apple.com.",
    });
  });

  it("reduces a typed link or subdomain to its registered domain", () => {
    expect(
      compareExpectedSite(parse, real, "https://www.paypal.com/login"),
    ).toMatchObject({ outcome: "match" });
    expect(
      compareExpectedSite(parse, lookAlike, "WWW.PayPal.com"),
    ).toMatchObject({
      outcome: "mismatch",
      sentence: "No. The link only spells out paypal.com.",
    });
  });

  it("never confirms or denies a name: it can't know which sites a brand owns", () => {
    const answer = (url: string, name: string) =>
      compareExpectedSite(parse, anatomyOf(url), name);
    // Microsoft owns live.com: saying "not Microsoft" would be false.
    expect(answer("https://login.live.com/", "Microsoft")).toEqual({
      outcome: "unknown",
      sentence:
        "We can't tell from a name whether live.com is Microsoft's site. Type its address to compare.",
    });
    expect(compareExpectedSite(parse, real, "PayPal")).toMatchObject({
      outcome: "unknown",
    });
    expect(compareExpectedSite(parse, lookAlike, "PayPal")).toMatchObject({
      outcome: "unknown",
    });
    // Punctuation, another ending, or a hosting customer's name: still
    // nothing confirmed.
    for (const [url, name] of [
      ["https://pay-pal.com/", "PayPal"],
      ["https://paypal.xyz/", "PayPal"],
      ["https://bankofamerica-secure.example/", "Bank of America"],
      ["https://login-verify.github.io/", "GitHub"],
      ["https://secure-login.xyz/", "my bank"],
    ] as const) {
      expect(answer(url, name)).toMatchObject({ outcome: "unknown" });
    }
    expect(compareExpectedSite(parse, real, "!!")).toBeNull();
  });

  it("treats a site under a hosting suffix as its own site", () => {
    const tenant = anatomyOf("https://login-verify.github.io/");
    expect(tenant.registeredDomain).toBe("login-verify.github.io");
    expect(compareExpectedSite(parse, tenant, "github.com")).toMatchObject({
      outcome: "mismatch",
    });
    expect(
      compareExpectedSite(parse, tenant, "login-verify.github.io"),
    ).toMatchObject({ outcome: "match" });
  });
});
