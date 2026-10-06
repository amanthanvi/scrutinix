import {
  MISSING_SIGNAL_DATA,
  sharedSnapshotSchema,
  signalNames,
  type AnalysisResult,
  type SharedSnapshot,
  type SignalName,
  type SignalResults,
  type SignalSignature,
} from "@/lib/domain/schemas";
import { getSignalSeverity, type Severity } from "@/lib/domain/signal-severity";

/**
 * The eight-cell strip's data: one severity per signal in fixed
 * `signalNames` order. The same signature drives the live strip, the
 * history and batch glyphs, shared snapshots, and their preview images.
 * Pure and isomorphic: no React, no Public Suffix List.
 */

/**
 * Plain words for each step of the ramp: the single source for accessible
 * names ("VirusTotal: flagged the link"), cell titles, and the /about
 * legend. "Couldn't run" never reads as a bad certificate the way "failed"
 * would.
 */
export const severityWords: Record<Severity, string> = {
  malicious: "flagged the link",
  suspicious: "found a warning sign",
  error: "couldn't run",
  neutral: "gave a partial answer",
  clear: "found nothing",
  skipped: "didn't apply",
  pending: "still running",
};

export function getSignalSignature(
  signals: SignalResults,
  scoredSignals: readonly SignalName[] | ReadonlySet<SignalName> = [],
): SignalSignature {
  const scored: ReadonlySet<SignalName> = new Set(scoredSignals);
  return signalNames.map((name) => {
    const signal = signals[name];
    return getSignalSeverity(
      signal.status,
      signal.data,
      name,
      scored.has(name),
    );
  });
}

/**
 * Saved before signals were stored: the sanitizer fills every missing
 * check as an error carrying its own "missing" message. Such an entry has
 * no real signature to draw. A real scan whose checks all failed (an
 * Error verdict) carries the providers' messages instead, so it still
 * draws eight failed cells.
 */
export function isLegacySignalRecord(signals: SignalResults): boolean {
  return signalNames.every(
    (name) =>
      signals[name].status === "error" &&
      signals[name].data === null &&
      signals[name].error === MISSING_SIGNAL_DATA,
  );
}

/** The signature of a stored result, or null for legacy records. */
export function getResultSignature(
  result: Pick<AnalysisResult, "signals" | "threatInfo">,
): SignalSignature | null {
  if (isLegacySignalRecord(result.signals)) {
    return null;
  }
  return getSignalSignature(
    result.signals,
    result.threatInfo?.scoredSignals ?? [],
  );
}

/** What a Share link embeds: a point-in-time snapshot, never the payloads. */
export function buildSharedSnapshot(
  result: AnalysisResult,
  capturedAt = result.metadata?.completedAt || new Date().toISOString(),
): SharedSnapshot {
  return {
    verdict: result.verdict,
    url: result.url,
    summary: (result.threatInfo?.summary ?? "").slice(0, 600),
    capturedAt,
    signature: getResultSignature(result) ?? undefined,
  };
}

/** The `?shared=` value: base64 of the URI-encoded JSON snapshot. */
export function encodeSharedSnapshot(snapshot: SharedSnapshot): string {
  return btoa(encodeURIComponent(JSON.stringify(snapshot)));
}

/**
 * Parse a `?shared=` value. Accepts both encodings that have shipped
 * (URI-encoded and raw JSON inside base64) and validates the result, so a
 * tampered or truncated link yields null rather than a broken view.
 */
export function decodeSharedSnapshot(
  payload: string | null | undefined,
): SharedSnapshot | null {
  if (!payload || payload.length > 12_000) {
    return null;
  }

  const parse = (text: string): SharedSnapshot | null => {
    const parsed = sharedSnapshotSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  };

  try {
    const decoded = atob(payload);
    try {
      return parse(decodeURIComponent(decoded));
    } catch {
      return parse(decoded);
    }
  } catch {
    return null;
  }
}
