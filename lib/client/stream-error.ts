import { isPublicError } from "@/lib/domain/public-error";
import { sanitizeApiErrorResponse } from "@/lib/domain/runtime-safety";
import type { ApiError } from "@/lib/domain/types";

/**
 * Map a client-side stream failure to a user-facing ApiError.
 * Only PublicError messages are shown; other exception text stays local.
 */
export function streamFailureApiError(
  error: unknown,
  fallbackMessage: string,
): ApiError {
  if (isPublicError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return sanitizeApiErrorResponse(null, fallbackMessage);
}
