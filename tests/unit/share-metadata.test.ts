import { describe, expect, it } from "vitest";

import { encodeSharedSnapshot } from "@/lib/domain/signal-signature";
import {
  SHARE_IMAGE_MAX_PAYLOAD,
  SHARE_IMAGE_PATH,
  describeSharedSnapshot,
  getSharedMetadata,
} from "@/lib/server/share-metadata";

const snapshot = {
  verdict: "safe" as const,
  url: "https://paypal.com.secure-login.xyz/verify",
  summary: "No check flagged this link.",
  capturedAt: "2026-10-06T09:00:00.000Z",
  signature: [
    "clear",
    "clear",
    "clear",
    "clear",
    "clear",
    "clear",
    "clear",
    "clear",
  ] as const,
};

describe("getSharedMetadata", () => {
  it("points og:image and twitter:image at the per-result card", () => {
    const payload = encodeSharedSnapshot({
      ...snapshot,
      signature: [...snapshot.signature],
    });
    const metadata = getSharedMetadata(payload);
    const expected = `${SHARE_IMAGE_PATH}?shared=${encodeURIComponent(payload)}`;

    expect(metadata?.title).toBe("Safe: secure-login.xyz — Scrutinix");
    expect(metadata?.openGraph?.images).toEqual([
      expect.objectContaining({ url: expected, width: 1200, height: 630 }),
    ]);
    expect(metadata?.twitter?.images).toEqual([
      expect.objectContaining({ url: expected }),
    ]);
    // A look-alike hedges even a Safe snapshot's instruction, and the
    // description states the real owner once.
    expect(metadata?.description).toBe(
      "Don't sign in or enter details here. This link belongs to secure-login.xyz, not paypal.com.",
    );
    expect(metadata?.description).toMatch(
      /belongs to secure-login\.xyz, not paypal\.com/,
    );
  });

  it("falls back to the defaults for a missing or invalid payload", () => {
    expect(getSharedMetadata(null)).toBeNull();
    expect(getSharedMetadata("not-base64!")).toBeNull();
    expect(
      getSharedMetadata(btoa(JSON.stringify({ verdict: "x" }))),
    ).toBeNull();
  });

  it("describes snapshots shared before the signature existed", () => {
    const old = {
      verdict: snapshot.verdict,
      url: snapshot.url,
      summary: snapshot.summary,
      capturedAt: snapshot.capturedAt,
    };
    const card = describeSharedSnapshot(
      btoa(encodeURIComponent(JSON.stringify(old))),
    );
    expect(card).toMatchObject({
      domain: "secure-login.xyz",
      impersonates: "paypal.com",
    });
    expect(card?.snapshot.signature).toBeUndefined();
  });

  it("hands the server-side anatomy to the shared view", () => {
    const card = describeSharedSnapshot(
      encodeSharedSnapshot({ ...snapshot, signature: [...snapshot.signature] }),
    );
    expect(card?.anatomy).toMatchObject({
      scheme: "https",
      subdomain: "paypal.com",
      registeredDomain: "secure-login.xyz",
      impersonates: "paypal.com",
    });
  });

  it("advertises no per-result image for an oversize payload", () => {
    const payload = encodeSharedSnapshot({
      ...snapshot,
      url: `https://example.com/${"a".repeat(1_900)}`,
      summary: "é".repeat(600),
      signature: [...snapshot.signature],
    });
    expect(payload.length).toBeGreaterThan(SHARE_IMAGE_MAX_PAYLOAD);
    const metadata = getSharedMetadata(payload);
    expect(metadata?.title).toBe("Safe: example.com — Scrutinix");
    expect(metadata?.openGraph?.images).toBeUndefined();
    expect(metadata?.twitter?.images).toBeUndefined();
  });
});
