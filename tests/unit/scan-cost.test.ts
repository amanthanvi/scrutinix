import { describe, expect, it } from "vitest";

import { getScanRequestCost } from "@/lib/server/scan-cost";

describe("getScanRequestCost", () => {
  it("charges one token for a single scan", async () => {
    const request = new Request("https://scrutinix.test/api/analyze", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    });

    await expect(getScanRequestCost(request, "/api/analyze")).resolves.toBe(1);
  });

  it("charges one token per declared batch URL", async () => {
    const request = new Request("https://scrutinix.test/api/analyze/batch", {
      method: "POST",
      body: JSON.stringify({ urls: ["a.example", "b.example", "c.example"] }),
    });

    await expect(
      getScanRequestCost(request, "/api/analyze/batch"),
    ).resolves.toBe(3);
  });

  it("bounds chunked batch reads and charges oversized bodies the maximum", async () => {
    let chunksProduced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksProduced += 1;
        controller.enqueue(new Uint8Array(16 * 1024));
        if (chunksProduced === 10) controller.close();
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
    };

    const cost = await getScanRequestCost(
      new Request("https://scrutinix.test/api/analyze/batch", init),
      "/api/analyze/batch",
    );

    expect(cost).toBe(10);
    expect(chunksProduced).toBeLessThan(10);
  });
});
