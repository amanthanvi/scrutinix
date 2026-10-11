import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const applyRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/rate-limit", () => ({
  applyRateLimit,
  getClientRateLimitId: () => "203.0.113.10",
}));

import { proxy } from "@/proxy";

function batchRequest(
  body: string,
  headers: Record<string, string>,
): NextRequest {
  return new NextRequest("https://scrutinix.test/api/analyze/batch", {
    method: "POST",
    body,
    headers,
  });
}

describe("proxy batch rate-limit charging", () => {
  beforeEach(() => {
    applyRateLimit.mockReset();
    applyRateLimit.mockResolvedValue({
      success: true,
      remaining: 49,
      reset: Date.now() + 60_000,
    });
  });

  it("charges one token for a batch-looking non-JSON request", async () => {
    const body = JSON.stringify({
      urls: Array(10).fill("https://example.com"),
    });
    const request = batchRequest(body, { "content-type": "text/plain" });

    await proxy(request);

    expect(applyRateLimit).toHaveBeenCalledWith("203.0.113.10", 1, "scan");
  });

  it("charges one token for a batch-looking hostile-origin request", async () => {
    const body = JSON.stringify({
      urls: Array(10).fill("https://example.com"),
    });
    const request = batchRequest(body, {
      "content-type": "application/json",
      origin: "https://attacker.example",
    });

    await proxy(request);

    expect(applyRateLimit).toHaveBeenCalledWith("203.0.113.10", 1, "scan");
  });

  it("charges valid same-origin batches by URL count", async () => {
    const request = batchRequest(
      JSON.stringify({
        urls: [
          "https://example.com",
          "https://example.org",
          "https://example.net",
        ],
      }),
      {
        "content-type": "application/json",
        origin: "https://scrutinix.test",
      },
    );

    await proxy(request);

    expect(applyRateLimit).toHaveBeenCalledWith("203.0.113.10", 3, "scan");
  });

  it("preserves the original request body after charging", async () => {
    const body = JSON.stringify({
      urls: ["https://example.com", "https://example.org"],
    });
    const request = batchRequest(body, {
      "content-type": "application/json",
    });

    await proxy(request);

    await expect(request.text()).resolves.toBe(body);
  });

  it("meters the per-result share image on the image tier", async () => {
    await proxy(new NextRequest("https://scrutinix.test/og/result?shared=abc"));

    expect(applyRateLimit).toHaveBeenCalledWith("203.0.113.10", 1, "image");
  });

  it("answers 429 when the share image budget is spent", async () => {
    applyRateLimit.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 30_000,
      status: 429,
      error: { code: "rate_limited" },
    });

    const response = await proxy(
      new NextRequest("https://scrutinix.test/og/result?shared=abc"),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("sends the same wait in Retry-After that the message was worded from", async () => {
    applyRateLimit.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 5 * 3_600_000,
      retryAfterSeconds: 18_000,
      status: 429,
      error: { code: "rate_limited" },
    });

    const response = await proxy(
      new NextRequest("https://scrutinix.test/og/result?shared=abc"),
    );

    expect(response.headers.get("Retry-After")).toBe("18000");
  });
});
