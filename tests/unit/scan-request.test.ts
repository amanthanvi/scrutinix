import { describe, expect, it } from "vitest";

import { parseScanRequest } from "@/lib/server/scan-request";

describe("parseScanRequest content types", () => {
  it.each([
    ["single", JSON.stringify({ url: "https://example.com/" })],
    ["batch", JSON.stringify({ urls: ["https://example.com/"] })],
  ] as const)(
    "rejects JSON lookalikes for %s requests",
    async (shape, body) => {
      const outcome = await parseScanRequest(
        new Request(
          `https://scrutinix.test/api/analyze${shape === "batch" ? "/batch" : ""}`,
          {
            method: "POST",
            headers: { "content-type": "application/jsonx" },
            body,
          },
        ),
        shape,
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.response.status).toBe(415);
    },
  );

  it("accepts application/json for single requests", async () => {
    const outcome = await parseScanRequest(
      new Request("https://scrutinix.test/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/" }),
      }),
      "single",
    );

    expect(outcome.ok).toBe(true);
  });

  it("accepts application/json with parameters for batch requests", async () => {
    const outcome = await parseScanRequest(
      new Request("https://scrutinix.test/api/analyze/batch", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ urls: ["https://example.com/"] }),
      }),
      "batch",
    );

    expect(outcome.ok).toBe(true);
  });
});

describe("parseScanRequest body limits", () => {
  it("stops reading a chunked body once it exceeds 32 KiB", async () => {
    let cancelled = false;
    let chunksProduced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksProduced += 1;
        controller.enqueue(new Uint8Array(16 * 1024));
        if (chunksProduced === 10) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    };

    const outcome = await parseScanRequest(
      new Request("https://scrutinix.test/api/analyze", init),
      "single",
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(chunksProduced).toBeLessThan(10);
  });
});
