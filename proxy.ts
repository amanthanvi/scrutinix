import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy, createCspNonce } from "@/lib/server/csp";
import { applyRateLimit, getClientRateLimitId } from "@/lib/server/rate-limit";
import { MAX_BATCH_SIZE } from "@/lib/server/scan-request";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/analyze")) {
    return enforceRateLimit(request);
  }

  return applyCspNonce(request);
}

async function enforceRateLimit(request: NextRequest) {
  // Identity trusts platform/proxy headers; see getClientRateLimitId.
  const identifier = getClientRateLimitId(request.headers);
  const limit = await applyRateLimit(identifier, await scanCost(request));

  if (!limit.success) {
    const retryAfter = Math.max(
      1,
      Math.ceil((limit.reset - Date.now()) / 1000),
    );

    return NextResponse.json(
      { error: limit.error },
      {
        status: limit.status,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Remaining": String(limit.remaining),
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Remaining", String(limit.remaining));
  return response;
}

/**
 * A batch of N URLs consumes N rate-limit tokens; a malformed body costs 1
 * (the route will 400 it anyway).
 */
async function scanCost(request: NextRequest): Promise<number> {
  if (!request.nextUrl.pathname.startsWith("/api/analyze/batch")) {
    return 1;
  }

  try {
    const body = (await request.clone().json()) as { urls?: unknown };
    if (Array.isArray(body.urls)) {
      return Math.min(Math.max(body.urls.length, 1), MAX_BATCH_SIZE);
    }
  } catch {
    // Unreadable body; charge the minimum.
  }

  return 1;
}

function applyCspNonce(request: NextRequest) {
  const nonce = createCspNonce();
  const csp = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the request CSP header to stamp nonces onto framework scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/api/analyze/:path*",
    /*
     * Document routes get a per-request CSP nonce. Skip API, Next internals,
     * and common static assets; also skip link prefetches.
     */
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
