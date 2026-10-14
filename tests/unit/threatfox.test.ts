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

  it("skips with a coverage warning when no auth key is configured", async () => {
    delete process.env.URLHAUS_AUTH_KEY;
    resetEnvForTests();

    const outcome = await checkThreatFox("https://example.com/");

    expect(outcome.match).toBeNull();
    expect(outcome.warning).toContain("no abuse.ch Auth-Key");
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

    const outcome = await checkThreatFox("https://evil.example/payload");

    expect(outcome.match).toEqual({
      feed: "threatfox",
      matchedUrl: "https://evil.example/payload",
      detail:
        "lists this link as an indicator of malware delivery (AgentTesla)",
      confidence: "high",
      matchType: "url",
    });
  });

  it("lets a URL listed elsewhere on a shared host corroborate, never convict", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          query_status: "ok",
          data: [
            {
              ioc: "https://github.com/someone/tool/releases/download/v1/x.exe",
              threat_type: "payload_delivery",
              malware_printable: "Unknown Stealer",
              confidence_level: 100,
            },
          ],
        }),
      ),
    );

    const other = await checkThreatFox("https://github.com/vercel/next.js");
    expect(other.match).toEqual({
      feed: "threatfox",
      matchedUrl: "github.com",
      detail:
        "lists another link on this host as an indicator of malware delivery (Unknown Stealer)",
      confidence: "medium",
      matchType: "host",
      listedElsewhereOnHost: true,
    });

    const listed = await checkThreatFox(
      "http://github.com/someone/tool/releases/download/v1/x.exe",
    );
    expect(listed.match).toMatchObject({
      matchType: "url",
      confidence: "high",
    });
  });

  it("keeps C2 URL IOCs visible when a dedicated host's root is scanned", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          query_status: "ok",
          data: [
            {
              ioc: "http://1.2.3.4:8080/gate.php",
              threat_type: "botnet_cc",
              confidence_level: 50,
            },
            {
              ioc: "http://1.2.3.4:8080/panel/",
              threat_type: "botnet_cc",
              confidence_level: 100,
            },
          ],
        }),
      ),
    );

    const root = await checkThreatFox("http://1.2.3.4:8080/");
    expect(root.match).toMatchObject({
      matchType: "host",
      confidence: "medium",
    });

    const panel = await checkThreatFox("https://1.2.3.4:8080/panel");
    expect(panel.match).toMatchObject({ matchType: "url", confidence: "high" });
  });

  it("prefers the most confident host IOC and normalizes trailing dots", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          search_term: "evil.example",
        });
        return Response.json({
          query_status: "ok",
          data: [
            {
              ioc: "evil.example",
              threat_type: "botnet_cc",
              confidence_level: 50,
            },
            {
              ioc: "evil.example.",
              threat_type: "botnet_cc",
              confidence_level: 100,
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await checkThreatFox("https://EVIL.example./x");
    expect(outcome.match).toMatchObject({
      matchedUrl: "evil.example",
      matchType: "host",
      confidence: "high",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not let a weak exact-URL IOC mask a strong host IOC", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          query_status: "ok",
          data: [
            {
              ioc: "http://evil.example/kit",
              threat_type: "payload_delivery",
              confidence_level: 50,
            },
            {
              ioc: "evil.example",
              threat_type: "botnet_cc",
              confidence_level: 100,
            },
          ],
        }),
      ),
    );

    const outcome = await checkThreatFox("https://evil.example/kit");
    expect(outcome.match).toMatchObject({
      matchType: "host",
      confidence: "high",
    });
  });

  it("treats domain and host-root IOCs as host-level indicators", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    for (const ioc of [
      "evil.example",
      "evil.example:443",
      "http://evil.example/",
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            query_status: "ok",
            data: [{ ioc, threat_type: "botnet_cc", confidence_level: 90 }],
          }),
        ),
      );

      const outcome = await checkThreatFox("https://evil.example/any/path");
      expect(outcome.match, ioc).toMatchObject({
        matchedUrl: "evil.example",
        matchType: "host",
      });
    }
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

    const outcome = await checkThreatFox("https://evil.example/");
    expect(outcome.match).toBeNull();
  });

  it("does not promote a subdomain IOC to its parent host", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    const responses = [
      "http://notexample.com/payload",
      "http://example.com.evil.test/payload",
      "http://unrelated.test/?next=example.com",
      "https://sub.example.com/payload",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          query_status: "ok",
          data: responses.map((ioc) => ({
            ioc,
            threat_type: "payload_delivery",
            confidence_level: 80,
          })),
        }),
      ),
    );

    const outcome = await checkThreatFox("https://example.com/payload");

    expect(outcome.match).toBeNull();
  });

  it("throws on server errors so the caller can count the failure", async () => {
    vi.stubEnv("URLHAUS_AUTH_KEY", "abusech-key");
    resetEnvForTests();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 })),
    );

    await expect(checkThreatFox("https://evil.example/")).rejects.toThrow(
      "ThreatFox lookup failed with status 502.",
    );
  });
});
