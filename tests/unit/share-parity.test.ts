import { parse } from "tldts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvForTests } from "@/lib/config/env";
import { splitLinkAnatomy } from "@/lib/domain/link-anatomy";
import {
  buildSharedSnapshot,
  decodeSharedSnapshot,
  encodeSharedSnapshot,
} from "@/lib/domain/signal-signature";
import {
  signalNames,
  type AnalysisResult,
  type SignalResults,
  type Verdict,
} from "@/lib/domain/types";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { getVerdictBasis } from "@/lib/domain/verdict-basis";
import {
  getSharedGuidance,
  getVerdictGuidance,
} from "@/lib/domain/verdict-guidance";
import {
  describeSharedSnapshot,
  getSharedMetadata,
  resolveSharedView,
} from "@/lib/server/share-metadata";
import { signSharePayload, withResultShare } from "@/lib/server/share-signing";
import {
  fixtureSignals,
  heuristicCriticalSignals,
} from "@/tests/fixtures/scenario-signals";

/**
 * A verified share says what the sender saw: for every verdict variant,
 * the instruction (and band tone) the sender's own band showed is the one
 * the recipient's band, the page metadata, and the share card state,
 * through the real server path (issue, sign, verify, describe).
 */

const SECRET = "unit-test-share-secret-0123456789abcdef";
const CHECKED_AT = "2026-10-06T09:00:00.000Z";
/** 3h after the check: well inside SHARE_MAX_AGE. */
const NOW = Date.parse("2026-10-06T12:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("SHARE_SIGNING_SECRET", SECRET);
  resetEnvForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

/** Payload and signature, as the server signs any payload. */
function signed(payload: string): [string, string] {
  const sig = signSharePayload(payload);
  if (!sig) throw new Error("test secret not configured");
  return [payload, sig];
}

function resultFrom(
  signals: SignalResults,
  url = "https://example.com/login",
  partialFailure = false,
): AnalysisResult {
  const { verdict, threatInfo } = buildThreatAssessment(signals);
  return {
    id: "scan",
    url,
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId: "scan",
      startedAt: CHECKED_AT,
      completedAt: CHECKED_AT,
      checkedAt: CHECKED_AT,
      cacheHit: false,
      partialFailure,
      signalCount: signalNames.length,
      durationMs: 1_000,
    },
  };
}

/** What the sender's band showed: the browser's own anatomy of the link. */
function senderGuidance(result: AnalysisResult) {
  const impersonates = splitLinkAnatomy(parse, result.url)?.impersonates;
  return getVerdictGuidance({ ...result, impersonates: impersonates ?? null });
}

interface Variant {
  name: string;
  verdict: Verdict;
  imperative: string;
  build: () => Promise<AnalysisResult>;
}

const variants: Variant[] = [
  {
    name: "Critical confirmed by a reputation source",
    verdict: "critical",
    imperative: "Don't open this link — it's a known threat.",
    build: async () =>
      resultFrom(await fixtureSignals("critical.scrutinix.test")),
  },
  {
    name: "Critical from local heuristics alone",
    verdict: "critical",
    imperative: "Don't open this link.",
    build: async () => resultFrom(await heuristicCriticalSignals()),
  },
  {
    name: "Malicious",
    verdict: "malicious",
    imperative: "Don't open this link.",
    build: async () =>
      resultFrom(await fixtureSignals("malicious.scrutinix.test")),
  },
  {
    name: "Suspicious",
    verdict: "suspicious",
    imperative: "Don't sign in or enter payment details here.",
    build: async () => {
      // An invalid certificate on a days-old domain, no reputation hit.
      const signals = await fixtureSignals("example.com");
      if (signals.ssl.data) signals.ssl.data.validationState = "invalid";
      if (signals.whois.data) signals.whois.data.ageDays = 3;
      return resultFrom(signals);
    },
  },
  {
    name: "Safe, high confidence and nothing found",
    verdict: "safe",
    imperative: "Looks safe to open.",
    build: async () => resultFrom(await fixtureSignals("example.com")),
  },
  {
    name: "Safe with minor warning signs",
    verdict: "safe",
    imperative: "Probably safe — still check who sent it.",
    build: async () => {
      const signals = await fixtureSignals("example.com");
      if (signals.virusTotal.data) signals.virusTotal.data.malicious = 1;
      const result = resultFrom(signals);
      expect(result.threatInfo?.hasPositiveEvidence).toBe(true);
      return result;
    },
  },
  {
    name: "Safe below high confidence",
    verdict: "safe",
    imperative: "Probably safe — still check who sent it.",
    build: async () => {
      const signals = await fixtureSignals("example.com");
      signals.virusTotal = {
        status: "error",
        data: null,
        error: "VirusTotal timed out.",
        durationMs: 1,
      };
      const result = resultFrom(signals, undefined, true);
      expect(result.threatInfo?.confidenceLabel).not.toBe("high");
      return result;
    },
  },
  {
    name: "Safe, high confidence, partly finished",
    verdict: "safe",
    imperative: "Probably safe — still check who sent it.",
    build: async () => {
      const result = resultFrom(
        await fixtureSignals("example.com"),
        undefined,
        true,
      );
      expect(result.threatInfo?.confidenceLabel).toBe("high");
      expect(result.threatInfo?.hasPositiveEvidence).toBe(false);
      return result;
    },
  },
  {
    name: "Safe look-alike (from the server's anatomy)",
    verdict: "safe",
    imperative: "Don't sign in or enter details here.",
    build: async () =>
      resultFrom(
        await fixtureSignals("example.com"),
        "https://paypal.com.secure-login.xyz/verify",
      ),
  },
  {
    name: "Unknown",
    verdict: "unknown",
    imperative: "We couldn't check this link — treat it as unsafe.",
    build: async () =>
      resultFrom(await fixtureSignals("unreachable.scrutinix.test")),
  },
  {
    name: "Error",
    verdict: "error",
    imperative: "The scan failed — try again.",
    build: async () => {
      const signals = await fixtureSignals("example.com");
      for (const name of signalNames) {
        signals[name] = {
          status: "error",
          data: null,
          error: "The provider failed.",
          durationMs: 1,
        };
      }
      return resultFrom(signals, undefined, true);
    },
  },
];

describe("a verified share says what the sender saw", () => {
  it.each(variants)("$name", async ({ verdict, imperative, build }) => {
    const result = await build();
    expect(result.verdict).toBe(verdict);
    const sender = senderGuidance(result);
    expect(sender.imperative).toBe(imperative);

    // The server issues and signs the share with the result it streams.
    const share = withResultShare(result).share;
    expect(share?.sig).toBeTruthy();
    const card = describeSharedSnapshot(share!.payload, share!.sig, NOW);
    expect(card).not.toBeNull();

    // The band (getSharedGuidance over the verified snapshot and the
    // server's anatomy), the share card, and the metadata agree with the
    // sender's band.
    const view = resolveSharedView(share!.payload, share!.sig, NOW);
    const band = getSharedGuidance(view!.snapshot!, view!.anatomy.impersonates);
    expect(band.imperative).toBe(sender.imperative);
    expect(band.tone).toBe(sender.tone);
    expect(card!.imperative).toBe(sender.imperative);
    expect(card!.guidance.tone).toBe(sender.tone);
    expect(card!.guidance.confidenceNote).toBe(sender.confidenceNote);
    const description = getSharedMetadata(
      share!.payload,
      share!.sig,
      NOW,
    )?.description;
    expect(description?.startsWith(`${sender.imperative} `)).toBe(true);
  });
});

describe("the signed basis", () => {
  it("is read from the result the same way the band reads it", async () => {
    const critical = resultFrom(
      await fixtureSignals("critical.scrutinix.test"),
    );
    expect(buildSharedSnapshot(critical).basis).toEqual({
      confidence: critical.threatInfo?.confidenceLabel,
      clean: false,
      partial: false,
      confirmed: true,
    });
    const safe = resultFrom(await fixtureSignals("example.com"));
    expect(buildSharedSnapshot(safe).basis).toEqual({
      confidence: "high",
      clean: true,
      partial: false,
      confirmed: false,
    });
  });

  it("never reassures without evidence", () => {
    expect(getVerdictBasis({ threatInfo: null })).toEqual({
      confidence: "low",
      clean: false,
      partial: false,
      confirmed: false,
    });
  });
});

describe("snapshots signed before the basis existed", () => {
  // Exactly what the server signed before this field: verdict, link,
  // summary, check time, and signature.
  function legacyShare(verdict: Verdict) {
    const payload = encodeSharedSnapshot({
      verdict,
      url: "https://example.com/login",
      summary: "",
      capturedAt: CHECKED_AT,
      signature: Array(8).fill("clear"),
    });
    expect(decodeSharedSnapshot(payload)?.basis).toBeUndefined();
    return signed(payload);
  }

  it("keep the hedged instruction on every surface", () => {
    for (const [verdict, hedged] of [
      ["safe", "Probably safe — still check who sent it."],
      ["critical", "Don't open this link."],
    ] as const) {
      const [payload, sig] = legacyShare(verdict);
      const card = describeSharedSnapshot(payload, sig, NOW);
      expect(card?.imperative, verdict).toBe(hedged);
      const view = resolveSharedView(payload, sig, NOW);
      expect(
        getSharedGuidance(view!.snapshot!, view!.anatomy.impersonates)
          .imperative,
      ).toBe(hedged);
      expect(
        getSharedMetadata(payload, sig, NOW)?.description?.startsWith(hedged),
      ).toBe(true);
    }
  });
});

describe("an unverified basis changes nothing shown", () => {
  it("states nothing for an unsigned or edited payload carrying a basis", async () => {
    const reassuring = {
      confidence: "high",
      clean: true,
      partial: false,
      confirmed: false,
    } as const;
    const critical = withResultShare(
      resultFrom(await fixtureSignals("critical.scrutinix.test")),
    ).share!;
    const heuristic = withResultShare(
      resultFrom(await heuristicCriticalSignals()),
    ).share!;

    // Someone's own "Looks safe to open." for a known threat: a Safe
    // verdict with a reassuring basis, never signed by Scrutinix.
    const forged = encodeSharedSnapshot({
      ...decodeSharedSnapshot(critical.payload)!,
      verdict: "safe",
      basis: reassuring,
    });
    // Genuine snapshots whose basis alone was edited after signing: one
    // softened, one made to claim "known threat".
    const softened = encodeSharedSnapshot({
      ...decodeSharedSnapshot(critical.payload)!,
      basis: { ...reassuring, confidence: "low" },
    });
    const hardened = encodeSharedSnapshot({
      ...decodeSharedSnapshot(heuristic.payload)!,
      basis: {
        ...decodeSharedSnapshot(heuristic.payload)!.basis!,
        confirmed: true,
      },
    });

    for (const [payload, sig] of [
      [forged, null],
      [forged, critical.sig],
      [softened, critical.sig],
      [hardened, heuristic.sig],
    ] as const) {
      const view = resolveSharedView(payload, sig, NOW);
      expect(view?.snapshot).toBeNull();
      expect(describeSharedSnapshot(payload, sig, NOW)).toBeNull();
      expect(getSharedMetadata(payload, sig, NOW)).toBeNull();
    }
  });

  it("is dropped when malformed, leaving the snapshot hedged", () => {
    const payload = btoa(
      encodeURIComponent(
        JSON.stringify({
          verdict: "safe",
          url: "https://example.com/login",
          summary: "",
          capturedAt: CHECKED_AT,
          basis: { confidence: "certain", clean: "yes" },
        }),
      ),
    );
    const [, sig] = signed(payload);
    const snapshot = resolveSharedView(payload, sig, NOW)?.snapshot;
    expect(snapshot).not.toBeNull();
    expect(snapshot?.basis).toBeUndefined();
    expect(describeSharedSnapshot(payload, sig, NOW)?.imperative).toBe(
      "Probably safe — still check who sent it.",
    );
  });
});
