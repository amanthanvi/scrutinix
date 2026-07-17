import { describe, expect, it } from "vitest";

import {
  createCacheKey,
  normalizeUrlInput,
  simplifyUrlForMatching,
} from "@/lib/domain/url";

describe("normalizeUrlInput", () => {
  it("normalizes hostnames by defaulting to https", () => {
    const result = normalizeUrlInput("example.com");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.normalizedUrl).toBe("https://example.com/");
    }
  });

  it("rejects private and localhost destinations", () => {
    expect(normalizeUrlInput("http://127.0.0.1").ok).toBe(false);
    expect(normalizeUrlInput("http://192.168.1.3").ok).toBe(false);
    expect(normalizeUrlInput("http://localhost").ok).toBe(false);
  });

  it("rejects reserved, CGNAT, TEST-NET, and multicast destinations", () => {
    expect(normalizeUrlInput("http://100.64.0.1").ok).toBe(false);
    expect(normalizeUrlInput("http://192.0.2.1").ok).toBe(false);
    expect(normalizeUrlInput("http://198.51.100.1").ok).toBe(false);
    expect(normalizeUrlInput("http://203.0.113.1").ok).toBe(false);
    expect(normalizeUrlInput("http://224.0.0.1").ok).toBe(false);
    expect(normalizeUrlInput("http://[2001:db8::1]").ok).toBe(false);
  });

  it("rejects unsupported protocols", () => {
    const result = normalizeUrlInput("ftp://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Only HTTP and HTTPS/);
    }
  });

  it("builds stable cache and feed keys", () => {
    expect(createCacheKey("HTTPS://Example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(simplifyUrlForMatching("https://example.com/")).toBe(
      "https://example.com",
    );
  });
});
