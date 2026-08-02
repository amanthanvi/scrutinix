import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryDnsbls } from "@/lib/server/providers/dnsbl";
import {
  runThreatFeedsProvider,
  URLHAUS_NO_LISTING_OBSERVATION,
} from "@/lib/server/providers/threat-feeds";
import { server } from "@/tests/setup/msw.server";

// DNSBL lookups ride raw DNS, which MSW cannot intercept; stub them out.
vi.mock("@/lib/server/providers/dnsbl", () => ({
  queryDnsbls: vi.fn(async () => ({
    matches: [],
    warnings: [],
    observations: [],
  })),
}));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("URLHAUS_AUTH_KEY", "urlhaus-key");
  vi.mocked(queryDnsbls).mockResolvedValue({
    matches: [],
    warnings: [],
    observations: [],
  });
});

function stubThreatFox() {
  server.use(
    http.post("https://threatfox-api.abuse.ch/api/v1/", () =>
      HttpResponse.json({ query_status: "no_result" }),
    ),
  );
}

describe("threat feed provider", () => {
  it("uses the documented URLhaus header and the OpenPhish community feed", async () => {
    let urlhausHeader: string | null = null;

    server.use(
      http.post("https://urlhaus-api.abuse.ch/v1/url/", ({ request }) => {
        urlhausHeader = request.headers.get("Auth-Key");
        return HttpResponse.json({ query_status: "no_results" });
      }),
      http.post("https://urlhaus-api.abuse.ch/v1/host/", () =>
        HttpResponse.json({ query_status: "no_results" }),
      ),
      http.get(
        "https://openphish.com/feed.txt",
        () =>
          new HttpResponse("https://example.com/\nhttps://login.example/\n", {
            status: 200,
          }),
      ),
    );
    stubThreatFox();

    const result = await runThreatFeedsProvider("https://example.com/");

    expect(urlhausHeader).toBe("urlhaus-key");
    expect(result.warnings).toEqual([]);
    expect(result.observations).toEqual([URLHAUS_NO_LISTING_OBSERVATION]);
    expect(result.matches).toEqual([
      {
        feed: "openphish",
        matchedUrl: "https://example.com",
        detail: "listed in the OpenPhish community feed",
        confidence: "high",
        matchType: "url",
      },
    ]);
  });

  it("falls back to URLhaus host-level listings when the exact URL is unknown", async () => {
    server.use(
      http.post("https://urlhaus-api.abuse.ch/v1/url/", () =>
        HttpResponse.json({ query_status: "no_results" }),
      ),
      http.post("https://urlhaus-api.abuse.ch/v1/host/", () =>
        HttpResponse.json({ query_status: "ok", url_count: 12 }),
      ),
      http.get(
        "https://openphish.com/feed.txt",
        () => new HttpResponse("", { status: 200 }),
      ),
    );
    stubThreatFox();

    const result = await runThreatFeedsProvider("https://bad-host.example/x");

    expect(result.matches).toContainEqual({
      feed: "urlhaus",
      matchedUrl: "bad-host.example",
      detail: "host has 12 malware URL listings in URLhaus",
      confidence: "medium",
      matchType: "host",
    });
    // A host-level hit replaces the "no listing" note.
    expect(result.observations).toEqual([]);
  });

  it("surfaces ThreatFox IOC matches for the registrable domain", async () => {
    server.use(
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
      http.post("https://threatfox-api.abuse.ch/api/v1/", () =>
        HttpResponse.json({
          query_status: "ok",
          data: [
            {
              ioc: "evil.example",
              threat_type: "botnet_cc",
              malware_printable: "Cobalt Strike",
              confidence_level: 90,
            },
          ],
        }),
      ),
    );

    const result = await runThreatFeedsProvider("https://evil.example/path");

    expect(result.matches).toContainEqual({
      feed: "threatfox",
      matchedUrl: "evil.example",
      detail: "botnet_cc indicator for Cobalt Strike in ThreatFox",
      confidence: "high",
      matchType: "host",
    });
  });

  it("does not promote a sibling ThreatFox IOC to the scanned host", async () => {
    let searchTerm: string | null = null;
    server.use(
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
      http.post(
        "https://threatfox-api.abuse.ch/api/v1/",
        async ({ request }) => {
          const body = (await request.json()) as { search_term?: string };
          searchTerm = body.search_term ?? null;
          return HttpResponse.json({
            query_status: "ok",
            data: [
              {
                ioc: "malware.example.com",
                threat_type: "payload_delivery",
                confidence_level: 100,
              },
            ],
          });
        },
      ),
    );

    const result = await runThreatFeedsProvider("https://www.example.com/");

    expect(searchTerm).toBe("www.example.com");
    expect(result.matches.some((match) => match.feed === "threatfox")).toBe(
      false,
    );
  });

  it("marks ThreatFox coverage incomplete when no auth key is configured", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "");

    server.use(
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
    );

    const result = await runThreatFeedsProvider("https://example.com/");

    expect(result.warnings).toContain(
      "ThreatFox lookup skipped: no abuse.ch Auth-Key is configured.",
    );
  });

  it("merges DNSBL matches into the feed results", async () => {
    vi.mocked(queryDnsbls).mockResolvedValue({
      matches: [
        {
          feed: "spamhaus-dbl",
          matchedUrl: "evil.example",
          detail: "listed as a phishing domain by Spamhaus DBL",
          confidence: "high",
          matchType: "host",
        },
      ],
      warnings: [],
      observations: [],
    });

    server.use(
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
    );
    stubThreatFox();

    const result = await runThreatFeedsProvider("https://evil.example/");

    expect(result.matches).toContainEqual(
      expect.objectContaining({ feed: "spamhaus-dbl", confidence: "high" }),
    );
    expect(queryDnsbls).toHaveBeenCalledWith("evil.example");
  });

  it("propagates unavailable DNSBL coverage as a warning", async () => {
    vi.mocked(queryDnsbls).mockResolvedValue({
      matches: [],
      warnings: [
        "spamhaus-dbl lookups are unavailable from this runtime's DNS resolver.",
      ],
      observations: [],
    });

    server.use(
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
    );
    stubThreatFox();

    const result = await runThreatFeedsProvider("https://example.com/");

    expect(result.warnings).toContainEqual(
      expect.stringContaining("spamhaus-dbl lookups are unavailable"),
    );
  });

  it("fails the signal only when every feed source fails", async () => {
    vi.mocked(queryDnsbls).mockRejectedValue(new Error("resolver down"));

    server.use(
      http.post("https://urlhaus-api.abuse.ch/v1/url/", () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
      http.get(
        "https://openphish.com/feed.txt",
        () => new HttpResponse("", { status: 503 }),
      ),
      http.post(
        "https://threatfox-api.abuse.ch/api/v1/",
        () => new HttpResponse("", { status: 500 }),
      ),
    );

    await expect(
      runThreatFeedsProvider("https://example.com/"),
    ).rejects.toThrow("All threat-feed lookups failed.");
  });

  it("stays successful when only some feed sources fail", async () => {
    server.use(
      http.post("https://urlhaus-api.abuse.ch/v1/url/", () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
      http.get(
        "https://openphish.com/feed.txt",
        () => new HttpResponse("", { status: 200 }),
      ),
    );
    stubThreatFox();

    const result = await runThreatFeedsProvider("https://example.com/");

    expect(result.matches).toEqual([]);
    expect(result.warnings).toContain("URLhaus lookup failed with status 401.");
  });
});
