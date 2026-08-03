import { describe, expect, it, vi } from "vitest";

import { fetchWithTimeout, sleep } from "@/lib/server/http";

describe("fetchWithTimeout", () => {
  it("honors the caller signal without disabling the timeout", async () => {
    const seenSignals: Array<AbortSignal | null | undefined> = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        seenSignals.push(init?.signal);
        return new Response("ok");
      });

    const caller = new AbortController();
    await fetchWithTimeout("https://example.com/", { signal: caller.signal });

    const combined = seenSignals[0];
    expect(combined).toBeDefined();
    expect(combined?.aborted).toBe(false);

    // Aborting the caller signal must abort the combined signal - the old
    // implementation dropped the internal timeout when a caller signal was
    // provided, and vice versa.
    caller.abort(new Error("caller cancelled"));
    expect(combined?.aborted).toBe(true);

    fetchSpy.mockRestore();
  });

  it("still times out when a caller signal is provided", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new Error("aborted")),
          );
        }),
    );

    const caller = new AbortController();
    const pending = fetchWithTimeout(
      "https://example.com/",
      { signal: caller.signal },
      1_000,
    );
    const assertion = expect(pending).rejects.toThrow(/Timed out after 1000ms/);

    await vi.advanceTimersByTimeAsync(1_500);
    await assertion;

    fetchSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe("sleep", () => {
  it("rejects promptly when the signal aborts", async () => {
    const controller = new AbortController();
    const pending = sleep(60_000, controller.signal);

    controller.abort(new Error("stop sleeping"));

    await expect(pending).rejects.toThrow("stop sleeping");
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already aborted"));

    await expect(sleep(10, controller.signal)).rejects.toThrow(
      "already aborted",
    );
  });
});
