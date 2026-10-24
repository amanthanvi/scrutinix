import { IMPERSONATED_BRAND_SET } from "@/lib/domain/impersonated-brands";
import {
  registrableDomainOf,
  type LinkAnatomy,
  type ParseHostname,
} from "@/lib/domain/link-anatomy";
import { ownershipSentence } from "@/lib/domain/verdict-guidance";

/**
 * "Were you expecting…?": compare the site someone expected (a domain like
 * paypal.com, or a brand name like PayPal) with the site a link really
 * belongs to, the way a bank checks a payee's name before a transfer.
 * Runs in the browser on the link's anatomy; nothing is sent anywhere.
 *
 * A match only says the link belongs to the domain they typed, never that
 * it is safe: the scan still checks the rest. A brand name is never
 * confirmed, because a brand's name can sit on anyone's domain.
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
 * The registered domain of something typed as a domain or link
 * ("paypal.com", "www.paypal.com", "https://paypal.com/login"), worked out
 * exactly as the link's own anatomy is (private suffixes included, so
 * "you.github.io" is its own site), or null if it isn't one.
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
  if (!parse(hostname, { allowPrivateDomains: true }).domain) return null;
  return registrableDomainOf(parse, hostname);
}

export function compareExpectedSite(
  parse: ParseHostname,
  anatomy: Pick<LinkAnatomy, "registeredDomain" | "isIp">,
  rawExpected: string,
): ExpectedSiteComparison | null {
  const expected = rawExpected.trim();
  if (!expected) return null;
  const owner = anatomy.registeredDomain.toLowerCase();

  // A domain or link: compare registered domains exactly.
  const domain = expectedDomain(parse, expected);
  if (domain) {
    return domain === owner
      ? { outcome: "match", sentence: `Matches ${domain}.` }
      : { outcome: "mismatch", sentence: ownershipSentence(owner, domain) };
  }

  // A name. We don't know which domains a brand owns, so a name is never
  // confirmed as a match: "paypal.xyz" carries PayPal's name too. Its own
  // name (the registered domain's first label, exactly as the anatomy found
  // it) only tells us the link isn't obviously someone else's.
  const name = compact(expected);
  if (!name) return null;
  const ownerName = anatomy.isIp ? null : owner.split(".")[0];
  if (ownerName === name) {
    return {
      outcome: "unknown",
      sentence: `This link belongs to ${owner}. Check that's ${expected}'s address.`,
    };
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
