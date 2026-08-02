import { getRegistrableDomain } from "@/lib/domain/registrable-domain";
import type { PageContentFindings } from "@/lib/domain/types";

const MAX_TITLE_LENGTH = 200;
const MAX_FORM_HOSTS = 5;
const MAX_HINTS = 6;

/**
 * Regex-based phishing heuristics over the first chunk of a page's HTML.
 * Deliberately parser-free: the input is capped (~64KB), adversarial, and we
 * only extract coarse indicators - a full HTML parser would add a dependency
 * without changing any verdict.
 */
export function analyzePageContent(
  html: string,
  finalUrl: string,
): PageContentFindings {
  // Browsers resolve relative URLs against the first <base href>, so a
  // phishing page can point a relative form action at another origin.
  const baseUrl = resolveDocumentBaseUrl(html, finalUrl);

  return {
    title: extractTitle(html),
    crossOriginFormHosts: extractCrossOriginFormHosts(html, finalUrl, baseUrl),
    passwordInputCount: countMatches(
      html,
      /<input\b[^>]*type\s*=\s*["']?password/gi,
    ),
    iframeCount: countMatches(html, /<iframe\b/gi),
    hiddenIframeCount: countHiddenIframes(html),
    obfuscationHints: extractObfuscationHints(html),
    metaRefreshTarget: extractMetaRefreshTarget(html, baseUrl),
  };
}

/** The document's effective base URL: the first valid HTTP(S) <base href>, else the page URL. */
function resolveDocumentBaseUrl(html: string, finalUrl: string): string {
  const base = /<base\b[^>]*>/i.exec(html);
  const href = base ? extractAttribute(base[0], "href") : null;
  if (!href) {
    return finalUrl;
  }

  try {
    const resolved = new URL(href, finalUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return finalUrl;
    }
    return resolved.toString();
  } catch {
    return finalUrl;
  }
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) {
    return null;
  }

  const title = match[1].replace(/\s+/g, " ").trim();
  return title ? title.slice(0, MAX_TITLE_LENGTH) : null;
}

function extractCrossOriginFormHosts(
  html: string,
  finalUrl: string,
  baseUrl: string,
): string[] {
  let pageDomain: string;
  try {
    pageDomain = getRegistrableDomain(new URL(finalUrl).hostname);
  } catch {
    return [];
  }

  const hosts = new Set<string>();
  const formPattern = /<form\b[^>]*>/gi;
  let form: RegExpExecArray | null;

  while ((form = formPattern.exec(html)) !== null) {
    const action = extractAttribute(form[0], "action");
    if (!action) {
      continue;
    }

    let target: URL;
    try {
      // Resolve against the document base, but compare against the page's
      // own domain - that is where the browser would actually submit.
      target = new URL(action, baseUrl);
    } catch {
      continue;
    }

    if (target.protocol !== "http:" && target.protocol !== "https:") {
      continue;
    }

    if (getRegistrableDomain(target.hostname) !== pageDomain) {
      hosts.add(target.hostname);
      if (hosts.size >= MAX_FORM_HOSTS) {
        break;
      }
    }
  }

  return [...hosts];
}

function countHiddenIframes(html: string): number {
  const iframePattern = /<iframe\b[^>]*>/gi;
  let count = 0;
  let match: RegExpExecArray | null;

  while ((match = iframePattern.exec(html)) !== null) {
    const tag = match[0];
    if (
      /display\s*:\s*none/i.test(tag) ||
      /visibility\s*:\s*hidden/i.test(tag) ||
      /\b(?:width|height)\s*=\s*["']?0(?:px)?["'\s>]/i.test(tag)
    ) {
      count += 1;
    }
  }

  return count;
}

const OBFUSCATION_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\beval\s*\(/, hint: "eval() call" },
  { pattern: /\bunescape\s*\(/, hint: "unescape() call" },
  { pattern: /\batob\s*\(/, hint: "atob() base64 decoding" },
  { pattern: /String\.fromCharCode/, hint: "String.fromCharCode decoding" },
  {
    pattern: /document\.write\s*\(\s*(?:unescape|atob|String\.fromCharCode)/,
    hint: "document.write of decoded content",
  },
  {
    pattern: /(?:\\x[0-9a-fA-F]{2}){40,}/,
    hint: "long hex-escaped string",
  },
  {
    pattern: /["'][A-Za-z0-9+/=]{500,}["']/,
    hint: "very long base64-like blob",
  },
];

function extractObfuscationHints(html: string): string[] {
  const hints: string[] = [];
  for (const { pattern, hint } of OBFUSCATION_PATTERNS) {
    if (pattern.test(html)) {
      hints.push(hint);
      if (hints.length >= MAX_HINTS) {
        break;
      }
    }
  }
  return hints;
}

function extractMetaRefreshTarget(
  html: string,
  baseUrl: string,
): string | null {
  const meta = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i.exec(
    html,
  );
  if (!meta) {
    return null;
  }

  const content = extractAttribute(meta[0], "content");
  const urlPart = content ? /url\s*=\s*['"]?([^'">\s]+)/i.exec(content) : null;
  if (!urlPart?.[1]) {
    return null;
  }

  try {
    const target = new URL(urlPart[1], baseUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return null;
    }
    return target.toString();
  } catch {
    return null;
  }
}

function extractAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function countMatches(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}
