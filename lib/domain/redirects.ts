/** HTTP statuses that redirect; any other response's Location is ignored. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * A hop that redirects onto plain HTTP. A relative Location ("/b") is
 * resolved against the hop it came from, so staying on HTTP counts the same
 * whether the server writes the full address or not; a response that
 * doesn't redirect (a 200 that happens to carry a Location) never counts.
 * Client-safe: the verdict engine scores it and the Summary explains it.
 */
export function redirectsOverHttp(hop: {
  url: string;
  status: number;
  location?: string;
}): boolean {
  if (!hop.location || !REDIRECT_STATUSES.has(hop.status)) return false;
  try {
    return new URL(hop.location, hop.url || undefined).protocol === "http:";
  } catch {
    return false;
  }
}
