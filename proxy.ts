import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  SHARE_LAUNCH_COOKIE,
  SHARE_LAUNCH_COOKIE_ATTRIBUTES,
  SHARE_LAUNCH_HEADER,
} from "@/lib/domain/share-launch";
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
  const spendsLaunch = handOverShareLaunch(request, requestHeaders);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", csp);
  if (spendsLaunch) {
    response.cookies.set(SHARE_LAUNCH_COOKIE, "", {
      ...SHARE_LAUNCH_COOKIE_ATTRIBUTES,
      maxAge: 0,
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

/**
 * The share-target launch grant (`SHARE_LAUNCH_COOKIE`) is spent by the
 * first response for `/` that carries it, matching or not: the page gets
 * the grant in `SHARE_LAUNCH_HEADER` and this response clears the cookie,
 * so a reload, another tab, or an abandoned launch never finds it again.
 * The cookie itself can't carry it to the page: Next merges a cookie the
 * proxy clears into what `cookies()` reads for the same render. Whether
 * the grant scans, and that it does so once, is the page's call
 * (`redeemLaunchGrant`). Only `/` reads it, so other paths (the manifest
 * and icon fetches a launch makes, `/share` itself) leave it alone.
 * Returns whether the cookie is to be cleared.
 */
function handOverShareLaunch(
  request: NextRequest,
  requestHeaders: Headers,
): boolean {
  // Only this proxy speaks for the cookie. (Prefetches skip the proxy, but
  // the app's own router makes them and never sends the header.)
  requestHeaders.delete(SHARE_LAUNCH_HEADER);
  if (request.nextUrl.pathname !== "/") return false;
  const grant = request.cookies.get(SHARE_LAUNCH_COOKIE);
  if (!grant) return false;
  if (grant.value) requestHeaders.set(SHARE_LAUNCH_HEADER, grant.value);
  return true;
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
