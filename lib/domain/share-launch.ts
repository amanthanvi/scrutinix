import { normalizeUrlInput } from "@/lib/domain/url";

/**
 * Ways a link reaches Scrutinix from outside the page: the installed app's
 * share target (`POST /share`, `app/share/route.ts`) and plain `/?url=`
 * links (bookmarklets, the iOS Shortcut, anyone's page). Every one of them
 * does the same thing: it fills in the Single field and waits for the
 * person to tap Analyze. Nothing starts a scan on its own.
 */

/** The query parameter that prefills the Single field. */
export const PREFILL_PARAM = "url";

/** The share-target fields, in the order a link is looked for in them. */
export interface SharedFields {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}

/** A link written into prose. `'` is a valid URL character, so it stays in. */
const LINK_PATTERN = /https?:\/\/[^\s<>"`]+/i;
/** A whole field that is nothing but one link. */
const STANDALONE_LINK = /^https?:\/\/\S+$/i;
const TRAILING_PUNCTUATION = new Set(".,;:!?'\"»”’");
type Closer = ")" | "]" | "}";
const OPENERS: Record<string, Closer> = { "(": ")", "[": "]", "{": "}" };

function isCloser(char: string | undefined): char is Closer {
  return char === ")" || char === "]" || char === "}";
}

/**
 * A link as it ends inside prose: drop sentence punctuation and unpaired
 * closers (`(https://a.example/x)` loses its `)`, `…/Mercury_(planet)`
 * keeps it). Only for links found in prose: a link that is the whole
 * field is taken as written, since `!`, `'`, or `)` may end a real path.
 * Linear: the closers each kind has spare are counted once, and trimming
 * one spends one (a link is up to 16 KiB of shared text, all of it `)`).
 */
function trimLinkEnd(link: string): string {
  const unpaired: Record<Closer, number> = { ")": 0, "]": 0, "}": 0 };
  for (const char of link) {
    if (isCloser(char)) unpaired[char] += 1;
    else if (char in OPENERS) unpaired[OPENERS[char]!] -= 1;
  }
  let end = link.length;
  while (end > 0) {
    const last = link[end - 1]!;
    if (TRAILING_PUNCTUATION.has(last)) {
      end -= 1;
    } else if (isCloser(last) && unpaired[last] > 0) {
      unpaired[last] -= 1;
      end -= 1;
    } else {
      break;
    }
  }
  return link.slice(0, end);
}

/**
 * The link one share-target field holds, as written, or null when it holds
 * none. `url` is a structured field: its whole value is the link. `text`
 * and `title` are prose unless they are one link and nothing else, which
 * is how Android often shares a page.
 */
function linkInField(
  value: string | null | undefined,
  structured: boolean,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (structured) return /^https?:/i.test(trimmed) ? trimmed : null;
  if (STANDALONE_LINK.test(trimmed)) return trimmed;
  const match = trimmed.match(LINK_PATTERN);
  return match ? trimLinkEnd(match[0]) : null;
}

/**
 * The first http(s) link in what another app shared, normalized centrally
 * (`normalizeUrlInput`), or null. Android usually leaves `url` empty and
 * puts the link inside `text` ("Look at this https://…"), occasionally in
 * `title`. A first link that can't be checked (a private or local host)
 * yields null rather than a later one, so the person never sees a link
 * they didn't mean.
 */
export function extractSharedLink(fields: SharedFields): string | null {
  for (const [value, structured] of [
    [fields.url, true],
    [fields.text, false],
    [fields.title, false],
  ] as const) {
    const link = linkInField(value, structured);
    if (!link) continue;
    const normalized = normalizeUrlInput(link);
    return normalized.ok ? normalized.value.normalizedUrl : null;
  }
  return null;
}

/**
 * The link `?url=` prefills, normalized, or null when it is absent or not
 * checkable (which says nothing). It never starts a scan.
 */
export function resolvePrefill(
  param: string | null | undefined,
): string | null {
  if (!param) return null;
  const normalized = normalizeUrlInput(param);
  return normalized.ok ? normalized.value.normalizedUrl : null;
}
