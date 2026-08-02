export type LimitedBodyRead =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "unreadable" };

/** Reads a web Request body without ever retaining more than maxBytes. */
export async function readRequestTextWithLimit(
  request: Request,
  maxBytes: number,
): Promise<LimitedBodyRead> {
  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        // A cloned Request tees the stream; awaiting cancellation can block
        // until the untouched downstream branch closes. Stop this reader
        // immediately and let cancellation settle best-effort.
        void reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    reader.releaseLock();
  }
}
