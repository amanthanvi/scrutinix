import {
  reverse,
  resolve4,
  resolve6,
  resolveCname,
  resolveMx,
  resolveNs,
  resolveTxt,
} from "node:dns/promises";
import { isIP } from "node:net";

import {
  isBlockedNetworkAddress,
  PRIVATE_ADDRESSES_OMITTED,
} from "@/lib/domain/blocked-address";
import type { DNSData } from "@/lib/domain/types";
import { bareHostname } from "@/lib/domain/url";
import { withTimeout } from "@/lib/server/http";
import { lookupHostingNetwork } from "@/lib/server/providers/team-cymru";

/**
 * Public addresses of one family (IPv4 or IPv6) at which a hostname's
 * address records count as unusual. Per family: a dual-stack name doubles
 * its count without being unusual (youtu.be answers 4 A and 4 AAAA).
 */
export const MANY_ADDRESS_RECORDS = 6;

/**
 * `signal` cancels the hosting-network lookup (the only lookup here that
 * reaches a third party); the record lookups use their own timeouts.
 */
export async function runDnsSignal(
  url: string,
  signal?: AbortSignal,
): Promise<DNSData> {
  const hostname = bareHostname(url);

  if (isIP(hostname)) {
    const { publicAddresses, blockedCount } = partitionAddresses([hostname]);
    const [reverseLookup, hosting] = await Promise.all([
      Promise.allSettled([withTimeout(reverse(hostname), 5_000, "PTR lookup")]),
      lookupHostingNetwork(publicAddresses, signal),
    ]);
    const reverseHostnames =
      reverseLookup[0]?.status === "fulfilled" ? reverseLookup[0].value : [];

    const observations = [
      "DNS zone records do not apply to literal IP targets.",
      ...(reverseHostnames.length > 0
        ? [`Reverse DNS returned ${reverseHostnames.join(", ")}.`]
        : ["No reverse DNS hostnames were returned for the IP address."]),
    ];

    if (blockedCount > 0) {
      observations.push(PRIVATE_ADDRESSES_OMITTED);
    }

    return {
      subjectType: "ip",
      addresses: publicAddresses,
      cnames: [],
      mx: [],
      txt: [],
      nameservers: [],
      reverseHostnames,
      anomalies: [],
      observations,
      ...(hosting ? { hosting } : {}),
    };
  }

  // The hosting lookup starts as soon as the addresses are known, so it
  // overlaps the remaining record lookups instead of following them.
  const addressLookup = Promise.allSettled([
    withTimeout(resolve4(hostname), 5_000, "A record lookup"),
    withTimeout(resolve6(hostname), 5_000, "AAAA record lookup"),
  ]).then(([ipv4Addresses, ipv6Addresses]) => {
    const addressList = unique([
      ...(ipv4Addresses.status === "fulfilled" ? ipv4Addresses.value : []),
      ...(ipv6Addresses.status === "fulfilled" ? ipv6Addresses.value : []),
    ]);
    return {
      addressList,
      ...partitionAddresses(addressList),
      lookupErrors: [ipv4Addresses, ipv6Addresses].map((lookup) =>
        lookup.status === "rejected" ? errorCodeOf(lookup.reason) : null,
      ),
    };
  });

  const [
    { addressList, publicAddresses, blockedCount, lookupErrors },
    hosting,
    [cnames, mxRecords, nameservers, txtRecords],
  ] = await Promise.all([
    addressLookup,
    addressLookup.then(({ publicAddresses }) =>
      lookupHostingNetwork(publicAddresses, signal),
    ),
    Promise.allSettled([
      withTimeout(resolveCname(hostname), 5_000, "CNAME lookup"),
      withTimeout(resolveMx(hostname), 5_000, "MX lookup"),
      withTimeout(resolveNs(hostname), 5_000, "NS lookup"),
      withTimeout(resolveTxt(hostname), 5_000, "TXT lookup"),
    ]),
  ]);

  const cnameList = cnames.status === "fulfilled" ? cnames.value : [];
  const mxList =
    mxRecords.status === "fulfilled"
      ? mxRecords.value.map((entry) => entry.exchange).filter(Boolean)
      : [];
  const nameserverList =
    nameservers.status === "fulfilled" ? nameservers.value : [];
  const txtList =
    txtRecords.status === "fulfilled"
      ? txtRecords.value.map((record) => record.join("")).filter(Boolean)
      : [];

  const anomalies: string[] = [];
  const observations: string[] = [];

  if (hostname.includes("xn--")) {
    anomalies.push("The hostname uses punycode encoding.");
  }

  const ipv4Count = publicAddresses.filter((ip) => isIP(ip) === 4).length;
  if (
    Math.max(ipv4Count, publicAddresses.length - ipv4Count) >=
    MANY_ADDRESS_RECORDS
  ) {
    anomalies.push(
      "The hostname resolves to an unusually high number of address records.",
    );
  }

  if (addressList.length === 0 && cnameList.length === 0) {
    observations.push(describeMissingAddresses(lookupErrors));
  }

  if (blockedCount > 0) {
    observations.push(PRIVATE_ADDRESSES_OMITTED);
  }

  return {
    subjectType: "hostname",
    addresses: publicAddresses,
    cnames: cnameList,
    mx: mxList,
    txt: txtList,
    nameservers: nameserverList,
    reverseHostnames: [],
    anomalies,
    observations,
    ...(hosting ? { hosting } : {}),
  };
}

/** Resolver answers that mean the name has no address, not a failed lookup. */
const NO_ADDRESS_CODES = new Set(["ENODATA", "ENOTFOUND"]);

/**
 * Why a name has no address, from the A and AAAA lookups' error codes:
 * NXDOMAIN (the name doesn't exist), NODATA (it exists without address
 * records), or a lookup that got no answer (SERVFAIL, a timeout, a refused
 * query), which says nothing about the name.
 */
function describeMissingAddresses(codes: readonly (string | null)[]): string {
  if (codes.includes("ENOTFOUND")) {
    return "The hostname doesn't exist in DNS.";
  }
  if (codes.every((code) => code === null || NO_ADDRESS_CODES.has(code))) {
    return "No A, AAAA, or CNAME records were returned for the hostname.";
  }
  return "The DNS lookup got no answer (a server failure or a timeout), so we couldn't find the hostname's addresses.";
}

function errorCodeOf(reason: unknown): string {
  return reason instanceof Error &&
    "code" in reason &&
    typeof reason.code === "string"
    ? reason.code
    : "UNKNOWN";
}

function partitionAddresses(addresses: string[]) {
  const publicAddresses: string[] = [];
  let blockedCount = 0;

  for (const address of addresses) {
    if (isBlockedNetworkAddress(address)) {
      blockedCount += 1;
      continue;
    }

    publicAddresses.push(address);
  }

  return { publicAddresses, blockedCount };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
