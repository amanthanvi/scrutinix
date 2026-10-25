/**
 * Small English helpers for user-facing copy. Every count that reaches the
 * UI goes through `countOf` so "1 sources" can never ship again.
 */

/** "1 engine", "7 engines", "2 matches" (pass the irregular plural). */
export function countOf(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/** "A", "A and B", "A, B, and C". */
export function formatList(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * A duration in days worded the way people say it: "12 days", "about 3
 * months", "about 8 years". Exact day counts past two months read as noise.
 */
export function formatAge(days: number): string {
  const whole = Math.max(0, Math.floor(days));
  if (whole === 0) {
    return "less than a day";
  }
  if (whole < 60) {
    return countOf(whole, "day");
  }
  if (whole < 730) {
    return `about ${countOf(Math.round(whole / 30.44), "month")}`;
  }
  return `about ${countOf(Math.floor(whole / 365), "year")}`;
}

const HOUR_MS = 1000 * 60 * 60;

/**
 * Elapsed time worded to follow "listed" or "issued" and precede "ago":
 * "less than an hour", "6 hours", "3 days", "about 2 months". Hours give
 * way to `formatAge` from two days on; a negative span (clock skew) reads
 * as "less than an hour".
 */
export function formatElapsed(milliseconds: number): string {
  const hours = Math.floor(Math.max(0, milliseconds) / HOUR_MS);
  if (hours < 1) {
    return "less than an hour";
  }
  if (hours < 48) {
    return countOf(hours, "hour");
  }
  return formatAge(hours / 24);
}
