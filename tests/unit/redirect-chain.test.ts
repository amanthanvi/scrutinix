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
  vi.clearAllMocks();
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
