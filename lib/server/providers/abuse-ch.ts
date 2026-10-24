/**
 * abuse.ch timestamps (URLhaus `date_added`, ThreatFox `first_seen`) read
 * "2026-10-23 07:12:45 UTC". Returns an ISO string, or undefined for
 * anything else so a malformed date never reaches a result.
 */
export function parseAbuseChTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?: ?UTC|Z)?$/.exec(
      value.trim(),
    );
  if (!match) {
    return undefined;
  }

  const time = Date.parse(`${match[1]}T${match[2]}Z`);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
