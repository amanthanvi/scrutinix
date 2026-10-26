import { lookup } from "node:dns/promises";
import tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RedirectData } from "@/lib/domain/types";
import { getTlsProbeTarget, runSslSignal } from "@/lib/server/signals/ssl";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(lookup);

describe("getTlsProbeTarget", () => {
  it("uses explicit https port when present", () => {
    expect(getTlsProbeTarget("https://15.58.86.110:38376/bin.sh")).toEqual({
      hostname: "15.58.86.110",
      port: 38376,
    });
  });

  it("reads an IPv6 literal without its URL brackets", () => {
    expect(getTlsProbeTarget("https://[2606:4700:4700::1111]:8443/")).toEqual({
      hostname: "2606:4700:4700::1111",
      port: 8443,
    });
  });

  it("defaults https to 443 when port omitted", () => {
    expect(getTlsProbeTarget("https://example.com/path")).toMatchObject({
      port: 443,
    });
  });

  it("reads a plain-HTTP link's own host on 443, never port 80", () => {
    // Port 80 answers a TLS hello with plain HTTP, which says nothing.
    expect(getTlsProbeTarget("http://example.com/path")).toEqual({
      hostname: "example.com",
      port: 443,
    });
  });

  it("preserves an explicit port 0 instead of the scheme default", () => {
    // The redirect probe targets the URL's literal port; substituting 80/443
    // here would let one scan mix evidence from two different endpoints.
    expect(getTlsProbeTarget("http://example.test:0/start")).toMatchObject({
      port: 0,
    });
    expect(getTlsProbeTarget("https://example.test:0/start")).toMatchObject({
      port: 0,
    });
  });

  it("reads a plain-HTTP link's certificate where its chain reaches HTTPS", () => {
    expect(
      getTlsProbeTarget(
        "http://github.com/",
        chain({
          finalUrl: "https://github.com/",
          hops: [
            {
              url: "http://github.com/",
              status: 301,
              location: "https://github.com/",
            },
            { url: "https://github.com/", status: 200 },
          ],
        }),
      ),
    ).toEqual({ hostname: "github.com", port: 443 });
    // The first HTTPS address, not the last: the certificate the browser
    // meets on the way.
    expect(
      getTlsProbeTarget(
        "http://short.example/x",
        chain({
          finalUrl: "https://landing.example:8443/end",
          hops: [
            {
              url: "http://short.example/x",
              status: 302,
              location: "https://hop.example/y",
            },
            {
              url: "https://hop.example/y",
              status: 302,
              location: "https://landing.example:8443/end",
            },
            { url: "https://landing.example:8443/end", status: 200 },
          ],
        }),
      ),
    ).toEqual({ hostname: "hop.example", port: 443 });
  });

  it("asks the host's own 443 when the chain stays on plain HTTP, as browsers that try HTTPS first do", () => {
    const plain = chain({
      finalUrl: "http://plain.example/",
      hops: [{ url: "http://plain.example/", status: 200 }],
    });
    expect(getTlsProbeTarget("http://plain.example/", plain)).toEqual({
      hostname: "plain.example",
      port: 443,
      offered: true,
    });
    // ":80" is the default port, so it names none.
    expect(getTlsProbeTarget("http://plain.example:80/", plain)).toMatchObject({
      port: 443,
      offered: true,
    });
    // A link that names its own port stays on it: no certificate to read.
    expect(getTlsProbeTarget("http://plain.example:8080/", plain)).toEqual({
      skip: "no-https",
    });
  });

  it("never reads the link's own TLS port once its chain answered on HTTP and stopped", () => {
    // http://origin.example -> http://down.example (refused): origin's
    // 443 was never in the visitor's path.
    expect(
      getTlsProbeTarget(
        "http://origin.example/",
        chain({
          reachable: false,
          terminalStatus: 302,
          terminalError: "The host refused the connection.",
          finalUrl: "http://down.example/",
          hops: [
            {
              url: "http://origin.example/",
              status: 302,
              location: "http://down.example/",
            },
          ],
        }),
      ),
    ).toEqual({ skip: "chain-stopped" });
  });

  it("falls back to the link's own TLS port when the chain never answered", () => {
    const silent = chain({
      reachable: false,
      terminalStatus: null,
      finalUrl: "http://down.example/",
      hops: [],
    });
    expect(getTlsProbeTarget("http://down.example/", silent)).toEqual({
      hostname: "down.example",
      port: 443,
    });
    expect(getTlsProbeTarget("http://down.example:8080/", silent)).toEqual({
      hostname: "down.example",
      port: 8080,
    });
  });

  it("ignores the chain for an https link", () => {
    expect(
      getTlsProbeTarget(
        "https://short.example/",
        chain({ finalUrl: "https://landing.example/" }),
      ),
    ).toEqual({ hostname: "short.example", port: 443 });
  });
});

function chain(overrides: Partial<RedirectData>): RedirectData {
  return {
    finalUrl: "",
    totalHops: 0,
    httpsUpgraded: false,
    reachable: true,
    terminalStatus: 200,
    terminalError: null,
    hops: [],
    observations: [],
    ...overrides,
  };
}

function failingSocket(code: string) {
  return () => {
    const socket = {
      setTimeout: vi.fn(),
      once: vi.fn((event: string, handler: (err?: Error) => void) => {
        if (event === "error") {
          queueMicrotask(() => {
            const err = new Error(code) as Error & { code?: string };
            err.code = code;
            handler(err);
          });
        }
      }),
      destroy: vi.fn(),
      end: vi.fn(),
    };
    return socket as unknown as tls.TLSSocket;
  };
}

/** A socket that completes the handshake and presents a certificate. */
function certificateSocket({
  authorizationError,
}: { authorizationError?: string } = {}) {
  return () => {
    const socket = {
      authorizationError,
      setTimeout: vi.fn(),
      once: vi.fn((event: string, handler: () => void) => {
        if (event === "secureConnect") queueMicrotask(handler);
        return socket;
      }),
      getPeerCertificate: () => ({
        valid_from: "Jan  1 00:00:00 2026 GMT",
        valid_to: authorizationError
          ? "Jan  1 00:00:00 2026 GMT"
          : "Jan  1 00:00:00 2099 GMT",
        issuer: { CN: "Example CA" },
        subject: { CN: "example" },
      }),
      getProtocol: () => "TLSv1.3",
      end: vi.fn(),
      destroy: vi.fn(),
    };
    return socket as unknown as tls.TLSSocket;
  };
}

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

  it("says a plain-HTTP link that stays on HTTP has no certificate when its site offers none", async () => {
    const stays = vi.fn(async () =>
      chain({
        finalUrl: "http://93.184.215.14/",
        hops: [{ url: "http://93.184.215.14/", status: 200 }],
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Nothing on 443, no TLS there, an unexpected failure, or a
    // certificate a browser rejects: browsers fall back to plain HTTP, so
    // none of them is lost coverage.
    for (const answer of [
      failingSocket("ECONNREFUSED"),
      failingSocket("ERR_SSL_WRONG_VERSION_NUMBER"),
      failingSocket("ERR_SOMETHING_ODD"),
      certificateSocket({ authorizationError: "CERT_HAS_EXPIRED" }),
    ]) {
      const connectSpy = vi.spyOn(tls, "connect").mockImplementation(answer);
      const result = await runSslSignal(
        "http://93.184.215.14/",
        undefined,
        "scan-http",
        stays,
      );

      expect(connectSpy).toHaveBeenCalledWith(
        expect.objectContaining({ host: "93.184.215.14", port: 443 }),
      );
      expect(result).toMatchObject({ available: false, noHttps: true });
      expect(result.probeFailed).toBeUndefined();
      expect(result.problem).toBeUndefined();
      expect(result.observations).toEqual([
        "This link never moves to HTTPS, so there's no certificate to check.",
      ]);
      connectSpy.mockRestore();
    }
    expect(stays).toHaveBeenCalledTimes(4);
    errorSpy.mockRestore();

    // A link that names its port: nothing to ask.
    const connectSpy = vi.spyOn(tls, "connect");
    const named = await runSslSignal(
      "http://93.184.215.14:8080/",
      undefined,
      undefined,
      async () =>
        chain({
          finalUrl: "http://93.184.215.14:8080/",
          hops: [{ url: "http://93.184.215.14:8080/", status: 200 }],
        }),
    );
    expect(connectSpy).not.toHaveBeenCalled();
    expect(named).toMatchObject({ available: false, noHttps: true });
  });

  it("reads the certificate a plain-HTTP link's site offers on 443", async () => {
    const connectSpy = vi
      .spyOn(tls, "connect")
      .mockImplementation(certificateSocket());

    const result = await runSslSignal(
      "http://93.184.215.14/",
      undefined,
      undefined,
      async () =>
        chain({
          finalUrl: "http://93.184.215.14/",
          hops: [{ url: "http://93.184.215.14/", status: 200 }],
        }),
    );

    expect(connectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ host: "93.184.215.14", port: 443 }),
    );
    // The link's own host: its certificate, paired with its domain age.
    expect(result).toMatchObject({
      available: true,
      validationState: "trusted",
    });
    expect(result.noHttps).toBeUndefined();
    expect(result.otherSite).toBeUndefined();
    expect(result.observations[0]).toBe(
      "This link stays on plain HTTP; this is the certificate its site presents over HTTPS.",
    );
  });

  it("probes where a plain-HTTP link's chain reaches HTTPS", async () => {
    const connectSpy = vi
      .spyOn(tls, "connect")
      .mockImplementation(failingSocket("ECONNREFUSED"));

    await runSslSignal(
      "http://93.184.215.14/",
      undefined,
      undefined,
      async () =>
        chain({
          finalUrl: "https://93.184.215.15/",
          hops: [
            {
              url: "http://93.184.215.14/",
              status: 301,
              location: "https://93.184.215.15/",
            },
            { url: "https://93.184.215.15/", status: 200 },
          ],
        }),
    );

    expect(connectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ host: "93.184.215.15", port: 443 }),
    );
  });

  it("marks a certificate read on another site as that site's", async () => {
    const upgrade = async () =>
      chain({
        finalUrl: "https://93.184.215.15/",
        hops: [
          {
            url: "http://93.184.215.14/",
            status: 301,
            location: "https://93.184.215.15/",
          },
          { url: "https://93.184.215.15/", status: 200 },
        ],
      });
    const connectSpy = vi.spyOn(tls, "connect").mockImplementation(() => {
      const socket = {
        authorizationError: undefined,
        setTimeout: vi.fn(),
        once: vi.fn((event: string, handler: () => void) => {
          if (event === "secureConnect") queueMicrotask(handler);
          return socket;
        }),
        getPeerCertificate: () => ({
          valid_from: "Jan  1 00:00:00 2026 GMT",
          valid_to: "Jan  1 00:00:00 2099 GMT",
          issuer: { CN: "Example CA" },
          subject: { CN: "landing" },
        }),
        getProtocol: () => "TLSv1.3",
        end: vi.fn(),
        destroy: vi.fn(),
      };
      return socket as unknown as tls.TLSSocket;
    });

    const result = await runSslSignal(
      "http://93.184.215.14/",
      undefined,
      undefined,
      upgrade,
    );

    expect(result.otherSite).toBe("93.184.215.15");
    expect(result.observations[0]).toBe(
      "This is the certificate of 93.184.215.15, where the link moves to HTTPS.",
    );

    // A problem with it is named as that site's.
    connectSpy.mockImplementation(
      certificateSocket({ authorizationError: "CERT_HAS_EXPIRED" }),
    );
    const expired = await runSslSignal(
      "http://93.184.215.14/",
      undefined,
      undefined,
      upgrade,
    );
    expect(expired).toMatchObject({
      otherSite: "93.184.215.15",
      validationState: "invalid",
      problem: "The certificate at 93.184.215.15 has expired.",
    });

    // No certificate read: nothing to attribute.
    connectSpy.mockImplementation(failingSocket("ECONNREFUSED"));
    const refused = await runSslSignal(
      "http://93.184.215.14/",
      undefined,
      undefined,
      upgrade,
    );
    expect(refused.otherSite).toBeUndefined();
    expect(refused.observations).toEqual([
      "The host refused a TLS connection on port 443.",
    ]);
  });

  it("reads nothing when the chain answered on HTTP and stopped short", async () => {
    const connectSpy = vi.spyOn(tls, "connect");

    const result = await runSslSignal(
      "http://93.184.215.14/",
      undefined,
      undefined,
      async () =>
        chain({
          reachable: false,
          terminalStatus: 302,
          finalUrl: "http://93.184.215.16/",
          hops: [
            {
              url: "http://93.184.215.14/",
              status: 302,
              location: "http://93.184.215.16/",
            },
          ],
        }),
    );

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ available: false });
    expect(result.noHttps).toBeUndefined();
    expect(result.probeFailed).toBeUndefined();
    expect(result.observations).toEqual([
      "The redirects stopped before reaching HTTPS, so there was no certificate to read.",
    ]);
  });

  it("words a certificate problem plainly and keeps the code out of every sentence", async () => {
    vi.spyOn(tls, "connect").mockImplementation(() => {
      const socket = {
        authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID",
        setTimeout: vi.fn(),
        once: vi.fn((event: string, handler: () => void) => {
          if (event === "secureConnect") queueMicrotask(handler);
          return socket;
        }),
        getPeerCertificate: () => ({
          valid_from: "Jan  1 00:00:00 2026 GMT",
          valid_to: "Jan  1 00:00:00 2099 GMT",
          issuer: { CN: "Example CA" },
          subject: { CN: "*.badssl.com" },
        }),
        getProtocol: () => "TLSv1.3",
        end: vi.fn(),
        destroy: vi.fn(),
      };
      return socket as unknown as tls.TLSSocket;
    });

    const result = await runSslSignal("https://93.184.215.14/");

    expect(result).toMatchObject({
      validationState: "invalid",
      authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID",
      problem: "The site's certificate was issued for a different name.",
    });
    expect(result.observations.join(" ")).not.toMatch(
      /ERR_|CERT_|TLS validation/,
    );
  });

  it("reads a plain-HTTP answer on a TLS port as a finding, not a failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(tls, "connect").mockImplementation(
      failingSocket("ERR_SSL_WRONG_VERSION_NUMBER"),
    );

    const result = await runSslSignal("https://93.184.215.14:8080/");

    expect(result.available).toBe(false);
    expect(result.probeFailed).toBeUndefined();
    expect(result.observations).toEqual([
      "The host answered on port 8080 without TLS.",
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
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
