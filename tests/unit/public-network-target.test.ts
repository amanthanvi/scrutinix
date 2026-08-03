import { lookup } from "node:dns/promises";

import { describe, expect, it, vi } from "vitest";

import {
  assertPublicNetworkTarget,
  isBlockedNetworkAddress,
} from "@/lib/server/public-network-target";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(lookup);

describe("public network target guard", () => {
  it("allows public literal IP targets", async () => {
    const result = await assertPublicNetworkTarget("https://93.184.216.34/");

    expect(result.ok).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("blocks private literal IP targets", async () => {
    const result = await assertPublicNetworkTarget("https://10.0.0.5/");

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("private");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("blocks private DNS resolution answers", async () => {
    mockLookupAll([
      {
        address: "192.168.1.20",
        family: 4,
      },
    ]);

    const result = await assertPublicNetworkTarget("https://example.test/");

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("192.168.1.20");
  });

  it("stops awaiting DNS resolution when the caller aborts", async () => {
    vi.useFakeTimers();
    lookupMock.mockImplementationOnce(() => new Promise(() => {}) as never);

    try {
      const controller = new AbortController();
      const pending = assertPublicNetworkTarget("https://example.test/", {
        signal: controller.signal,
      });
      const settled = Promise.race([
        pending,
        new Promise<"still pending">((resolve) => {
          setTimeout(() => resolve("still pending"), 25);
        }),
      ]);

      controller.abort();
      await vi.advanceTimersByTimeAsync(25);

      await expect(settled).resolves.toEqual({
        ok: false,
        error: expect.stringContaining("cancelled"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds DNS resolution by the active probe time budget", async () => {
    vi.useFakeTimers();
    lookupMock.mockImplementationOnce(() => new Promise(() => {}) as never);

    try {
      const pending = assertPublicNetworkTarget("https://example.test/", {
        timeoutMs: 1_000,
      });
      const settled = Promise.race([
        pending,
        new Promise<"still pending">((resolve) => {
          setTimeout(() => resolve("still pending"), 1_500);
        }),
      ]);

      await vi.advanceTimersByTimeAsync(1_500);

      await expect(settled).resolves.toEqual({
        ok: false,
        error: expect.stringContaining("time budget"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks IPv4-mapped IPv6 loopback addresses", () => {
    expect(isBlockedNetworkAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("blocks IPv4-compatible IPv6 private addresses", () => {
    expect(isBlockedNetworkAddress("::10.0.0.1")).toBe(true);
  });

  it("blocks NAT64 well-known private IPv4 embeddings", () => {
    expect(isBlockedNetworkAddress("64:ff9b::a00:1")).toBe(true);
  });

  it("allows NAT64 well-known public IPv4 embeddings", () => {
    expect(isBlockedNetworkAddress("64:ff9b::808:808")).toBe(false);
  });

  it("allows public DNS resolution answers", async () => {
    mockLookupAll([
      {
        address: "93.184.216.34",
        family: 4,
      },
      {
        address: "2606:2800:220:1:248:1893:25c8:1946",
        family: 6,
      },
    ]);

    const result = await assertPublicNetworkTarget("https://example.test/");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.resolution.addresses : []).toEqual([
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
  });
});

function mockLookupAll(records: Array<{ address: string; family: 4 | 6 }>) {
  lookupMock.mockResolvedValueOnce(records as never);
}
