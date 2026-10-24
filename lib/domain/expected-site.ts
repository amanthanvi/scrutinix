import { IMPERSONATED_BRAND_SET } from "@/lib/domain/impersonated-brands";
import type { LinkAnatomy, ParseHostname } from "@/lib/domain/link-anatomy";
import { ownershipSentence } from "@/lib/domain/verdict-guidance";

/**
 * "Were you expecting…?": compare the site someone expected (a domain like
 * paypal.com, or a brand name like PayPal) with the site a link really
 * belongs to, the way a bank checks a payee's name before a transfer.
 * Runs in the browser on the link's anatomy; nothing is sent anywhere.
 *
 * A match only says the link belongs to the site they named, never that
 * it is safe: the scan still checks the rest.
 */
export interface ExpectedSiteComparison {
  /**
   * "match": the link belongs to the expected site. "mismatch": it belongs
   * to another site. "unknown": the answer names no site we can compare.
   */
  outcome: "match" | "mismatch" | "unknown";
  sentence: string;
}

/** Letters and digits only: "Bank of America" → "bankofamerica". */
function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The registrable domain of something typed as a domain or link
 * ("paypal.com", "www.paypal.com", "https://paypal.com/login"), or null if
 * it isn't one.
 */
function expectedDomain(parse: ParseHostname, expected: string): string | null {
  if (/\s/.test(expected) || !expected.includes(".")) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(expected)
    ? expected
    : `https://${expected}`;
  let hostname: string;
  try {
    hostname = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  const parsed = parse(hostname);
  return parsed.domain && parsed.isIcann ? parsed.domain.toLowerCase() : null;
}

export function compareExpectedSite(
  parse: ParseHostname,
  anatomy: Pick<LinkAnatomy, "registeredDomain" | "isIp">,
  rawExpected: string,
): ExpectedSiteComparison | null {
  const expected = rawExpected.trim();
  if (!expected) return null;
  const owner = anatomy.registeredDomain.toLowerCase();

  const domain = expectedDomain(parse, expected);
  if (domain) {
    return domain === owner
      ? { outcome: "match", sentence: `Matches ${domain}.` }
      : { outcome: "mismatch", sentence: ownershipSentence(owner, domain) };
  }

  // A name: compare it with the registered domain's own name, so "PayPal"
  // matches paypal.com and paypal.de alike.
  const name = compact(expected);
  if (!name) return null;
  const ownerName = anatomy.isIp
    ? null
    : compact(parse(owner).domainWithoutSuffix ?? "");
  if (ownerName && ownerName === name) {
    return { outcome: "match", sentence: `Matches ${owner}.` };
  }
  if (IMPERSONATED_BRAND_SET.has(name)) {
    return {
      outcome: "mismatch",
      sentence: ownershipSentence(owner, expected),
    };
  }
  return {
    outcome: "unknown",
    sentence: `We can't tell which site “${expected}” means. This link belongs to ${owner}.`,
  };
}
