import { describe, expect, it } from "vitest";

import {
  issueLaunchGrant,
  launchGrantId,
} from "@/lib/server/share-launch-grant";

const LINK = "https://parcel-help.example/track?id=42";

describe("issueLaunchGrant", () => {
  it("is 66 characters, however long the link", () => {
    const long = `https://example.com/${"/".repeat(1_500)}a`;
    for (const url of [LINK, long]) {
      const grant = issueLaunchGrant(url);
      expect(grant).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
      // Cookie-safe as is: nothing to URI-encode.
      expect(encodeURIComponent(grant)).toBe(grant);
    }
  });

  it("is new each time, so each launch has its own id", () => {
    expect(issueLaunchGrant(LINK)).not.toBe(issueLaunchGrant(LINK));
  });
});

describe("launchGrantId", () => {
  it("gives the grant's random id for the link it names, never the link", () => {
    const grant = issueLaunchGrant(LINK);
    const id = launchGrantId(grant, LINK);
    expect(id).toBe(grant.split(".")[0]);
    expect(id).not.toContain("parcel");
  });

  it("remembers nothing: the server's only record of use is the cleared cookie", () => {
    const grant = issueLaunchGrant(LINK);
    const id = launchGrantId(grant, LINK);
    // Asking again answers the same; the browser scans each id once.
    expect(launchGrantId(grant, LINK)).toBe(id);
  });

  it("refuses a grant for a different link", () => {
    expect(
      launchGrantId(issueLaunchGrant(LINK), "https://other.example/"),
    ).toBeNull();
  });

  it("refuses anything that isn't a grant", () => {
    for (const value of [
      null,
      undefined,
      "",
      LINK,
      encodeURIComponent(LINK),
      `${issueLaunchGrant(LINK)}x`,
      `x${issueLaunchGrant(LINK)}`,
    ]) {
      expect(launchGrantId(value, LINK), String(value)).toBeNull();
    }
  });
});
