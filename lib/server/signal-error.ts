import { PublicError } from "@/lib/domain/public-error";

/** Intentional skip whose message is safe to show (not an internal failure). */
export class SignalSkipError extends PublicError {
  constructor(message: string) {
    super("signal_skipped", message);
    this.name = "SignalSkipError";
  }
}

export function isSignalSkipError(error: unknown): error is SignalSkipError {
  return error instanceof SignalSkipError;
}

export function getErrorMessage(
  error: unknown,
  fallback = "Unknown signal error.",
) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallback;
}
