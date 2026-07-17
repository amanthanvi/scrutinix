import type { ApiError } from "@/lib/domain/types";
import { sanitizeApiErrorResponse } from "@/lib/domain/runtime-safety";

/** Map a thrown stream/parse/network failure to a user-facing ApiError. */
export function streamFailureApiError(
  error: unknown,
  fallbackMessage: string,
): ApiError {
  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage;

  return sanitizeApiErrorResponse(null, message);
}
