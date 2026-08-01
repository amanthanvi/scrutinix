import { describe, expect, it } from "vitest";

import { createNdjsonResponse } from "@/lib/server/stream";

describe("createNdjsonResponse", () => {
  it("streams events and closes cleanly", async () => {
    const response = createNdjsonResponse(async (writer) => {
      writer.send({ type: "batch_started", total: 1, startedAt: "t" });
      writer.send({ type: "keepalive" });
    });

    const text = await response.text();
    const lines = text.trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      type: "batch_started",
    });
  });

  it("aborts the run signal when the client cancels mid-stream", async () => {
    let observedSignal: AbortSignal | null = null;
    let releaseRun = () => {};
    const runHeld = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let sendAfterCancel: (() => void) | null = null;

    const response = createNdjsonResponse(async (writer, clientGone) => {
      observedSignal = clientGone;
      writer.send({ type: "batch_started", total: 1, startedAt: "t" });
      sendAfterCancel = () =>
        writer.send({ type: "batch_complete", results: [] });
      await runHeld;
    });

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();

    expect(observedSignal).not.toBeNull();
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);

    // Sends after disconnect must be swallowed, not thrown.
    expect(() => sendAfterCancel?.()).not.toThrow();
    releaseRun();
  });
});
