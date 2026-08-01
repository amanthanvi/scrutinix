import { isIP } from "node:net";

/**
 * Common two-level public suffixes. Deliberately NOT the full Public Suffix
 * List (that would be a large dependency for marginal gain here); this covers
 * the registries most likely to appear in scans. Unknown multi-level
 * suffixes degrade to last-two-labels, which is safe for our uses
 * (typosquat comparison, feed lookups, redirect-domain comparison).
 */
const TWO_LEVEL_SUFFIXES = new Set([
  "ac.uk",
  "co.uk",
  "gov.uk",
  "ltd.uk",
  "me.uk",
  "net.uk",
  "org.uk",
  "plc.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "go.jp",
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "co.in",
  "net.in",
  "org.in",
  "gov.in",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "com.mx",
  "com.ar",
  "com.tr",
  "com.tw",
  "com.sg",
  "com.hk",
  "com.my",
  "co.za",
  "co.kr",
  "co.id",
  "com.ph",
  "com.vn",
  "com.eg",
  "com.sa",
  "com.pk",
  "com.ng",
  "co.th",
  "com.ua",
]);

/**
 * Best-effort registrable domain (eTLD+1) for a hostname. IP literals and
 * single-label hosts are returned unchanged.
 */
export function getRegistrableDomain(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");

  if (!normalized || isIP(normalized) !== 0) {
    return normalized;
  }

  const labels = normalized.split(".");
  if (labels.length <= 2) {
    return normalized;
  }

  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }

  return lastTwo;
}

/** The leftmost label of the registrable domain ("paypal" in paypal.co.uk). */
export function getRegistrableLabel(hostname: string): string {
  const registrable = getRegistrableDomain(hostname);
  return registrable.split(".")[0] ?? registrable;
}
