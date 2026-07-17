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

import { isBlockedNetworkAddress } from "@/lib/domain/blocked-address";
import type { DNSData } from "@/lib/domain/types";
import { withTimeout } from "@/lib/server/http";

const REDACTED_ADDRESS_OBSERVATION =
  "Private or reserved addresses were omitted from the DNS result.";

export async function runDnsSignal(url: string): Promise<DNSData> {
  const hostname = new URL(url).hostname;

  if (isIP(hostname)) {
    const reverseLookup = await Promise.allSettled([
      withTimeout(reverse(hostname), 5_000, "PTR lookup"),
    ]);
    const reverseHostnames =
      reverseLookup[0]?.status === "fulfilled" ? reverseLookup[0].value : [];

    const { publicAddresses, blockedCount } = partitionAddresses([hostname]);
    const observations = [
      "DNS zone records do not apply to literal IP targets.",
      ...(reverseHostnames.length > 0
        ? [`Reverse DNS returned ${reverseHostnames.join(", ")}.`]
        : ["No reverse DNS hostnames were returned for the IP address."]),
    ];

    if (blockedCount > 0) {
      observations.push(REDACTED_ADDRESS_OBSERVATION);
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
    };
  }

  const [
    ipv4Addresses,
    ipv6Addresses,
    cnames,
    mxRecords,
    nameservers,
    txtRecords,
  ] = await Promise.allSettled([
    withTimeout(resolve4(hostname), 5_000, "A record lookup"),
    withTimeout(resolve6(hostname), 5_000, "AAAA record lookup"),
    withTimeout(resolveCname(hostname), 5_000, "CNAME lookup"),
    withTimeout(resolveMx(hostname), 5_000, "MX lookup"),
    withTimeout(resolveNs(hostname), 5_000, "NS lookup"),
    withTimeout(resolveTxt(hostname), 5_000, "TXT lookup"),
  ]);

  const addressList = unique([
    ...(ipv4Addresses.status === "fulfilled" ? ipv4Addresses.value : []),
    ...(ipv6Addresses.status === "fulfilled" ? ipv6Addresses.value : []),
  ]);
  const { publicAddresses, blockedCount } = partitionAddresses(addressList);
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

  if (publicAddresses.length >= 6) {
    anomalies.push(
      "The hostname resolves to an unusually high number of address records.",
    );
  }

  if (addressList.length === 0 && cnameList.length === 0) {
    observations.push(
      "No A, AAAA, or CNAME records were returned for the hostname.",
    );
  }

  if (blockedCount > 0) {
    observations.push(REDACTED_ADDRESS_OBSERVATION);
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
  };
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
