import {
  isPublicError,
  unexpectedClientMessage,
} from "@/lib/domain/public-error";
import { logError } from "@/lib/server/logger";

// file:// stack frames stay readable. Every other scheme (https, redis, …) is a URL.
const URL_IN_TEXT = /\b(?!file:\/\/)[a-z][a-z0-9+.-]*:\/\/[^\s"'<>\\]+/gi;

export interface ClientErrorView {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ClientErrorOptions {
  correlationId: string;
  /** User-facing summary. Unexpected failures append `Reference: <id>.` */
  summary: string;
  logEvent: string;
  /** Code used when the thrown value is not a PublicError. */
  code?: string;
  retryable?: boolean;
  /**
   * Substrings that must not appear in logs. Pass the scanned URL and
   * hostname; scheme-bearing URLs are stripped even when omitted.
   */
  redact?: readonly string[];
  logFields?: Record<string, unknown>;
}

/**
 * Replace scanned URLs, hostnames, and any scheme-bearing URL (Redis DSNs,
 * request URLs embedded in parser errors) before a string is logged.
 */
export function redactForLogs(value: string, secrets: readonly string[] = []) {
  let redacted = value;
  const needles = [
    ...new Set(
      secrets
        .map((secret) => secret.trim())
        .filter((secret) => secret.length >= 4),
    ),
  ].sort((left, right) => right.length - left.length);

  for (const needle of needles) {
    redacted = redacted.split(needle).join("[redacted]");
  }

  return redacted.replace(URL_IN_TEXT, "[url]");
}

/**
 * Map a thrown value to the error a client may see.
 *
 * PublicError messages pass through unchanged. Abort wrappers around a
 * PublicError (Node fetch timeout) unwrap one level. Anything else is logged
 * in full and replaced with a generic summary plus the correlation id.
 */
export function exposeClientError(
  error: unknown,
  options: ClientErrorOptions,
): ClientErrorView {
  const published = publishedError(error);
  if (published) {
    if (published.cause !== undefined) {
      logInternalFailure(options.logEvent, published.cause, {
        ...options,
        logFields: {
          ...options.logFields,
          publicCode: published.code,
        },
      });
    }

    return {
      code: published.code,
      message: published.message,
      retryable: published.retryable,
    };
  }

  logInternalFailure(options.logEvent, error, options);

  return {
    code: options.code ?? "internal_error",
    message: unexpectedClientMessage(options.summary, options.correlationId),
    retryable: options.retryable ?? true,
  };
}

export function logInternalFailure(
  event: string,
  error: unknown,
  options: Pick<ClientErrorOptions, "correlationId" | "redact" | "logFields">,
) {
  const redact = options.redact ?? [];
  const described = describeThrown(error);
  const cause =
    error instanceof Error && error.cause !== undefined
      ? describeThrown(error.cause)
      : null;

  logError(event, {
    correlationId: options.correlationId,
    ...options.logFields,
    errorName: described.name,
    errorMessage: redactForLogs(described.message, redact),
    ...(described.stack
      ? { errorStack: redactForLogs(described.stack, redact) }
      : {}),
    ...(cause
      ? {
          causeName: cause.name,
          causeMessage: redactForLogs(cause.message, redact),
        }
      : {}),
  });
}

function publishedError(error: unknown) {
  if (isPublicError(error)) {
    return error;
  }

  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError") &&
    isPublicError(error.cause)
  ) {
    return error.cause;
  }

  return null;
}

function describeThrown(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return { name: "StringError", message: error };
  }

  return {
    name: "UnknownError",
    message: "A non-error value was thrown.",
  };
}
