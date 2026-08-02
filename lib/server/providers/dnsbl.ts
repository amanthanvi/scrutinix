import { Resolver } from "node:dns/promises";

import type { ThreatFeedsData } from "@/lib/domain/types";

type FeedMatch = ThreatFeedsData["matches"][number];

export interface DnsblOutcome {
  matches: FeedMatch[];
  warnings: string[];
  observations: string[];
}

interface DnsblZone {
  feed: "spamhaus-dbl" | "surbl";
  zone: string;
  /** Documented test record that must return a listing for the zone to be trusted. */
  testRecord: string;
  describe: (
    codes: string[],
  ) => { detail: string; confidence: "medium" | "high" } | null;
}

/**
 * Spamhaus returns these when queried through a blocked/over-limit public
 * resolver. They mean "no answer available", never "listed".
 */
const SPAMHAUS_ERROR_CODES = new Set([
  "127.255.255.252",
  "127.255.255.254",
  "127.255.255.255",
]);

const ZONES: DnsblZone[] = [
  {
    feed: "spamhaus-dbl",
    zone: "dbl.spamhaus.org",
    testRecord: "dbltest.com",
    describe: (codes) => {
      const known: Array<[string, string, "medium" | "high"]> = [
        ["127.0.1.2", "listed as a spam domain by Spamhaus DBL", "medium"],
        ["127.0.1.4", "listed as a phishing domain by Spamhaus DBL", "high"],
        ["127.0.1.5", "listed as a malware domain by Spamhaus DBL", "high"],
        ["127.0.1.6", "listed as a botnet C&C domain by Spamhaus DBL", "high"],
      ];
      for (const [code, detail, confidence] of known) {
        if (codes.includes(code)) {
          return { detail, confidence };
        }
      }
      // 127.0.1.102-106: abused-but-legitimate ranges.
      if (codes.some((code) => /^127\.0\.1\.1\d\d$/.test(code))) {
        return {
          detail: "listed by Spamhaus DBL as an abused legitimate domain",
          confidence: "medium",
        };
      }
      return null;
    },
  },
  {
    feed: "surbl",
    zone: "multi.surbl.org",
    testRecord: "test.surbl.org",
    describe: (codes) => {
      const bits = codes
        .filter((code) => code.startsWith("127.0.0."))
        .map((code) => Number(code.split(".")[3]))
        .filter((value) => Number.isFinite(value))
        .reduce((mask, value) => mask | value, 0);

      if (bits & 8) {
        return { detail: "listed as phishing by SURBL", confidence: "high" };
      }
      if (bits & 16) {
        return { detail: "listed as malware by SURBL", confidence: "high" };
      }
      if (bits & 128) {
        return { detail: "listed as cracked by SURBL", confidence: "high" };
      }
      if (bits & 64) {
        return { detail: "listed as abused by SURBL", confidence: "medium" };
      }
      return null;
    },
  },
];

const QUERY_TIMEOUT_MS = 2_000;
const HEALTH_RECHECK_MS = 1000 * 60 * 60 * 6;

interface ZoneHealth {
  checkedAt: number;
  healthy: boolean;
}

declare global {
  var __dnsblZoneHealth: Map<string, ZoneHealth> | undefined;
}

export function resetDnsblStateForTests() {
  globalThis.__dnsblZoneHealth = undefined;
}

function createResolver(): Resolver {
  return new Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 1 });
}

type LookupResult =
  | { status: "listed"; codes: string[] }
  | { status: "clean" }
  | { status: "unavailable"; reason: string };

async function lookupZone(
  resolver: Resolver,
  name: string,
  zone: string,
): Promise<LookupResult> {
  try {
    const codes = await resolver.resolve4(`${name}.${zone}`);
    if (codes.some((code) => SPAMHAUS_ERROR_CODES.has(code))) {
      return {
        status: "unavailable",
        reason: "the list rejects queries from this runtime's DNS resolver",
      };
    }
    // Any answer outside 127.0.0.0/8 means an interfering resolver
    // (e.g. NXDOMAIN-wildcarding ISP DNS); never treat it as a listing.
    if (!codes.every((code) => code.startsWith("127."))) {
      return {
        status: "unavailable",
        reason:
          "the resolver returned non-DNSBL answers (possible wildcarding)",
      };
    }
    return { status: "listed", codes };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { status: "clean" };
    }
    return {
      status: "unavailable",
      reason: `the lookup failed (${code || "network error"})`,
    };
  }
}

/**
 * Self-test gate: each zone must answer its documented test record before
 * clean answers are trusted. Serverless resolvers are frequently blocked by
 * Spamhaus/SURBL; without this gate every scan would read "clean" when the
 * list was actually unreachable.
 */
async function isZoneHealthy(
  resolver: Resolver,
  zone: DnsblZone,
): Promise<boolean> {
  const health = (globalThis.__dnsblZoneHealth ??= new Map());
  const cached = health.get(zone.zone);
  if (cached && Date.now() - cached.checkedAt < HEALTH_RECHECK_MS) {
    return cached.healthy;
  }

  const result = await lookupZone(resolver, zone.testRecord, zone.zone);
  const healthy = result.status === "listed";
  health.set(zone.zone, { checkedAt: Date.now(), healthy });
  return healthy;
}

/** Hostname-level DNSBL lookups (Spamhaus DBL + SURBL) over plain DNS. */
export async function queryDnsbls(
  registrableDomain: string,
): Promise<DnsblOutcome> {
  const outcome: DnsblOutcome = { matches: [], warnings: [], observations: [] };

  if (!registrableDomain || /^\d+\.\d+\.\d+\.\d+$/.test(registrableDomain)) {
    return outcome;
  }

  const resolver = createResolver();

  await Promise.all(
    ZONES.map(async (zone) => {
      if (!(await isZoneHealthy(resolver, zone))) {
        outcome.warnings.push(
          `${zone.feed} lookups are unavailable from this runtime's DNS resolver.`,
        );
        return;
      }

      const result = await lookupZone(resolver, registrableDomain, zone.zone);

      if (result.status === "unavailable") {
        outcome.warnings.push(`${zone.feed} lookup failed: ${result.reason}.`);
        return;
      }

      if (result.status === "listed") {
        const described = zone.describe(result.codes);
        if (described) {
          outcome.matches.push({
            feed: zone.feed,
            matchedUrl: registrableDomain,
            detail: described.detail,
            confidence: described.confidence,
            matchType: "host",
          });
        }
      }
    }),
  );

  return outcome;
}
