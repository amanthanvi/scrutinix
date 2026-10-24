import { lookup } from "node:dns/promises";
import tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getTlsProbeTarget, runSslSignal } from "@/lib/server/signals/ssl";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(lookup);

describe("getTlsProbeTarget", () => {
  it("uses explicit https port when present", () => {
    const { hostname, port } = getTlsProbeTarget(
      "https://15.58.86.110:38376/bin.sh",
    );
    expect(hostname).toBe("15.58.86.110");
    expect(port).toBe(38376);
  });

  it("reads an IPv6 literal without its URL brackets", () => {
    expect(getTlsProbeTarget("https://[2606:4700:4700::1111]:8443/")).toEqual({
      hostname: "2606:4700:4700::1111",
      port: 8443,
    });
  });

  it("defaults https to 443 when port omitted", () => {
    const { port } = getTlsProbeTarget("https://example.com/path");
    expect(port).toBe(443);
  });

  it("defaults http to 80 when port omitted", () => {
    const { port } = getTlsProbeTarget("http://example.com/path");
    expect(port).toBe(80);
  });

  it("preserves an explicit port 0 instead of the scheme default", () => {
    // The redirect probe targets the URL's literal port; substituting 80/443
    // here would let one scan mix evidence from two different endpoints.
    expect(getTlsProbeTarget("http://example.test:0/start").port).toBe(0);
    expect(getTlsProbeTarget("https://example.test:0/start").port).toBe(0);
  });
});

describe("runSslSignal", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("passes resolved port into tls.connect", async () => {
    const connectSpy = vi.spyOn(tls, "connect").mockImplementation(() => {
      const socket = {
        setTimeout: vi.fn(),
        once: vi.fn((event: string, handler: (err?: Error) => void) => {
          if (event === "error") {
            queueMicrotask(() => {
              const err = new Error("connect ECONNREFUSED") as Error & {
                code?: string;
              };
              err.code = "ECONNREFUSED";
              handler(err);
            });
          }
        }),
        destroy: vi.fn(),
        end: vi.fn(),
      };
      return socket as unknown as tls.TLSSocket;
    });

    const result = await runSslSignal("https://15.58.86.110:38376/bin.sh");

    expect(connectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "15.58.86.110",
        port: 38376,
      }),
    );
    expect(result.available).toBe(false);
    expect(result.observations[0]).toContain("38376");
  });

  it("does not return raw TLS exception text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(tls, "connect").mockImplementation(() => {
      const socket = {
        setTimeout: vi.fn(),
        once: vi.fn((event: string, handler: (err?: Error) => void) => {
          if (event === "error") {
            queueMicrotask(() => {
              handler(
                new Error(
                  "handshake failed for redis://default:s3cret-token@cache.internal ONNXRuntime",
                ),
              );
            });
          }
        }),
        destroy: vi.fn(),
        end: vi.fn(),
      };
      return socket as unknown as tls.TLSSocket;
    });

    const result = await runSslSignal(
      "https://15.58.86.110:38376/bin.sh",
      undefined,
      "scan-1234",
    );
    const observation = result.observations.join("\n");

    expect(result.available).toBe(false);
    // Lost coverage, not a finding: the scan result becomes partial.
    expect(result.probeFailed).toBe(true);
    expect(observation).toContain("The TLS probe failed unexpectedly.");
    // The result states the scan's reference once; the row stays plain.
    expect(observation).not.toContain("Reference");
    expect(observation).not.toContain("s3cret-token");
    expect(observation).not.toContain("redis://");
    expect(observation).not.toContain("ONNXRuntime");

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(logged).toContain('"correlationId":"scan-1234"');
    expect(logged).toContain("ONNXRuntime");
    expect(logged).not.toContain("redis://");
  });

  it("keeps an unexpected failure when the next address only refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.215.14", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ] as never);
    const connectSpy = vi
      .spyOn(tls, "connect")
      .mockImplementation((options) => {
        const host = (options as tls.ConnectionOptions).host;
        const socket = {
          setTimeout: vi.fn(),
          once: vi.fn((event: string, handler: (err?: Error) => void) => {
            if (event !== "error") return;
            queueMicrotask(() => {
              if (host === "93.184.215.14") {
                handler(new Error("unexpected handshake state"));
                return;
              }
              const refused = new Error("connect ECONNREFUSED") as Error & {
                code?: string;
              };
              refused.code = "ECONNREFUSED";
              handler(refused);
            });
          }),
          destroy: vi.fn(),
          end: vi.fn(),
        };
        return socket as unknown as tls.TLSSocket;
      });

    const result = await runSslSignal(
      "https://example.test/",
      undefined,
      "scan-5678",
    );

    expect(connectSpy).toHaveBeenCalledTimes(2);
    expect(result.available).toBe(false);
    // The refusal on the second address must not hide the lost coverage.
    expect(result.probeFailed).toBe(true);
    expect(result.observations.join("\n")).toContain(
      "The TLS probe failed unexpectedly.",
    );
  });

  it("blocks private literal IPs before opening a TLS socket", async () => {
    const connectSpy = vi.spyOn(tls, "connect");

    const result = await runSslSignal("https://127.0.0.1:443/");

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(result.observations[0]).toContain("private");
  });

  it("stops during hostname resolution when the scan is cancelled", async () => {
    lookupMock.mockImplementationOnce(() => new Promise(() => {}) as never);
    const connectSpy = vi.spyOn(tls, "connect");
    const controller = new AbortController();

    const pending = runSslSignal("https://example.test/", controller.signal);
    controller.abort();
    const result = await pending;

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(result.observations[0]).toContain("cancelled");
  });
});
