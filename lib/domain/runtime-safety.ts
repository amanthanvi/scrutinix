import {
  analyzeEventSchema,
  batchEventSchema,
  createAnalysisResultSchema,
  createApiErrorSchema,
  type AnalysisResult,
  type AnalyzeEvent,
  type ApiError,
  type BatchEvent,
  type HistoryEntry,
} from "@/lib/domain/schemas";

/**
 * Boundary sanitizers for data arriving from the NDJSON stream, the shared
 * result cache, or IndexedDB history. All shape knowledge lives in
 * lib/domain/schemas.ts; these wrappers only choose fallbacks and convert
 * parse failures into nulls.
 */

export function sanitizeAnalysisResult(
  value: unknown,
  fallbackTimestamp = new Date().toISOString(),
): AnalysisResult | null {
  const result = createAnalysisResultSchema(fallbackTimestamp).safeParse(value);
  return result.success ? result.data : null;
}

export function sanitizeHistoryEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const savedAt = typeof record.savedAt === "string" ? record.savedAt : "";
  const fallbackTimestamp = savedAt || new Date().toISOString();
  const result = sanitizeAnalysisResult(record, fallbackTimestamp);
  if (!result) {
    return null;
  }

  return {
    ...result,
    savedAt: savedAt || result.metadata.completedAt || fallbackTimestamp,
  };
}

export function sanitizeApiError(
  value: unknown,
  fallbackMessage: string,
): ApiError {
  const result = createApiErrorSchema(fallbackMessage).safeParse(value);
  return result.success
    ? result.data
    : {
        code: "unexpected_error",
        message: fallbackMessage,
        retryable: false,
      };
}

export function sanitizeApiErrorResponse(
  value: unknown,
  fallbackMessage: string,
): ApiError {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return sanitizeApiError(record?.error ?? value, fallbackMessage);
}

export function sanitizeAnalyzeEvent(value: unknown): AnalyzeEvent | null {
  const result = analyzeEventSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function sanitizeBatchEvent(value: unknown): BatchEvent | null {
  const result = batchEventSchema.safeParse(value);
  return result.success ? result.data : null;
}
