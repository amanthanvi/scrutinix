import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvForTests } from "@/lib/config/env";
import { runGoogleSafeBrowsingProvider } from "@/lib/server/providers/google-safe-browsing";

describe("runGoogleSafeBrowsingProvider", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    resetEnvForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when the API key is not configured", async () => {
    delete process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    resetEnvForTests();

    await expect(
      runGoogleSafeBrowsingProvider("https://example.com/"),
    ).rejects.toThrow("Google Safe Browsing API key is not configured.");
  });

  it("parses threat matches from a successful response", async () => {
    vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "gsb-test-key");
    resetEnvForTests();

    const fetchMock = vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const u = typeof input === "string" ? input : input.toString();
        expect(u.includes("threatMatches:find")).toBe(true);
        // The key must travel in a header, never the query string, so it
        // stays out of proxy/CDN access logs.
        expect(u.includes("key=")).toBe(false);
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(
          "gsb-test-key",
        );
        return Response.json({
          matches: [
            {
              threatType: "MALWARE",
              platformType: "ANY_PLATFORM",
              threatEntryType: "URL",
            },
            {
              threatType: "SOCIAL_ENGINEERING",
              platformType: "WINDOWS",
              threatEntryType: "URL",
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runGoogleSafeBrowsingProvider(
      "https://malware.example/payload",
    );

    expect(result.matches).toEqual([
      {
        threatType: "MALWARE",
        platformType: "ANY_PLATFORM",
        threatEntryType: "URL",
      },
      {
        threatType: "SOCIAL_ENGINEERING",
        platformType: "WINDOWS",
        threatEntryType: "URL",
      },
    ]);
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns an empty matches list when the payload has no matches", async () => {
    vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "gsb-test-key");
    resetEnvForTests();

    const fetchMock = vi.fn(async (): Promise<Response> => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runGoogleSafeBrowsingProvider(
      "https://clean.example/",
    );

    expect(result.matches).toEqual([]);
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("throws when the lookup returns a non-OK status", async () => {
    vi.stubEnv("GOOGLE_SAFE_BROWSING_API_KEY", "gsb-test-key");
    resetEnvForTests();

    const fetchMock = vi.fn(
      async (): Promise<Response> => new Response("forbidden", { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runGoogleSafeBrowsingProvider("https://example.com/"),
    ).rejects.toThrow("Google Safe Browsing lookup failed with status 403.");
  });
});
