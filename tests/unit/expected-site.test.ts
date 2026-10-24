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
    expect(compareExpectedSite(parse, lookAlike, "paypal.com")).toEqual({
      outcome: "mismatch",
      sentence: "This link belongs to secure-login.xyz, not paypal.com.",
    });
    expect(compareExpectedSite(parse, real, "paypal.com")).toEqual({
      outcome: "match",
      sentence: "Matches paypal.com.",
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
      sentence: "This link belongs to secure-login.xyz, not paypal.com.",
    });
  });

  it("never confirms a brand name, only says when the link isn't that brand's", () => {
    // We don't know which domains a brand owns: its name alone never matches.
    expect(compareExpectedSite(parse, real, "PayPal")).toEqual({
      outcome: "unknown",
      sentence:
        "This link belongs to paypal.com. Check that's PayPal's address.",
    });
    expect(compareExpectedSite(parse, lookAlike, "PayPal")).toEqual({
      outcome: "mismatch",
      sentence: "This link belongs to secure-login.xyz, not PayPal.",
    });
    expect(
      compareExpectedSite(
        parse,
        anatomyOf("https://bankofamerica-secure.example/"),
        "Bank of America",
      ),
    ).toEqual({
      outcome: "mismatch",
      sentence:
        "This link belongs to bankofamerica-secure.example, not Bank of America.",
    });
  });

  it("can't be fooled by punctuation, another ending, or a hosting customer's name", () => {
    // Hyphens and digits are not stripped from the link's own name.
    expect(
      compareExpectedSite(parse, anatomyOf("https://pay-pal.com/"), "PayPal"),
    ).toMatchObject({ outcome: "mismatch" });
    // The brand's name on another ending is not a match.
    expect(
      compareExpectedSite(parse, anatomyOf("https://paypal.xyz/"), "PayPal"),
    ).toMatchObject({ outcome: "unknown" });
    // A site under a hosting suffix is its own site, as the anatomy says.
    const tenant = anatomyOf("https://login-verify.github.io/");
    expect(tenant.registeredDomain).toBe("login-verify.github.io");
    expect(compareExpectedSite(parse, tenant, "GitHub")).toEqual({
      outcome: "mismatch",
      sentence: "This link belongs to login-verify.github.io, not GitHub.",
    });
    expect(compareExpectedSite(parse, tenant, "github.com")).toMatchObject({
      outcome: "mismatch",
    });
    expect(
      compareExpectedSite(parse, tenant, "login-verify.github.io"),
    ).toMatchObject({ outcome: "match" });
  });

  it("admits when a name means no site it can compare", () => {
    expect(compareExpectedSite(parse, lookAlike, "my bank")).toEqual({
      outcome: "unknown",
      sentence:
        "We can't tell which site “my bank” means. This link belongs to secure-login.xyz.",
    });
  });
});
