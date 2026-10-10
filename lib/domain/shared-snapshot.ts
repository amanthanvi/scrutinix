import { z } from "zod";

import {
  sharedSnapshotSchema,
  type AnalysisResult,
  type SharedSnapshot,
  type Verdict,
} from "@/lib/domain/schemas";
import { normalizeUrlInput } from "@/lib/domain/url";

/**
 * `?shared=` links carry an unsigned snapshot: base64 JSON that anyone can
 * write. Decoding never turns one into a result. The page presents it as an
 * unverified claim, and only a fresh scan states a verdict. Every field is
 * attacker-controlled, so decoding also narrows what can reach the page:
 *
 * - the URL must pass the central normalizer and is shown normalized, so the
 *   page displays exactly what a fresh scan would check;
 * - `capturedAt` survives only as an ISO timestamp, never as free text;
 * - the summary loses control and invisible formatting characters (bidi
 *   overrides, zero-width characters) and is capped for display.
 */

/** Real summaries are one short sentence; anything longer is cut here. */
export const SHARED_SUMMARY_MAX_LENGTH = 160;

/** What a `?shared=` link may put on the page: a claim, never a result. */
export interface UnverifiedSnapshot {
  verdict: Verdict;
  url: string;
  summary: string | null;
  capturedAt: string | null;
}

const isoTimestampSchema = z.iso.datetime({ offset: true });

export function encodeSharedSnapshot(result: AnalysisResult): string {
  const snapshot: SharedSnapshot = {
    verdict: result.verdict,
    url: result.url,
    summary: toDisplayText(result.threatInfo?.summary ?? "") ?? "",
    capturedAt: result.metadata?.completedAt ?? new Date().toISOString(),
  };
  // Percent-encoding first keeps non-Latin-1 text inside btoa's range.
  return btoa(encodeURIComponent(JSON.stringify(snapshot)));
}

export function decodeSharedSnapshot(
  payload: string,
): UnverifiedSnapshot | null {
  const snapshot = parseSnapshotPayload(payload);
  if (!snapshot) return null;

  const url = normalizeUrlInput(snapshot.url);
  if (!url.ok) return null;

  const capturedAt = isoTimestampSchema.safeParse(snapshot.capturedAt);

  return {
    verdict: snapshot.verdict,
    url: url.value.normalizedUrl,
    summary: toDisplayText(snapshot.summary),
    capturedAt: capturedAt.success ? capturedAt.data : null,
  };
}

function parseSnapshotPayload(payload: string): SharedSnapshot | null {
  // Current links percent-encode the JSON before base64; the first links
  // base64-encoded the raw JSON. Both stay readable.
  const decoders = [(text: string) => decodeURIComponent(text), String];
  for (const decode of decoders) {
    try {
      const parsed = sharedSnapshotSchema.safeParse(
        JSON.parse(decode(atob(payload))),
      );
      if (parsed.success) return parsed.data;
    } catch {
      // Not this encoding; try the next one.
    }
  }
  return null;
}

function toDisplayText(value: string): string | null {
  const text = value
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}\s]+/gu, " ")
    .trim();
  if (!text) return null;

  const characters = Array.from(text);
  if (characters.length <= SHARED_SUMMARY_MAX_LENGTH) return text;
  return `${characters
    .slice(0, SHARED_SUMMARY_MAX_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}
