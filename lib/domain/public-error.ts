/**
 * The only exception type whose message may be shown to a client.
 *
 * Validation failures, missing provider configuration, and other copy we
 * wrote ourselves are thrown as PublicError. Every other thrown value is an
 * internal failure: callers log it (with URL redaction) and return a generic
 * summary plus a correlation id. Do not decide this by matching message text.
 *
 * The brand is a string so the check still works if the class is loaded
 * twice (test module resets, duplicate server chunks). It is not a message
 * allowlist.
 */
const PUBLIC_ERROR_BRAND = "scrutinix.public-error";

export class PublicError extends Error {
  readonly brand = PUBLIC_ERROR_BRAND;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "PublicError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export function isPublicError(error: unknown): error is PublicError {
  if (error instanceof PublicError) {
    return true;
  }

  return (
    error instanceof Error &&
    "brand" in error &&
    error.brand === PUBLIC_ERROR_BRAND &&
    "code" in error &&
    typeof error.code === "string" &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  );
}

/** Generic client copy for an unexpected failure, tied to a server log line. */
export function unexpectedClientMessage(
  summary: string,
  correlationId: string,
) {
  return `${summary} Reference: ${correlationId}.`;
}
