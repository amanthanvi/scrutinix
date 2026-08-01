import { describe, expect, it } from "vitest";

import { getUrlStructureRisk } from "@/lib/domain/url-structure-risk";

describe("getUrlStructureRisk", () => {
  it("detects script extensions and non-standard https port on literal IP", () => {
    const risk = getUrlStructureRisk("https://15.58.86.110:38376/bin.sh");
    expect(risk.scoreDelta).toBeGreaterThan(0);
    expect(risk.reasons.join(" ")).toMatch(
      /script or shell|non-standard HTTPS port/i,
    );
  });

  it("returns empty delta for a normal https URL", () => {
    const risk = getUrlStructureRisk("https://example.com/about");
    expect(risk.scoreDelta).toBe(0);
    expect(risk.reasons).toHaveLength(0);
  });

  it("does not treat ccTLDs in the hostname as script extensions", () => {
    for (const host of [
      "https://news.pl/",
      "https://example.py/",
      "https://nic.sh/",
    ]) {
      const risk = getUrlStructureRisk(host);
      expect(risk.reasons.join(" ")).not.toMatch(/script or shell/i);
      expect(risk.reasons.some((r) => r.includes(".pl"))).toBe(false);
    }
  });

  it("still flags script-like extensions in the path", () => {
    const risk = getUrlStructureRisk("https://example.com/install.ps1");
    expect(risk.reasons.join(" ")).toMatch(/script or shell/i);
    expect(risk.scoreDelta).toBeGreaterThan(0);
  });

  it("flags domains one typo away from an impersonated brand", () => {
    for (const url of [
      "https://paypa1.com/login",
      "https://payapl.com/",
      "https://microsofl.com/",
    ]) {
      const risk = getUrlStructureRisk(url);
      expect(risk.reasons.join(" ")).toMatch(/one typo away/i);
      expect(risk.scoreDelta).toBeGreaterThanOrEqual(0.22);
    }
  });

  it("flags brand names attached with affixes or buried in subdomains", () => {
    const affix = getUrlStructureRisk("https://paypal-secure-login.example/");
    expect(affix.reasons.join(" ")).toMatch(/extra words to "paypal"/i);

    const subdomain = getUrlStructureRisk("https://paypal.com.evil.example/");
    expect(subdomain.reasons.join(" ")).toMatch(/subdomain of an unrelated/i);
  });

  it("never flags the brand's own domains", () => {
    for (const url of [
      "https://www.paypal.com/",
      "https://paypal.co.uk/signin",
      "https://accounts.google.com/",
      "https://github.com/user/repo",
    ]) {
      const risk = getUrlStructureRisk(url);
      expect(risk.reasons.join(" ")).not.toMatch(
        /typo|impersonation|subdomain/i,
      );
    }
  });

  it("does not false-positive on compound names without separators", () => {
    const risk = getUrlStructureRisk("https://amazonaws.com/bucket");
    expect(risk.reasons.join(" ")).not.toMatch(/typo|impersonation/i);
  });

  it("flags punycode hostnames mixing Latin with lookalike scripts", () => {
    // xn--pypal-4ve.com decodes to pаypal.com with a Cyrillic "а".
    const risk = getUrlStructureRisk("https://xn--pypal-4ve.com/");
    expect(risk.reasons.join(" ")).toMatch(/homograph/i);
    expect(risk.scoreDelta).toBeGreaterThanOrEqual(0.2);
  });

  it("leaves legitimate single-script internationalized domains alone", () => {
    // xn--80akhbyknj4f (испытание) is fully Cyrillic but not Latin-lookalike.
    const risk = getUrlStructureRisk("https://xn--80akhbyknj4f.com/");
    expect(risk.reasons.join(" ")).not.toMatch(/homograph/i);
  });
});
