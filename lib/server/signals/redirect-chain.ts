import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";

import { analyzePageContent } from "@/lib/domain/content-analysis";
import type { RedirectData } from "@/lib/domain/types";
import {
  assertPublicNetworkTarget,
  selectPublicProbeAddresses,
  type PublicNetworkTargetResolution,
} from "@/lib/server/public-network-target";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 8_000;
/** Aggregate budget across the whole chain (all hops, all addresses). */
const REDIRECT_SIGNAL_BUDGET_MS = 12_000;
/** Cap on captured terminal-page HTML; enough for head, forms, and inline scripts. */
const BODY_CAPTURE_LIMIT_BYTES = 64 * 1024;
const BODY_CAPTURE_TIMEOUT_MS = 3_000;

export async function runRedirectSignal(
  url: string,
  signal?: AbortSignal,
): Promise<RedirectData> {
  const hops: RedirectData["hops"] = [];
  let currentUrl = url;
  let reachable = true;
  let terminalStatus: number | null = null;
  let terminalError: string | null = null;
  let currentResolution: PublicNetworkTargetResolution | null = null;
  let terminalBody: string | null = null;
  const observations: string[] = [];
  const deadline = Date.now() + REDIRECT_SIGNAL_BUDGET_MS;

  for (let attempt = 0; attempt < MAX_REDIRECTS; attempt += 1) {
    if (Date.now() >= deadline || signal?.aborted) {
      observations.push(
        "The redirect probe stopped before the chain was fully followed (time budget exhausted).",
      );
      break;
    }

    if (!currentResolution) {
      const publicTarget = await assertPublicNetworkTarget(currentUrl, {
        signal,
        timeoutMs: Math.max(0, deadline - Date.now()),
      });
      if (!publicTarget.ok) {
        reachable = false;
        terminalError = publicTarget.error;
        observations.push(publicTarget.error);
        break;
      }
      currentResolution = publicTarget.resolution;
    }

    const outcome = await requestRedirectHop(
      currentUrl,
      currentResolution,
      deadline,
      signal,
    );
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
      terminalBody = outcome.body ?? null;
      break;
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      observations.push(
        "The redirect chain stopped at a Location header that is not a valid URL.",
      );
      break;
    }

    // Only follow web schemes; a redirect into file:/data:/ftp: territory is
    // recorded as an observation and never fetched.
    if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
      observations.push(
        `The redirect chain stopped at a non-HTTP scheme (${nextUrl.protocol.replace(/:$/, "")}).`,
      );
      break;
    }

    const publicRedirectTarget = await assertPublicNetworkTarget(
      nextUrl.toString(),
      {
        signal,
        timeoutMs: Math.max(0, deadline - Date.now()),
      },
    );

    if (!publicRedirectTarget.ok) {
      currentUrl = nextUrl.toString();
      reachable = false;
      terminalError = publicRedirectTarget.error;
      observations.push(publicRedirectTarget.error);
      break;
    }

    currentUrl = nextUrl.toString();
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
    content: terminalBody ? analyzePageContent(terminalBody, currentUrl) : null,
  };
}

async function requestRedirectHop(
  url: string,
  resolution: PublicNetworkTargetResolution,
  deadline: number,
  signal?: AbortSignal,
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
    const remaining = deadline - Date.now();
    if (remaining <= 0 || signal?.aborted) {
      return {
        error:
          lastError ??
          "The redirect probe ran out of time before the host responded.",
      };
    }

    const outcome = await requestRedirectHopAtAddress(
      client,
      target,
      resolution.hostname,
      address,
      Math.min(REQUEST_TIMEOUT_MS, remaining),
      signal,
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
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return await new Promise<
    | { status: number; location: string | null; body: string | null }
    | { error: string }
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
        const status = response.statusCode ?? 0;
        const contentType = response.headers["content-type"] ?? "";
        const isTerminalHtml =
          !(location && REDIRECT_STATUSES.has(status)) &&
          typeof contentType === "string" &&
          contentType.toLowerCase().includes("text/html");

        if (isTerminalHtml) {
          // Capture a bounded slice of the final page for content analysis;
          // the same response is already SSRF-gated, so no new fetch happens.
          void captureBody(response).then((body) => {
            resolve({ status, location, body });
          });
          return;
        }

        resolve({ status, location, body: null });

        // Headers are all we need; destroy instead of draining the body so
        // a link to a multi-gigabyte file doesn't transfer the whole thing.
        response.destroy();
      },
    );

    const onAbort = () => {
      request.destroy();
      resolve({ error: "The redirect probe was cancelled." });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    request.once("close", () => {
      signal?.removeEventListener("abort", onAbort);
    });

    request.once("error", (error) => {
      resolve({
        error: describeRedirectFailure(error),
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve({
        error: `The host did not respond to the redirect probe within ${REQUEST_TIMEOUT_MS}ms.`,
      });
    });

    request.end();
  });
}

/** Read up to BODY_CAPTURE_LIMIT_BYTES, then destroy the response. */
function captureBody(response: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      response.destroy();
      resolve(total > 0 ? Buffer.concat(chunks).toString("utf8") : null);
    };

    const timer = setTimeout(finish, BODY_CAPTURE_TIMEOUT_MS);

    response.on("data", (chunk: Buffer) => {
      const remaining = BODY_CAPTURE_LIMIT_BYTES - total;
      if (remaining <= 0) {
        finish();
        return;
      }

      const captured = chunk.subarray(0, remaining);
      chunks.push(captured);
      total += captured.length;
      if (total >= BODY_CAPTURE_LIMIT_BYTES) {
        finish();
      }
    });
    response.once("end", finish);
    response.once("error", finish);
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
