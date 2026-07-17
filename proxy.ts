import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  applyRateLimit,
  getClientRateLimitId,
} from "@/lib/server/rate-limit";

export function proxy(request: NextRequest) {
  return enforceRateLimit(request);
}

async function enforceRateLimit(request: NextRequest) {
  // Identity trusts platform/proxy headers; see getClientRateLimitId.
  const identifier = getClientRateLimitId(request.headers);
  const limit = await applyRateLimit(identifier);

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

export const config = {
  matcher: ["/api/analyze/:path*"],
};
