import { formatElapsed } from "@/lib/domain/copy";
import type { SSLData } from "@/lib/domain/schemas";

type CertificateFacts = Pick<
  SSLData,
  | "validationState"
  | "authorizationError"
  | "validTo"
  | "daysRemaining"
  | "selfSigned"
>;

/** Issuer problems: the chain ends at an authority browsers don't trust. */
const UNTRUSTED_ISSUER = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_UNTRUSTED",
  "CERT_CHAIN_TOO_LONG",
  "INVALID_CA",
]);

/**
 * Why a certificate isn't trusted, in plain words, from the facts the TLS
 * probe stored, never the OpenSSL or Node code itself
 * ("CERT_HAS_EXPIRED"). Null unless the certificate is invalid or
 * untrusted. `asOf` (the evidence time) dates an expiry: "expired about 11
 * years ago"; without it the sentence is timeless. The verdict's reason,
 * the Full row, and the Summary answer all say it this way.
 */
export function describeCertificateProblem(
  data: CertificateFacts,
  asOf?: number,
): string | null {
  if (
    data.validationState !== "invalid" &&
    data.validationState !== "untrusted"
  ) {
    return null;
  }

  const code = data.authorizationError;
  if (code === "CERT_HAS_EXPIRED" || (data.daysRemaining ?? 0) < 0) {
    const validTo = data.validTo ? Date.parse(data.validTo) : Number.NaN;
    return asOf !== undefined && Number.isFinite(validTo) && validTo <= asOf
      ? `The site's certificate expired ${formatElapsed(asOf - validTo)} ago.`
      : "The site's certificate has expired.";
  }
  if (code === "CERT_NOT_YET_VALID") {
    return "The site's certificate isn't valid yet.";
  }
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || code === "HOSTNAME_MISMATCH") {
    return "The site's certificate was issued for a different name.";
  }
  if (code === "CERT_REVOKED") {
    return "The site's certificate has been revoked.";
  }
  if (code && UNTRUSTED_ISSUER.has(code)) {
    return "The site's certificate comes from an issuer browsers don't trust.";
  }
  if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || data.selfSigned) {
    return "The site's certificate is self-signed, so no trusted authority vouches for it.";
  }
  return "The site's certificate isn't trusted.";
}
