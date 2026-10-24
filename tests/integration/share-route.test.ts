import { describe, expect, it } from "vitest";

import { GET, POST } from "@/app/share/route";
import { SHARE_LAUNCH_COOKIE } from "@/lib/domain/share-launch";
import { redeemLaunchGrant } from "@/lib/server/share-launch-grant";

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

/** The grant value the launch cookie holds. */
function grantIn(response: Response): string | null {
  const cookie = launchCookie(response);
  return cookie
    ? decodeURIComponent(
        cookie.slice(SHARE_LAUNCH_COOKIE.length + 1).split(";")[0]!,
      )
    : null;
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
    expect(cookie).toMatch(/Max-Age=60/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
    // Spent on the server: no script needs to read it.
    expect(cookie).toMatch(/HttpOnly/i);
    // A grant for this link, not the link itself.
    expect(cookie).not.toContain("parcel-help");
    const grant = grantIn(response)!;
    expect(
      await redeemLaunchGrant(grant, "https://parcel-help.example/track?id=42"),
    ).toBe(true);
  });

  it("keeps the grant small for a long link, so the browser still stores it", async () => {
    // Valid and under the 2,048-character link limit, but 4,500+ characters
    // URI-encoded: a cookie holding the link itself is over the 4 KiB
    // browsers accept, and the scan silently never starts.
    const link = `https://parcel-help.example/${"/".repeat(1_500)}track`;
    expect(encodeURIComponent(link).length).toBeGreaterThan(4_096);
    const response = await POST(shareRequest({ url: link }, { site: "none" }));

    expect(
      new URL(response.headers.get("location")!, ORIGIN).searchParams.get(
        "url",
      ),
    ).toBe(link);
    const cookie = launchCookie(response)!;
    expect(cookie.length).toBeLessThan(200);
    expect(await redeemLaunchGrant(grantIn(response), link)).toBe(true);
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

  it("refuses a body that declares more than 16 KiB, unread", async () => {
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

  it("stops reading a streamed body at 16 KiB, whatever its Content-Length says", async () => {
    for (const declared of ["10", undefined]) {
      // The link comes first, so a reader that kept going would find it.
      const stream = chunkedBody(
        `text=${encodeURIComponent(`https://parcel-help.example/ ${"a".repeat(131_000)}`)}`,
      );
      const response = await POST(
        streamedRequest(stream.body, {
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "none",
          ...(declared ? { "content-length": declared } : {}),
        }),
      );
      expect(response.headers.get("location"), String(declared)).toBe("/");
      expect(launchCookie(response), String(declared)).toBeNull();
      // Cancelled at the chunk that crossed the limit (plus the one the
      // stream queued ahead), not drained.
      expect(stream.sent(), String(declared)).toBeLessThanOrEqual(
        16 * 1024 + 2 * CHUNK,
      );
    }
  });

  it("reads a body sent without Content-Length when it stays under the limit", async () => {
    const response = await POST(
      streamedRequest(
        chunkedBody(
          new URLSearchParams({
            text: "Your parcel: https://parcel-help.example/track?id=42",
          }).toString(),
        ).body,
        {
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "none",
        },
      ),
    );
    expect(
      new URL(response.headers.get("location")!, ORIGIN).searchParams.get(
        "url",
      ),
    ).toBe("https://parcel-help.example/track?id=42");
    expect(launchCookie(response)).not.toBeNull();
  });

  it("parses multipart from the bounded bytes too, and nothing else", async () => {
    const form = new FormData();
    form.set("text", "https://parcel-help.example/");
    const multipart = await POST(
      new Request(`${ORIGIN}/share`, {
        method: "POST",
        headers: { "sec-fetch-site": "none" },
        body: form,
      }),
    );
    expect(
      new URL(multipart.headers.get("location")!, ORIGIN).searchParams.get(
        "url",
      ),
    ).toBe("https://parcel-help.example/");

    const plain = await POST(
      new Request(`${ORIGIN}/share`, {
        method: "POST",
        headers: { "content-type": "text/plain", "sec-fetch-site": "none" },
        body: "text=https://parcel-help.example/",
      }),
    );
    expect(plain.headers.get("location")).toBe("/");
    expect(launchCookie(plain)).toBeNull();
  });

  it("is never cached", async () => {
    const response = await POST(
      shareRequest({ text: "https://parcel-help.example/" }, { site: "none" }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /share", () => {
  it("goes home", () => {
    const response = GET();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(launchCookie(response)).toBeNull();
  });
});

const CHUNK = 1024;

/** A body handed over 1 KiB at a time, counting what the reader pulled. */
function chunkedBody(text: string) {
  const bytes = new TextEncoder().encode(text);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes.byteLength) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(sent, sent + CHUNK);
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return { body, sent: () => sent };
}

function streamedRequest(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string>,
): Request {
  return new Request(`${ORIGIN}/share`, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}
