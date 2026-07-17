import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/tests/setup/msw.server";

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
  vi.stubEnv("HUGGINGFACE_API_KEY", "hf-key");
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

    const text = await response.text();
    const events = text
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            name?: string;
            result?: { verdict?: string };
          },
      );

    expect(events[0]?.type).toBe("scan_started");
    expect(
      events.filter((event) => event.type === "signal_result"),
    ).toHaveLength(8);
    expect(events.at(-1)?.type).toBe("scan_complete");
  });

  it("degrades RDAP outages into whois caveats instead of hard signal errors", async () => {
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

    const text = await response.text();
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; result?: unknown });
    const completion = events.at(-1);

    expect(completion?.type).toBe("scan_complete");
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

  it("does not cache partial-failure scan results", async () => {
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
    const secondResponse = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: requestBody,
      }),
    );

    const firstEvents = await parseNdjsonEvents(firstResponse);
    const secondEvents = await parseNdjsonEvents(secondResponse);
    const firstCompletion = firstEvents.at(-1);
    const secondCompletion = secondEvents.at(-1);

    expect(firstCompletion?.result).toMatchObject({
      metadata: {
        cacheHit: false,
        partialFailure: true,
      },
    });
    expect(secondCompletion?.result).toMatchObject({
      metadata: {
        cacheHit: false,
        partialFailure: true,
      },
    });
    expect(
      secondEvents.filter((event) => event.type === "signal_result"),
    ).toHaveLength(8);
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

    const text = await response.text();
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });

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
      const { createApiError } = await import("@/lib/server/api-error");

      return {
        ...actual,
        runAnalysis: vi.fn(async (input: string, options = {}) => {
          if (input.includes("bad.example")) {
            return {
              ok: false as const,
              status: 502,
              error: createApiError(
                "provider_failed",
                "Synthetic batch failure.",
                true,
              ),
            };
          }

          return actual.runAnalysis(input, options);
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

    const text = await response.text();
    const events = text
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            url?: string;
            result?: {
              verdict?: string;
              metadata?: { partialFailure?: boolean };
            };
          },
      );

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
  return text.trim().length === 0
    ? []
    : text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              type: string;
              result?: {
                metadata?: { cacheHit?: boolean; partialFailure?: boolean };
              };
            },
        );
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
    http.get(
      "https://openphish.com/feed.txt",
      () => new HttpResponse("", { status: 200 }),
    ),
    http.post(
      "https://router.huggingface.co/hf-inference/models/:owner/:model",
      () => HttpResponse.json([[{ label: "benign", score: 0.12 }]]),
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
