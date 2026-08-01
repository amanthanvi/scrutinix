import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvForTests } from "@/lib/config/env";
import { checkThreatFox } from "@/lib/server/providers/threatfox";

describe("checkThreatFox", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    resetEnvForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips with an observation when no auth key is configured", async () => {
    delete process.env.URLHAUS_AUTH_KEY;
    resetEnvForTests();

    const outcome = await checkThreatFox("example.com");

    expect(outcome.match).toBeNull();
    expect(outcome.observation).toContain("no abuse.ch Auth-Key");
  });

  it("maps high-confidence IOCs to high-confidence matches", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("Auth-Key")).toBe("abusech-key");
        expect(JSON.parse(String(init?.body))).toEqual({
          query: "search_ioc",
          search_term: "evil.example",
        });
        return Response.json({
          query_status: "ok",
          data: [
            {
              ioc: "http://evil.example/payload",
              threat_type: "payload_delivery",
              malware_printable: "AgentTesla",
              confidence_level: 100,
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await checkThreatFox("evil.example");

    expect(outcome.match).toEqual({
      feed: "threatfox",
      matchedUrl: "evil.example",
      detail: "payload_delivery indicator for AgentTesla in ThreatFox",
      confidence: "high",
      matchType: "host",
    });
  });

  it("returns no match for empty results and unrelated IOCs", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          query_status: "ok",
          data: [{ ioc: "http://unrelated.example/", threat_type: "x" }],
        }),
      ),
    );

    const outcome = await checkThreatFox("evil.example");
    expect(outcome.match).toBeNull();
  });

  it("throws on server errors so the caller can count the failure", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 })),
    );

    await expect(checkThreatFox("evil.example")).rejects.toThrow(
      "ThreatFox lookup failed with status 502.",
    );
  });
});
