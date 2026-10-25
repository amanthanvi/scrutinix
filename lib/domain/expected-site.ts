import {
  registrableDomainOf,
  splitLinkAnatomy,
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
 * compared either way, because we don't know which domains a brand owns:
 * "paypal.xyz" carries PayPal's name, and live.com is Microsoft's without it.
 */
export interface ExpectedSiteComparison {
  /**
   * "match": the link belongs to the expected site. "mismatch": it belongs
   * to another site. "unknown": the answer names no site we can compare.
   */
  outcome: "match" | "mismatch" | "unknown";
  sentence: string;
}

/**
 * Letters and digits only, in any script: "Bank of America" →
 * "bankofamerica", "Сбербанк" stays "сбербанк".
 */
function compact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * An IP address typed bare ("1.1.1.1", "2606:4700::1111"), bracketed, or
 * in a link, written exactly as a link's anatomy writes its owner
 * ("[2606:4700::1111]"); null if it isn't one.
 */
function expectedIp(parse: ParseHostname, expected: string): string | null {
  if (/\s/.test(expected)) return null;
  let link = expected;
  if (!HAS_SCHEME.test(expected)) {
    const host = expected.split(/[/?#]/, 1)[0] ?? "";
    if (host.startsWith("[")) {
      link = `https://${expected}`;
    } else if (parse(host).isIp) {
      const bracketed = host.includes(":") ? `[${host}]` : host;
      link = `https://${bracketed}${expected.slice(host.length)}`;
    } else {
      return null;
    }
  }
  const typed = splitLinkAnatomy(parse, link);
  return typed?.isIp ? typed.registeredDomain : null;
}

/**
 * The registered domain of something typed as a domain or link
 * ("paypal.com", "www.paypal.com", "https://paypal.com/login"), worked out
 * exactly as the link's own anatomy is (private suffixes included, so
 * "you.github.io" is its own site), or null if it isn't one.
 */
function expectedDomain(parse: ParseHostname, expected: string): string | null {
  if (/\s/.test(expected) || !expected.includes(".")) return null;
  const withScheme = HAS_SCHEME.test(expected)
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
  anatomy: Pick<LinkAnatomy, "registeredDomain" | "impersonates">,
  rawExpected: string,
): ExpectedSiteComparison | null {
  const expected = rawExpected.trim();
  if (!expected) return null;
  const owner = anatomy.registeredDomain.toLowerCase();

  // An IP address, compared directly: an IP link's anatomy names its
  // address as the owner, and an address has no registered domain.
  const ip = expectedIp(parse, expected);
  if (ip) {
    if (ip === owner) return { outcome: "match", sentence: `Matches ${ip}.` };
    return {
      outcome: "mismatch",
      sentence: anatomy.impersonates
        ? `No. This link doesn't belong to ${ip}.`
        : ownershipSentence(owner, ip),
    };
  }

  // A domain or link: compare registered domains exactly.
  const domain = expectedDomain(parse, expected);
  if (domain) {
    if (domain === owner) {
      return { outcome: "match", sentence: `Matches ${domain}.` };
    }
    // A look-alike's anatomy, beside this answer, already says whose site
    // the link is: answer without saying it twice.
    if (anatomy.impersonates) {
      return {
        outcome: "mismatch",
        sentence:
          domain === anatomy.impersonates
            ? `No. The link only spells out ${domain}.`
            : `No. This link doesn't belong to ${domain}.`,
      };
    }
    return { outcome: "mismatch", sentence: ownershipSentence(owner, domain) };
  }

  // A name: never a match or a mismatch, only whose site it is.
  if (!compact(expected)) return null;
  return {
    outcome: "unknown",
    sentence: `We can't tell from a name whether ${owner} is ${expected}'s site. Type its address to compare.`,
  };
}
