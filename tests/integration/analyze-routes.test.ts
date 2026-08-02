import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/tests/setup/msw.server";

// DNSBL lookups ride raw DNS, which MSW cannot intercept; stub them out.
vi.mock("@/lib/server/providers/dnsbl", () => ({
  queryDnsbls: vi.fn(async () => ({
    matches: [],
    warnings: [],
    observations: [],
  })),
}));

vi.mock("@/lib/server/signals/dns", () => ({
  runDnsSignal: vi.fn(async () => ({
    subjectType: "hostname",
    addresses: ["93.184.216.34"],
    cnames: [],
    mx: ["mx.example.com"],
    txt: ["v=spf1 include:_spf.example.com ~all"],
    nameservers: ["ns1.example.com"],
    reverseHostnames: [],
    anomalies: [],
    observations: [],
  })),
}));

vi.mock("@/lib/server/signals/ssl", () => ({
  runSslSignal: vi.fn(async () => ({
    protocol: "TLSv1.3",
    available: true,
    validationState: "trusted",
    authorized: true,
    authorizationError: null,
    issuer: "Example CA",
    subject: "example.com",
    validFrom: "2025-01-01T00:00:00.000Z",
    validTo: "2027-01-01T00:00:00.000Z",
    daysRemaining: 240,
    selfSigned: false,
    fingerprint256: "abc123",
    observations: [],
  })),
}));

vi.mock("@/lib/server/signals/redirect-chain", () => ({
  runRedirectSignal: vi.fn(async () => ({
    finalUrl: "https://example.com/",
    totalHops: 1,
    httpsUpgraded: true,
    reachable: true,
    terminalStatus: 200,
    terminalError: null,
    hops: [
      {
        url: "http://example.com/",
        status: 301,
        location: "https://example.com/",
      },
      { url: "https://example.com/", status: 200 },
    ],
    observations: [],
  })),
}));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VIRUSTOTAL_API_KEY", "vt-key");
  vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "gsb-key");
});

describe("analysis routes", () => {
  it("streams single analysis events", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers();

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "example.com" }),
      }),
    );

    const events = await parseNdjsonEvents(response);

    expect(events[0]?.type).toBe("scan_started");
    expect(
      events.filter((event) => event.type === "signal_result"),
    ).toHaveLength(8);
    expect(events.at(-1)?.type).toBe("scan_complete");
  });

  it("rejects requests without a JSON content type", async () => {
    const { POST } = await import("@/app/api/analyze/route");

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({ url: "example.com" }),
      }),
    );

    expect(response.status).toBe(415);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("unsupported_media_type");
  });

  it("rejects cross-origin scan requests", async () => {
    const { POST } = await import("@/app/api/analyze/route");

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ url: "example.com" }),
      }),
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("cross_origin_forbidden");
  });

  it("allows same-origin scan requests", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers();

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ url: "example.com" }),
      }),
    );

    expect(response.status).toBe(200);
    // Drain the stream so the scan does not keep running into the next test.
    await parseNdjsonEvents(response);
  });

  it("matches the browser origin against the Host header, not request.url", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers();

    // Behind `next start`, request.url reports the server's configured
    // hostname (localhost) even when the browser connected via 127.0.0.1.
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({ url: "example.com" }),
      }),
    );

    expect(response.status).toBe(200);
    await parseNdjsonEvents(response);
  });

  it("rejects an origin spoofed through X-Forwarded-Host", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers();

    const response = await POST(
      new Request("https://scrutinix.example/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "scrutinix.example",
          origin: "https://attacker.example",
          "x-forwarded-host": "attacker.example",
        },
        body: JSON.stringify({ url: "example.com" }),
      }),
    );

    if (response.status === 200) {
      await parseNdjsonEvents(response);
    }
    expect(response.status).toBe(403);
  });

  it("reports RDAP outages as whois signal errors and partial failure", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers({ rdapStatus: 504 });

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "example.com" }),
      }),
    );

    const events = await parseNdjsonEvents(response);
    const completion = events.at(-1);

    expect(completion?.type).toBe("scan_complete");
    expect(completion?.result).toMatchObject({
      signals: {
        whois: {
          status: "error",
          data: null,
        },
      },
      metadata: {
        partialFailure: true,
      },
    });
  });

  it("treats an RDAP 404 as an honest no-record answer, not an error", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers({ rdapStatus: 404 });

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "example.com" }),
      }),
    );

    const events = await parseNdjsonEvents(response);
    const completion = events.at(-1);

    expect(completion?.result).toMatchObject({
      signals: {
        whois: {
          status: "success",
          data: {
            available: false,
          },
        },
      },
      metadata: {
        partialFailure: false,
      },
    });
  });

  it("caches partial-failure results briefly instead of re-running everything", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers({ virusTotalStatus: 503 });

    const requestBody = JSON.stringify({ url: "partial.example" });
    const firstResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: requestBody,
      }),
    );
    // Drain the first scan fully so its cache write lands before the retry.
    const firstEvents = await parseNdjsonEvents(firstResponse);

    const secondResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: requestBody,
      }),
    );
    const secondEvents = await parseNdjsonEvents(secondResponse);
    const firstCompletion = firstEvents.at(-1);
    const secondCompletion = secondEvents.at(-1);

    expect(firstCompletion?.result).toMatchObject({
      metadata: {
        cacheHit: false,
        partialFailure: true,
      },
    });
    // Degraded results are cached with a short TTL so a provider hiccup does
    // not force every retry to re-run all eight signals.
    expect(secondCompletion?.result).toMatchObject({
      metadata: {
        cacheHit: true,
        partialFailure: true,
      },
    });
    expect(
      secondEvents.filter((event) => event.type === "signal_result"),
    ).toHaveLength(8);
  });

  it("replays signal_result events and sets cached on cache hits", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers();

    const requestBody = JSON.stringify({ url: "cache-hit.example" });
    const firstResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: requestBody,
      }),
    );
    const firstEvents = await parseNdjsonEvents(firstResponse);
    const secondResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: requestBody,
      }),
    );
    const secondEvents = await parseNdjsonEvents(secondResponse);

    expect(firstEvents[0]).toMatchObject({
      type: "scan_started",
      cached: false,
    });
    expect(firstEvents.at(-1)?.result).toMatchObject({
      metadata: {
        cacheHit: false,
      },
    });

    expect(secondEvents[0]).toMatchObject({
      type: "scan_started",
      cached: true,
    });
    expect(
      secondEvents.filter((event) => event.type === "signal_result"),
    ).toHaveLength(8);
    expect(secondEvents.at(-1)).toMatchObject({
      type: "scan_complete",
      result: {
        metadata: {
          cacheHit: true,
        },
      },
    });
  });

  it("streams batch analysis events", async () => {
    const { POST } = await import("@/app/api/analyze/batch/route");
    installHandlers();

    const response = await POST(
      new Request("http://localhost/api/analyze/batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ urls: ["example.com", "https://example.org"] }),
      }),
    );

    const events = await parseNdjsonEvents(response);

    expect(events[0]?.type).toBe("batch_started");
    expect(events.filter((event) => event.type === "url_started")).toHaveLength(
      2,
    );
    expect(
      events.filter((event) => event.type === "url_complete"),
    ).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("batch_complete");
  });

  it("keeps the batch stream alive when one URL fails internally", async () => {
    vi.resetModules();
    vi.doMock("@/lib/server/analyze", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@/lib/server/analyze")>();
      type RunAnalysis = typeof actual.runAnalysis;

      return {
        ...actual,
        runAnalysis: vi.fn<RunAnalysis>(async (target, options) => {
          if (target.normalizedUrl.includes("bad.example")) {
            throw new Error("Synthetic batch failure.");
          }

          return actual.runAnalysis(target, options);
        }),
      };
    });

    const { POST } = await import("@/app/api/analyze/batch/route");
    installHandlers();

    const response = await POST(
      new Request("http://localhost/api/analyze/batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          urls: ["example.com", "https://bad.example/test"],
        }),
      }),
    );

    const events = await parseNdjsonEvents(response);

    expect(
      events.filter((event) => event.type === "url_complete"),
    ).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("batch_complete");
    expect(
      events.find(
        (event) =>
          event.type === "url_complete" && event.url?.includes("bad.example"),
      )?.result,
    ).toMatchObject({
      verdict: "error",
      metadata: {
        partialFailure: true,
      },
    });

    vi.doUnmock("@/lib/server/analyze");
    vi.resetModules();
  });
});

async function parseNdjsonEvents(response: Response) {
  const text = await response.text();
  const events =
    text.trim().length === 0
      ? []
      : text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map(
            (line) =>
              JSON.parse(line) as {
                type: string;
                cached?: boolean;
                url?: string;
                result?: {
                  verdict?: string;
                  metadata?: { cacheHit?: boolean; partialFailure?: boolean };
                };
              },
          );

  // Keepalive frames are timing-dependent chatter; assertions target the
  // semantic event stream.
  return events.filter((event) => event.type !== "keepalive");
}

function installHandlers(
  options: { rdapStatus?: number; virusTotalStatus?: number } = {},
) {
  server.use(
    http.get("https://www.virustotal.com/api/v3/urls/:id", () =>
      options.virusTotalStatus
        ? new HttpResponse(null, { status: options.virusTotalStatus })
        : HttpResponse.json({
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
    http.get(
      "https://openphish.com/feed.txt",
      () => new HttpResponse("", { status: 200 }),
    ),
    http.get("https://rdap.org/domain/:hostname", () =>
      options.rdapStatus
        ? new HttpResponse(null, { status: options.rdapStatus })
        : HttpResponse.json({
            handle: "EXAMPLE-1",
            country: "US",
            entities: [
              {
                roles: ["registrar"],
                vcardArray: [
                  "vcard",
                  [["fn", {}, "text", "Example Registrar"]],
                ],
              },
            ],
            events: [
              {
                eventAction: "registration",
                eventDate: "2010-01-01T00:00:00.000Z",
              },
              {
                eventAction: "expiration",
                eventDate: "2030-01-01T00:00:00.000Z",
              },
            ],
          }),
    ),
  );
}
