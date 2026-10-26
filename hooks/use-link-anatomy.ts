"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type * as LinkParserModule from "@/lib/client/link-parser";
import type { LinkAnatomy } from "@/lib/domain/link-anatomy";

/**
 * The loaded parser chunk: tldts' `parse` and the anatomy and
 * expected-site logic that takes it (`lib/client/link-parser.ts`).
 */
export type LinkParser = typeof LinkParserModule;

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
let parsePromise: Promise<LinkParser> | null = null;
let loadedParser: LinkParser | null = null;
let loadFailed = false;
const listeners = new Set<() => void>();

function setLoadState(failed: boolean) {
  loadFailed = failed;
  for (const listener of listeners) listener();
}

function importParser(): Promise<LinkParser> {
  return import("@/lib/client/link-parser");
}

/**
 * Start loading the parser; safe to call repeatedly. A failed import is
 * tried once more after a short pause. If that fails too, the status is
 * "failed" and the promise is forgotten, so the next call (a new scan, the
 * link field gaining focus) tries again instead of reusing a dead one.
 * The status stays "failed" while it does: a shown "Unconfirmed" never
 * flickers back to a held band, and changes only if a load succeeds.
 */
export function preloadLinkParser(): Promise<LinkParser> {
  if (!parsePromise) {
    parsePromise = importParser()
      .catch(
        () =>
          new Promise<LinkParser>((resolve, reject) => {
            setTimeout(
              () => importParser().then(resolve, reject),
              RETRY_DELAY_MS,
            );
          }),
      )
      .then(
        (parser) => {
          loadedParser = parser;
          setLoadState(false);
          return parser;
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
 * The parser for a one-off task over many links (CSV export): waits for a
 * load in progress, tries again after a failure, and gives null only if it
 * still can't load, so the caller says the address wasn't checked.
 */
export function loadLinkParser(): Promise<LinkParser | null> {
  return preloadLinkParser().catch(() => null);
}

/**
 * The parser if it has loaded, else null (still loading, or failed). For
 * synchronous work over many links (history filtering) that re-runs when
 * `useLinkParserStatus` changes.
 */
export function getLoadedLinkParser(): LinkParser | null {
  return loadedParser;
}

/** The parser's status right now; components use `useLinkParserStatus`. */
export function getLinkParserStatus(): LinkParserStatus {
  if (loadedParser) return "ready";
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

/**
 * The parser's status, re-rendering when it loads or fails: anything that
 * reads `getLoadedLinkParser()` while rendering (history search) must
 * depend on it, or it keeps what it computed while the parser was pending.
 */
export function useLinkParserStatus(): LinkParserStatus {
  return useSyncExternalStore(subscribe, getLinkParserStatus, getServerStatus);
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
  const status = useLinkParserStatus();

  // A link starts the load if nothing has yet. After a failure, only a
  // deliberate step (a new scan, focusing the link field) tries again: a
  // history row mounting must not re-run it under a result on screen.
  useEffect(() => {
    if (url && !loadedParser && !loadFailed) warmLinkParser();
  }, [url]);

  return useMemo(
    () => ({
      anatomy:
        url && status === "ready" && loadedParser
          ? loadedParser.splitLinkAnatomy(loadedParser.parse, url)
          : null,
      status,
    }),
    [url, status],
  );
}
