import { PublicError } from "@/lib/domain/public-error";

/** Outbound identity; rdap.org rejects requests with no or a generic UA (403). */
export const SCRUTINIX_USER_AGENT = "scrutinix/3.0";

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new PublicError("lookup_failed", `Timed out after ${timeoutMs}ms.`),
    );
  }, timeoutMs);

  // Combine the caller's signal with the timeout instead of letting one
  // silently disable the other.
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  try {
    return await fetch(input, {
      ...init,
      signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `label` is client-visible when the timeout wins. Pass a fixed phrase,
 * never a URL, hostname, or other request data.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
) {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new PublicError(
            "lookup_failed",
            `${label} timed out after ${timeoutMs}ms.`,
          ),
        ),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/** Sleep that rejects immediately when the signal aborts, so retry loops stop. */
export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(abortReason(signal));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal?: AbortSignal): Error {
  const reason = signal?.reason as unknown;
  return reason instanceof Error
    ? reason
    : new Error("The operation was aborted.");
}
