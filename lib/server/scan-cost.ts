import { readRequestTextWithLimit } from "@/lib/domain/request-body";
import { MAX_BATCH_SIZE, MAX_SCAN_BODY_BYTES } from "@/lib/domain/scan-limits";

/**
 * A batch of N URLs consumes N rate-limit tokens. Oversized bodies are charged
 * the maximum without being buffered; malformed bodies cost one token and are
 * rejected later by the route parser.
 */
export async function getScanRequestCost(
  request: Request,
  pathname: string,
): Promise<number> {
  if (!pathname.startsWith("/api/analyze/batch")) {
    return 1;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SCAN_BODY_BYTES) {
    return MAX_BATCH_SIZE;
  }

  const body = await readRequestTextWithLimit(
    request.clone(),
    MAX_SCAN_BODY_BYTES,
  );
  if (!body.ok) {
    return body.reason === "too_large" ? MAX_BATCH_SIZE : 1;
  }

  try {
    const parsed = JSON.parse(body.text) as { urls?: unknown };
    if (Array.isArray(parsed.urls)) {
      return Math.min(Math.max(parsed.urls.length, 1), MAX_BATCH_SIZE);
    }
  } catch {
    // The route owns validation; malformed input still costs one token.
  }

  return 1;
}
