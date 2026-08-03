import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { classifyUrlLocally } from "@/lib/server/ml/local-classifier";
import { runRedirectSignal } from "@/lib/server/signals/redirect-chain";
import { server } from "@/tests/setup/msw.server";

// DNSBL lookups ride raw DNS, which MSW cannot intercept; stub them out.
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

const classifierMock = vi.mocked(classifyUrlLocally);
const benignClassification = {
  label: "benign" as const,
  score: 0.99,
  reasons: ["The local URL model classified this link as benign."],
  model: "test-transformer",
};

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
  runRedirectSignal: vi.fn(),
}));

const redirectMock = vi.mocked(runRedirectSignal);
const cleanRedirectResult = {
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
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VIRUSTOTAL_API_KEY", "vt-key");
  vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "gsb-key");
  vi.stubEnv("URLHAUS_AUTH_KEY", "abuse-ch-key");
  classifierMock.mockReset().mockResolvedValue(benignClassification);
  redirectMock.mockReset().mockResolvedValue(cleanRedirectResult);
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

  it("rejects opaque browser origins", async () => {
    const { POST } = await import("@/app/api/analyze/route");

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "null",
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

  it("rejects a same-host origin with a different scheme", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers();

    const requestBody = JSON.stringify({ url: "example.com" });
    const mismatchedResponse = await POST(
      new Request("https://scrutinix.example/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "scrutinix.example",
          origin: "http://scrutinix.example",
        },
        body: requestBody,
      }),
    );

    if (mismatchedResponse.status === 200) {
      await parseNdjsonEvents(mismatchedResponse);
    }
    expect(mismatchedResponse.status).toBe(403);

    const matchingResponse = await POST(
      new Request("https://scrutinix.example/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "scrutinix.example",
          origin: "https://scrutinix.example",
        },
        body: requestBody,
      }),
    );

    expect(matchingResponse.status).toBe(200);
    await parseNdjsonEvents(matchingResponse);
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

  it("re-runs partial-failure results so recovered providers can contribute", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    const { virusTotalLookup } = installHandlers({
      virusTotalStatuses: [503, undefined],
    });

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
      signals: {
        virusTotal: {
          status: "error",
        },
      },
      metadata: {
        cacheHit: false,
        partialFailure: true,
      },
    });
    expect(secondEvents[0]).toMatchObject({
      type: "scan_started",
      cached: false,
    });
    expect(secondCompletion?.result).toMatchObject({
      signals: {
        virusTotal: {
          status: "success",
        },
      },
      metadata: {
        cacheHit: false,
        partialFailure: false,
      },
    });
    expect(virusTotalLookup).toHaveBeenCalledTimes(2);
    expect(
      secondEvents.filter((event) => event.type === "signal_result"),
    ).toHaveLength(8);
  });

  it("re-runs warning-degraded threat-feed results after a source recovers", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    const { urlhausLookup } = installHandlers({
      urlhausStatuses: [503, undefined],
    });

    const requestBody = JSON.stringify({ url: "feed-recovery.example" });
    const firstResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );
    const firstEvents = await parseNdjsonEvents(firstResponse);
    const secondResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );
    const secondEvents = await parseNdjsonEvents(secondResponse);

    expect(firstEvents.at(-1)?.result).toMatchObject({
      signals: {
        threatFeeds: {
          status: "success",
          data: { warnings: ["URLhaus lookup failed with status 503."] },
        },
      },
      metadata: { cacheHit: false, partialFailure: true },
    });
    expect(secondEvents[0]).toMatchObject({
      type: "scan_started",
      cached: false,
    });
    expect(secondEvents.at(-1)?.result).toMatchObject({
      signals: {
        threatFeeds: { status: "success", data: { warnings: [] } },
      },
      metadata: { cacheHit: false, partialFailure: false },
    });
    expect(urlhausLookup).toHaveBeenCalledTimes(2);
  });

  it("re-runs lexical-fallback results after the local classifier recovers", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers();
    classifierMock
      .mockRejectedValueOnce(new Error("Classifier unavailable."))
      .mockResolvedValue(benignClassification);

    const requestBody = JSON.stringify({ url: "classifier-recovery.example" });
    const firstResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );
    const firstEvents = await parseNdjsonEvents(firstResponse);
    const secondResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );
    const secondEvents = await parseNdjsonEvents(secondResponse);

    expect(firstEvents.at(-1)?.result).toMatchObject({
      signals: {
        mlEnsemble: {
          status: "success",
          data: {
            transformerModel: null,
            warnings: [
              "Classifier unavailable. Falling back to lexical heuristics only.",
            ],
          },
        },
      },
      metadata: { cacheHit: false, partialFailure: true },
    });
    expect(secondEvents[0]).toMatchObject({
      type: "scan_started",
      cached: false,
    });
    expect(secondEvents.at(-1)?.result).toMatchObject({
      signals: {
        mlEnsemble: {
          status: "success",
          data: { warnings: [] },
        },
      },
      metadata: { cacheHit: false, partialFailure: false },
    });
    expect(classifierMock).toHaveBeenCalledTimes(2);
  });

  it("re-runs incomplete redirect results after the chain recovers", async () => {
    const { POST } = await import("@/app/api/analyze/route");
    installHandlers();
    const terminalError =
      "The redirect probe stopped before the chain was fully followed (time budget exhausted).";
    redirectMock
      .mockResolvedValueOnce({
        ...cleanRedirectResult,
        finalUrl: "http://redirect-recovery.example/",
        reachable: false,
        terminalStatus: 302,
        terminalError,
        hops: [
          {
            url: "http://redirect-recovery.example/",
            status: 302,
            location: "https://landing.example/",
          },
        ],
        observations: [terminalError],
      })
      .mockResolvedValueOnce(cleanRedirectResult);

    const requestBody = JSON.stringify({ url: "redirect-recovery.example" });
    const firstResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );
    const firstEvents = await parseNdjsonEvents(firstResponse);
    const secondResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );
    const secondEvents = await parseNdjsonEvents(secondResponse);

    expect(firstEvents.at(-1)?.result).toMatchObject({
      signals: {
        redirectChain: {
          status: "success",
          data: { reachable: false, terminalError },
        },
      },
      metadata: { cacheHit: false, partialFailure: true },
    });
    expect(secondEvents[0]).toMatchObject({
      type: "scan_started",
      cached: false,
    });
    expect(secondEvents.at(-1)?.result).toMatchObject({
      signals: {
        redirectChain: {
          status: "success",
          data: { reachable: true, terminalError: null },
        },
      },
      metadata: { cacheHit: false, partialFailure: false },
    });
    expect(redirectMock).toHaveBeenCalledTimes(2);
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

  it("stops dispatching queued URLs after the client disconnects", async () => {
    vi.resetModules();
    const runAnalysis = vi.fn(
      async (
        _target: unknown,
        options: { signal: AbortSignal },
      ): Promise<never> => {
        await new Promise<never>((_resolve, reject) => {
          if (options.signal.aborted) {
            reject(options.signal.reason);
            return;
          }

          options.signal.addEventListener(
            "abort",
            () => reject(options.signal.reason),
            { once: true },
          );
        });

        throw new Error("unreachable");
      },
    );

    vi.doMock("@/lib/server/analyze", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@/lib/server/analyze")>();
      return { ...actual, runAnalysis };
    });

    const { POST } = await import("@/app/api/analyze/batch/route");
    const response = await POST(
      new Request("http://localhost/api/analyze/batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          urls: Array.from(
            { length: 10 },
            (_, index) => `https://batch-${index}.example`,
          ),
        }),
      }),
    );

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(runAnalysis).toHaveBeenCalledTimes(3);

    vi.doUnmock("@/lib/server/analyze");
    vi.resetModules();
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
  options: {
    rdapStatus?: number;
    urlhausStatuses?: readonly (number | undefined)[];
    virusTotalStatus?: number;
    virusTotalStatuses?: readonly (number | undefined)[];
  } = {},
) {
  let urlhausRequest = 0;
  const urlhausLookup = vi.fn(() => {
    const status = options.urlhausStatuses?.[urlhausRequest];
    urlhausRequest += 1;

    return status
      ? new HttpResponse(null, { status })
      : HttpResponse.json({ query_status: "no_results" });
  });
  let virusTotalRequest = 0;
  const virusTotalLookup = vi.fn(() => {
    const status =
      options.virusTotalStatuses?.[virusTotalRequest] ??
      options.virusTotalStatus;
    virusTotalRequest += 1;

    return status
      ? new HttpResponse(null, { status })
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
        });
  });

  server.use(
    http.get("https://www.virustotal.com/api/v3/urls/:id", virusTotalLookup),
    http.post("https://safebrowsing.googleapis.com/v4/threatMatches:find", () =>
      HttpResponse.json({ matches: [] }),
    ),
    http.post("https://urlhaus-api.abuse.ch/v1/url/", urlhausLookup),
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

  return { urlhausLookup, virusTotalLookup };
}
