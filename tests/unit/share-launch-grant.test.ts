import { describe, expect, it } from "vitest";

import {
  issueLaunchGrant,
  readLaunchGrant,
} from "@/lib/server/share-launch-grant";

const LINK = "https://parcel-help.example/track?id=42";
const NOW = Date.parse("2026-10-24T12:00:00.000Z");

describe("issueLaunchGrant", () => {
  it("is 80 characters, however long the link", () => {
    const long = `https://example.com/${"/".repeat(1_500)}a`;
    for (const url of [LINK, long]) {
      const grant = issueLaunchGrant(url, NOW);
      expect(grant).toMatch(/^[A-Za-z0-9_-]{22}\.\d{13}\.[A-Za-z0-9_-]{43}$/);
      expect(grant).toHaveLength(80);
      // Cookie-safe as is: nothing to URI-encode.
      expect(encodeURIComponent(grant)).toBe(grant);
    }
  });

  it("carries the server's time it was issued", () => {
    expect(issueLaunchGrant(LINK, NOW).split(".")[1]).toBe(String(NOW));
  });

  it("is new each time, so each launch has its own id", () => {
    expect(issueLaunchGrant(LINK, NOW)).not.toBe(issueLaunchGrant(LINK, NOW));
  });
});

describe("readLaunchGrant", () => {
  it("gives the grant's random id and issue time for the link it names, never the link", () => {
    const grant = issueLaunchGrant(LINK, NOW);
    const read = readLaunchGrant(grant, LINK, NOW + 1_000);
    expect(read).toEqual({ id: grant.split(".")[0], issuedAt: NOW });
    expect(JSON.stringify(read)).not.toContain("parcel");
  });

  it("remembers nothing: the server's only record of use is the cleared cookie", () => {
    const grant = issueLaunchGrant(LINK, NOW);
    const read = readLaunchGrant(grant, LINK, NOW);
    // Asking again answers the same; the browser scans each id once.
    expect(readLaunchGrant(grant, LINK, NOW)).toEqual(read);
  });

  it("refuses a grant for a different link", () => {
    expect(
      readLaunchGrant(
        issueLaunchGrant(LINK, NOW),
        "https://other.example/",
        NOW,
      ),
    ).toBeNull();
  });

  it("refuses a grant more than a minute from the render, either way", () => {
    const grant = issueLaunchGrant(LINK, NOW);
    for (const renderedAt of [NOW - 60_000, NOW + 60_000]) {
      expect(readLaunchGrant(grant, LINK, renderedAt)).not.toBeNull();
    }
    for (const renderedAt of [NOW - 60_001, NOW + 60_001]) {
      expect(readLaunchGrant(grant, LINK, renderedAt)).toBeNull();
    }
  });

  it("refuses anything that isn't a grant", () => {
    const grant = issueLaunchGrant(LINK, NOW);
    const [id, , digest] = grant.split(".");
    for (const value of [
      null,
      undefined,
      "",
      LINK,
      encodeURIComponent(LINK),
      `${grant}x`,
      `x${grant}`,
      // The round-3 shape, without an issue time.
      `${id}.${digest}`,
      // Issue times in seconds, or signed.
      `${id}.${NOW / 1000}.${digest}`,
      `${id}.-${String(NOW).slice(1)}.${digest}`,
    ]) {
      expect(readLaunchGrant(value, LINK, NOW), String(value)).toBeNull();
    }
  });
});
