"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  splitLinkAnatomy,
  type LinkAnatomy,
  type ParseHostname,
} from "@/lib/domain/link-anatomy";

/**
 * Whether a link's anatomy is known. "pending" while the parser loads,
 * "ready" once it has (the anatomy is final, null only for links that
 * aren't http(s)), "failed" when it could not load even after a retry: we
 * cannot tell whether the address imitates another site.
 */
export type LinkParserStatus = "pending" | "ready" | "failed";

/** One retry after a short pause covers a dropped request or a deploy race. */
const RETRY_DELAY_MS = 1_000;

// tldts carries the Public Suffix List (~40 KB gzipped). Load it only once
// a scan starts or a result shows, never with the initial page.
let parsePromise: Promise<ParseHostname> | null = null;
let loadedParse: ParseHostname | null = null;
let loadFailed = false;
const listeners = new Set<() => void>();

function setLoadState(failed: boolean) {
  loadFailed = failed;
  for (const listener of listeners) listener();
}

function importParser(): Promise<ParseHostname> {
  return import("tldts").then((module) => module.parse);
}

/**
 * Start loading the parser; safe to call repeatedly. A failed import is
 * tried once more after a short pause. If that fails too, the status is
 * "failed" and the promise is forgotten, so the next call (a new scan, the
 * link field gaining focus) tries again instead of reusing a dead one.
 * The status stays "failed" while it does: a shown "Unconfirmed" never
 * flickers back to a held band, and changes only if a load succeeds.
 */
export function preloadLinkParser(): Promise<ParseHostname> {
  if (!parsePromise) {
    parsePromise = importParser()
      .catch(
        () =>
          new Promise<ParseHostname>((resolve, reject) => {
            setTimeout(
              () => importParser().then(resolve, reject),
              RETRY_DELAY_MS,
            );
          }),
      )
      .then(
        (parse) => {
          loadedParse = parse;
          setLoadState(false);
          return parse;
        },
        (error: unknown) => {
          parsePromise = null;
          setLoadState(true);
          throw error;
        },
      );
  }
  return parsePromise;
}

/** Fire-and-forget preload that never raises an unhandled rejection. */
export function warmLinkParser(): void {
  preloadLinkParser().catch(() => {});
}

/**
 * The parser if it has loaded, else null (still loading, or failed). For
 * synchronous work over many links (history filtering, CSV export) on
 * screens whose rows have already loaded it.
 */
export function getLoadedLinkParser(): ParseHostname | null {
  return loadedParse;
}

/** The parser's status, for synchronous callers (history filtering). */
export function getLinkParserStatus(): LinkParserStatus {
  if (loadedParse) return "ready";
  return loadFailed ? "failed" : "pending";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The server never has the parser: every link starts pending. */
function getServerStatus(): LinkParserStatus {
  return "pending";
}

export interface LinkAnatomyState {
  /** Null unless `status` is "ready", and for links that aren't http(s). */
  anatomy: LinkAnatomy | null;
  /**
   * "ready" when `anatomy` is final. Anything waiting on it (a Safe
   * verdict's word, the verdict announcement) holds while "pending", and
   * says it couldn't check the address when "failed", never that the link
   * is not a look-alike.
   */
  status: LinkParserStatus;
}

/**
 * The link's anatomy once the parser has loaded; null until then, so
 * nothing ever shows a naive split that would put a look-alike host at
 * full emphasis.
 */
export function useLinkAnatomy(url: string | null): LinkAnatomyState {
  const status = useSyncExternalStore(
    subscribe,
    getLinkParserStatus,
    getServerStatus,
  );

  // A link starts the load if nothing has yet. After a failure, only a
  // deliberate step (a new scan, focusing the link field) tries again: a
  // history row mounting must not re-run it under a result on screen.
  useEffect(() => {
    if (url && !loadedParse && !loadFailed) warmLinkParser();
  }, [url]);

  return useMemo(
    () => ({
      anatomy:
        url && status === "ready" && loadedParse
          ? splitLinkAnatomy(loadedParse, url)
          : null,
      status,
    }),
    [url, status],
  );
}
