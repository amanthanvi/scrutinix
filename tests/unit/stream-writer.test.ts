import { afterEach, describe, expect, it, vi } from "vitest";

import { createNdjsonResponse } from "@/lib/server/stream";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("replaces a thrown exception with a generic stream error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = createNdjsonResponse(async () => {
      throw new Error(
        "ONNXRuntime failed WRONGPASS s3cret-token redis://default:s3cret-token@cache.internal",
      );
    });

    let caught: unknown;
    try {
      await response.text();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("The scan stream failed unexpectedly.");
    expect(message).toMatch(/Reference: [0-9a-f-]{36}\./);
    expect(message).not.toContain("s3cret-token");
    expect(message).not.toContain("ONNXRuntime");
    expect(message).not.toContain("redis://");

    const logged = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(logged).toContain("ONNXRuntime");
    expect(logged).toContain("WRONGPASS");
    expect(logged).not.toContain("redis://");
  });
});
