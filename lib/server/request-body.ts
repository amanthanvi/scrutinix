export async function readJsonBody<T = unknown>(
  request: Request,
): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The request body, or null when it is longer than `maxBytes`. Bytes are
 * counted as they arrive, so a `Content-Length` that understates the body
 * (or a body sent without one) never gets read past the limit: the stream
 * is cancelled at the first chunk that crosses it. A declared length over
 * the limit is refused before anything is read.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= maxBytes)) return null;
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
