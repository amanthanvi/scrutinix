import { describe, expect, it } from "vitest";

import { GET, POST } from "@/app/share/route";
import { resolvePrefill } from "@/lib/domain/share-launch";
import { normalizeUrlInput } from "@/lib/domain/url";
import { parseScanRequest } from "@/lib/server/scan-request";

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

/** The redirect's target, resolved against the site. */
function locationOf(response: Response): URL {
  return new URL(response.headers.get("location")!, ORIGIN);
}

/**
 * What the redirect asks of the page: the query parameters it carries, by
 * name. `["url"]` alone is a prefill and nothing more.
 */
function paramsOf(response: Response): string[] {
  return [...locationOf(response).searchParams.keys()];
}

describe("POST /share", () => {
  it("redirects a share-sheet launch to the page with the link filled in, and nothing else", async () => {
    // The share sheet's own POST: the browser builds it, so it has no
    // initiating site.
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
    expect(locationOf(response).pathname).toBe("/");
    expect(locationOf(response).searchParams.get("url")).toBe(
      "https://parcel-help.example/track?id=42",
    );
    // Only a prefill: no cookie, and nothing else in the address that
    // could ask the page to start the scan itself.
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(paramsOf(response)).toEqual(["url"]);
  });

  it("answers a form another site posts exactly as it answers the share sheet", async () => {
    const answers = [];
    for (const site of ["none", "cross-site", "same-site", undefined]) {
      const response = await POST(
        shareRequest({ text: "https://parcel-help.example/" }, { site }),
      );
      expect(response.status, String(site)).toBe(303);
      expect(response.headers.getSetCookie(), String(site)).toEqual([]);
      answers.push(response.headers.get("location"));
    }
    expect(new Set(answers)).toEqual(
      new Set(["/?url=https%3A%2F%2Fparcel-help.example%2F"]),
    );
  });

  it("carries a long link whole", async () => {
    // Valid and under the 2,048-character link limit, but 4,500+ characters
    // URI-encoded.
    const link = `https://parcel-help.example/${"/".repeat(1_500)}track`;
    expect(encodeURIComponent(link).length).toBeGreaterThan(4_096);
    const response = await POST(shareRequest({ url: link }, { site: "none" }));
    expect(locationOf(response).searchParams.get("url")).toBe(link);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("goes home with nothing prefilled when no checkable link was shared", async () => {
    for (const fields of [
      { text: "see you at 6" } as Record<string, string>,
      { url: "http://localhost:3000/admin" },
    ]) {
      const response = await POST(shareRequest(fields, { site: "none" }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
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
    expect(locationOf(response).searchParams.get("url")).toBe(
      "https://parcel-help.example/track?id=42",
    );
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
    expect(locationOf(multipart).searchParams.get("url")).toBe(
      "https://parcel-help.example/",
    );

    const plain = await POST(
      new Request(`${ORIGIN}/share`, {
        method: "POST",
        headers: { "content-type": "text/plain", "sec-fetch-site": "none" },
        body: "text=https://parcel-help.example/",
      }),
    );
    expect(plain.headers.get("location")).toBe("/");
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
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

const CHUNK = 1024;

describe("a Unicode link, from the share sheet to the scan", () => {
  /** The link the page prefills: `/share`'s location, as `searchParams` decodes it. */
  function prefillAfter(response: Response): string | null {
    return resolvePrefill(locationOf(response).searchParams.get("url"));
  }

  /** The analyze routes' own validation of a scan request for `url`. */
  function scanRequest(url: string) {
    return parseScanRequest(
      new Request(`${ORIGIN}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }),
      "single",
    );
  }

  it("is judged by its normalized length at every boundary, so none disagrees", async () => {
    // 420 characters as typed, 2,420 percent-encoded. Measured as typed, it
    // passed /share, which redirected with the encoded link the page then
    // refused: no prefill and no scan, and nothing said why.
    const long = `https://example.com/${"é".repeat(400)}`;
    expect(long).toHaveLength(420);
    const typed = normalizeUrlInput(long);
    expect(typed.ok).toBe(false);
    expect(typed.ok ? null : typed.error).toBe(
      "That link is too long to check (over 2,048 characters).",
    );
    const shared = await POST(shareRequest({ url: long }, { site: "none" }));
    expect(shared.headers.get("location")).toBe("/");
    expect(resolvePrefill(long)).toBeNull();
    const refused = await scanRequest(long);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.response.status).toBe(400);
      expect(await refused.response.json()).toMatchObject({
        error: {
          code: "invalid_url",
          message: typed.ok ? null : typed.error,
        },
      });
    }

    // 338 encode to exactly 2,048 characters: accepted at every boundary,
    // and the page prefills, and Analyze scans, the very link /share took.
    const fits = `https://example.com/${"é".repeat(338)}`;
    const launched = await POST(shareRequest({ url: fits }, { site: "none" }));
    const prefill = prefillAfter(launched);
    expect(prefill).toHaveLength(2_048);
    expect(normalizeUrlInput(fits)).toMatchObject({
      ok: true,
      value: { normalizedUrl: prefill },
    });
    const accepted = await scanRequest(prefill!);
    expect(accepted.ok && accepted.targets[0]!.normalizedUrl).toBe(prefill);
  });
});

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
