import { describe, expect, it } from "vitest";

import { GET, POST } from "@/app/share/route";
import { SHARE_LAUNCH_COOKIE } from "@/lib/domain/share-launch";

const ORIGIN = "https://www.scrutinix.net";

function shareRequest(
  fields: Record<string, string>,
  { site }: { site?: string } = {},
): Request {
  const body = new URLSearchParams(fields).toString();
  return new Request(`${ORIGIN}/share`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(Buffer.byteLength(body)),
      ...(site ? { "sec-fetch-site": site } : {}),
    },
    body,
  });
}

function launchCookie(response: Response): string | null {
  return (
    response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${SHARE_LAUNCH_COOKIE}=`)) ?? null
  );
}

describe("POST /share", () => {
  it("redirects a share-sheet launch to the prefilled page and allows one scan", async () => {
    const response = await POST(
      shareRequest(
        {
          title: "Delivery",
          text: "Your parcel: https://parcel-help.example/track?id=42",
          url: "",
        },
        { site: "none" },
      ),
    );

    expect(response.status).toBe(303);
    // Relative: never an origin the server guessed.
    const header = response.headers.get("location")!;
    expect(header.startsWith("/?")).toBe(true);
    const location = new URL(header, ORIGIN);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("url")).toBe(
      "https://parcel-help.example/track?id=42",
    );

    const cookie = launchCookie(response);
    expect(cookie).not.toBeNull();
    expect(cookie).toContain(
      `${SHARE_LAUNCH_COOKIE}=${encodeURIComponent("https://parcel-help.example/track?id=42")}`,
    );
    expect(cookie).toMatch(/Max-Age=60/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  it("only prefills for a form another site posts", async () => {
    for (const site of ["cross-site", "same-site", undefined]) {
      const response = await POST(
        shareRequest({ text: "https://parcel-help.example/" }, { site }),
      );
      expect(response.status).toBe(303);
      expect(
        new URL(response.headers.get("location")!, ORIGIN).searchParams.get(
          "url",
        ),
      ).toBe("https://parcel-help.example/");
      expect(launchCookie(response), String(site)).toBeNull();
    }
  });

  it("goes home with nothing prefilled when no checkable link was shared", async () => {
    for (const fields of [
      { text: "see you at 6" } as Record<string, string>,
      { url: "http://localhost:3000/admin" },
    ]) {
      const response = await POST(shareRequest(fields, { site: "none" }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(launchCookie(response)).toBeNull();
    }
  });

  it("reads no oversized or unlabelled body", async () => {
    const big = new Request(`${ORIGIN}/share`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(20_000),
        "sec-fetch-site": "none",
      },
      body: `text=${"a".repeat(19_990)}`,
    });
    const response = await POST(big);
    expect(response.headers.get("location")).toBe("/");
    expect(launchCookie(response)).toBeNull();
  });
});

describe("GET /share", () => {
  it("goes home", () => {
    const response = GET();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(launchCookie(response)).toBeNull();
  });
});
