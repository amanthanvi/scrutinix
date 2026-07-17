const PRIVATE_HOSTS = new Set(["localhost", "0.0.0.0", "::1"]);

const IPV4_BLOCKED_SUBNETS = [
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
] as const;

const IPV6_BLOCKED_SUBNETS = [
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
] as const;

/** True for localhost, *.local, and reserved / private / multicast IP literals. */
export function isBlockedHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);

  if (PRIVATE_HOSTS.has(normalized) || normalized.endsWith(".local")) {
    return true;
  }

  return isBlockedNetworkAddress(normalized);
}

export function isBlockedNetworkAddress(address: string) {
  const normalized = normalizeHostname(address);
  const ipVersion = getIpVersion(normalized);

  if (ipVersion === 4) {
    return isBlockedIpv4(normalized);
  }

  if (ipVersion === 6) {
    const embeddedIpv4 = getEmbeddedIpv4FromIpv6(normalized);
    if (embeddedIpv4) {
      return isBlockedIpv4(embeddedIpv4);
    }

    return isBlockedIpv6(normalized);
  }

  return false;
}

function isBlockedIpv4(address: string) {
  const value = ipv4ToInt(address);
  if (value === null) {
    return false;
  }

  return IPV4_BLOCKED_SUBNETS.some(([range, prefix]) => {
    const base = ipv4ToInt(range);
    if (base === null) {
      return false;
    }

    const mask = (~0 << (32 - prefix)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

function isBlockedIpv6(address: string) {
  const bytes = parseIpv6Bytes(address);
  if (!bytes) {
    return false;
  }

  return IPV6_BLOCKED_SUBNETS.some(([range, prefix]) => {
    const rangeBytes = parseIpv6Bytes(range);
    if (!rangeBytes) {
      return false;
    }

    return ipv6PrefixEqual(bytes, rangeBytes, prefix);
  });
}

function ipv6PrefixEqual(left: number[], right: number[], prefix: number) {
  let remaining = prefix;

  for (let index = 0; index < 16; index += 1) {
    const leftByte = left[index] ?? 0;
    const rightByte = right[index] ?? 0;

    if (remaining >= 8) {
      if (leftByte !== rightByte) {
        return false;
      }
      remaining -= 8;
      continue;
    }

    if (remaining === 0) {
      return true;
    }

    const mask = (0xff << (8 - remaining)) & 0xff;
    return (leftByte & mask) === (rightByte & mask);
  }

  return true;
}

function ipv4ToInt(address: string) {
  const octets = address.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
    )
  ) {
    return null;
  }

  const [a, b, c, d] = octets as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function getIpVersion(hostname: string) {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return 4;
  }

  if (hostname.includes(":")) {
    return 6;
  }

  return 0;
}

function normalizeHostname(hostname: string) {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
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
    octets.some(
      (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
    )
  ) {
    return null;
  }

  const [a, b, c, d] = octets as [number, number, number, number];
  return [(a << 8) + b, (c << 8) + d];
}
