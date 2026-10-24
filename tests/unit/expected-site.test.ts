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

  it("matches a brand name against the registered domain's own name", () => {
    expect(compareExpectedSite(parse, real, "PayPal")).toEqual({
      outcome: "match",
      sentence: "Matches paypal.com.",
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

  it("admits when a name means no site it can compare", () => {
    expect(compareExpectedSite(parse, lookAlike, "my bank")).toEqual({
      outcome: "unknown",
      sentence:
        "We can't tell which site “my bank” means. This link belongs to secure-login.xyz.",
    });
  });
});
