import { NextResponse } from "next/server";

import {
  PREFILL_PARAM,
  SHARE_LAUNCH_COOKIE,
  SHARE_LAUNCH_MAX_AGE_SECONDS,
  extractSharedLink,
  isShareTargetLaunch,
} from "@/lib/domain/share-launch";

export const runtime = "nodejs";

/**
 * Longest share body read. A shared message is a few hundred bytes; the
 * link is all that is kept, and the rest is dropped here unread past it.
 */
const MAX_SHARE_BODY_BYTES = 16 * 1024;

async function readSharedFields(request: Request) {
  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length > MAX_SHARE_BODY_BYTES) return {};
  try {
    const form = await request.formData();
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
 * shared and redirects to `/?url=<link>`, which prefills the Single field.
 * Only a share-sheet launch (`isShareTargetLaunch`) also sets the
 * short-lived launch cookie that lets the page start the scan; a form
 * another site posts here prefills and waits for a tap. Nothing is logged
 * or stored.
 */
export async function POST(request: Request) {
  const link = extractSharedLink(await readSharedFields(request));
  const location = link
    ? `/?${new URLSearchParams({ [PREFILL_PARAM]: link }).toString()}`
    : "/";

  const response = redirectTo(location);
  if (link && isShareTargetLaunch(request.method, request.headers)) {
    response.cookies.set(SHARE_LAUNCH_COOKIE, link, {
      maxAge: SHARE_LAUNCH_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "strict",
      secure: new URL(request.url).protocol === "https:",
    });
  }
  return response;
}

/** Opened by hand: there is nothing to receive, so go home. */
export function GET() {
  return redirectTo("/");
}

/**
 * 303, so the page is fetched with GET and a reload never re-posts. The
 * location is relative: the server's idea of its own origin (`request.url`
 * under `next start` names `localhost`) must never send the visitor to a
 * different site, where the launch cookie would not exist.
 */
function redirectTo(location: string) {
  return new NextResponse(null, { status: 303, headers: { location } });
}
