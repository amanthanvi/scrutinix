const SHARED_PARAM = "shared";

const listeners = new Set<() => void>();

/** The raw `?shared=` payload, or null. Browser-only: reads `window.location`. */
export function readSharedPayload(): string | null {
  return new URLSearchParams(window.location.search).get(SHARED_PARAM);
}

export function subscribeToSharedPayload(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Removes `?shared=` from the address bar once a real scan has superseded the
 * snapshot, so a reload or a copied address no longer reopens the claim. It
 * replaces the current history entry and keeps every other param and the hash.
 */
export function clearSharedPayload(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SHARED_PARAM)) return;

  url.searchParams.delete(SHARED_PARAM);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  listeners.forEach((listener) => listener());
}
