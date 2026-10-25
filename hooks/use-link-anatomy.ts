"use client";

import { useEffect, useMemo, useState } from "react";

import {
  splitLinkAnatomy,
  type LinkAnatomy,
  type ParseHostname,
} from "@/lib/domain/link-anatomy";

// tldts carries the Public Suffix List (~40 KB gzipped). Load it only once
// a scan starts or a result shows, never with the initial page.
let parsePromise: Promise<ParseHostname> | null = null;
let loadedParse: ParseHostname | null = null;

/**
 * Start loading the parser; safe to call repeatedly. A failed load (offline
 * after the page loaded, or a stale chunk after a deploy) is forgotten, so
 * the next call tries again instead of reusing a dead promise.
 */
export function preloadLinkParser(): Promise<ParseHostname> {
  parsePromise ??= import("tldts").then(
    (module) => {
      loadedParse = module.parse;
      return module.parse;
    },
    (error: unknown) => {
      parsePromise = null;
      throw error;
    },
  );
  return parsePromise;
}

/** Fire-and-forget preload that never raises an unhandled rejection. */
export function warmLinkParser(): void {
  preloadLinkParser().catch(() => {});
}

export interface LinkAnatomyState {
  /** Null until the parser loads, and for links that aren't http(s). */
  anatomy: LinkAnatomy | null;
  /**
   * True once the parser is available, or once loading it failed: either
   * way `anatomy` is final, so nothing waiting on it (the verdict
   * announcement) waits forever.
   */
  ready: boolean;
}

/**
 * The link's anatomy once the parser has loaded; null until then, so
 * nothing ever shows a naive split that would put a look-alike host at
 * full emphasis.
 */
export function useLinkAnatomy(url: string | null): LinkAnatomyState {
  const [parse, setParse] = useState<ParseHostname | null>(() => loadedParse);
  // The URL whose load failed: a new link tries the import again.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = url !== null && failedFor === url;

  useEffect(() => {
    if (!url || parse || failedFor === url) return;
    let live = true;
    preloadLinkParser().then(
      (loaded) => {
        if (live) setParse(() => loaded);
      },
      () => {
        if (live) setFailedFor(url);
      },
    );
    return () => {
      live = false;
    };
  }, [url, parse, failedFor]);

  return useMemo(
    () => ({
      anatomy: url && parse ? splitLinkAnatomy(parse, url) : null,
      ready: parse !== null || failed,
    }),
    [parse, url, failed],
  );
}
