import { describe, expect, it } from "vitest";

import { parseScanRequest } from "@/lib/server/scan-request";

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
