import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import http from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runRedirectSignal } from "@/lib/server/signals/redirect-chain";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

vi.mock("node:http", () => ({
  default: {
    request: vi.fn(),
  },
}));

vi.mock("node:https", () => ({
  default: {
    request: vi.fn(),
  },
}));

const lookupMock = vi.mocked(lookup);
const requestMock = vi.mocked(http.request);

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("runRedirectSignal", () => {
  it("records a reachable public target", async () => {
    mockLookupAll([{ address: "93.184.216.34", family: 4 }]);
    mockHttpResponse(200);

    const result = await runRedirectSignal("http://example.test/start");

    expect(result.finalUrl).toBe("http://example.test/start");
    expect(result.totalHops).toBe(0);
    expect(result.httpsUpgraded).toBe(false);
    expect(result.reachable).toBe(true);
    expect(result.terminalStatus).toBe(200);
    expect(result.terminalError).toBeNull();
    expect(result.observations).toEqual([]);
    expect(result.hops).toEqual([
      {
        url: "http://example.test/start",
        status: 200,
      },
    ]);
  });

  it("does not analyze terminal HTML beyond the capture limit", async () => {
    mockLookupAll([{ address: "93.184.216.34", family: 4 }]);
    mockHtmlResponse(`${"a".repeat(64 * 1024)}<script>eval('late')</script>`);

    const result = await runRedirectSignal("http://example.test/start");

    expect(result.content?.obfuscationHints).not.toContain("eval() call");
  });

  it("analyzes terminal HTML captured normally within the deadline", async () => {
    mockLookupAll([{ address: "93.184.216.34", family: 4 }]);
    mockHtmlResponse("<html><script>eval('captured')</script></html>");

    const result = await runRedirectSignal("http://example.test/start");

    expect(result.content?.obfuscationHints).toContain("eval() call");
  });

  it("caps terminal HTML capture by the remaining aggregate deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    mockLookupAll([{ address: "93.184.216.34", family: 4 }]);
    const response = mockDelayedHtmlHeaders(11_750);

    const pending = runRedirectSignal("http://example.test/start");
    await vi.advanceTimersByTimeAsync(11_750);
    expect(response.destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(249);
    expect(response.destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(response.destroy).toHaveBeenCalledTimes(1);
    expect(result.terminalStatus).toBe(200);
    expect(result.content).toBeNull();
  });

  it("destroys terminal HTML immediately when no signal budget remains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    mockLookupAll([{ address: "93.184.216.34", family: 4 }]);
    const response = mockDelayedHtmlHeaders(12_000);

    const pending = runRedirectSignal("http://example.test/start");
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;

    expect(response.destroy).toHaveBeenCalledTimes(1);
    expect(result.terminalStatus).toBe(200);
    expect(result.content).toBeNull();
  });

  it("stops during hostname resolution when the scan is cancelled", async () => {
    lookupMock.mockImplementationOnce(() => new Promise(() => {}) as never);
    const controller = new AbortController();

    const pending = runRedirectSignal(
      "http://example.test/start",
      controller.signal,
    );
    controller.abort();
    const result = await pending;

    expect(requestMock).not.toHaveBeenCalled();
    expect(result.terminalError).toContain("cancelled");
  });

  it("blocks a redirect target that resolves to a private address", async () => {
    mockLookupAll([{ address: "93.184.216.34", family: 4 }]);
    mockLookupAll([{ address: "10.0.0.8", family: 4 }]);
    mockHttpResponse(302, "http://internal.example.test/admin");

    const result = await runRedirectSignal("http://example.test/start");

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(result.finalUrl).toBe("http://internal.example.test/admin");
    expect(result.totalHops).toBe(1);
    expect(result.reachable).toBe(false);
    expect(result.terminalStatus).toBe(302);
    expect(result.terminalError).toContain("private");
    expect(result.observations).toEqual([result.terminalError]);
    expect(result.hops).toEqual([
      {
        url: "http://example.test/start",
        status: 302,
        location: "http://internal.example.test/admin",
      },
    ]);
  });

  it("blocks an initial private literal target before a request", async () => {
    const result = await runRedirectSignal("http://127.0.0.1:3000/start");

    expect(lookupMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.reachable).toBe(false);
    expect(result.terminalStatus).toBeNull();
    expect(result.terminalError).toContain("private");
    expect(result.hops).toEqual([]);
  });

  it("reports a reachable terminal response before the redirect limit", async () => {
    mockLookupAll([{ address: "93.184.216.34", family: 4 }]);
    mockLookupAll([{ address: "93.184.216.34", family: 4 }]);
    mockHttpResponse(302, "/landing");
    mockHttpResponse(204);

    const result = await runRedirectSignal("http://example.test/start");

    expect(result.finalUrl).toBe("http://example.test/landing");
    expect(result.totalHops).toBe(1);
    expect(result.reachable).toBe(true);
    expect(result.terminalStatus).toBe(204);
    expect(result.terminalError).toBeNull();
    expect(result.observations).toEqual([]);
    expect(result.hops).toEqual([
      {
        url: "http://example.test/start",
        status: 302,
        location: "/landing",
      },
      {
        url: "http://example.test/landing",
        status: 204,
      },
    ]);
  });

  it("reports an indeterminate result when the redirect limit is exhausted", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    for (let index = 1; index <= 5; index += 1) {
      mockHttpResponse(302, `/hop-${index}`);
    }

    const result = await runRedirectSignal("http://example.test/start");

    expect(result.finalUrl).toBe("http://example.test/hop-4");
    expect(result.totalHops).toBe(5);
    expect(result.reachable).toBe(false);
    expect(result.terminalStatus).toBe(302);
    expect(result.terminalError).toBe(
      "The redirect chain exceeded the maximum of 5 redirects before reaching a terminal response.",
    );
    expect(result.observations).toEqual([result.terminalError]);
    expect(result.hops.at(-1)).toEqual({
      url: "http://example.test/hop-4",
      status: 302,
      location: "/hop-5",
    });
  });
});

function mockHttpResponse(statusCode: number, location?: string) {
  requestMock.mockImplementationOnce((...args: unknown[]) => {
    const options = args[0];
    const callback = args.find(
      (arg): arg is (response: unknown) => void => typeof arg === "function",
    );

    expect(options).toEqual(
      expect.objectContaining({
        hostname: "93.184.216.34",
        headers: expect.objectContaining({
          host: "example.test",
        }),
      }),
    );
    const response = {
      headers: location ? { location } : {},
      statusCode,
      destroy: vi.fn(),
    };
    const request = {
      once: vi.fn(),
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(() => {
        queueMicrotask(() => {
          callback?.(response as never);
        });
      }),
    };

    return request as never;
  });
}

function mockLookupAll(records: Array<{ address: string; family: 4 | 6 }>) {
  lookupMock.mockResolvedValueOnce(records as never);
}

function mockHtmlResponse(body: string) {
  requestMock.mockImplementationOnce((...args: unknown[]) => {
    const callback = args.find(
      (arg): arg is (response: unknown) => void => typeof arg === "function",
    );
    const response = Object.assign(new EventEmitter(), {
      headers: { "content-type": "text/html" },
      statusCode: 200,
      destroy: vi.fn(),
    });
    const request = {
      once: vi.fn(),
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(() => {
        queueMicrotask(() => {
          callback?.(response as never);
          queueMicrotask(() => {
            response.emit("data", Buffer.from(body));
            response.emit("end");
          });
        });
      }),
    };

    return request as never;
  });
}

function mockDelayedHtmlHeaders(delayMs: number) {
  const response = Object.assign(new EventEmitter(), {
    headers: { "content-type": "text/html" },
    statusCode: 200,
    destroy: vi.fn(),
  });

  requestMock.mockImplementationOnce((...args: unknown[]) => {
    const callback = args.find(
      (arg): arg is (response: unknown) => void => typeof arg === "function",
    );
    const request = {
      once: vi.fn(),
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(() => {
        setTimeout(() => {
          callback?.(response as never);
        }, delayMs);
      }),
    };

    return request as never;
  });

  return response;
}
