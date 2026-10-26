import tls from "node:tls";
import { isIP } from "node:net";

import { describeCertificateProblem } from "@/lib/domain/certificate";
import type { RedirectData, SSLData } from "@/lib/domain/types";
import { bareHostname } from "@/lib/domain/url";
import {
  checkFailureMessage,
  type CheckFailureOptions,
} from "@/lib/server/client-error";
import {
  assertPublicNetworkTarget,
  selectPublicProbeAddresses,
} from "@/lib/server/public-network-target";

/**
 * Where the TLS probe reads a certificate (exported for unit tests).
 *
 * An https: link: its own host and port. An http: link: the first HTTPS
 * address its redirect chain reached, the certificate a visitor's browser
 * checks there (http://github.com moves to https://github.com/). A chain
 * that answered and never reached HTTPS has no certificate to read, so
 * null. When the chain is unknown or never answered, the link's own host
 * on the port the link names, else 443: a site that answers only over TLS
 * still counts as answering. Never port 80 for a plain link: a web server
 * there answers a TLS hello with plain HTTP (ERR_SSL_WRONG_VERSION_NUMBER),
 * which says nothing about the site.
 *
 * WHATWG URL leaves port as "" when absent and otherwise guarantees an
 * in-range numeric string, so only emptiness means "use the default": an
 * explicit :0 stays 0, the endpoint the redirect probe uses.
 */
export function getTlsProbeTarget(
  url: string,
  chain?: RedirectData | null,
): { hostname: string; port: number } | null {
  const target = new URL(url);
  if (target.protocol === "http:" && chain) {
    const firstHttps = [...chain.hops.map((hop) => hop.url), chain.finalUrl]
      .map(parseUrl)
      .find((candidate) => candidate?.protocol === "https:");
    if (firstHttps) {
      return endpointOf(firstHttps);
    }
    if (chain.reachable) {
      return null;
    }
  }

  return endpointOf(target);
}

function endpointOf(target: URL) {
  return {
    hostname: bareHostname(target),
    port: target.port === "" ? 443 : Number(target.port),
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Aggregate budget across every probed address. */
const SSL_SIGNAL_BUDGET_MS = 12_000;
const SSL_PROBE_TIMEOUT_MS = 8_000;

/**
 * `redirects` is the scan's own redirect-chain run (shared, so the link is
 * opened once): a plain-HTTP link's certificate is read where the chain
 * first reaches HTTPS.
 */
export async function runSslSignal(
  url: string,
  signal?: AbortSignal,
  scanId?: string,
  redirects?: () => Promise<RedirectData>,
): Promise<SSLData> {
  const chain =
    redirects && new URL(url).protocol === "http:"
      ? await redirects().catch(() => null)
      : null;
  const probeTarget = getTlsProbeTarget(url, chain);
  if (!probeTarget) {
    return createNoHttpsSslData();
  }

  const { hostname, port } = probeTarget;
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
  // An unexpected failure on one address is lost coverage even when the
  // next address merely refuses or times out; only a certificate clears it.
  let unexpectedFailure: SSLData | null = null;

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
      { correlationId: scanId, redact: [url, hostname] },
      signal,
    );
    if (result.available) {
      return result;
    }
    if (result.probeFailed) {
      unexpectedFailure ??= result;
    }
    lastResult = result;
  }

  return (
    unexpectedFailure ??
    lastResult ??
    createUnavailableSslData("The TLS probe failed for every resolved address.")
  );
}

function runSslProbe(
  hostname: string,
  port: number,
  probeAddress: string,
  timeoutMs: number,
  failureLog: ProbeFailureLog,
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

      const facts = {
        validationState,
        authorizationError,
        validTo,
        daysRemaining,
        selfSigned:
          issuerCommonName !== null && issuerCommonName === subjectCommonName,
      };
      resolve({
        ...facts,
        protocol: socket.getProtocol() ?? "unknown",
        available: true,
        authorized:
          validationState === "trusted" || validationState === "warning",
        issuer: issuerCommonName,
        subject: subjectCommonName,
        validFrom,
        fingerprint256: certificate.fingerprint256 ?? null,
        observations: buildSslObservations(facts),
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
      const failure = describeTlsFailure(error, port, failureLog);
      resolve(
        createUnavailableSslData(failure.message, {
          probeFailed: failure.unexpected,
        }),
      );
    });
  });
}

/** Plain sentences only: the raw verification code stays in `authorizationError`. */
function buildSslObservations(
  facts: Parameters<typeof describeCertificateProblem>[0],
) {
  const observations: string[] = [];

  if (facts.validationState === "warning" && facts.authorizationError) {
    observations.push(
      "The certificate chain could not be fully verified from the scanning runtime.",
    );
  }

  // Covers an expired certificate too ("The site's certificate has expired.").
  const problem = describeCertificateProblem(facts);
  if (problem) {
    observations.push(problem);
  } else if (facts.daysRemaining !== null && facts.daysRemaining < 14) {
    observations.push("The certificate expires within the next 14 days.");
  }

  return observations;
}

/**
 * A plain-HTTP link whose redirects never reach HTTPS: there is no
 * certificate in its path. An answer, not lost coverage: the cell reads
 * "didn't apply", and the result stays complete and cacheable.
 */
function createNoHttpsSslData(): SSLData {
  return {
    ...createUnavailableSslData(
      "This link never moves to HTTPS, so there's no certificate to check.",
    ),
    noHttps: true,
  };
}

function createUnavailableSslData(
  message: string,
  { probeFailed = false }: { probeFailed?: boolean } = {},
): SSLData {
  return {
    ...(probeFailed ? { probeFailed: true } : {}),
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

const TLS_FAILURE_SUMMARIES: Record<string, (port: number) => string> = {
  ECONNREFUSED: (port) => `The host refused a TLS connection on port ${port}.`,
  ENOTFOUND: () => "The hostname could not be resolved for the TLS probe.",
  ECONNRESET: () =>
    "The TLS connection was reset before the handshake completed.",
  ETIMEDOUT: () => "The TLS probe timed out before the host responded.",
  // Plain HTTP (or another protocol) on the port: the host answered, just
  // not with TLS. A finding about the endpoint, not a probe failure.
  ERR_SSL_WRONG_VERSION_NUMBER: (port) =>
    `The host answered on port ${port} without TLS.`,
  ERR_SSL_PACKET_LENGTH_TOO_LONG: (port) =>
    `The host answered on port ${port} without TLS.`,
};

type ProbeFailureLog = Pick<CheckFailureOptions, "correlationId" | "redact">;

function describeTlsFailure(
  error: unknown,
  port: number,
  failureLog: ProbeFailureLog,
) {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  const summary = code ? TLS_FAILURE_SUMMARIES[code] : undefined;
  if (summary) {
    return { message: summary(port), unexpected: false };
  }

  return {
    message: checkFailureMessage(error, {
      ...failureLog,
      summary: "The TLS probe failed unexpectedly.",
      logEvent: "ssl.probe_failed",
    }),
    unexpected: true,
  };
}

function normalizeCertificateName(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
