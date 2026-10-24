import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  SHARE_LAUNCH_COOKIE,
  SHARE_LAUNCH_HEADER,
} from "@/lib/domain/share-launch";
import { proxy } from "@/proxy";

const GRANT = `${"a".repeat(22)}.${"b".repeat(43)}`;

function documentRequest(
  path: string,
  {
    cookie,
    headers = {},
  }: { cookie?: string; headers?: Record<string, string> } = {},
  method = "GET",
): NextRequest {
  return new NextRequest(`https://www.scrutinix.net${path}`, {
    method,
    headers: {
      ...headers,
      ...(cookie !== undefined
        ? { cookie: `theme=dark; ${SHARE_LAUNCH_COOKIE}=${cookie}` }
        : {}),
    },
  });
}

/** The request header the page will see, as the proxy overrode it. */
function handedOver(response: Response): string | null {
  const overridden = response.headers.get("x-middleware-override-headers");
  if (!overridden?.split(",").includes(SHARE_LAUNCH_HEADER)) return null;
  return response.headers.get(`x-middleware-request-${SHARE_LAUNCH_HEADER}`);
}

function clearsLaunchCookie(response: Response): boolean {
  return response.headers
    .getSetCookie()
    .some(
      (cookie) =>
        cookie.startsWith(`${SHARE_LAUNCH_COOKIE}=;`) &&
        /Max-Age=0/i.test(cookie) &&
        /Path=\//i.test(cookie) &&
        /HttpOnly/i.test(cookie) &&
        /SameSite=Strict/i.test(cookie) &&
        /Secure/i.test(cookie),
    );
}

describe("proxy: spending the share-launch grant", () => {
  it("hands the grant to the page once and clears it in the same response", async () => {
    const response = await proxy(
      documentRequest(`/?url=${encodeURIComponent("https://a.example/")}`, {
        cookie: GRANT,
      }),
    );
    expect(handedOver(response)).toBe(GRANT);
    expect(clearsLaunchCookie(response)).toBe(true);
    // The CSP nonce path is unchanged.
    expect(response.headers.get("content-security-policy")).toContain("nonce-");
  });

  it("clears it whatever the page does with it: no ?url=, a mismatch, a shared link", async () => {
    for (const path of [
      "/",
      `/?url=${encodeURIComponent("https://other.example/")}`,
      "/?url=javascript%3Aalert(1)",
      "/?shared=abc&sig=def",
    ]) {
      const response = await proxy(documentRequest(path, { cookie: GRANT }));
      expect(clearsLaunchCookie(response), path).toBe(true);
    }
  });

  it("clears an empty cookie without handing anything over", async () => {
    const response = await proxy(documentRequest("/", { cookie: "" }));
    expect(handedOver(response)).toBeNull();
    expect(clearsLaunchCookie(response)).toBe(true);
  });

  it("never passes on a grant header a request arrived with", async () => {
    for (const cookie of [undefined, GRANT]) {
      const response = await proxy(
        documentRequest("/", {
          cookie,
          headers: { [SHARE_LAUNCH_HEADER]: "forged" },
        }),
      );
      expect(handedOver(response), String(cookie)).toBe(
        cookie === undefined ? null : GRANT,
      );
    }
  });

  it("leaves the cookie alone off the home page, and sets nothing without one", async () => {
    for (const [path, method] of [
      ["/about", "GET"],
      ["/site.webmanifest", "GET"],
      ["/share", "POST"],
    ] as const) {
      const response = await proxy(
        documentRequest(path, { cookie: GRANT }, method),
      );
      expect(handedOver(response), path).toBeNull();
      expect(clearsLaunchCookie(response), path).toBe(false);
    }
    const plain = await proxy(documentRequest("/"));
    expect(handedOver(plain)).toBeNull();
    expect(plain.headers.getSetCookie()).toEqual([]);
  });
});
