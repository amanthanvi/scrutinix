import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy, createCspNonce } from "@/lib/server/csp";
import {
  applyRateLimit,
  getClientRateLimitId,
  type RateLimitTier,
} from "@/lib/server/rate-limit";
import { getScanRequestCost } from "@/lib/server/scan-cost";

/** Per-result share images render on every unique payload: metered too. */
const SHARE_IMAGE_PATH = "/og/result";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/analyze")) {
    return enforceRateLimit(
      request,
      await getScanRequestCost(request, pathname),
      "scan",
    );
  }
  if (pathname === SHARE_IMAGE_PATH) {
    return enforceRateLimit(request, 1, "image");
  }

  return applyCspNonce(request);
}

async function enforceRateLimit(
  request: NextRequest,
  cost: number,
  tier: RateLimitTier,
) {
  // Identity trusts platform/proxy headers; see getClientRateLimitId.
  const identifier = getClientRateLimitId(request.headers);
  const limit = await applyRateLimit(identifier, cost, tier);

  if (!limit.success) {
    // The message was worded from the same value (see toLimitResult).
    const retryAfter =
      limit.retryAfterSeconds ??
      Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));

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
    "/og/result",
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
