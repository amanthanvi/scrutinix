import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvForTests } from "@/lib/config/env";
import {
  decodeSharedSnapshot,
  encodeSharedSnapshot,
} from "@/lib/domain/signal-signature";
import {
  SHARE_IMAGE_MAX_PAYLOAD,
  SHARE_IMAGE_PATH,
  describeSharedSnapshot,
  getSharedMetadata,
  resolveSharedView,
} from "@/lib/server/share-metadata";
import { signSharePayload } from "@/lib/server/share-signing";

const SECRET = "unit-test-share-secret-0123456789abcdef";

beforeEach(() => {
  vi.stubEnv("SHARE_SIGNING_SECRET", SECRET);
  resetEnvForTests();
});

/** Payload and signature, as a Share link from this server carries them. */
function signed(payload: string): [string, string] {
  const sig = signSharePayload(payload);
  if (!sig) throw new Error("test secret not configured");
  return [payload, sig];
}

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
    const [, sig] = signed(payload);
    const metadata = getSharedMetadata(payload, sig);
    const expected = `${SHARE_IMAGE_PATH}?shared=${encodeURIComponent(payload)}&sig=${sig}`;

    // A signed Safe look-alike never leads with "Safe": many chat clients
    // show only the title and image.
    expect(metadata?.title).toBe(
      "Look-alike of paypal.com: secure-login.xyz — Scrutinix",
    );
    expect(metadata?.title).not.toMatch(/^Safe/);
    expect(metadata?.openGraph?.title).not.toMatch(/^Safe/);
    expect(metadata?.twitter?.title).not.toMatch(/^Safe/);
    expect(metadata?.openGraph?.images).toEqual([
      expect.objectContaining({
        url: expected,
        width: 1200,
        height: 630,
        alt: "Scrutinix result for secure-login.xyz: Look-alike of paypal.com.",
      }),
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
    expect(getSharedMetadata(null, null)).toBeNull();
    expect(getSharedMetadata(...signed("not-base64!"))).toBeNull();
    expect(
      getSharedMetadata(...signed(btoa(JSON.stringify({ verdict: "x" })))),
    ).toBeNull();
  });

  describe("unverified payloads keep the site defaults", () => {
    // A forged "Safe" for a phishing link: nothing of it may reach a
    // title, description, or image, not even the domain.
    const forged = encodeSharedSnapshot({
      ...snapshot,
      signature: [...snapshot.signature],
    });

    it("without a signature (links shared before signing)", () => {
      expect(getSharedMetadata(forged, null)).toBeNull();
      expect(describeSharedSnapshot(forged, null)).toBeNull();
    });

    it("with a malformed signature", () => {
      expect(getSharedMetadata(forged, "not-a-signature")).toBeNull();
    });

    it("when the payload was edited after signing", () => {
      const original = encodeSharedSnapshot({
        ...snapshot,
        verdict: "malicious",
        signature: [...snapshot.signature],
      });
      const [, sig] = signed(original);
      expect(getSharedMetadata(original, sig)).not.toBeNull();
      expect(getSharedMetadata(forged, sig)).toBeNull();
      // One character changed in the encoded payload.
      const edited = `${original.slice(0, 10)}${original[10] === "A" ? "B" : "A"}${original.slice(11)}`;
      expect(getSharedMetadata(edited, sig)).toBeNull();
    });

    it("when signing is not configured", () => {
      const [payload, sig] = signed(forged);
      vi.stubEnv("SHARE_SIGNING_SECRET", "");
      resetEnvForTests();
      expect(getSharedMetadata(payload, sig)).toBeNull();
      expect(describeSharedSnapshot(payload, sig)).toBeNull();
    });
  });

  it("describes snapshots shared before the signature existed", () => {
    const old = {
      verdict: snapshot.verdict,
      url: snapshot.url,
      summary: snapshot.summary,
      capturedAt: snapshot.capturedAt,
    };
    const card = describeSharedSnapshot(
      ...signed(btoa(encodeURIComponent(JSON.stringify(old)))),
    );
    expect(card).toMatchObject({
      domain: "secure-login.xyz",
      impersonates: "paypal.com",
    });
    expect(card?.snapshot.signature).toBeUndefined();
  });

  it("hands the server-side anatomy to the shared view", () => {
    const card = describeSharedSnapshot(
      ...signed(
        encodeSharedSnapshot({
          ...snapshot,
          signature: [...snapshot.signature],
        }),
      ),
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
    const metadata = getSharedMetadata(...signed(payload));
    expect(metadata?.title).toBe("Safe: example.com — Scrutinix");
    expect(metadata?.openGraph?.images).toBeUndefined();
    expect(metadata?.twitter?.images).toBeUndefined();
  });
});

describe("a '+' that query decoding turned into a space", () => {
  // Find a payload whose base64 contains "+" (it depends on the bytes).
  const withPlus = (() => {
    for (let index = 0; index < 500; index += 1) {
      const payload = encodeSharedSnapshot({
        ...snapshot,
        summary: `No check flagged this link. ${"~".repeat(index)}`,
        signature: [...snapshot.signature],
      });
      if (payload.includes("+")) return payload;
    }
    throw new Error("no payload with '+' found");
  })();

  it("still verifies and decodes", () => {
    const [payload, sig] = signed(withPlus);
    const spaced = payload.replace(/\+/g, " ");
    expect(spaced).not.toBe(payload);
    expect(resolveSharedView(spaced, sig)?.snapshot).toEqual(
      decodeSharedSnapshot(payload),
    );
    const metadata = getSharedMetadata(spaced, sig);
    expect(metadata?.title).toMatch(/secure-login\.xyz — Scrutinix$/);
    // The image link carries the canonical payload, "+" restored.
    expect(metadata?.openGraph?.images).toEqual([
      expect.objectContaining({
        url: `${SHARE_IMAGE_PATH}?shared=${encodeURIComponent(payload)}&sig=${sig}`,
      }),
    ]);
  });

  it("while any other change still fails", () => {
    const [payload, sig] = signed(withPlus);
    const at = payload.indexOf("+");
    const edited = `${payload.slice(0, at)}/${payload.slice(at + 1)}`;
    expect(resolveSharedView(edited, sig)?.snapshot ?? null).toBeNull();
    expect(getSharedMetadata(edited, sig)).toBeNull();
  });
});

describe("resolveSharedView", () => {
  const payload = encodeSharedSnapshot({
    ...snapshot,
    signature: [...snapshot.signature],
  });

  it("hands a verified snapshot to the page", () => {
    const view = resolveSharedView(...signed(payload));
    expect(view?.snapshot).toEqual(decodeSharedSnapshot(payload));
    expect(view?.url).toBe(snapshot.url);
  });

  it("hands an unverified link only its URL and Scrutinix's anatomy", () => {
    const view = resolveSharedView(payload, null);
    expect(view).toEqual({
      url: snapshot.url,
      anatomy: expect.objectContaining({
        registeredDomain: "secure-login.xyz",
        impersonates: "paypal.com",
      }),
      snapshot: null,
    });
    expect(JSON.stringify(view)).not.toContain(snapshot.summary);
  });

  it("shows nothing for a payload that does not decode or is not http(s)", () => {
    expect(resolveSharedView("%%%", null)).toBeNull();
    expect(
      resolveSharedView(
        ...signed(
          encodeSharedSnapshot({
            ...snapshot,
            url: "javascript:alert(1)",
            signature: [...snapshot.signature],
          }),
        ),
      ),
    ).toBeNull();
  });
});
