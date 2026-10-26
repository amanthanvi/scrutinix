import { formatElapsed } from "@/lib/domain/copy";
import type { SSLData } from "@/lib/domain/schemas";

type CertificateFacts = Pick<
  SSLData,
  | "validationState"
  | "authorizationError"
  | "validTo"
  | "daysRemaining"
  | "selfSigned"
  | "otherSite"
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
 * the Full row, and the Summary answer all say it this way. A certificate
 * read on the site an http:// link moves to (`otherSite`) is named as that
 * site's: "The certificate at landing.example has expired."
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

  const whose = data.otherSite
    ? `The certificate at ${data.otherSite}`
    : "The site's certificate";
  const code = data.authorizationError;
  if (code === "CERT_HAS_EXPIRED" || (data.daysRemaining ?? 0) < 0) {
    const validTo = data.validTo ? Date.parse(data.validTo) : Number.NaN;
    return asOf !== undefined && Number.isFinite(validTo) && validTo <= asOf
      ? `${whose} expired ${formatElapsed(asOf - validTo)} ago.`
      : `${whose} has expired.`;
  }
  if (code === "CERT_NOT_YET_VALID") {
    return `${whose} isn't valid yet.`;
  }
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || code === "HOSTNAME_MISMATCH") {
    return `${whose} was issued for a different name.`;
  }
  if (code === "CERT_REVOKED") {
    return `${whose} has been revoked.`;
  }
  if (code && UNTRUSTED_ISSUER.has(code)) {
    return `${whose} comes from an issuer browsers don't trust.`;
  }
  if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || data.selfSigned) {
    return `${whose} is self-signed, so no trusted authority vouches for it.`;
  }
  return `${whose} isn't trusted.`;
}

/**
 * The note on a certificate read on another site, where an http:// link
 * moves to HTTPS. The probe stores it first in the notes; limitations leave
 * it out, since it states whose certificate it is, not what was missed.
 */
export function otherSiteCertificateNote(site: string): string {
  return `This is the certificate of ${site}, where the link moves to HTTPS.`;
}
