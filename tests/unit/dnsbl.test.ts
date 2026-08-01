import { beforeEach, describe, expect, it, vi } from "vitest";

const resolve4Mock = vi.hoisted(() =>
  vi.fn<(name: string) => Promise<string[]>>(),
);

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolve4 = resolve4Mock;
  },
}));

import {
  queryDnsbls,
  resetDnsblStateForTests,
} from "@/lib/server/providers/dnsbl";

function nxdomain(): Promise<string[]> {
  const error = new Error("queryA ENOTFOUND") as Error & { code: string };
  error.code = "ENOTFOUND";
  return Promise.reject(error);
}

/** Route lookups by suffix: healthy self-tests plus per-name answers. */
function routeLookups(
  answers: Record<string, string[] | "nxdomain" | "servfail">,
) {
  resolve4Mock.mockImplementation((name: string) => {
    if (name === "dbltest.com.dbl.spamhaus.org") {
      return Promise.resolve(["127.0.1.2"]);
    }
    if (name === "test.surbl.org.multi.surbl.org") {
      return Promise.resolve(["127.0.0.126"]);
    }

    const answer = answers[name];
    if (answer === "servfail") {
      const error = new Error("queryA ESERVFAIL") as Error & { code: string };
      error.code = "ESERVFAIL";
      return Promise.reject(error);
    }
    if (!answer || answer === "nxdomain") {
      return nxdomain();
    }
    return Promise.resolve(answer);
  });
}

beforeEach(() => {
  resolve4Mock.mockReset();
  resetDnsblStateForTests();
});

describe("queryDnsbls", () => {
  it("maps Spamhaus DBL phishing listings to high-confidence matches", async () => {
    routeLookups({ "phish.example.dbl.spamhaus.org": ["127.0.1.4"] });

    const outcome = await queryDnsbls("phish.example");

    expect(outcome.matches).toContainEqual({
      feed: "spamhaus-dbl",
      matchedUrl: "phish.example",
      detail: "listed as a phishing domain by Spamhaus DBL",
      confidence: "high",
      matchType: "host",
    });
    expect(outcome.warnings).toEqual([]);
  });

  it("decodes the SURBL bitmask", async () => {
    routeLookups({ "phish.example.multi.surbl.org": ["127.0.0.8"] });

    const outcome = await queryDnsbls("phish.example");

    expect(outcome.matches).toContainEqual(
      expect.objectContaining({
        feed: "surbl",
        detail: "listed as phishing by SURBL",
        confidence: "high",
      }),
    );
  });

  it("treats NXDOMAIN as clean", async () => {
    routeLookups({});

    const outcome = await queryDnsbls("clean.example");

    expect(outcome.matches).toEqual([]);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.observations).toEqual([]);
  });

  it("treats Spamhaus resolver-error sentinels as unavailable, never clean", async () => {
    routeLookups({
      "any.example.dbl.spamhaus.org": ["127.255.255.254"],
      "any.example.multi.surbl.org": "nxdomain",
    });

    const outcome = await queryDnsbls("any.example");

    expect(outcome.matches).toEqual([]);
    expect(outcome.warnings).toContainEqual(
      expect.stringContaining("spamhaus-dbl lookup failed"),
    );
  });

  it("ignores answers outside 127/8 (wildcarding resolvers)", async () => {
    routeLookups({
      "any.example.dbl.spamhaus.org": ["198.51.100.99"],
      "any.example.multi.surbl.org": "nxdomain",
    });

    const outcome = await queryDnsbls("any.example");

    expect(outcome.matches).toEqual([]);
    expect(outcome.warnings).toContainEqual(
      expect.stringContaining("wildcarding"),
    );
  });

  it("disables a zone whose self-test fails and says so once", async () => {
    resolve4Mock.mockImplementation((name: string) => {
      if (name.endsWith("multi.surbl.org")) {
        if (name === "test.surbl.org.multi.surbl.org") {
          return Promise.resolve(["127.0.0.126"]);
        }
        return nxdomain();
      }
      // Every Spamhaus query fails, including the self-test.
      const error = new Error("timeout") as Error & { code: string };
      error.code = "ETIMEOUT";
      return Promise.reject(error);
    });

    const outcome = await queryDnsbls("whatever.example");

    expect(outcome.observations).toContainEqual(
      expect.stringContaining(
        "spamhaus-dbl lookups are unavailable from this runtime's DNS resolver",
      ),
    );
    // The failing zone must not produce a lookup warning or a clean answer.
    expect(outcome.warnings).toEqual([]);
    expect(outcome.matches).toEqual([]);

    // A second query reuses the cached health verdict without re-testing.
    const callsAfterFirst = resolve4Mock.mock.calls.length;
    await queryDnsbls("another.example");
    const spamhausCalls = resolve4Mock.mock.calls
      .slice(callsAfterFirst)
      .filter(([name]) => String(name).endsWith("dbl.spamhaus.org"));
    expect(spamhausCalls).toHaveLength(0);
  });

  it("skips IP literals outright", async () => {
    const outcome = await queryDnsbls("192.0.2.1");

    expect(outcome).toEqual({ matches: [], warnings: [], observations: [] });
    expect(resolve4Mock).not.toHaveBeenCalled();
  });
});
