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
    // Any other domain: still no second owner sentence.
    expect(compareExpectedSite(parse, lookAlike, "apple.com")).toEqual({
      outcome: "mismatch",
      sentence: "No. This link doesn't belong to apple.com.",
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

  it("answers a name in any script, still without confirming or denying it", () => {
    for (const name of ["Сбербанк", "支付宝", "पेटीएम"]) {
      expect(compareExpectedSite(parse, real, name)).toEqual({
        outcome: "unknown",
        sentence: `We can't tell from a name whether paypal.com is ${name}'s site. Type its address to compare.`,
      });
    }
  });

  it("compares a typed IP address with an IP link's address directly", () => {
    const v4 = anatomyOf("https://1.1.1.1/");
    expect(compareExpectedSite(parse, v4, "1.1.1.1")).toEqual({
      outcome: "match",
      sentence: "Matches 1.1.1.1.",
    });
    expect(
      compareExpectedSite(parse, v4, "https://1.1.1.1/dns-query"),
    ).toMatchObject({ outcome: "match" });
    // A port is part of the address as typed, not IPv6 syntax.
    for (const typed of ["1.1.1.1:443", "1.1.1.1:8443/dns-query"]) {
      expect(compareExpectedSite(parse, v4, typed), typed).toEqual({
        outcome: "match",
        sentence: "Matches 1.1.1.1.",
      });
    }
    expect(compareExpectedSite(parse, v4, "8.8.8.8")).toEqual({
      outcome: "mismatch",
      sentence: "This link belongs to 1.1.1.1, not 8.8.8.8.",
    });

    const v6 = anatomyOf("https://[2606:4700:4700::1111]/");
    expect(v6.registeredDomain).toBe("[2606:4700:4700::1111]");
    for (const typed of [
      "[2606:4700:4700::1111]",
      "[2606:4700:4700::1111]:443/dns-query",
      "2606:4700:4700::1111",
      "2606:4700:4700:0:0:0:0:1111",
    ]) {
      expect(compareExpectedSite(parse, v6, typed), typed).toEqual({
        outcome: "match",
        sentence: "Matches [2606:4700:4700::1111].",
      });
    }

    // A link with a name never belongs to a typed address.
    expect(compareExpectedSite(parse, real, "1.1.1.1")).toEqual({
      outcome: "mismatch",
      sentence: "This link belongs to paypal.com, not 1.1.1.1.",
    });
    // A bare number is a name, not an address.
    expect(compareExpectedSite(parse, real, "7")).toMatchObject({
      outcome: "unknown",
    });
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
