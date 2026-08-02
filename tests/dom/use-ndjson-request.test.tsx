import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNdjsonRequest } from "@/hooks/use-ndjson-request";

const OPTIONS = {
  endpoint: "/api/analyze",
  requestLabel: "Scan request",
  streamFailureMessage: "The scan stream failed unexpectedly.",
};

function ndjsonResponse(lines: string[]): Response {
  return new Response(`${lines.join("\n")}\n`, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNdjsonRequest", () => {
  it("streams events to the handler on the happy path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjsonResponse(['{"type":"a"}', '{"type":"b"}'])),
    );

    const { result } = renderHook(() => useNdjsonRequest(OPTIONS));
    const events: unknown[] = [];
    const onError = vi.fn();

    await act(async () => {
      await result.current.start(
        { url: "https://example.com/" },
        {
          onEvent: (event) => {
            events.push(event);
            return (event as { type?: string }).type === "b"
              ? "terminal"
              : "continue";
          },
          onError,
          onAborted: vi.fn(),
        },
      );
    });

    expect(events).toEqual([{ type: "a" }, { type: "b" }]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("sanitizes HTTP error payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "rate_limited",
                message: "Too many scans.",
                retryable: true,
              },
            }),
            { status: 429 },
          ),
      ),
    );

    const { result } = renderHook(() => useNdjsonRequest(OPTIONS));
    const onError = vi.fn();

    await act(async () => {
      await result.current.start(
        { url: "https://example.com/" },
        { onEvent: vi.fn(), onError, onAborted: vi.fn() },
      );
    });

    expect(onError).toHaveBeenCalledWith({
      code: "rate_limited",
      message: "Too many scans.",
      retryable: true,
    });
  });

  it("maps mid-stream failures to the stream error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"type":"a"}\n'));
        controller.error(new Error("connection reset"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    const { result } = renderHook(() => useNdjsonRequest(OPTIONS));
    const onError = vi.fn();
    const events: unknown[] = [];

    await act(async () => {
      await result.current.start(
        { url: "https://example.com/" },
        {
          onEvent: (event) => {
            events.push(event);
            return "continue";
          },
          onError,
          onAborted: vi.fn(),
        },
      );
    });

    // Chunk delivery before the error is runtime-dependent; the contract is
    // that the failure reaches onError as a sanitized ApiError.
    expect(events.length).toBeLessThanOrEqual(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "connection reset" }),
    );
  });

  it("reports cancellation through onAborted, not onError", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            release = () => reject(new DOMException("Aborted", "AbortError"));
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );

    const { result } = renderHook(() => useNdjsonRequest(OPTIONS));
    const onError = vi.fn();
    const onAborted = vi.fn();

    await act(async () => {
      const pending = result.current.start(
        { url: "https://example.com/" },
        { onEvent: vi.fn(), onError, onAborted },
      );
      result.current.cancel();
      release?.();
      await pending;
    });

    expect(onAborted).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores abort callbacks from a request superseded by a newer one", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          (_input: unknown, init?: RequestInit) =>
            new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
            }),
        )
        .mockResolvedValueOnce(ndjsonResponse(['{"type":"new"}'])),
    );

    const { result } = renderHook(() => useNdjsonRequest(OPTIONS));
    const firstAborted = vi.fn();
    const secondEvents: unknown[] = [];

    await act(async () => {
      const first = result.current.start(
        { url: "https://old.example/" },
        {
          onEvent: vi.fn(),
          onError: vi.fn(),
          onAborted: firstAborted,
        },
      );
      const second = result.current.start(
        { url: "https://new.example/" },
        {
          onEvent: (event) => {
            secondEvents.push(event);
            return "terminal";
          },
          onError: vi.fn(),
          onAborted: vi.fn(),
        },
      );
      await Promise.all([first, second]);
    });

    expect(firstAborted).not.toHaveBeenCalled();
    expect(secondEvents).toEqual([{ type: "new" }]);
  });

  it("reports a clean EOF that arrives before a terminal event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjsonResponse(['{"type":"scan_started"}'])),
    );

    const { result } = renderHook(() => useNdjsonRequest(OPTIONS));
    const onError = vi.fn();

    await act(async () => {
      await result.current.start(
        { url: "https://example.com/" },
        {
          onEvent: () => "continue",
          onError,
          onAborted: vi.fn(),
        },
      );
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "The result stream ended before a terminal event.",
      }),
    );
  });
});
