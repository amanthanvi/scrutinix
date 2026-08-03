import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy, createCspNonce } from "@/lib/server/csp";
import { applyRateLimit, getClientRateLimitId } from "@/lib/server/rate-limit";
import { getScanRequestCost } from "@/lib/server/scan-cost";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/analyze")) {
    return enforceRateLimit(request);
  }

  return applyCspNonce(request);
}

async function enforceRateLimit(request: NextRequest) {
  // Identity trusts platform/proxy headers; see getClientRateLimitId.
  const identifier = getClientRateLimitId(request.headers);
  const limit = await applyRateLimit(
    identifier,
    await getScanRequestCost(request, request.nextUrl.pathname),
  );

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
