import { describe, expect, it } from "vitest";

import { isBlockedNetworkAddress } from "@/lib/domain/blocked-address";
import {
  createCacheKey,
  displayUrlOf,
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
    expect(normalizeUrlInput("http://192.88.99.1").ok).toBe(false);
    expect(normalizeUrlInput("http://198.51.100.1").ok).toBe(false);
    expect(normalizeUrlInput("http://203.0.113.1").ok).toBe(false);
    expect(normalizeUrlInput("http://224.0.0.1").ok).toBe(false);
    expect(normalizeUrlInput("http://[2001:db8::1]").ok).toBe(false);
    expect(normalizeUrlInput("http://[fec0::1]").ok).toBe(false);
    expect(normalizeUrlInput("http://[3fff::1]").ok).toBe(false);
    expect(normalizeUrlInput("http://[5f00::1]").ok).toBe(false);
    expect(normalizeUrlInput("http://[100:0:0:1::1]").ok).toBe(false);
  });

  it("treats IPv6 zone IDs as blocked link-local addresses", () => {
    expect(isBlockedNetworkAddress("fe80::1%eth0")).toBe(true);
    expect(isBlockedNetworkAddress("fe80::1%25eth0")).toBe(true);
  });

  it("measures the length limit on the normalized link it returns", () => {
    const tooLong = "That link is too long to check (over 2,048 characters).";
    // 420 characters as typed; percent-encoded, 2,420.
    const accented = normalizeUrlInput(
      `https://example.com/${"é".repeat(400)}`,
    );
    expect(accented.ok ? null : accented.error).toBe(tooLong);
    // A missing scheme counts too: "https://" pushes 2,041 typed past 2,048.
    const bare = normalizeUrlInput(`example.com/${"a".repeat(2_029)}`);
    expect(bare.ok ? null : bare.error).toBe(tooLong);
    // Exactly 2,048 once normalized is fine, and stays the same link.
    const fits = normalizeUrlInput(`https://example.com/${"é".repeat(338)}`);
    expect(fits.ok && fits.value.normalizedUrl.length).toBe(2_048);
    expect(
      fits.ok && normalizeUrlInput(fits.value.normalizedUrl),
    ).toMatchObject({
      ok: true,
      value: { normalizedUrl: fits.ok && fits.value.normalizedUrl },
    });
    // Over the limit as typed is still refused before parsing, even when
    // normalizing would drop the excess (a fragment).
    const fragment = normalizeUrlInput(
      `https://example.com/#${"a".repeat(2_048)}`,
    );
    expect(fragment.ok ? null : fragment.error).toBe(tooLong);
  });

  it("rejects unsupported protocols", () => {
    const result = normalizeUrlInput("ftp://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Only web links \(http or https\)/);
    }
  });

  it("builds stable cache and feed keys", () => {
    // normalizeUrlInput already lowercases scheme+host via the URL parser.
    const normalized = normalizeUrlInput("HTTPS://Example.com/a");
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(createCacheKey(normalized.value.normalizedUrl)).toBe(
        "https://example.com/a",
      );
    }

    expect(simplifyUrlForMatching("https://example.com/")).toBe(
      "https://example.com",
    );
  });

  it("keeps case-sensitive paths distinct in cache keys", () => {
    expect(createCacheKey("https://example.com/AdminPanel")).not.toBe(
      createCacheKey("https://example.com/adminpanel"),
    );
  });
});

describe("displayUrlOf", () => {
  function display(input: string) {
    const result = normalizeUrlInput(input);
    if (!result.ok) throw new Error(result.error);
    return {
      shown: displayUrlOf(result.value),
      scanned: result.value.normalizedUrl,
    };
  }

  it("shows a typed fragment that the scan never sees", () => {
    expect(display("example.com/#/login")).toEqual({
      shown: "https://example.com/#/login",
      scanned: "https://example.com/",
    });
  });

  it("is the normalized link when nothing was typed after #", () => {
    expect(display("https://Example.com:443/a")).toEqual({
      shown: "https://example.com/a",
      scanned: "https://example.com/a",
    });
  });
});
