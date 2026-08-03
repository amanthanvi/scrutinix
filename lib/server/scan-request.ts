import { getEnv } from "@/lib/config/env";
import { readRequestTextWithLimit } from "@/lib/domain/request-body";
import { MAX_BATCH_SIZE, MAX_SCAN_BODY_BYTES } from "@/lib/domain/scan-limits";
import { normalizeUrlInput, type NormalizedUrl } from "@/lib/domain/url";
import { createApiError } from "@/lib/server/api-error";

export type ScanRequestOutcome =
  | { ok: true; targets: NormalizedUrl[] }
  | { ok: false; response: Response };

/**
 * Shared request kernel for the analyze routes: enforces content type, body
 * size, and same-origin posture, then validates and normalizes every URL
 * exactly once. Routes receive ready-to-scan NormalizedUrl targets.
 */
export async function parseScanRequest(
  request: Request,
  shape: "single" | "batch",
): Promise<ScanRequestOutcome> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return reject(
      415,
      "unsupported_media_type",
      "Requests must use Content-Type: application/json.",
    );
  }

  const originError = checkOrigin(request);
  if (originError) {
    return originError;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SCAN_BODY_BYTES) {
    return reject(413, "payload_too_large", "Request body is too large.");
  }

  const bodyResult = await readRequestTextWithLimit(
    request,
    MAX_SCAN_BODY_BYTES,
  );
  if (!bodyResult.ok && bodyResult.reason === "too_large") {
    return reject(413, "payload_too_large", "Request body is too large.");
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyResult.ok ? bodyResult.text : "");
  } catch {
    body = null;
  }

  return shape === "single" ? parseSingleBody(body) : parseBatchBody(body);
}

function parseSingleBody(body: unknown): ScanRequestOutcome {
  const url =
    body && typeof body === "object" && "url" in body
      ? (body as { url: unknown }).url
      : undefined;

  if (typeof url !== "string") {
    return reject(
      400,
      "invalid_request",
      "Request body must include a string url.",
    );
  }

  const validated = normalizeUrlInput(url);
  if (!validated.ok) {
    return reject(400, "invalid_url", validated.error);
  }

  return { ok: true, targets: [validated.value] };
}

function parseBatchBody(body: unknown): ScanRequestOutcome {
  const urls =
    body && typeof body === "object" && "urls" in body
      ? (body as { urls: unknown }).urls
      : undefined;

  if (!Array.isArray(urls)) {
    return reject(
      400,
      "invalid_request",
      "Request body must include a urls array.",
    );
  }

  if (urls.length === 0 || urls.length > MAX_BATCH_SIZE) {
    return reject(
      400,
      "invalid_batch_size",
      `Batch scans must contain between 1 and ${MAX_BATCH_SIZE} URLs.`,
    );
  }

  if (!urls.every((item): item is string => typeof item === "string")) {
    return reject(
      400,
      "invalid_request",
      "Each batch item must be a string URL.",
    );
  }

  const targets: NormalizedUrl[] = [];
  for (const url of urls) {
    const validated = normalizeUrlInput(url);
    if (!validated.ok) {
      return reject(400, "invalid_url", validated.error);
    }
    targets.push(validated.value);
  }

  return { ok: true, targets };
}

/**
 * If the browser sent an Origin header, it must match this deployment.
 * Otherwise any third-party page could burn provider quota via cross-origin
 * fetch. Requests without an Origin (curl, server-to-server) pass through.
 *
 * Full origins are compared so scheme and effective port remain part of the
 * authorization decision. Next can normalize request.url to the server's
 * configured hostname (e.g. localhost behind `next start`), so the incoming
 * Host header is also paired with the request URL's protocol. Forwarding
 * headers are caller-controlled unless a trusted proxy contract says
 * otherwise and must not authorize an origin.
 */
function checkOrigin(request: Request): ScanRequestOutcome | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }
  if (origin === "null") {
    return rejectCrossOrigin();
  }

  let requestOrigin: string;
  try {
    requestOrigin = toHttpOrigin(origin);
  } catch {
    return rejectCrossOrigin();
  }

  const allowedOrigins = new Set<string>();
  let requestUrl: URL | null = null;

  try {
    requestUrl = new URL(request.url);
    allowedOrigins.add(toHttpOrigin(request.url));
  } catch {
    // request.url is always absolute in route handlers; ignore otherwise.
  }

  const host = request.headers.get("host")?.trim();
  if (host && requestUrl && !/[\\/@?#\s]/.test(host)) {
    try {
      allowedOrigins.add(toHttpOrigin(`${requestUrl.protocol}//${host}`));
    } catch {
      // Invalid Host header; the other deployment origins still apply.
    }
  }

  const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      allowedOrigins.add(toHttpOrigin(appUrl));
    } catch {
      // Malformed configured URL; the request-derived origins still apply.
    }
  }

  return allowedOrigins.has(requestOrigin) ? null : rejectCrossOrigin();
}

function toHttpOrigin(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Origin must use HTTP or HTTPS.");
  }
  return parsed.origin.toLowerCase();
}

function rejectCrossOrigin(): ScanRequestOutcome {
  return reject(
    403,
    "cross_origin_forbidden",
    "Cross-origin scan requests are not allowed.",
  );
}

function reject(
  status: number,
  code: string,
  message: string,
): ScanRequestOutcome {
  return {
    ok: false,
    response: Response.json(
      { error: createApiError(code, message, false) },
      { status },
    ),
  };
}
