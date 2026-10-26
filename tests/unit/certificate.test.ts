import { describe, expect, it } from "vitest";

import { describeCertificateProblem } from "@/lib/domain/certificate";
import type { SSLData } from "@/lib/domain/types";
import { getSummaryQuestions } from "@/lib/domain/summary-questions";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

const DAY_MS = 86_400_000;

function facts(
  overrides: Partial<SSLData>,
): Parameters<typeof describeCertificateProblem>[0] {
  return {
    validationState: "invalid",
    authorizationError: null,
    validTo: "2030-01-01T00:00:00.000Z",
    daysRemaining: 1000,
    selfSigned: false,
    ...overrides,
  };
}

describe("describeCertificateProblem", () => {
  it("words each verification failure plainly, never as its code", () => {
    // The badssl.com cases production scanned.
    const cases: [Partial<SSLData>, string][] = [
      [
        { authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID" },
        "The site's certificate was issued for a different name.",
      ],
      [
        {
          validationState: "untrusted",
          authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
          selfSigned: true,
        },
        "The site's certificate is self-signed, so no trusted authority vouches for it.",
      ],
      [
        {
          validationState: "untrusted",
          authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
        },
        "The site's certificate comes from an issuer browsers don't trust.",
      ],
      [
        { authorizationError: "CERT_NOT_YET_VALID" },
        "The site's certificate isn't valid yet.",
      ],
      [
        { authorizationError: "CERT_REVOKED" },
        "The site's certificate has been revoked.",
      ],
      [
        { authorizationError: "CERT_SIGNATURE_FAILURE" },
        "The site's certificate isn't trusted.",
      ],
    ];
    for (const [overrides, sentence] of cases) {
      const text = describeCertificateProblem(facts(overrides));
      expect(text).toBe(sentence);
      expect(text).not.toMatch(/[A-Z]{3,}_/);
    }
  });

  it("says how long ago a certificate expired, as of the check", () => {
    const expired = facts({
      authorizationError: "CERT_HAS_EXPIRED",
      validTo: "2015-04-12T23:59:59.000Z",
      daysRemaining: -4214,
    });
    const checkedAt = Date.parse("2026-10-25T19:32:59.000Z");

    expect(describeCertificateProblem(expired, checkedAt)).toBe(
      "The site's certificate expired about 11 years ago.",
    );
    // Without a clock (a stored note, the Full row) it stays timeless.
    expect(describeCertificateProblem(expired)).toBe(
      "The site's certificate has expired.",
    );
    // Lapsed hours ago: the code says expired before the day count does.
    expect(
      describeCertificateProblem(
        facts({
          authorizationError: "CERT_HAS_EXPIRED",
          validTo: new Date(checkedAt - 6 * 3_600_000).toISOString(),
          daysRemaining: 0,
        }),
        checkedAt,
      ),
    ).toBe("The site's certificate expired 6 hours ago.");
  });

  it("has nothing to say about a certificate that isn't invalid or untrusted", () => {
    expect(
      describeCertificateProblem(facts({ validationState: "trusted" })),
    ).toBeNull();
    expect(
      describeCertificateProblem(
        facts({
          validationState: "warning",
          authorizationError: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        }),
      ),
    ).toBeNull();
  });

  it("is what the verdict's reason and the Summary's HTTPS answer say", async () => {
    const checkedAt = Date.parse("2026-10-25T19:32:59.000Z");
    const signals = await fixtureSignals("example.com");
    signals.ssl.data = {
      ...signals.ssl.data!,
      validationState: "invalid",
      authorized: false,
      authorizationError: "CERT_HAS_EXPIRED",
      validFrom: new Date(checkedAt - 4300 * DAY_MS).toISOString(),
      validTo: new Date(checkedAt - 4214 * DAY_MS).toISOString(),
      daysRemaining: -4214,
      // An older release stored the raw code here.
      observations: ["TLS validation failed: CERT_HAS_EXPIRED."],
    };

    const sentence = "The site's certificate expired about 11 years ago.";
    expect(
      buildThreatAssessment(signals, checkedAt).threatInfo?.reasons,
    ).toContain(sentence);
    const https = getSummaryQuestions({
      url: "https://example.com/",
      signals,
      now: checkedAt,
    }).find((question) => question.id === "https");
    expect(https?.answer).toContain(sentence);
    expect(https?.answer).not.toMatch(/CERT_/);
  });
});
