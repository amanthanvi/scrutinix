"use client";

import { useState, type ComponentType } from "react";

import { Button } from "@/components/ui/button";

/**
 * A loader for `next/dynamic` whose failure stays in its own place, as the
 * lazy toaster's does. An optional chunk can fail to arrive (a dropped
 * request, a deploy between page load and click); thrown, it would reach
 * the boundary shared by the scan form and results and hide both. Instead
 * it renders `failure` with "Try again", which loads it once more.
 */
export function retryableChunk<P extends object>(
  load: () => Promise<ComponentType<P>>,
  failure: string,
): () => Promise<ComponentType<P>> {
  let loaded: ComponentType<P> | null = null;
  const attempt = () =>
    load().then((component) => {
      loaded = component;
      return component;
    });

  function Unavailable(props: P) {
    // A retry that worked before this place remounted (a tab switch) holds.
    const [Loaded, setLoaded] = useState(() => loaded);
    const [retrying, setRetrying] = useState(false);
    if (Loaded) return <Loaded {...props} />;

    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-meta text-[var(--sx-danger-fg)]">
          {failure}
        </p>
        <Button
          type="button"
          variant="outline"
          aria-busy={retrying || undefined}
          onClick={() => {
            if (retrying) return;
            setRetrying(true);
            attempt().then(
              (component) => setLoaded(() => component),
              () => setRetrying(false),
            );
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return () => attempt().catch(() => Unavailable);
}
