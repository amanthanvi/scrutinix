import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isBlockedNetworkAddress } from "@/lib/domain/blocked-address";

export interface PublicNetworkTargetResolution {
  hostname: string;
  addresses: string[];
}

export type PublicNetworkTargetResult =
  | {
      ok: true;
      resolution: PublicNetworkTargetResolution;
    }
  | {
      ok: false;
      error: string;
    };

const BLOCKED_TARGET_MESSAGE =
  "The active network probe was blocked because the target resolves to a private, local, multicast, or reserved network address.";

export async function assertPublicNetworkTarget(
  urlOrHostname: string | URL,
): Promise<PublicNetworkTargetResult> {
  const hostname = normalizeHostname(
    urlOrHostname instanceof URL
      ? urlOrHostname.hostname
      : extractHostname(urlOrHostname),
  );

  if (!hostname) {
    return {
      ok: false,
      error:
        "The active network probe was blocked because the target hostname is empty.",
    };
  }

  const literalVersion = isIP(hostname);
  if (literalVersion !== 0) {
    return createResult(hostname, [hostname]);
  }

  let records: Array<{ address: string }>;

  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return {
      ok: false,
      error: "The hostname could not be resolved for the active network probe.",
    };
  }

  const addresses = records.map((record) => record.address);
  if (addresses.length === 0) {
    return {
      ok: false,
      error:
        "The hostname did not resolve to an address for the active network probe.",
    };
  }

  return createResult(hostname, addresses);
}

export { isBlockedNetworkAddress };

function createResult(
  hostname: string,
  addresses: string[],
): PublicNetworkTargetResult {
  const blockedAddress = addresses.find((address) =>
    isBlockedNetworkAddress(address),
  );

  if (blockedAddress) {
    return {
      ok: false,
      error: `${BLOCKED_TARGET_MESSAGE} Blocked address: ${blockedAddress}.`,
    };
  }

  return {
    ok: true,
    resolution: {
      hostname,
      addresses,
    },
  };
}

function extractHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function normalizeHostname(hostname: string) {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * Cap active probes at one IPv4 plus one IPv6 address. Hosts with many A
 * records would otherwise multiply per-address timeouts into minutes of
 * probing for no additional evidence.
 */
export function selectPublicProbeAddresses(
  resolution: PublicNetworkTargetResolution,
) {
  const ipv4 = resolution.addresses.find((address) => isIP(address) === 4);
  const ipv6 = resolution.addresses.find((address) => isIP(address) === 6);
  return [ipv4, ipv6].filter((address): address is string => Boolean(address));
}
