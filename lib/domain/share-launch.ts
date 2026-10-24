import { normalizeUrlInput } from "@/lib/domain/url";

/**
 * Ways a link reaches Scrutinix from outside the page: the installed app's
 * share target (`POST /share`, `app/share/route.ts`) and plain `/?url=`
 * links (bookmarklets, the iOS Shortcut, anyone's page). Both prefill the
 * Single field; only a genuine share-target launch starts the scan.
 */

/** The query parameter that prefills the Single field. */
export const PREFILL_PARAM = "url";

/**
 * Set by `POST /share` on a genuine share-target launch, holding a
 * one-use grant bound to the exact normalized link it redirects with
 * (`lib/server/share-launch-grant.ts`). Nothing a third-party page can
 * send sets it, so a plain `/?url=` link (or a crafted one) only prefills.
 * It is spent on the server: `proxy.ts` takes it off every request for
 * `/`, hands it to the page in `SHARE_LAUNCH_HEADER`, and clears it in
 * that same response, whether or not it matches; the page starts a scan
 * only when the grant names `?url=`, and the browser only once per grant
 * id (`lib/client/launch-claims.ts`). No script reads it (`HttpOnly`).
 */
export const SHARE_LAUNCH_COOKIE = "sx-share-launch";

/**
 * The request header `proxy.ts` hands the launch grant to the page in. The
 * proxy removes any copy a request arrives with; a navigation can't add
 * one, so a page can't make another site's visitor send it.
 */
export const SHARE_LAUNCH_HEADER = "x-sx-share-launch";

/** How long a share-target launch may take to reach the page. */
export const SHARE_LAUNCH_MAX_AGE_SECONDS = 60;

/** Set and cleared with the same attributes, so clearing always matches. */
export const SHARE_LAUNCH_COOKIE_ATTRIBUTES = {
  path: "/",
  sameSite: "strict",
  httpOnly: true,
} as const;

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
 * Whether a request to the share target is the browser launching it from
 * the system share sheet. The share target is a POST navigation the user
 * agent builds itself (W3C Web Share Target, "Launching the web share
 * target"; Chromium loads it as a browser-initiated HTTP POST), so it has
 * no initiating site and carries `Sec-Fetch-Site: none` (W3C Fetch
 * Metadata §2.3). A form another page submits is `cross-site` (or
 * `same-site`); a link tapped in another app opens as a GET. A missing
 * header (an older browser) fails closed: prefill only.
 */
export function isShareTargetLaunch(method: string, headers: Headers): boolean {
  return (
    method.toUpperCase() === "POST" && headers.get("sec-fetch-site") === "none"
  );
}

/**
 * The link `?url=` prefills, normalized, or null when it is absent or not
 * checkable (which says nothing). Whether it also scans is the launch
 * grant's to say (`launchGrantId`).
 */
export function resolvePrefill(
  param: string | null | undefined,
): string | null {
  if (!param) return null;
  const normalized = normalizeUrlInput(param);
  return normalized.ok ? normalized.value.normalizedUrl : null;
}
