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
});
