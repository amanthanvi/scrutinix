import type { parse as tldtsParse } from "tldts";

import { IMPERSONATED_BRAND_SET } from "@/lib/domain/impersonated-brands";

/**
 * Isomorphic link anatomy: who really owns a link, and whether its
 * subdomain spells out somebody else's domain.
 *
 * The Public Suffix List parser is passed in rather than imported, so this
 * module carries no runtime dependency: the server
 * (`lib/domain/registrable-domain.ts`) hands it tldts' static `parse`, and
 * the browser loads tldts lazily (`hooks/use-link-anatomy.ts`) only once a
 * scan starts or a result shows. The `import type` above is erased at build.
 */
export type ParseHostname = typeof tldtsParse;

export interface LinkAnatomy {
  /**
   * The URL as parsed: the full value, for titles and copy. A password in
   * the link is removed, so a title or copy never echoes a credential.
   */
  href: string;
  /** "https" or "http", without "://". */
  scheme: string;
  /**
   * The decoded login name before "@" ("paypal.com" in
   * https://paypal.com@secure-login.xyz/), or "". Browsers ignore it when
   * choosing the site, which is why look-alikes use it. Never the password.
   */
  userinfo: string;
  /** Labels left of the registered domain, without the trailing dot. */
  subdomain: string;
  /** Public-Suffix-List registrable domain, or the host for IPs. */
  registeredDomain: string;
  /** ":8443" when the link names a non-default port, else "". */
  port: string;
  /** Path, query, and fragment; "" when the path is only "/". */
  path: string;
  isIp: boolean;
  /**
   * A different domain spelled inside the subdomain, as "paypal.com" in
   * paypal.com.secure-login.xyz: what the link pretends to be. Null when
   * nothing impersonates.
   */
  impersonates: string | null;
}

/**
 * The registrable domain (eTLD+1). Private suffixes count, so independent
 * tenants such as safe.github.io do not collapse to a shared platform
 * domain; IP literals and single-label hosts come back unchanged.
 */
export function registrableDomainOf(
  parse: ParseHostname,
  hostname: string,
): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) {
    return normalized;
  }

  return parse(normalized, { allowPrivateDomains: true }).domain ?? normalized;
}

/** Split an http(s) URL into its anatomy; null for anything else. */
export function splitLinkAnatomy(
  parse: ParseHostname,
  url: string,
): LinkAnatomy | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const scheme = parsed.protocol.replace(/:$/, "");
  if (scheme !== "http" && scheme !== "https") {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const isIp =
    host.startsWith("[") || Boolean(parse(host.replace(/^\[|\]$/g, "")).isIp);
  const registeredDomain = isIp ? host : registrableDomainOf(parse, host);
  const subdomain =
    !isIp && host.endsWith(`.${registeredDomain}`)
      ? host.slice(0, -registeredDomain.length - 1)
      : "";
  const rawPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const userinfo = decodeUserinfo(parsed.username);
  parsed.password = "";

  return {
    href: parsed.href,
    scheme,
    userinfo,
    subdomain,
    registeredDomain,
    port: parsed.port ? `:${parsed.port}` : "",
    path: rawPath === "/" ? "" : rawPath,
    isIp,
    impersonates: isIp
      ? null
      : (findImpersonatedDomain(parse, subdomain, registeredDomain) ??
        findImpersonatedLogin(parse, userinfo, registeredDomain)),
  };
}

function decodeUserinfo(username: string): string {
  if (!username) return "";
  try {
    return decodeURIComponent(username);
  } catch {
    return username;
  }
}

/**
 * The domain a link's login name spells out, as "paypal.com" in
 * https://www.paypal.com@secure-login.xyz/. Unlike the subdomain search, a
 * single whole run ("paypal.com") counts, because the login name is not
 * part of the host at all.
 */
function findImpersonatedLogin(
  parse: ParseHostname,
  userinfo: string,
  registeredDomain: string,
): string | null {
  const labels = userinfo.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.some((label) => !label)) return null;

  for (let start = 0; start < labels.length; start += 1) {
    for (let end = labels.length; end - start >= 2; end -= 1) {
      const found = recognisedDomain(parse, labels.slice(start, end).join("."));
      if (found && found !== registeredDomain) {
        return found;
      }
    }
  }

  return null;
}

/**
 * Suffixes people read as "a website address" on any name. Newer generic
 * TLDs such as .app or .zip are left out: "mail.app.example.com" and
 * "files.zip.example.com" are ordinary hostnames far more often than they
 * are look-alikes. Multi-label public suffixes (co.uk, com.au) count too.
 *
 * Two-letter country codes are different: regional and tenant hostnames
 * put them in the subdomain all the time (acme.us.auth0.com,
 * shop.de.example.com, news.uk.example.com). A "name.cc" run counts only
 * when the name is a frequently impersonated brand (amazon.de, paypal.fr).
 *
 * "int" and "mil" are brand-gated the same way: they are common
 * environment labels (internal, integration) in ordinary hostnames such as
 * api.int.example.com. "edu" stays recognised (cs.mit.edu.example.com).
 */
const RECOGNISED_SUFFIXES = new Set([
  "com",
  "net",
  "org",
  "gov",
  "edu",
  "info",
  "biz",
]);

const BRAND_GATED_SUFFIXES = new Set(["int", "mil"]);

/**
 * The domain spelled inside the subdomain, if any. Every contiguous run of
 * two or more labels is tested, longest first from each starting label, and
 * a run counts only when it is exactly a domain, so "www.paypal.com.signin"
 * (secure-login.xyz) and "paypal.com.malicious" (scrutinix.test) both
 * surface paypal.com. Paths are never searched: a
 * path naming a domain (/wiki/Example.com, /report.pdf) is ordinary.
 */
export function findImpersonatedDomain(
  parse: ParseHostname,
  subdomain: string,
  registeredDomain: string,
): string | null {
  const labels = subdomain.split(".").filter(Boolean);

  for (let start = 0; start < labels.length - 1; start += 1) {
    for (let end = labels.length; end - start >= 2; end -= 1) {
      const found = recognisedDomain(parse, labels.slice(start, end).join("."));
      if (found && found !== registeredDomain) {
        return found;
      }
    }
  }

  return null;
}

function recognisedDomain(
  parse: ParseHostname,
  candidate: string,
): string | null {
  const parsed = parse(candidate, { allowPrivateDomains: false });
  const name = parsed.domainWithoutSuffix;
  const suffix = parsed.publicSuffix;
  // The run must be exactly a domain: "paypal.com.apple.com" parses as
  // apple.com, but what it spells first is paypal.com (a shorter run).
  if (parsed.domain !== candidate || !parsed.isIcann || !suffix || !name) {
    return null;
  }
  // "www.us" in www.us.example.com is a host prefix; "en.us" a locale.
  if (name.length < 3 || name === "www") {
    return null;
  }

  const recognised =
    RECOGNISED_SUFFIXES.has(suffix) ||
    suffix.includes(".") ||
    ((/^[a-z]{2}$/.test(suffix) || BRAND_GATED_SUFFIXES.has(suffix)) &&
      IMPERSONATED_BRAND_SET.has(name));
  return recognised ? parsed.domain : null;
}

/** Hostname of a URL, lowercased; null when it does not parse. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * Where the link actually ends, when that is a different host from the one
 * it names: the final redirect host. Null when it ends where it started.
 */
export function redirectDestination(
  scannedUrl: string,
  finalUrl: string | null | undefined,
): string | null {
  const start = hostOf(scannedUrl);
  const end = finalUrl ? hostOf(finalUrl) : null;
  return start && end && start !== end ? end : null;
}
