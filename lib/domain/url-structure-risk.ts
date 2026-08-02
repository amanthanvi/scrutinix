import { isIP } from "node:net";
import { domainToUnicode } from "node:url";

import {
  getRegistrableLabel,
  getRegistrableDomain,
  isPrivateSuffixDomain,
} from "@/lib/domain/registrable-domain";
import { normalizeUrlInput } from "@/lib/domain/url";

export interface UrlStructureRisk {
  /** Added to the lexical ensemble score before label thresholds (0–1 scale). */
  scoreDelta: number;
  reasons: string[];
}

const SCRIPT_INDICATORS = [".sh", ".bash", ".py", ".pl", ".ps1"] as const;

/**
 * Frequently-impersonated brands for typosquat comparison. Only names with
 * 5+ characters participate in edit-distance matching (shorter ones create
 * false positives); all participate in exact-label checks.
 */
const IMPERSONATED_BRANDS = [
  "adobe",
  "airbnb",
  "amazon",
  "americanexpress",
  "apple",
  "bankofamerica",
  "barclays",
  "binance",
  "bitwarden",
  "blockchain",
  "booking",
  "chase",
  "citibank",
  "coinbase",
  "discord",
  "dropbox",
  "facebook",
  "fedex",
  "github",
  "gmail",
  "google",
  "hsbc",
  "icloud",
  "instagram",
  "linkedin",
  "metamask",
  "microsoft",
  "netflix",
  "office365",
  "outlook",
  "paypal",
  "roblox",
  "santander",
  "spotify",
  "steam",
  "telegram",
  "twitter",
  "walmart",
  "wellsfargo",
  "whatsapp",
  "yahoo",
] as const;

const MIN_EDIT_DISTANCE_BRAND_LENGTH = 5;

/**
 * Structural URL signals (non-default ports, script-like paths) used by lexical
 * heuristics so they stay aligned with a single definition.
 */
export function getUrlStructureRisk(url: string): UrlStructureRisk {
  const parsed = normalizeUrlInput(url);
  if (!parsed.ok) {
    return { scoreDelta: 0, reasons: [] };
  }

  const u = new URL(parsed.value.normalizedUrl);
  const hostname = u.hostname.toLowerCase();
  /** Script extensions must not be matched in the hostname (e.g. .pl, .py, .sh ccTLDs). */
  const pathSearchHash = `${u.pathname}${u.search}${u.hash}`.toLowerCase();

  let scoreDelta = 0;
  const reasons: string[] = [];

  const scriptMatches = SCRIPT_INDICATORS.filter((indicator) =>
    pathSearchHash.includes(indicator),
  );
  if (scriptMatches.length > 0) {
    scoreDelta += Math.min(0.24, 0.12 + scriptMatches.length * 0.06);
    reasons.push(
      `The URL references script or shell content such as ${scriptMatches.slice(0, 3).join(", ")}.`,
    );
  }

  const literalIp = isIP(hostname);
  const explicitPort = u.port !== "";

  if (u.protocol === "https:" && explicitPort && u.port !== "443") {
    let bump = 0.18;
    if (literalIp) bump += 0.08;
    scoreDelta += bump;
    reasons.push(
      `The URL uses a non-standard HTTPS port (${u.port}), which is uncommon for typical web services.`,
    );
  } else if (u.protocol === "http:" && explicitPort && u.port !== "80") {
    let bump = 0.12;
    if (literalIp) bump += 0.06;
    scoreDelta += bump;
    reasons.push(
      `The URL uses a non-standard HTTP port (${u.port}), which is uncommon for typical web services.`,
    );
  }

  if (!literalIp) {
    const homoglyph = detectHomoglyphRisk(hostname);
    if (homoglyph) {
      scoreDelta += 0.2;
      reasons.push(homoglyph);
    }

    const typosquat = detectTyposquatRisk(hostname);
    if (typosquat) {
      scoreDelta += 0.22;
      reasons.push(typosquat);
    }
  }

  return { scoreDelta, reasons };
}

/**
 * Flags internationalized hostnames whose labels mix Latin with Cyrillic or
 * Greek letters, or consist entirely of Latin-lookalike Cyrillic - the two
 * dominant homograph-attack shapes. Legitimate fully non-Latin domains
 * (single script, non-confusable) are left alone.
 */
function detectHomoglyphRisk(hostname: string): string | null {
  if (!hostname.includes("xn--")) {
    return null;
  }

  let unicodeHost: string;
  try {
    unicodeHost = domainToUnicode(hostname);
  } catch {
    return null;
  }

  for (const label of unicodeHost.split(".")) {
    const hasLatin = /[a-z]/i.test(label);
    const hasCyrillic = /[Ѐ-ӿ]/.test(label);
    const hasGreek = /[Ͱ-Ͽ]/.test(label);

    if (hasLatin && (hasCyrillic || hasGreek)) {
      return `The hostname mixes Latin with lookalike characters from another alphabet ("${label}"), a common homograph-attack pattern.`;
    }

    // Entirely composed of Cyrillic letters that render like Latin ones.
    if (!hasLatin && hasCyrillic && /^[аеорсухіјѕ.-]+$/.test(label)) {
      return `The hostname is written entirely in Latin-lookalike characters ("${label}"), a common homograph-attack pattern.`;
    }
  }

  return null;
}

function detectTyposquatRisk(hostname: string): string | null {
  const registrableLabel = getRegistrableLabel(hostname);
  const registrable = getRegistrableDomain(hostname);
  const hostLabels = hostname.split(".");

  // The brand's own domains (paypal.com, paypal.co.uk, www.paypal.com) sit
  // under ICANN suffixes. The same label under a *private* suffix
  // (paypal.github.io, paypal.web.app) is an anyone-registrable tenant of a
  // shared hosting platform, never the brand itself.
  if ((IMPERSONATED_BRANDS as readonly string[]).includes(registrableLabel)) {
    if (isPrivateSuffixDomain(hostname)) {
      return `The hostname uses "${registrableLabel}" as its name on a shared hosting platform (${registrable}), where anyone can register that label.`;
    }
    return null;
  }

  for (const brand of IMPERSONATED_BRANDS) {
    // paypal.com.evil.example - brand as a non-registrable hostname label.
    if (hostLabels.slice(0, -1).includes(brand)) {
      return `The hostname embeds "${brand}" as a subdomain of an unrelated domain (${registrable}).`;
    }

    // paypal-secure-login.example - brand with an affix in the registrable label.
    if (
      registrableLabel !== brand &&
      new RegExp(`(^|[-_])${brand}([-_]|$)`).test(registrableLabel)
    ) {
      return `The domain name attaches extra words to "${brand}" (${registrable}), a common impersonation pattern.`;
    }

    // paypa1.com / payapl.com - one edit away from the brand.
    if (
      brand.length >= MIN_EDIT_DISTANCE_BRAND_LENGTH &&
      registrableLabel !== brand &&
      Math.abs(registrableLabel.length - brand.length) <= 1 &&
      damerauLevenshteinAtMostOne(registrableLabel, brand)
    ) {
      return `The domain name (${registrable}) is one typo away from "${brand}".`;
    }
  }

  return null;
}

/** True when the strings are within Damerau-Levenshtein distance 1. */
function damerauLevenshteinAtMostOne(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }

  if (a.length === b.length) {
    // One substitution, or one adjacent transposition.
    let firstDiff = -1;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        if (firstDiff === -1) {
          firstDiff = i;
        } else if (
          firstDiff === i - 1 &&
          a[firstDiff] === b[i] &&
          a[i] === b[firstDiff]
        ) {
          // Transposition: the rest must match exactly.
          return a.slice(i + 1) === b.slice(i + 1);
        } else {
          return false;
        }
      }
    }
    return firstDiff !== -1;
  }

  // One insertion/deletion.
  const [shorter, longer] = a.length < b.length ? [a, b] : ([b, a] as const);
  if (longer.length - shorter.length !== 1) {
    return false;
  }

  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (!skipped) {
      skipped = true;
      j += 1;
    } else {
      return false;
    }
  }
  return true;
}
