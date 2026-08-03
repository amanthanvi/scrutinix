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
  const formFindings = extractFormFindings(html, finalUrl);

  return {
    title: extractTitle(html),
    ...formFindings,
    passwordInputCount: countMatches(
      html,
      /<input\b[^>]*type\s*=\s*["']?password/gi,
    ),
    iframeCount: countMatches(html, /<iframe\b/gi),
    hiddenIframeCount: countHiddenIframes(html),
    obfuscationHints: extractObfuscationHints(html),
    metaRefreshTarget: extractMetaRefreshTarget(html, finalUrl),
  };
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) {
    return null;
  }

  const title = match[1].replace(/\s+/g, " ").trim();
  return title ? title.slice(0, MAX_TITLE_LENGTH) : null;
}

function extractFormFindings(
  html: string,
  finalUrl: string,
): Pick<
  PageContentFindings,
  "crossOriginFormHosts" | "crossOriginPasswordFormHosts"
> {
  let pageUrl: URL;
  let pageDomain: string;
  try {
    pageUrl = new URL(finalUrl);
    pageDomain = getRegistrableDomain(pageUrl.hostname);
  } catch {
    return {
      crossOriginFormHosts: [],
      crossOriginPasswordFormHosts: [],
    };
  }

  const documentBaseUrl = extractDocumentBaseUrl(html, pageUrl);
  const hosts = new Set<string>();
  const passwordHosts = new Set<string>();
  const passwordInputs = extractPasswordInputs(html);
  const formPattern = /<form\b[^>]*>/gi;
  let form: RegExpExecArray | null;

  while ((form = formPattern.exec(html)) !== null) {
    const action = extractAttribute(form[0], "action");
    if (!action) {
      continue;
    }

    let target: URL;
    try {
      target = new URL(action, documentBaseUrl);
    } catch {
      continue;
    }

    if (target.protocol !== "http:" && target.protocol !== "https:") {
      continue;
    }

    if (getRegistrableDomain(target.hostname) !== pageDomain) {
      if (hosts.size < MAX_FORM_HOSTS) {
        hosts.add(target.hostname);
      }
      if (
        passwordHosts.size < MAX_FORM_HOSTS &&
        formOwnsPasswordInput(html, form, passwordInputs)
      ) {
        passwordHosts.add(target.hostname);
      }
    }
  }

  return {
    crossOriginFormHosts: [...hosts],
    crossOriginPasswordFormHosts: [...passwordHosts],
  };
}

interface PasswordInput {
  index: number;
  ownerId: string | null;
}

function extractPasswordInputs(html: string): PasswordInput[] {
  const inputs: PasswordInput[] = [];
  const inputPattern = /<input\b[^>]*>/gi;
  let input: RegExpExecArray | null;

  while ((input = inputPattern.exec(html)) !== null) {
    if (extractAttribute(input[0], "type")?.toLowerCase() === "password") {
      inputs.push({
        index: input.index,
        ownerId: extractAttribute(input[0], "form"),
      });
    }
  }

  return inputs;
}

function formOwnsPasswordInput(
  html: string,
  form: RegExpExecArray,
  passwordInputs: PasswordInput[],
): boolean {
  const formId = extractAttribute(form[0], "id");
  const contentStart = form.index + form[0].length;
  const closingFormPattern = /<\/form\s*>/gi;
  closingFormPattern.lastIndex = contentStart;
  const closingForm = closingFormPattern.exec(html);
  const contentEnd = closingForm?.index ?? html.length;

  return passwordInputs.some((input) => {
    if (input.ownerId !== null) {
      return Boolean(formId) && input.ownerId === formId;
    }
    return input.index >= contentStart && input.index < contentEnd;
  });
}

function extractDocumentBaseUrl(html: string, fallbackUrl: URL): URL {
  const basePattern = /<base\b[^>]*>/gi;
  let base: RegExpExecArray | null;

  while ((base = basePattern.exec(html)) !== null) {
    const href = extractAttribute(base[0], "href");
    if (href === null) {
      continue;
    }

    try {
      const baseUrl = new URL(href, fallbackUrl);
      return baseUrl.protocol === "data:" || baseUrl.protocol === "javascript:"
        ? fallbackUrl
        : baseUrl;
    } catch {
      return fallbackUrl;
    }
  }

  return fallbackUrl;
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
  finalUrl: string,
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
    const pageUrl = new URL(finalUrl);
    const documentBaseUrl = extractDocumentBaseUrl(html, pageUrl);
    const target = new URL(urlPart[1], documentBaseUrl);
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
