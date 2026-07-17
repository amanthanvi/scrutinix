import http from "node:http";
import https from "node:https";

import type { RedirectData } from "@/lib/domain/types";
import {
  assertPublicNetworkTarget,
  selectPublicProbeAddresses,
  type PublicNetworkTargetResolution,
} from "@/lib/server/public-network-target";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 8_000;

export async function runRedirectSignal(url: string): Promise<RedirectData> {
  const hops: RedirectData["hops"] = [];
  let currentUrl = url;
  let reachable = true;
  let terminalStatus: number | null = null;
  let terminalError: string | null = null;
  let currentResolution: PublicNetworkTargetResolution | null = null;
  const observations: string[] = [];

  for (let attempt = 0; attempt < MAX_REDIRECTS; attempt += 1) {
    if (!currentResolution) {
      const publicTarget = await assertPublicNetworkTarget(currentUrl);
      if (!publicTarget.ok) {
        reachable = false;
        terminalError = publicTarget.error;
        observations.push(publicTarget.error);
        break;
      }
      currentResolution = publicTarget.resolution;
    }

    const outcome = await requestRedirectHop(currentUrl, currentResolution);
    if ("error" in outcome) {
      reachable = false;
      terminalError = outcome.error;
      observations.push(outcome.error);
      break;
    }

    const { status, location } = outcome;
    terminalStatus = status;
    hops.push({
      url: currentUrl,
      status,
      location: location ?? undefined,
    });

    if (!location || !REDIRECT_STATUSES.has(status)) {
      break;
    }

    const nextUrl = new URL(location, currentUrl).toString();
    const publicRedirectTarget = await assertPublicNetworkTarget(nextUrl);

    if (!publicRedirectTarget.ok) {
      currentUrl = nextUrl;
      reachable = false;
      terminalError = publicRedirectTarget.error;
      observations.push(publicRedirectTarget.error);
      break;
    }

    currentUrl = nextUrl;
    currentResolution = publicRedirectTarget.resolution;
  }

  return {
    finalUrl: currentUrl,
    totalHops: hops.filter(
      (hop) => hop.location && REDIRECT_STATUSES.has(hop.status),
    ).length,
    httpsUpgraded:
      new URL(url).protocol === "http:" &&
      new URL(currentUrl).protocol === "https:",
    reachable,
    terminalStatus,
    terminalError,
    hops,
    observations,
  };
}

async function requestRedirectHop(
  url: string,
  resolution: PublicNetworkTargetResolution,
) {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  const addresses = selectPublicProbeAddresses(resolution);

  if (addresses.length === 0) {
    return {
      error:
        "The hostname did not resolve to an address for the redirect probe.",
    };
  }

  let lastError: string | null = null;

  for (const address of addresses) {
    const outcome = await requestRedirectHopAtAddress(
      client,
      target,
      resolution.hostname,
      address,
    );
    if (!("error" in outcome)) {
      return outcome;
    }
    lastError = outcome.error;
  }

  return {
    error: lastError ?? "The redirect probe failed for every resolved address.",
  };
}

async function requestRedirectHopAtAddress(
  client: typeof http | typeof https,
  target: URL,
  servername: string,
  address: string,
) {
  return await new Promise<
    { status: number; location: string | null } | { error: string }
  >((resolve) => {
    const request = client.request(
      {
        protocol: target.protocol,
        hostname: address,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        rejectUnauthorized: false,
        servername,
        headers: {
          host: target.host,
          "user-agent": "scrutinix/3.0",
        },
      },
      (response) => {
        const locationHeader = response.headers.location;
        const location = Array.isArray(locationHeader)
          ? (locationHeader[0] ?? null)
          : (locationHeader ?? null);

        resolve({
          status: response.statusCode ?? 0,
          location,
        });

        response.resume();
      },
    );

    request.once("error", (error) => {
      resolve({
        error: describeRedirectFailure(error),
      });
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      resolve({
        error: `The host did not respond to the redirect probe within ${REQUEST_TIMEOUT_MS}ms.`,
      });
    });

    request.end();
  });
}

function describeRedirectFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return "The redirect probe failed unexpectedly.";
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;

  switch (code) {
    case "ECONNREFUSED":
      return "The host refused the redirect probe on the target port.";
    case "ENOTFOUND":
      return "The hostname could not be resolved during the redirect probe.";
    case "ECONNRESET":
      return "The redirect probe connection was reset before a response arrived.";
    case "ETIMEDOUT":
      return "The redirect probe timed out before the host responded.";
    default:
      return error.message || "The redirect probe failed unexpectedly.";
  }
}
