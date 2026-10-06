import { beforeEach, describe, expect, it, vi } from "vitest";

const resolve4Mock = vi.hoisted(() =>
  vi.fn<(name: string) => Promise<string[]>>(),
);

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolve4 = resolve4Mock;
  },
}));

import { resetEnvForTests } from "@/lib/config/env";
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
  vi.unstubAllEnvs();
  resetEnvForTests();
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

    expect(outcome.warnings).toContainEqual(
      expect.stringContaining(
        "spamhaus-dbl lookups are unavailable from this runtime's DNS resolver",
      ),
    );
    // The failing zone must not produce a clean answer.
    expect(outcome.observations).toEqual([]);
    expect(outcome.matches).toEqual([]);

    // A second query reuses the cached health verdict without re-testing.
    const callsAfterFirst = resolve4Mock.mock.calls.length;
    await queryDnsbls("another.example");
    const spamhausCalls = resolve4Mock.mock.calls
      .slice(callsAfterFirst)
      .filter(([name]) => String(name).endsWith("dbl.spamhaus.org"));
    expect(spamhausCalls).toHaveLength(0);
  });

  describe("with a Spamhaus DQS key", () => {
    const KEY = "abcdefghijklmnopqrstuvwxyz";
    const DQS = `${KEY}.dbl.dq.spamhaus.net`;

    function useKey(key = KEY) {
      vi.stubEnv("SPAMHAUS_DQS_KEY", key);
      resetEnvForTests();
    }

    function routeDqs(dblAnswers: Record<string, string[]>) {
      resolve4Mock.mockImplementation((name: string) => {
        if (name === "test.surbl.org.multi.surbl.org") {
          return Promise.resolve(["127.0.0.126"]);
        }
        const answer = dblAnswers[name];
        return answer ? Promise.resolve(answer) : nxdomain();
      });
    }

    it("queries the DQS zone instead of the public mirror", async () => {
      useKey();
      routeDqs({
        [`dbltest.com.${DQS}`]: ["127.0.1.2"],
        [`phish.example.${DQS}`]: ["127.0.1.4"],
      });

      const outcome = await queryDnsbls("phish.example");

      expect(outcome.warnings).toEqual([]);
      expect(outcome.matches).toContainEqual(
        expect.objectContaining({ feed: "spamhaus-dbl", confidence: "high" }),
      );
      const names = resolve4Mock.mock.calls.map(([name]) => String(name));
      expect(names.some((name) => name.endsWith("dbl.spamhaus.org"))).toBe(
        false,
      );
    });

    it("reports a disabled key as unavailable without echoing the key", async () => {
      useKey();
      routeDqs({ [`dbltest.com.${DQS}`]: ["127.255.255.250"] });

      const outcome = await queryDnsbls("any.example");

      expect(outcome.matches).toEqual([]);
      expect(outcome.warnings).toContain(
        "spamhaus-dbl lookups are unavailable: the list did not accept this deployment's access key.",
      );
      expect(JSON.stringify(outcome)).not.toContain(KEY);
    });

    it("never reads an error-range answer as a listing", async () => {
      useKey();
      routeDqs({
        [`dbltest.com.${DQS}`]: ["127.0.1.2"],
        [`any.example.${DQS}`]: ["127.255.255.251"],
      });

      const outcome = await queryDnsbls("any.example");

      expect(outcome.matches).toEqual([]);
      expect(outcome.warnings).toContainEqual(
        expect.stringContaining("did not accept this deployment's access key"),
      );
    });

    it("never leaks the key from a DNS error message", async () => {
      useKey();
      resolve4Mock.mockImplementation((name: string) => {
        if (name === "test.surbl.org.multi.surbl.org") {
          return Promise.resolve(["127.0.0.126"]);
        }
        if (name === `dbltest.com.${DQS}`) {
          return Promise.resolve(["127.0.1.2"]);
        }
        const error = new Error(`queryA ETIMEOUT ${name}`) as Error & {
          code: string;
        };
        error.code = "ETIMEOUT";
        return Promise.reject(error);
      });

      const outcome = await queryDnsbls("any.example");

      expect(outcome.warnings).toContain(
        "spamhaus-dbl lookup failed: the lookup failed (ETIMEOUT).",
      );
      expect(JSON.stringify(outcome)).not.toContain(KEY);
    });

    it("treats resolver-block sentinels on the DQS zone as unavailable", async () => {
      useKey();
      routeDqs({
        [`dbltest.com.${DQS}`]: ["127.0.1.2"],
        [`any.example.${DQS}`]: ["127.255.255.254"],
      });

      const outcome = await queryDnsbls("any.example");

      expect(outcome.matches).toEqual([]);
      expect(outcome.warnings).toContainEqual(
        expect.stringContaining("spamhaus-dbl lookup failed"),
      );
    });

    it("trims the key and accepts up to the 63-character label limit", async () => {
      const longKey = "a".repeat(63);
      useKey(`  ${longKey}\n`);
      routeLookups({});

      await queryDnsbls("any.example");

      const names = resolve4Mock.mock.calls.map(([name]) => String(name));
      expect(names).toContain(`dbltest.com.${longKey}.dbl.dq.spamhaus.net`);

      resolve4Mock.mockClear();
      resetDnsblStateForTests();
      useKey("a".repeat(64));
      await queryDnsbls("any.example");
      const fallback = resolve4Mock.mock.calls.map(([name]) => String(name));
      expect(fallback).toContain("dbltest.com.dbl.spamhaus.org");
    });

    it("ignores a key that is not a single alphanumeric label", async () => {
      useKey("abc.evil.example");
      routeLookups({});

      await queryDnsbls("any.example");

      const names = resolve4Mock.mock.calls.map(([name]) => String(name));
      expect(names).toContain("dbltest.com.dbl.spamhaus.org");
      expect(names.some((name) => name.includes("evil"))).toBe(false);
    });
  });

  it("retries a transiently failed self-test after a minute, not six hours", async () => {
    vi.useFakeTimers();
    try {
      let spamhausUp = false;
      resolve4Mock.mockImplementation((name: string) => {
        if (name === "test.surbl.org.multi.surbl.org") {
          return Promise.resolve(["127.0.0.126"]);
        }
        if (name === "dbltest.com.dbl.spamhaus.org" && spamhausUp) {
          return Promise.resolve(["127.0.1.2"]);
        }
        if (name === "dbltest.com.dbl.spamhaus.org") {
          const error = new Error("timeout") as Error & { code: string };
          error.code = "ETIMEOUT";
          return Promise.reject(error);
        }
        return nxdomain();
      });

      const first = await queryDnsbls("any.example");
      expect(first.warnings).toHaveLength(1);

      spamhausUp = true;
      vi.advanceTimersByTime(61_000);
      const second = await queryDnsbls("any.example");
      expect(second.warnings).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips IP literals outright", async () => {
    const outcome = await queryDnsbls("192.0.2.1");

    expect(outcome).toEqual({ matches: [], warnings: [], observations: [] });
    expect(resolve4Mock).not.toHaveBeenCalled();
  });
});
