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

  it("says plainly when VirusTotal refuses the address", async () => {
    const target = "https://scrutinix-check.invalid/";
    const urlId = Buffer.from(target).toString("base64url");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
        const u = typeof input === "string" ? input : input.toString();
        return u.includes(`/urls/${urlId}`)
          ? new Response(null, { status: 404 })
          : new Response(null, { status: 400 });
      }),
    );

    await expect(runVirusTotalProvider(target)).rejects.toThrow(
      "VirusTotal doesn't accept this address for analysis.",
    );
  });

  it("drops engines that found nothing from a fresh analysis, as from a report", async () => {
    const target = "https://fresh.example/z";
    const urlId = Buffer.from(target).toString("base64url");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
        const u = typeof input === "string" ? input : input.toString();
        if (u.includes(`/urls/${urlId}`)) {
          return new Response(null, { status: 404 });
        }
        if (u === "https://www.virustotal.com/api/v3/urls") {
          return Response.json({ data: { id: "analysis-fresh" } });
        }
        if (u.includes("/analyses/analysis-fresh")) {
          const analysis = completedAnalysisJson();
          analysis.data.attributes.results = {
            Alpha: { category: "undetected", result: "unrated" },
            Bravo: { category: "malicious", result: "phishing" },
            Charlie: { category: "harmless", result: "clean" },
          } as never;
          return Response.json(analysis);
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const result = await runVirusTotalProvider(target);

    expect(result.results.map((entry) => entry.engine)).toEqual([
      "Bravo",
      "Charlie",
    ]);
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

  it("reads the URL report in one request, with no domain lookup", async () => {
    const target = "https://evil.example/path";
    const lastAnalysisUnix = 1_750_000_000;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
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
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runVirusTotalProvider(target);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/urls/");
    expect(result.malicious).toBe(4);
    expect(result.suspicious).toBe(1);
    expect(result.lastAnalysisDate).toBe(
      new Date(lastAnalysisUnix * 1000).toISOString(),
    );
  });
});
