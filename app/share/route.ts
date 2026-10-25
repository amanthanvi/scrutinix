import { NextResponse } from "next/server";

import { PREFILL_PARAM, extractSharedLink } from "@/lib/domain/share-launch";
import { readBoundedBody } from "@/lib/server/request-body";

export const runtime = "nodejs";

/**
 * Longest share body read. A shared message is a few hundred bytes; the
 * link is all that is kept, and a longer body is dropped whole: counted as
 * it streams in (`readBoundedBody`), whatever `Content-Length` claims.
 */
const MAX_SHARE_BODY_BYTES = 16 * 1024;

/**
 * The manifest asks for `application/x-www-form-urlencoded`. A share
 * target that also took files would post `multipart/form-data`, so that
 * is parsed too; both only ever from the bounded bytes. Anything else
 * holds no fields.
 */
const FORM_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];

async function readSharedFields(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  const essence = type.split(";")[0]!.trim().toLowerCase();
  if (!FORM_TYPES.includes(essence)) return {};
  const body = await readBoundedBody(request, MAX_SHARE_BODY_BYTES);
  if (!body) return {};
  try {
    const form = await new Response(body, {
      headers: { "content-type": type },
    }).formData();
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : null;
    };
    return { url: field("url"), text: field("text"), title: field("title") };
  } catch {
    return {};
  }
}

/**
 * The installed app's Web Share Target (`share_target` in
 * `public/site.webmanifest`). Takes the first http(s) link from what was
 * shared and redirects to `/?url=<link>`, which fills in the Single field
 * and waits for the person to tap Analyze, as any `?url=` link does. It
 * sets no cookie, and nothing is logged or stored.
 */
export async function POST(request: Request) {
  const link = extractSharedLink(await readSharedFields(request));
  return redirectTo(
    link
      ? `/?${new URLSearchParams({ [PREFILL_PARAM]: link }).toString()}`
      : "/",
  );
}

/** Opened by hand: there is nothing to receive, so go home. */
export function GET() {
  return redirectTo("/");
}

/**
 * 303, so the page is fetched with GET and a reload never re-posts. The
 * location is relative: the server's idea of its own origin (`request.url`
 * under `next start` names `localhost`) must never send the visitor to a
 * different site. `no-store`: the answer belongs to this one share.
 */
function redirectTo(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });
}
