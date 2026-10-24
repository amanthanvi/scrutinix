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
    return { ok: false, error: "Paste a link to check." };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      error: "That link is too long to check (over 2,048 characters).",
    };
  }

  const candidate = withDefaultScheme(trimmed);

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return {
      ok: false,
      error: "That doesn't look like a web link. Check it and try again.",
    };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return {
      ok: false,
      error: "Only web links (http or https) can be checked.",
    };
  }

  const hostname = url.hostname.toLowerCase();

  if (!hostname) {
    return { ok: false, error: "That link is missing a site name." };
  }

  if (isPrivateHostname(hostname)) {
    return {
      ok: false,
      error: "Links to your own computer or private network can't be checked.",
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

/** "example.com" → "https://example.com"; a link with a scheme is kept. */
function withDefaultScheme(input: string): string {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(input) ? input : `https://${input}`;
}

/**
 * The normalized link with the fragment it was typed with ("#/login" in a
 * client-routed app), for showing the link only. A fragment never reaches
 * the server, a scan, or a cache key, which use `normalizedUrl`.
 */
export function displayUrlOf(value: NormalizedUrl): string {
  try {
    const { hash } = new URL(withDefaultScheme(value.input));
    return hash ? `${value.normalizedUrl}${hash}` : value.normalizedUrl;
  } catch {
    return value.normalizedUrl;
  }
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

/**
 * A URL's host as a resolver or `isIP` reads it. WHATWG URL keeps an IPv6
 * literal's brackets ("[2606:4700::1111]"); the address is what is inside.
 */
export function bareHostname(url: string | URL): string {
  return new URL(url).hostname.replace(/^\[(.*)\]$/, "$1");
}

export function isPrivateHostname(hostname: string) {
  return isBlockedHostname(hostname);
}
