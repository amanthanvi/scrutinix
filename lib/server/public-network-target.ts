import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

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

const blockedRanges = new BlockList();

for (const [range, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedRanges.addSubnet(range, prefix, "ipv4");
}

for (const [range, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedRanges.addSubnet(range, prefix, "ipv6");
}

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

export function isBlockedNetworkAddress(address: string) {
  const normalized = normalizeHostname(address);
  const ipVersion = isIP(normalized);

  if (ipVersion === 4) {
    return blockedRanges.check(normalized, "ipv4");
  }

  if (ipVersion === 6) {
    const embeddedIpv4 = getEmbeddedIpv4FromIpv6(normalized);
    if (embeddedIpv4) {
      return blockedRanges.check(embeddedIpv4, "ipv4");
    }

    return blockedRanges.check(normalized, "ipv6");
  }

  return false;
}

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

export function selectPublicProbeAddress(
  resolution: PublicNetworkTargetResolution,
) {
  return resolution.addresses[0] ?? null;
}

export function selectPublicProbeAddresses(
  resolution: PublicNetworkTargetResolution,
) {
  return resolution.addresses;
}

function getEmbeddedIpv4FromIpv6(address: string) {
  const bytes = parseIpv6Bytes(address);
  if (!bytes) {
    return null;
  }

  const isMapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;

  if (isMapped) {
    return bytes.slice(12).join(".");
  }

  const isCompatible =
    bytes.slice(0, 12).every((byte) => byte === 0) &&
    bytes.slice(12).some((byte) => byte !== 0);
  if (isCompatible) {
    return bytes.slice(12).join(".");
  }

  const isWellKnownNat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0);
  if (isWellKnownNat64) {
    return bytes.slice(12).join(".");
  }

  return null;
}

function parseIpv6Bytes(address: string) {
  const hextets = parseIpv6Hextets(address);
  if (!hextets) {
    return null;
  }

  return hextets.flatMap((hextet) => [hextet >> 8, hextet & 0xff]);
}

function parseIpv6Hextets(address: string) {
  const normalized = address.toLowerCase();
  const doubleColonParts = normalized.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  const left = parseIpv6Side(doubleColonParts[0] ?? "");
  const right = parseIpv6Side(doubleColonParts[1] ?? "");
  if (!left || !right) {
    return null;
  }

  if (doubleColonParts.length === 1) {
    return left.length === 8 ? left : null;
  }

  const zeroFill = 8 - left.length - right.length;
  if (zeroFill < 1) {
    return null;
  }

  return [...left, ...Array.from({ length: zeroFill }, () => 0), ...right];
}

function parseIpv6Side(side: string) {
  if (side === "") {
    return [];
  }

  const parts = side.split(":");
  const hextets: number[] = [];

  for (const part of parts) {
    if (part.includes(".")) {
      const ipv4Hextets = parseEmbeddedIpv4(part);
      if (!ipv4Hextets) {
        return null;
      }
      hextets.push(...ipv4Hextets);
      continue;
    }

    if (!/^[\da-f]{1,4}$/.test(part)) {
      return null;
    }

    hextets.push(Number.parseInt(part, 16));
  }

  return hextets;
}

function parseEmbeddedIpv4(value: string) {
  const octets = value.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  const [a, b, c, d] = octets as [number, number, number, number];
  return [(a << 8) + b, (c << 8) + d];
}
