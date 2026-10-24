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
 * Set by `POST /share` on a genuine share-target launch, holding the exact
 * normalized link it redirects with. The page starts a scan only when this
 * cookie matches `?url=`; nothing a third-party page can send sets it, so a
 * plain `/?url=` link (or a crafted one) only prefills. The page clears it
 * as soon as the scan starts, so it is readable by script (no `HttpOnly`).
 */
export const SHARE_LAUNCH_COOKIE = "sx-share-launch";

/** How long a share-target launch may take to reach the page. */
export const SHARE_LAUNCH_MAX_AGE_SECONDS = 60;

/** The share-target fields, in the order a link is looked for in them. */
export interface SharedFields {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}

const LINK_PATTERN = /https?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?'"»”’]+$/;
const CLOSERS = { ")": "(", "]": "[", "}": "{" } as const;

/** A link as it ends inside prose: drop sentence punctuation and unpaired closers. */
function trimLinkEnd(link: string): string {
  let trimmed = link;
  for (;;) {
    const before = trimmed;
    trimmed = trimmed.replace(TRAILING_PUNCTUATION, "");
    const last = trimmed.at(-1) as keyof typeof CLOSERS | undefined;
    if (last && last in CLOSERS) {
      const opener = CLOSERS[last];
      const opens = trimmed.split(opener).length - 1;
      const closes = trimmed.split(last).length - 1;
      if (closes > opens) trimmed = trimmed.slice(0, -1);
    }
    if (trimmed === before) return trimmed;
  }
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
  for (const value of [fields.url, fields.text, fields.title]) {
    const match = value?.match(LINK_PATTERN);
    if (!match) continue;
    const normalized = normalizeUrlInput(trimLinkEnd(match[0]));
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
 * What the home page does with `?url=` and the launch cookie: the link to
 * prefill (null when absent or not checkable, which says nothing), and
 * whether to start scanning it.
 */
export function resolveLaunch(
  param: string | null | undefined,
  launchCookie: string | null | undefined,
): { url: string; autoScan: boolean } | null {
  if (!param) return null;
  const normalized = normalizeUrlInput(param);
  if (!normalized.ok) return null;
  const url = normalized.value.normalizedUrl;
  return { url, autoScan: launchCookie === url };
}
