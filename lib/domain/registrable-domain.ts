import { parse } from "tldts";

import { registrableDomainOf } from "@/lib/domain/link-anatomy";

/**
 * Public-Suffix-List registrable domain (eTLD+1) for a hostname. Private
 * suffixes are enabled so independent tenants such as safe.github.io do not
 * collapse to a shared platform domain. IP literals and single-label hosts
 * are returned unchanged: tldts detects IPs itself (its domain is null),
 * which keeps this module free of `node:net` so the verdict engine can also
 * run in the browser (history backfill).
 *
 * The implementation is shared with the browser's link anatomy
 * (`registrableDomainOf`), which loads tldts lazily instead of statically.
 */
export function getRegistrableDomain(hostname: string): string {
  return registrableDomainOf(parse, hostname);
}

/** The leftmost label of the registrable domain ("paypal" in paypal.co.uk). */
export function getRegistrableLabel(hostname: string): string {
  const registrable = getRegistrableDomain(hostname);
  return registrable.split(".")[0] ?? registrable;
}
