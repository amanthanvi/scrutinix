import tls from "node:tls";

import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RedirectData } from "@/lib/domain/types";
import { classifyUrlLocally } from "@/lib/server/ml/local-classifier";
import { runRedirectSignal } from "@/lib/server/signals/redirect-chain";
import { server } from "@/tests/setup/msw.server";

/**
 * A plain http:// link through the real TLS check (`runSslSignal`): only
 * the socket and the address lookup are stubbed. Before the probe followed
 * the redirect chain it opened TLS on port 80, got
 * ERR_SSL_WRONG_VERSION_NUMBER, and marked every http:// scan partial
 * (never cached, a Reference line, "We couldn't check the certificate").
 */

// The TLS probe's public-address gate resolves the host; keep it offline.
vi.mock("node:dns/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:dns/promises")>()),
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("@/lib/server/providers/dnsbl", () => ({
  queryDnsbls: vi.fn(async () => ({
    matches: [],
    warnings: [],
    observations: [],
  })),
}));

vi.mock("@/lib/server/ml/local-classifier", () => ({
  classifyUrlLocally: vi.fn(),
}));

vi.mock("@/lib/server/signals/dns", () => ({
  runDnsSignal: vi.fn(async () => ({
    subjectType: "hostname",
    addresses: ["93.184.216.34"],
    cnames: [],
    mx: [],
    txt: [],
    nameservers: [],
    reverseHostnames: [],
    anomalies: [],
    observations: [],
  })),
}));

vi.mock("@/lib/server/signals/redirect-chain", () => ({
  runRedirectSignal: vi.fn(),
}));

const redirectMock = vi.mocked(runRedirectSignal);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VIRUSTOTAL_API_KEY", "vt-key");
  vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "gsb-key");
  vi.stubEnv("URLHAUS_AUTH_KEY", "abuse-ch-key");
  vi.mocked(classifyUrlLocally)
    .mockReset()
    .mockResolvedValue({
      label: "benign",
      score: 0.99,
      reasons: ["The local URL model classified this link as benign."],
      model: "test-transformer",
    });
  redirectMock.mockReset();
  vi.restoreAllMocks();
  installHandlers();
});

describe("plain http:// links", () => {
  it("say a link that stays on HTTP has no certificate when its site offers none, and cache the complete result", async () => {
    // Nothing listens on 443: a browser that tries HTTPS first falls back.
    const connectSpy = stubTls({});
    redirectMock.mockResolvedValue(
      chain("http://plain-http.example/", [
        { url: "http://plain-http.example/", status: 200 },
      ]),
    );

    const first = await scan("http://plain-http.example/");
    const second = await scan("http://plain-http.example/");

    // Port 80 is never asked for a certificate; 443 is asked once (the
    // second scan is a cache hit).
    expect(probesOf(connectSpy, "plain-http.example")).toEqual([443]);
    // One redirect run per scan, shared with the TLS check.
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(first.result).toMatchObject({
      verdict: "safe",
      signals: {
        ssl: {
          status: "success",
          data: {
            available: false,
            noHttps: true,
            observations: [
              "This link never moves to HTTPS, so there's no certificate to check.",
            ],
          },
        },
      },
      metadata: { cacheHit: false, partialFailure: false },
    });
    expect(first.result?.signals?.ssl?.data?.probeFailed).toBeUndefined();
    // Nothing reads as lost coverage.
    expect(first.result?.threatInfo?.confidenceReasons).not.toContainEqual(
      expect.stringMatching(/TLS Certificate/),
    );
    expect(first.result?.threatInfo?.limitations).toEqual([]);
    expect(second.cached).toBe(true);
    expect(second.result?.metadata).toMatchObject({ cacheHit: true });
  });

  it("read the certificate a site that stays on HTTP offers on 443, and cache the complete result", async () => {
    const connectSpy = stubTls({ "both.example": "trusted" });
    redirectMock.mockResolvedValue(
      chain("http://both.example/", [
        { url: "http://both.example/", status: 200 },
      ]),
    );

    const first = await scan("http://both.example/");
    const second = await scan("http://both.example/");

    expect(probesOf(connectSpy, "both.example")).toEqual([443]);
    expect(first.result).toMatchObject({
      verdict: "safe",
      signals: {
        ssl: {
          status: "success",
          data: { available: true, validationState: "trusted" },
        },
      },
      metadata: { cacheHit: false, partialFailure: false },
    });
    expect(first.result?.signals?.ssl?.data?.otherSite).toBeUndefined();
    expect(second.cached).toBe(true);
  });

  it("read the certificate where the link moves to HTTPS, and cache the complete result", async () => {
    const connectSpy = stubTls({ "upgrade.example": "trusted" });
    redirectMock.mockResolvedValue(
      chain("https://upgrade.example/", [
        {
          url: "http://upgrade.example/",
          status: 301,
          location: "https://upgrade.example/",
        },
        { url: "https://upgrade.example/", status: 200 },
      ]),
    );

    const first = await scan("http://upgrade.example/");
    const second = await scan("http://upgrade.example/");

    // One probe, on 443 (the second scan is a cache hit).
    expect(probesOf(connectSpy, "upgrade.example")).toEqual([443]);
    expect(first.result).toMatchObject({
      verdict: "safe",
      signals: {
        ssl: {
          status: "success",
          data: { available: true, validationState: "trusted" },
        },
      },
      metadata: { cacheHit: false, partialFailure: false },
    });
    expect(second.cached).toBe(true);
  });

  it("name another site's certificate as its own, never as the link's, and cache the complete result", async () => {
    const connectSpy = stubTls({ "landing.example": "warning" });
    redirectMock.mockResolvedValue(
      chain("https://landing.example/", [
        {
          url: "http://short.example/",
          status: 301,
          location: "https://landing.example/",
        },
        { url: "https://landing.example/", status: 200 },
      ]),
    );

    const first = await scan("http://short.example/");
    const second = await scan("http://short.example/");

    expect(probesOf(connectSpy, "short.example")).toEqual([]);
    expect(probesOf(connectSpy, "landing.example")).toEqual([443]);
    expect(first.result).toMatchObject({
      signals: {
        ssl: {
          status: "success",
          data: {
            available: true,
            validationState: "warning",
            otherSite: "landing.example",
          },
        },
      },
      metadata: { cacheHit: false, partialFailure: false },
    });
    // The chain-verification note is a limitation; the note naming whose
    // certificate it is isn't.
    expect(first.result?.threatInfo?.limitations).toEqual([
      "TLS Certificate: The certificate chain could not be fully verified from the scanning runtime.",
    ]);
    expect(second.cached).toBe(true);
  });
});

/**
 * The scanned sites' TLS sockets are fake, so a probe never reaches the
 * network: a listed `.example` servername completes the handshake with
 * that kind of certificate, and any other `.example` name is refused at
 * once. The providers' own connections (MSW answers them at the socket)
 * pass through.
 */
function stubTls(answers: Record<string, "trusted" | "warning">) {
  const realConnect = tls.connect;
  return vi.spyOn(tls, "connect").mockImplementation(((
    ...args: Parameters<typeof tls.connect>
  ) => {
    const servername = (args[0] as tls.ConnectionOptions).servername ?? "";
    if (!servername.endsWith(".example")) {
      return realConnect(...args);
    }
    const kind = answers[servername];
    return kind ? certificateSocket(kind) : refusedSocket();
  }) as typeof tls.connect);
}

/** The ports the TLS probe opened to `servername`. */
function probesOf(
  connectSpy: { mock: { calls: unknown[][] } },
  servername: string,
): unknown[] {
  return connectSpy.mock.calls
    .map((call) => call[0] as tls.ConnectionOptions)
    .filter((options) => options?.servername === servername)
    .map((options) => options.port);
}

function chain(finalUrl: string, hops: RedirectData["hops"]): RedirectData {
  return {
    finalUrl,
    totalHops: hops.filter((hop) => hop.location).length,
    httpsUpgraded: finalUrl.startsWith("https:"),
    reachable: true,
    terminalStatus: 200,
    terminalError: null,
    hops,
    observations: [],
  };
}

/** A TLS socket that completes the handshake with a certificate. */
function certificateSocket(kind: "trusted" | "warning") {
  const socket = {
    authorizationError:
      kind === "warning" ? "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" : undefined,
    setTimeout: vi.fn(),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === "secureConnect") {
        queueMicrotask(handler);
      }
      return socket;
    }),
    getPeerCertificate: () => ({
      valid_from: "Jan  1 00:00:00 2026 GMT",
      valid_to: "Jan  1 00:00:00 2099 GMT",
      issuer: { CN: "Example CA" },
      subject: { CN: "example" },
      fingerprint256: "AB:CD",
    }),
    getProtocol: () => "TLSv1.3",
    end: vi.fn(),
    destroy: vi.fn(),
  };
  return socket as unknown as tls.TLSSocket;
}

/** A TLS socket refused at once (nothing listens). */
function refusedSocket() {
  const socket = {
    setTimeout: vi.fn(),
    once: vi.fn((event: string, handler: (error: Error) => void) => {
      if (event === "error") {
        queueMicrotask(() =>
          handler(
            Object.assign(new Error("connect ECONNREFUSED"), {
              code: "ECONNREFUSED",
            }),
          ),
        );
      }
      return socket;
    }),
    end: vi.fn(),
    destroy: vi.fn(),
  };
  return socket as unknown as tls.TLSSocket;
}

interface ScanEvent {
  type: string;
  cached?: boolean;
  result?: {
    verdict?: string;
    metadata?: { cacheHit?: boolean; partialFailure?: boolean };
    signals?: {
      ssl?: {
        data?: { probeFailed?: boolean; otherSite?: string } | null;
      };
    };
    threatInfo?: {
      confidenceReasons?: string[];
      limitations?: string[];
    } | null;
  };
}

async function scan(url: string) {
  const { POST } = await import("@/app/api/analyze/route");
  const response = await POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );
  const events = (await response.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ScanEvent);
  return {
    cached: events.find((event) => event.type === "scan_started")?.cached,
    result: events.find((event) => event.type === "scan_complete")?.result,
  };
}

function installHandlers() {
  server.use(
    http.get("https://www.virustotal.com/api/v3/urls/:id", () =>
      HttpResponse.json({
        data: {
          attributes: {
            last_analysis_stats: {
              malicious: 0,
              suspicious: 0,
              harmless: 5,
              undetected: 20,
              timeout: 0,
            },
            last_analysis_results: {},
          },
        },
      }),
    ),
    http.post("https://safebrowsing.googleapis.com/v4/threatMatches:find", () =>
      HttpResponse.json({ matches: [] }),
    ),
    http.post("https://urlhaus-api.abuse.ch/v1/url/", () =>
      HttpResponse.json({ query_status: "no_results" }),
    ),
    http.post("https://urlhaus-api.abuse.ch/v1/host/", () =>
      HttpResponse.json({ query_status: "no_results" }),
    ),
    http.post("https://threatfox-api.abuse.ch/api/v1/", () =>
      HttpResponse.json({ query_status: "no_result", data: [] }),
    ),
    http.get(
      "https://openphish.com/feed.txt",
      () => new HttpResponse("", { status: 200 }),
    ),
    http.get("https://rdap.org/domain/:hostname", () =>
      HttpResponse.json({
        events: [
          {
            eventAction: "registration",
            eventDate: "2010-01-01T00:00:00.000Z",
          },
        ],
        entities: [
          {
            roles: ["registrar"],
            vcardArray: ["vcard", [["fn", {}, "text", "Example Registrar"]]],
          },
        ],
      }),
    ),
  );
}
