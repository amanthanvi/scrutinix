import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";

import {
  isBlockedNetworkAddress,
  parseIpv6Bytes,
} from "@/lib/domain/blocked-address";
import type { HostingNetwork } from "@/lib/domain/types";
import { logWarn } from "@/lib/server/logger";

/**
 * Team Cymru IP-to-ASN mapping over DNS: which network announces the
 * address a hostname resolved to. Free, keyless, and only the IP address
 * leaves the server (as a TXT query name), never the hostname or URL.
 *
 * Evidence only. A timeout or any other failure leaves `hosting` unset and
 * never fails the DNS signal or marks the scan partial.
 */

/** Same per-query budget as the DNSBL lookups (`dnsbl.ts`). */
const QUERY_TIMEOUT_MS = 2_000;
const AS_NAME_CACHE_LIMIT = 256;
/** AS names and registrations change on the scale of months. */
const AS_NAME_TTL_MS = 1000 * 60 * 60 * 24;
const AS_NAME_MAX_LENGTH = 120;
const MAX_ASN = 4_294_967_295;

export interface TxtResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  cancel(): void;
}

interface OriginRecord {
  asn: number;
  prefix: string | null;
  country: string | null;
}

interface AsNameRecord {
  asName: string | null;
  country: string | null;
}

interface CachedAsName extends AsNameRecord {
  cachedAt: number;
}

declare global {
  var __cymruAsNames: Map<number, CachedAsName> | undefined;
}

export function resetTeamCymruCacheForTests() {
  globalThis.__cymruAsNames = undefined;
}

/**
 * The address to look up: the first public IPv4 address, else the first
 * public IPv6 one. Private, reserved, and documentation addresses are never
 * queried, even if a caller passes them.
 */
export function selectHostingAddress(
  addresses: readonly string[],
): string | null {
  const queryable = addresses.filter(
    (address) => isIP(address) !== 0 && !isBlockedNetworkAddress(address),
  );
  return (
    queryable.find((address) => isIP(address) === 4) ??
    queryable.find((address) => isIP(address) === 6) ??
    null
  );
}

/**
 * `4.3.2.1.origin.asn.cymru.com` for 1.2.3.4; IPv6 uses `origin6` with the
 * address's 32 nibbles reversed.
 */
export function originQueryName(ip: string): string | null {
  if (isIP(ip) === 4) {
    return `${ip.split(".").reverse().join(".")}.origin.asn.cymru.com`;
  }

  if (isIP(ip) === 6) {
    const bytes = parseIpv6Bytes(ip);
    if (!bytes || bytes.length !== 16) {
      return null;
    }
    const nibbles = bytes.flatMap((byte) => [
      (byte >> 4).toString(16),
      (byte & 0xf).toString(16),
    ]);
    return `${nibbles.reverse().join(".")}.origin6.asn.cymru.com`;
  }

  return null;
}

/**
 * Origin answers look like `13335 | 1.1.1.0/24 | AU | apnic | 2011-08-11`.
 * An address can sit in several announced prefixes (one TXT record each),
 * and a prefix announced by several networks lists them space-separated;
 * the most specific prefix and its first ASN win. Null when nothing parses.
 */
export function parseOriginRecords(records: string[][]): OriginRecord | null {
  let best: (OriginRecord & { length: number }) | null = null;

  for (const record of records) {
    const fields = splitFields(record);
    const asn = parseAsn(fields[0]?.split(/\s+/)[0]);
    if (asn === null) {
      continue;
    }

    const prefix = parsePrefix(fields[1]);
    const length = prefix ? Number(prefix.split("/")[1]) : -1;
    if (best && best.length >= length) {
      continue;
    }

    best = { asn, prefix, country: parseCountry(fields[2]), length };
  }

  if (!best) {
    return null;
  }

  return { asn: best.asn, prefix: best.prefix, country: best.country };
}

/**
 * AS answers look like `13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US`.
 * The trailing country on the name repeats the second field, so it is
 * dropped. Null when no record describes `asn`.
 */
export function parseAsNameRecords(
  records: string[][],
  asn: number,
): AsNameRecord | null {
  for (const record of records) {
    const fields = splitFields(record);
    if (parseAsn(fields[0]) !== asn) {
      continue;
    }

    const country = parseCountry(fields[1]);
    const rawName = fields.slice(4).join(" | ");
    const name = rawName
      .replace(/\p{Cc}|\p{Cf}/gu, "")
      .replace(/,\s*[A-Z]{2}$/, "")
      .trim()
      .slice(0, AS_NAME_MAX_LENGTH);

    return { asName: name || null, country };
  }

  return null;
}

/**
 * The hosting network for the first public address in `addresses`.
 * Undefined when there is nothing to look up or the lookup failed; an
 * answer that no network routes the address is recorded with `asn: null`.
 * Never throws.
 */
export async function lookupHostingNetwork(
  addresses: readonly string[],
  signal?: AbortSignal,
  resolver?: TxtResolver,
): Promise<HostingNetwork | undefined> {
  const ip = selectHostingAddress(addresses);
  const queryName = ip ? originQueryName(ip) : null;
  if (!ip || !queryName || signal?.aborted) {
    return undefined;
  }

  let active: TxtResolver | undefined;
  const cancel = () => active?.cancel();
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    active = resolver ?? createResolver();
    let origin: OriginRecord | null;
    try {
      origin = parseOriginRecords(await active.resolveTxt(queryName));
    } catch (error) {
      if (errorCode(error) === "ENOTFOUND") {
        return {
          ip,
          asn: null,
          asName: null,
          prefix: null,
          registeredCountry: null,
        };
      }
      noteFailure("origin", error, signal);
      return undefined;
    }

    if (!origin) {
      logWarn("dns.hosting_lookup_failed", {
        stage: "origin",
        code: "malformed",
      });
      return undefined;
    }

    const asRecord = await lookupAsName(active, origin.asn, signal);
    return {
      ip,
      asn: origin.asn,
      asName: asRecord?.asName ?? null,
      prefix: origin.prefix,
      // The network's registry country; the prefix's only when the AS
      // record is unavailable. Both are registrations, not locations.
      registeredCountry: asRecord?.country ?? origin.country,
    };
  } catch (error) {
    noteFailure("unexpected", error, signal);
    return undefined;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

async function lookupAsName(
  resolver: TxtResolver,
  asn: number,
  signal: AbortSignal | undefined,
): Promise<AsNameRecord | null> {
  const cache = (globalThis.__cymruAsNames ??= new Map());
  const cached = cache.get(asn);
  if (cached && Date.now() - cached.cachedAt < AS_NAME_TTL_MS) {
    return cached;
  }

  try {
    const record = parseAsNameRecords(
      await resolver.resolveTxt(`AS${asn}.asn.cymru.com`),
      asn,
    );
    if (record) {
      cache.delete(asn);
      cache.set(asn, { ...record, cachedAt: Date.now() });
      while (cache.size > AS_NAME_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        cache.delete(oldest);
      }
    }
    return record;
  } catch (error) {
    noteFailure("as_name", error, signal);
    return null;
  }
}

function createResolver(): TxtResolver {
  return new Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 1 });
}

function splitFields(record: string[]) {
  return record
    .join("")
    .split("|")
    .map((field) => field.trim());
}

function parseAsn(value: string | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) {
    return null;
  }
  const asn = Number(value);
  return asn > 0 && asn <= MAX_ASN ? asn : null;
}

function parsePrefix(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [address, length, extra] = value.split("/");
  if (extra !== undefined || !address || !length || !/^\d{1,3}$/.test(length)) {
    return null;
  }
  const max = isIP(address) === 4 ? 32 : isIP(address) === 6 ? 128 : -1;
  return Number(length) <= max ? `${address.toLowerCase()}/${length}` : null;
}

/** Two-letter registry country; "ZZ" and blanks mean unknown. */
function parseCountry(value: string | undefined): string | null {
  const country = value?.toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) && country !== "ZZ"
    ? country
    : null;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

/** Logs the failure class only: no hostname, URL, or IP address. */
function noteFailure(
  stage: string,
  error: unknown,
  signal: AbortSignal | undefined,
) {
  if (signal?.aborted) {
    return;
  }
  logWarn("dns.hosting_lookup_failed", {
    stage,
    code: errorCode(error) || "error",
  });
}
