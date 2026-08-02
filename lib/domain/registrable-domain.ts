import { isIP } from "node:net";
import { getDomain, parse } from "tldts";

/**
 * Public-Suffix-List registrable domain (eTLD+1) for a hostname. Private
 * suffixes are enabled so independent tenants such as safe.github.io do not
 * collapse to a shared platform domain. IP literals and single-label hosts
 * are returned unchanged.
 */
export function getRegistrableDomain(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");

  if (!normalized || isIP(normalized) !== 0) {
    return normalized;
  }

  return getDomain(normalized, { allowPrivateDomains: true }) ?? normalized;
}

/** The leftmost label of the registrable domain ("paypal" in paypal.co.uk). */
export function getRegistrableLabel(hostname: string): string {
  const registrable = getRegistrableDomain(hostname);
  return registrable.split(".")[0] ?? registrable;
}

/**
 * True when the registrable domain sits under a Public-Suffix-List *private*
 * suffix - a shared hosting platform such as github.io or web.app where any
 * tenant can register any label. A brand name there is never the brand.
 */
export function isPrivateSuffixDomain(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || isIP(normalized) !== 0) {
    return false;
  }

  return parse(normalized, { allowPrivateDomains: true }).isPrivate === true;
}
