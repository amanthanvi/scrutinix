import tls from "node:tls";
import { isIP } from "node:net";

import type { SSLData } from "@/lib/domain/types";
import {
  assertPublicNetworkTarget,
  selectPublicProbeAddresses,
} from "@/lib/server/public-network-target";

/** Resolves host/port for the TLS probe (exported for unit tests). */
export function getTlsProbeTarget(url: string): {
  hostname: string;
  port: number;
} {
  const target = new URL(url);
  const hostname = target.hostname;
  const defaultPort = target.protocol === "https:" ? 443 : 80;
  const port =
    target.port !== "" ? Number(target.port) || defaultPort : defaultPort;

  return { hostname, port };
}

/** Aggregate budget across every probed address. */
const SSL_SIGNAL_BUDGET_MS = 12_000;
const SSL_PROBE_TIMEOUT_MS = 8_000;

export async function runSslSignal(
  url: string,
  signal?: AbortSignal,
): Promise<SSLData> {
  const { hostname, port } = getTlsProbeTarget(url);
  const deadline = Date.now() + SSL_SIGNAL_BUDGET_MS;
  const publicTarget = await assertPublicNetworkTarget(hostname, {
    signal,
    timeoutMs: Math.max(0, deadline - Date.now()),
  });

  if (!publicTarget.ok) {
    return createUnavailableSslData(publicTarget.error);
  }
  const probeAddresses = selectPublicProbeAddresses(publicTarget.resolution);

  if (probeAddresses.length === 0) {
    return createUnavailableSslData(
      "The hostname did not resolve to an address for the TLS probe.",
    );
  }

  let lastResult: SSLData | null = null;

  for (const probeAddress of probeAddresses) {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || signal?.aborted) {
      break;
    }

    const result = await runSslProbe(
      hostname,
      port,
      probeAddress,
      Math.min(SSL_PROBE_TIMEOUT_MS, remaining),
      signal,
    );
    if (result.available) {
      return result;
    }
    lastResult = result;
  }

  return (
    lastResult ??
    createUnavailableSslData("The TLS probe failed for every resolved address.")
  );
}

function runSslProbe(
  hostname: string,
  port: number,
  probeAddress: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SSLData> {
  return new Promise<SSLData>((resolve) => {
    const socket = tls.connect({
      host: probeAddress,
      port,
      servername: isIP(hostname) ? undefined : hostname,
      rejectUnauthorized: false,
    });

    const onAbort = () => {
      socket.destroy();
      resolve(
        createUnavailableSslData(
          "The TLS probe was cancelled before it completed.",
        ),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("close", () => {
      signal?.removeEventListener("abort", onAbort);
    });

    socket.setTimeout(timeoutMs);

    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      socket.end();

      if (!certificate || Object.keys(certificate).length === 0) {
        resolve(
          createUnavailableSslData(
            "The endpoint did not present a TLS certificate.",
          ),
        );
        return;
      }

      const validTo = certificate.valid_to
        ? new Date(certificate.valid_to).toISOString()
        : null;
      const validFrom = certificate.valid_from
        ? new Date(certificate.valid_from).toISOString()
        : null;
      const daysRemaining = validTo
        ? Math.round(
            (new Date(validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          )
        : null;
      const issuerCommonName = normalizeCertificateName(certificate.issuer?.CN);
      const subjectCommonName = normalizeCertificateName(
        certificate.subject?.CN,
      );
      const authorizationError =
        typeof socket.authorizationError === "string"
          ? socket.authorizationError
          : null;
      const validationState = getValidationState(
        authorizationError,
        daysRemaining,
        issuerCommonName,
        subjectCommonName,
      );

      resolve({
        protocol: socket.getProtocol() ?? "unknown",
        available: true,
        validationState,
        authorized:
          validationState === "trusted" || validationState === "warning",
        authorizationError,
        issuer: issuerCommonName,
        subject: subjectCommonName,
        validFrom,
        validTo,
        daysRemaining,
        selfSigned:
          issuerCommonName !== null && issuerCommonName === subjectCommonName,
        fingerprint256: certificate.fingerprint256 ?? null,
        observations: buildSslObservations(
          validationState,
          authorizationError,
          daysRemaining,
        ),
      });
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(
        createUnavailableSslData(
          "The host did not complete a TLS handshake before the timeout.",
        ),
      );
    });

    socket.once("error", (error) => {
      socket.destroy();
      resolve(createUnavailableSslData(describeTlsFailure(error, port)));
    });
  });
}

function buildSslObservations(
  validationState: SSLData["validationState"],
  authorizationError: string | null,
  daysRemaining: number | null,
) {
  const observations: string[] = [];

  if (validationState === "warning" && authorizationError) {
    observations.push(
      "The certificate chain could not be fully verified from the scanning runtime.",
    );
  }

  if (validationState === "invalid" && authorizationError) {
    observations.push(`TLS validation failed: ${authorizationError}.`);
  }

  if (daysRemaining !== null && daysRemaining < 0) {
    observations.push("The TLS certificate is expired.");
  } else if (daysRemaining !== null && daysRemaining < 14) {
    observations.push("The TLS certificate expires within the next 14 days.");
  }

  return observations;
}

function createUnavailableSslData(message: string): SSLData {
  return {
    protocol: null,
    available: false,
    validationState: "unavailable",
    authorized: false,
    authorizationError: null,
    issuer: null,
    subject: null,
    validFrom: null,
    validTo: null,
    daysRemaining: null,
    selfSigned: false,
    fingerprint256: null,
    observations: [message],
  };
}

function getValidationState(
  authorizationError: string | null,
  daysRemaining: number | null,
  issuerCommonName: string | null,
  subjectCommonName: string | null,
): SSLData["validationState"] {
  if (daysRemaining !== null && daysRemaining < 0) {
    return "invalid";
  }

  if (
    issuerCommonName !== null &&
    subjectCommonName !== null &&
    issuerCommonName === subjectCommonName
  ) {
    return "untrusted";
  }

  if (!authorizationError) {
    return "trusted";
  }

  if (
    authorizationError === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    authorizationError === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  ) {
    return "warning";
  }

  if (
    authorizationError === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    authorizationError === "SELF_SIGNED_CERT_IN_CHAIN"
  ) {
    return "untrusted";
  }

  return "invalid";
}

function describeTlsFailure(error: unknown, port: number) {
  if (!(error instanceof Error)) {
    return "The TLS probe failed unexpectedly.";
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;

  switch (code) {
    case "ECONNREFUSED":
      return `The host refused a TLS connection on port ${port}.`;
    case "ENOTFOUND":
      return "The hostname could not be resolved for the TLS probe.";
    case "ECONNRESET":
      return "The TLS connection was reset before the handshake completed.";
    case "ETIMEDOUT":
      return "The TLS probe timed out before the host responded.";
    default:
      return error.message || "The TLS probe failed unexpectedly.";
  }
}

function normalizeCertificateName(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
