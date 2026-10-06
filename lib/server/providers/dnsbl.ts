import { Resolver } from "node:dns/promises";

import { getEnv } from "@/lib/config/env";
import type { ThreatFeedsData } from "@/lib/domain/types";
import { logWarn } from "@/lib/server/logger";

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
 * Spamhaus reports errors in 127.255.255.0/24 (blocked or over-limit
 * resolver, zone typo, disabled DQS key). They mean "no answer available",
 * never "listed".
 */
const SPAMHAUS_ERROR_RANGE = /^127\.255\.255\.\d{1,3}$/;

/**
 * DQS key errors: the specific cause goes to server logs only; the public
 * warning stays generic and the key itself is never echoed.
 */
const DQS_KEY_ERRORS: Record<string, string> = {
  "127.255.255.250": "dqs_key_disabled",
  "127.255.255.251": "dqs_key_rejected",
};
const DQS_KEY_PUBLIC_REASON =
  "the list did not accept this deployment's access key";

/** DQS keys are a single alphanumeric DNS label (max 63); anything else could rewrite the query name. */
const DQS_KEY_PATTERN = /^[a-z0-9]{8,63}$/i;

let warnedMalformedKey = false;

/**
 * With a DQS key, DBL is queried as <domain>.<key>.dbl.dq.spamhaus.net, which
 * Spamhaus answers from any resolver. The public dbl.spamhaus.org mirror
 * refuses most cloud resolvers, Vercel's included.
 */
function spamhausZone(): string {
  const key = getEnv().SPAMHAUS_DQS_KEY?.trim();
  if (key && DQS_KEY_PATTERN.test(key)) {
    return `${key}.dbl.dq.spamhaus.net`;
  }
  if (key && !warnedMalformedKey) {
    warnedMalformedKey = true;
    logWarn("dnsbl.dqs_key_malformed", {
      message:
        "SPAMHAUS_DQS_KEY is not a single alphanumeric label; using the public DBL mirror.",
    });
  }
  return "dbl.spamhaus.org";
}

const ZONE_DEFINITIONS: Array<
  Omit<DnsblZone, "zone"> & { zone: () => string }
> = [
  {
    feed: "spamhaus-dbl",
    zone: spamhausZone,
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
    zone: () => "multi.surbl.org",
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
/** A timeout or SERVFAIL says nothing lasting about the zone; retry soon. */
const TRANSIENT_HEALTH_RECHECK_MS = 60_000;

interface ZoneHealth {
  checkedAt: number;
  healthy: boolean;
  ttlMs: number;
  /** Set when the self-test failed for a reason worth naming (a DQS key error). */
  reason?: string;
}

declare global {
  var __dnsblZoneHealth: Map<string, ZoneHealth> | undefined;
}

export function resetDnsblStateForTests() {
  globalThis.__dnsblZoneHealth = undefined;
  warnedMalformedKey = false;
}

function createResolver(): Resolver {
  return new Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 1 });
}

type LookupResult =
  | { status: "listed"; codes: string[] }
  | { status: "clean" }
  | {
      status: "unavailable";
      reason: string;
      keyError?: boolean;
      transient?: boolean;
    };

async function lookupZone(
  resolver: Resolver,
  name: string,
  zone: string,
): Promise<LookupResult> {
  try {
    const codes = await resolver.resolve4(`${name}.${zone}`);
    const keyError = codes.map((code) => DQS_KEY_ERRORS[code]).find(Boolean);
    if (keyError) {
      logWarn("dnsbl.dqs_key_error", { feed: "spamhaus-dbl", error: keyError });
      return {
        status: "unavailable",
        reason: DQS_KEY_PUBLIC_REASON,
        keyError: true,
      };
    }
    if (codes.some((code) => SPAMHAUS_ERROR_RANGE.test(code))) {
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
      transient: true,
    };
  }
}

/**
 * Self-test gate: each zone must answer its documented test record before
 * clean answers are trusted. Serverless resolvers are frequently blocked by
 * Spamhaus/SURBL; without this gate every scan would read "clean" when the
 * list was actually unreachable.
 */
async function checkZoneHealth(
  resolver: Resolver,
  zone: DnsblZone,
): Promise<ZoneHealth> {
  const health = (globalThis.__dnsblZoneHealth ??= new Map());
  const cached = health.get(zone.zone);
  if (cached && Date.now() - cached.checkedAt < cached.ttlMs) {
    return cached;
  }

  const result = await lookupZone(resolver, zone.testRecord, zone.zone);
  const next: ZoneHealth = {
    checkedAt: Date.now(),
    healthy: result.status === "listed",
    ttlMs:
      result.status === "unavailable" && result.transient
        ? TRANSIENT_HEALTH_RECHECK_MS
        : HEALTH_RECHECK_MS,
    ...(result.status === "unavailable" && result.keyError
      ? { reason: result.reason }
      : {}),
  };
  health.set(zone.zone, next);
  return next;
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
  const zones: DnsblZone[] = ZONE_DEFINITIONS.map((definition) => ({
    ...definition,
    zone: definition.zone(),
  }));

  await Promise.all(
    zones.map(async (zone) => {
      const health = await checkZoneHealth(resolver, zone);
      if (!health.healthy) {
        outcome.warnings.push(
          health.reason
            ? `${zone.feed} lookups are unavailable: ${health.reason}.`
            : `${zone.feed} lookups are unavailable from this runtime's DNS resolver.`,
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
