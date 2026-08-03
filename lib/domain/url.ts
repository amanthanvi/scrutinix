import { isBlockedHostname } from "@/lib/domain/blocked-address";

export interface NormalizedUrl {
  input: string;
  normalizedUrl: string;
  hostname: string;
  protocol: "http:" | "https:";
}

export type UrlValidationResult =
  | {
      ok: true;
      value: NormalizedUrl;
    }
  | {
      ok: false;
      error: string;
    };

const MAX_URL_LENGTH = 2048;

export function normalizeUrlInput(input: string): UrlValidationResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, error: "Enter a URL to analyze." };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      error: "URLs longer than 2048 characters are not supported.",
    };
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: "Enter a valid HTTP or HTTPS URL." };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, error: "Only HTTP and HTTPS URLs are supported." };
  }

  const hostname = url.hostname.toLowerCase();

  if (!hostname) {
    return { ok: false, error: "A hostname is required." };
  }

  if (isPrivateHostname(hostname)) {
    return {
      ok: false,
      error: "Private, localhost, and internal network URLs are not allowed.",
    };
  }

  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  url.hash = "";

  return {
    ok: true,
    value: {
      input: trimmed,
      normalizedUrl: url.toString(),
      hostname,
      protocol: url.protocol as "http:" | "https:",
    },
  };
}

export function createCacheKey(normalizedUrl: string) {
  // The WHATWG URL parser already lowercased the hostname during
  // normalization. Lowercasing the whole URL here would collide distinct
  // case-sensitive paths (/AdminPanel vs /adminpanel) onto one entry.
  return normalizedUrl;
}

export function formatDisplayUrl(url: string) {
  const parsed = normalizeUrlInput(url);
  if (!parsed.ok) {
    return url;
  }

  return parsed.value.normalizedUrl.replace(/^https?:\/\//, "");
}

export function simplifyUrlForMatching(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const withoutTrailingSlash = parsed.toString().replace(/\/$/, "");
    return withoutTrailingSlash;
  } catch {
    return url.replace(/\/$/, "");
  }
}

export function isPrivateHostname(hostname: string) {
  return isBlockedHostname(hostname);
}
