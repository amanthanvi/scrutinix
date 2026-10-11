import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetEnvForTests } from "@/lib/config/env";
import {
  SHARED_PAYLOAD_MAX_LENGTH,
  createAnalysisResultSchema,
} from "@/lib/domain/schemas";
import {
  buildSharedSnapshot,
  decodeSharedSnapshot,
  encodeSharedSnapshot,
} from "@/lib/domain/signal-signature";
import { createPendingSignalResults } from "@/lib/domain/types";
import {
  issueResultShare,
  signSharePayload,
  verifySharePayload,
  withResultShare,
} from "@/lib/server/share-signing";

const SECRET = "unit-test-share-secret-0123456789abcdef";
const OTHER_SECRET = "another-share-secret-0123456789abcdefgh";

const payload = encodeSharedSnapshot({
  verdict: "malicious",
  url: "https://example.com/login",
  summary: "Google Safe Browsing lists this link as phishing.",
  capturedAt: "2026-10-06T09:00:00.000Z",
});

function useSecrets(current?: string, previous?: string) {
  vi.stubEnv("SHARE_SIGNING_SECRET", current ?? "");
  vi.stubEnv("SHARE_SIGNING_SECRET_PREVIOUS", previous ?? "");
  resetEnvForTests();
}

function flipLast(value: string): string {
  const last = value.at(-1) === "A" ? "B" : "A";
  return `${value.slice(0, -1)}${last}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("share signing", () => {
  it("round-trips: a signed payload verifies", () => {
    useSecrets(SECRET);
    const sig = signSharePayload(payload);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifySharePayload(payload, sig)).toBe(true);
  });

  it("signs the domain-separated exact payload string with HMAC-SHA256", () => {
    useSecrets(SECRET);
    const expected = createHmac("sha256", SECRET)
      .update(`scrutinix-share-v1\n${payload}`)
      .digest("base64url");
    expect(signSharePayload(payload)).toBe(expected);
    // Without the domain prefix the same key gives a different signature.
    const bare = createHmac("sha256", SECRET)
      .update(payload)
      .digest("base64url");
    expect(verifySharePayload(payload, bare)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    useSecrets(SECRET);
    const sig = signSharePayload(payload);
    const forged = encodeSharedSnapshot({
      ...decodeSharedSnapshot(payload)!,
      verdict: "safe",
    });
    expect(verifySharePayload(forged, sig)).toBe(false);
    expect(verifySharePayload(flipLast(payload), sig)).toBe(false);
    expect(verifySharePayload(`${payload}=`, sig)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    useSecrets(SECRET);
    const sig = signSharePayload(payload)!;
    expect(verifySharePayload(payload, flipLast(sig))).toBe(false);
    expect(verifySharePayload(payload, sig.toUpperCase())).toBe(false);
  });

  it("rejects a signature made with another key", () => {
    useSecrets(OTHER_SECRET);
    const foreign = signSharePayload(payload);
    useSecrets(SECRET);
    expect(verifySharePayload(payload, foreign)).toBe(false);
  });

  it("verifies links signed with the previous key during rotation, and signs with the current one", () => {
    useSecrets(OTHER_SECRET);
    const old = signSharePayload(payload);

    useSecrets(SECRET, OTHER_SECRET);
    expect(verifySharePayload(payload, old)).toBe(true);
    const fresh = signSharePayload(payload);
    expect(fresh).not.toBe(old);
    expect(verifySharePayload(payload, fresh)).toBe(true);

    // Rotation finished: the old key no longer verifies.
    useSecrets(SECRET);
    expect(verifySharePayload(payload, old)).toBe(false);
  });

  it("neither signs nor verifies with the secret unset", () => {
    useSecrets(SECRET);
    const sig = signSharePayload(payload);

    useSecrets();
    expect(signSharePayload(payload)).toBeNull();
    expect(verifySharePayload(payload, sig)).toBe(false);

    // A previous key alone does not turn verification on.
    useSecrets(undefined, SECRET);
    expect(verifySharePayload(payload, sig)).toBe(false);
  });

  it("ignores a secret shorter than 32 characters and warns once without printing it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const short = "too-short-secret-31-characters!";
    expect(short).toHaveLength(31);
    useSecrets(short);

    expect(signSharePayload(payload)).toBeNull();
    const forged = createHmac("sha256", short)
      .update(`scrutinix-share-v1\n${payload}`)
      .digest("base64url");
    expect(verifySharePayload(payload, forged)).toBe(false);
    signSharePayload(payload);

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain("SHARE_SIGNING_SECRET");
    expect(logged).not.toContain(short);
  });

  it("returns false, never throws, on malformed or oversize input", () => {
    useSecrets(SECRET);
    const sig = signSharePayload(payload)!;
    const bad: unknown[] = [
      null,
      undefined,
      "",
      42,
      {},
      ["x"],
      "not a signature",
      `${sig}=`,
      `${sig}A`,
      sig.slice(0, -1),
      sig.replace(/^./, "+"),
      "A".repeat(10_000),
    ];
    for (const value of bad) {
      expect(() => verifySharePayload(payload, value)).not.toThrow();
      expect(verifySharePayload(payload, value)).toBe(false);
    }
    expect(verifySharePayload(null, sig)).toBe(false);
    expect(verifySharePayload("", sig)).toBe(false);
    expect(verifySharePayload(42, sig)).toBe(false);

    const oversize = "A".repeat(SHARED_PAYLOAD_MAX_LENGTH + 1);
    const oversizeSig = signSharePayload(oversize);
    expect(verifySharePayload(oversize, oversizeSig)).toBe(false);
  });

  it("rejects a signature of the wrong length without comparing", () => {
    useSecrets(SECRET);
    // Valid base64url, but 32 and 44 characters: never a 43-character digest.
    expect(verifySharePayload(payload, "A".repeat(32))).toBe(false);
    expect(verifySharePayload(payload, "A".repeat(44))).toBe(false);
  });
});

describe("issued shares", () => {
  const result = createAnalysisResultSchema("2026-10-06T09:00:00.000Z").parse({
    id: "scan-1",
    url: "https://example.com/login",
    verdict: "malicious",
    signals: createPendingSignalResults(),
    threatInfo: null,
    metadata: {
      scanId: "scan-1",
      completedAt: "2026-10-06T09:00:00.000Z",
    },
  });

  it("carries the canonical snapshot payload, signed when a secret is set", () => {
    useSecrets(SECRET);
    const share = issueResultShare(result);
    expect(share?.payload).toBe(
      encodeSharedSnapshot(buildSharedSnapshot(result)),
    );
    expect(verifySharePayload(share?.payload, share?.sig)).toBe(true);
  });

  it("is unsigned when no secret is set", () => {
    useSecrets();
    const share = issueResultShare(result);
    expect(share?.payload).toBeTruthy();
    expect(share?.sig).toBeUndefined();
  });

  it("replaces any share the result already carried and never mutates it", () => {
    useSecrets(SECRET);
    const stale = { ...result, share: { payload: "forged", sig: "x" } };
    const issued = withResultShare(stale);
    expect(issued.share?.payload).not.toBe("forged");
    expect(verifySharePayload(issued.share?.payload, issued.share?.sig)).toBe(
      true,
    );
    expect(stale.share.payload).toBe("forged");
  });

  it("survives the result sanitizer, and old data without it still parses", () => {
    useSecrets(SECRET);
    const issued = withResultShare(result);
    const schema = createAnalysisResultSchema("2026-10-06T09:00:00.000Z");
    expect(schema.parse(JSON.parse(JSON.stringify(issued))).share).toEqual(
      issued.share,
    );
    expect(schema.parse(result)).not.toHaveProperty("share");
    // A malformed share is dropped, not fatal; a malformed sig alone is dropped.
    expect(
      schema.parse({ ...result, share: { payload: 7 } }),
    ).not.toHaveProperty("share");
    expect(
      schema.parse({ ...result, share: { payload: "abc", sig: "nope" } }).share,
    ).toEqual({ payload: "abc" });
  });
});
