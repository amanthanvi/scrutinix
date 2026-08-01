import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvForTests } from "@/lib/config/env";

vi.mock("@/lib/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/http")>();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

import { runVirusTotalProvider } from "@/lib/server/providers/virustotal";

function completedAnalysisJson() {
  return {
    data: {
      attributes: {
        status: "completed",
        stats: {
          malicious: 0,
          suspicious: 0,
          harmless: 2,
          undetected: 0,
          timeout: 0,
        },
        results: {},
      },
    },
  };
}

describe("runVirusTotalProvider", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VIRUSTOTAL_API_KEY", "vt-test-key");
    resetEnvForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries analysis polling after HTTP 429 using Retry-After", async () => {
    const target = "https://malware.example/payload";
    const urlId = Buffer.from(target).toString("base64url");
    let analysisCalls = 0;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const u = typeof input === "string" ? input : input.toString();

        if (u.includes(`/urls/${urlId}`) && !u.includes("/analyses")) {
          return new Response(null, { status: 404 });
        }

        if (u === "https://www.virustotal.com/api/v3/urls") {
          return Response.json({
            data: { id: "analysis-abc", type: "analysis" },
          });
        }

        if (u.includes("/analyses/analysis-abc")) {
          analysisCalls += 1;
          if (analysisCalls === 1) {
            return new Response(null, {
              status: 429,
              headers: { "retry-after": "0" },
            });
          }
          return Response.json(completedAnalysisJson());
        }

        return new Response("unexpected", { status: 500 });
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await runVirusTotalProvider(target);

    expect(result.malicious).toBe(0);
    expect(analysisCalls).toBe(2);
  });

  it("polls until analysis completes within the expanded attempt budget", async () => {
    const target = "https://slow.example/x";
    const urlId = Buffer.from(target).toString("base64url");
    let analysisCalls = 0;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const u = typeof input === "string" ? input : input.toString();

        if (u.includes(`/urls/${urlId}`) && !u.includes("/analyses")) {
          return new Response(null, { status: 404 });
        }

        if (u === "https://www.virustotal.com/api/v3/urls") {
          return Response.json({
            data: { id: "analysis-slow", type: "analysis" },
          });
        }

        if (u.includes("/analyses/analysis-slow")) {
          analysisCalls += 1;
          if (analysisCalls < 7) {
            return Response.json({
              data: {
                attributes: {
                  status: "queued",
                  stats: {},
                  results: {},
                },
              },
            });
          }
          return Response.json(completedAnalysisJson());
        }

        return new Response("unexpected", { status: 500 });
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await runVirusTotalProvider(target);

    expect(result.malicious).toBe(0);
    expect(analysisCalls).toBe(7);
  });

  it("fails when analysis never completes within poll attempts", async () => {
    const target = "https://stuck.example/y";
    const urlId = Buffer.from(target).toString("base64url");

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const u = typeof input === "string" ? input : input.toString();

        if (u.includes(`/urls/${urlId}`) && !u.includes("/analyses")) {
          return new Response(null, { status: 404 });
        }

        if (u === "https://www.virustotal.com/api/v3/urls") {
          return Response.json({
            data: { id: "analysis-stuck", type: "analysis" },
          });
        }

        if (u.includes("/analyses/analysis-stuck")) {
          return Response.json({
            data: {
              attributes: {
                status: "queued",
                stats: {},
                results: {},
              },
            },
          });
        }

        return new Response("unexpected", { status: 500 });
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(runVirusTotalProvider(target)).rejects.toThrow(
      /VirusTotal analysis did not complete before the timeout budget/,
    );

    const analysisPolls = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes("/analyses/analysis-stuck"),
    );
    expect(analysisPolls).toHaveLength(8);
  });

  it("captures the analysis date and domain reputation on the report path", async () => {
    const target = "https://evil.example/path";
    const lastAnalysisUnix = 1_750_000_000;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/urls/")) {
        return Response.json({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 4,
                suspicious: 1,
                harmless: 60,
                undetected: 10,
                timeout: 0,
              },
              last_analysis_results: {},
              last_analysis_date: lastAnalysisUnix,
            },
          },
        });
      }

      if (url.includes("/domains/evil.example")) {
        return Response.json({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 6,
                suspicious: 0,
                harmless: 70,
              },
              reputation: -40,
              categories: {
                vendorA: "phishing",
                vendorB: "phishing",
                vendorC: "malware",
              },
            },
          },
        });
      }

      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runVirusTotalProvider(target);

    expect(result.lastAnalysisDate).toBe(
      new Date(lastAnalysisUnix * 1000).toISOString(),
    );
    expect(result.domain).toEqual({
      malicious: 6,
      suspicious: 0,
      harmless: 70,
      reputation: -40,
      categories: ["phishing", "malware"],
    });

    // A second scan of the same domain reuses the cached domain report.
    await runVirusTotalProvider(target);
    const domainCalls = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes("/domains/"),
    );
    expect(domainCalls).toHaveLength(1);
  });

  it("degrades domain enrichment to null when the endpoint errors", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/urls/")) {
        return Response.json({
          data: {
            attributes: {
              last_analysis_stats: { malicious: 0, harmless: 10 },
              last_analysis_results: {},
            },
          },
        });
      }
      return new Response("nope", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runVirusTotalProvider("https://fine.example/");

    expect(result.domain).toBeNull();
    expect(result.malicious).toBe(0);
  });
});
