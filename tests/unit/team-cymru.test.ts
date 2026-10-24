import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import * as logger from "@/lib/server/logger";
import {
  lookupHostingNetwork,
  originQueryName,
  parseAsNameRecords,
  parseOriginRecords,
  resetTeamCymruCacheForTests,
  selectHostingAddress,
  type TxtResolver,
} from "@/lib/server/providers/team-cymru";

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

/** Answers by query name; anything unlisted is NXDOMAIN. */
function fakeResolver(
  answers: Record<string, string[][] | Error>,
): TxtResolver & { queries: string[]; cancel: Mock<() => void> } {
  const queries: string[] = [];
  return {
    queries,
    cancel: vi.fn<() => void>(),
    async resolveTxt(name: string) {
      queries.push(name);
      const answer = answers[name] ?? dnsError("ENOTFOUND");
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
}

const V4_ORIGIN = "34.216.184.93.origin.asn.cymru.com";

describe("selectHostingAddress", () => {
  it("prefers the first public IPv4 address", () => {
    expect(
      selectHostingAddress([
        "2606:2800:220:1:248:1893:25c8:1946",
        "93.184.216.34",
        "93.184.216.35",
      ]),
    ).toBe("93.184.216.34");
  });

  it("falls back to IPv6 and skips private, reserved, and documentation addresses", () => {
    expect(
      selectHostingAddress([
        "10.0.0.5",
        "192.168.1.1",
        "203.0.113.10",
        "fd00::1",
        "2001:db8::1",
        "2606:4700::6810:84e5",
      ]),
    ).toBe("2606:4700::6810:84e5");
  });

  it("returns null when nothing is queryable", () => {
    expect(selectHostingAddress(["127.0.0.1", "::1", "not-an-ip"])).toBeNull();
    expect(selectHostingAddress([])).toBeNull();
  });
});

describe("originQueryName", () => {
  it("reverses IPv4 octets under origin.asn.cymru.com", () => {
    expect(originQueryName("93.184.216.34")).toBe(V4_ORIGIN);
  });

  it("reverses all 32 IPv6 nibbles under origin6.asn.cymru.com", () => {
    expect(originQueryName("2606:4700::6810:84e5")).toBe(
      "5.e.4.8.0.1.8.6.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.7.4.6.0.6.2.origin6.asn.cymru.com",
    );
  });

  it("rejects non-addresses", () => {
    expect(originQueryName("example.com")).toBeNull();
  });
});

describe("Cymru TXT parsing", () => {
  it("reads an IPv4 origin answer", () => {
    expect(
      parseOriginRecords([["13335 | 1.1.1.0/24 | AU | apnic | 2011-08-11"]]),
    ).toEqual({ asn: 13335, prefix: "1.1.1.0/24", country: "AU" });
  });

  it("reads an IPv6 origin answer split across TXT strings", () => {
    expect(
      parseOriginRecords([
        ["13335 | 2606:4700::/32 | US | ar", "in | 2010-07-14"],
      ]),
    ).toEqual({ asn: 13335, prefix: "2606:4700::/32", country: "US" });
  });

  it("takes the most specific prefix and the first of several origin ASNs", () => {
    expect(
      parseOriginRecords([
        ["3356 | 8.0.0.0/9 | US | arin | 1992-12-01"],
        ["15169 36040 | 8.8.8.0/24 | US | arin | 2023-12-28"],
      ]),
    ).toEqual({ asn: 15169, prefix: "8.8.8.0/24", country: "US" });
  });

  it("returns null for malformed answers", () => {
    expect(parseOriginRecords([])).toBeNull();
    expect(parseOriginRecords([["not a cymru answer"]])).toBeNull();
    expect(parseOriginRecords([["AS13335 | 1.1.1.0/24 | AU"]])).toBeNull();
    expect(parseOriginRecords([["0 | 1.1.1.0/24 | AU"]])).toBeNull();
  });

  it("keeps the ASN but drops a malformed prefix or country", () => {
    expect(parseOriginRecords([["64500 | 1.1.1.0/99 | Netherlands"]])).toEqual({
      asn: 64500,
      prefix: null,
      country: null,
    });
    expect(parseOriginRecords([["64500 | 1.1.1.0/24 | ZZ"]])).toEqual({
      asn: 64500,
      prefix: "1.1.1.0/24",
      country: null,
    });
  });

  it("reads the AS name without its repeated country suffix", () => {
    expect(
      parseAsNameRecords(
        [["13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US"]],
        13335,
      ),
    ).toEqual({ asName: "CLOUDFLARENET", country: "US" });
    expect(
      parseAsNameRecords(
        [["24940 | DE | ripencc | 2002-06-03 | HETZNER-AS, DE"]],
        24940,
      ),
    ).toEqual({ asName: "HETZNER-AS", country: "DE" });
  });

  it("ignores AS answers for a different ASN and strips control characters", () => {
    expect(
      parseAsNameRecords([["15169 | US | arin | 2000-03-30 | GOOGLE, US"]], 1),
    ).toBeNull();
    expect(
      parseAsNameRecords(
        [["64500 | NL | ripencc | | EVIL\u202eNET\u0007"]],
        64500,
      ),
    ).toEqual({ asName: "EVILNET", country: "NL" });
  });
});

describe("lookupHostingNetwork", () => {
  beforeEach(() => {
    resetTeamCymruCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the network for an IPv4 address", async () => {
    const resolver = fakeResolver({
      [V4_ORIGIN]: [["15133 | 93.184.216.0/24 | EU | ripencc | 2008-06-02"]],
      "AS15133.asn.cymru.com": [
        ["15133 | US | arin | 2007-03-19 | EDGECAST, US"],
      ],
    });

    await expect(
      lookupHostingNetwork(["93.184.216.34"], undefined, resolver),
    ).resolves.toEqual({
      ip: "93.184.216.34",
      asn: 15133,
      asName: "EDGECAST",
      prefix: "93.184.216.0/24",
      registeredCountry: "US",
    });
  });

  it("returns the network for an IPv6-only host", async () => {
    const ip = "2606:4700::6810:84e5";
    const resolver = fakeResolver({
      [originQueryName(ip)!]: [
        ["13335 | 2606:4700::/32 | US | arin | 2010-07-14"],
      ],
      "AS13335.asn.cymru.com": [
        ["13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US"],
      ],
    });

    const hosting = await lookupHostingNetwork([ip], undefined, resolver);
    expect(hosting).toMatchObject({ ip, asn: 13335, asName: "CLOUDFLARENET" });
  });

  it("records NXDOMAIN as no routed origin, without an error", async () => {
    const warn = vi.spyOn(logger, "logWarn").mockImplementation(() => {});
    const resolver = fakeResolver({});

    await expect(
      lookupHostingNetwork(["93.184.216.34"], undefined, resolver),
    ).resolves.toEqual({
      ip: "93.184.216.34",
      asn: null,
      asName: null,
      prefix: null,
      registeredCountry: null,
    });
    expect(resolver.queries).toEqual([V4_ORIGIN]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves hosting unset on a timeout and logs no address", async () => {
    const warn = vi.spyOn(logger, "logWarn").mockImplementation(() => {});
    const resolver = fakeResolver({ [V4_ORIGIN]: dnsError("ETIMEOUT") });

    await expect(
      lookupHostingNetwork(["93.184.216.34"], undefined, resolver),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("dns.hosting_lookup_failed", {
      stage: "origin",
      code: "ETIMEOUT",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("93.184");
  });

  it("leaves hosting unset on a malformed origin answer", async () => {
    vi.spyOn(logger, "logWarn").mockImplementation(() => {});
    const resolver = fakeResolver({ [V4_ORIGIN]: [["garbage"]] });

    await expect(
      lookupHostingNetwork(["93.184.216.34"], undefined, resolver),
    ).resolves.toBeUndefined();
  });

  it("keeps the ASN when the AS name lookup fails, using the prefix country", async () => {
    vi.spyOn(logger, "logWarn").mockImplementation(() => {});
    const resolver = fakeResolver({
      [V4_ORIGIN]: [["64500 | 93.184.216.0/24 | NL | ripencc | 2008-06-02"]],
      "AS64500.asn.cymru.com": dnsError("ESERVFAIL"),
    });

    await expect(
      lookupHostingNetwork(["93.184.216.34"], undefined, resolver),
    ).resolves.toEqual({
      ip: "93.184.216.34",
      asn: 64500,
      asName: null,
      prefix: "93.184.216.0/24",
      registeredCountry: "NL",
    });
  });

  it("caches AS names per ASN", async () => {
    const answers = {
      [V4_ORIGIN]: [["64500 | 93.184.216.0/24 | NL | ripencc | 2008-06-02"]],
      "35.216.184.93.origin.asn.cymru.com": [
        ["64500 | 93.184.216.0/24 | NL | ripencc | 2008-06-02"],
      ],
      "AS64500.asn.cymru.com": [
        ["64500 | NL | ripencc | 2008-06-02 | EXAMPLE-NET, NL"],
      ],
    };
    const first = fakeResolver(answers);
    const second = fakeResolver(answers);

    await lookupHostingNetwork(["93.184.216.34"], undefined, first);
    const hosting = await lookupHostingNetwork(
      ["93.184.216.35"],
      undefined,
      second,
    );

    expect(first.queries).toHaveLength(2);
    expect(second.queries).toEqual(["35.216.184.93.origin.asn.cymru.com"]);
    expect(hosting?.asName).toBe("EXAMPLE-NET");
  });

  it("never queries a private address", async () => {
    const resolver = fakeResolver({});

    await expect(
      lookupHostingNetwork(["10.0.0.5", "192.168.0.1"], undefined, resolver),
    ).resolves.toBeUndefined();
    expect(resolver.queries).toEqual([]);
  });

  it("cancels in-flight queries when the scan aborts", async () => {
    const warn = vi.spyOn(logger, "logWarn").mockImplementation(() => {});
    const controller = new AbortController();
    const resolver = fakeResolver({});
    resolver.resolveTxt = (name: string) => {
      resolver.queries.push(name);
      return new Promise((_, reject) => {
        resolver.cancel.mockImplementation(() =>
          reject(dnsError("ECANCELLED")),
        );
        controller.abort();
      });
    };

    await expect(
      lookupHostingNetwork(["93.184.216.34"], controller.signal, resolver),
    ).resolves.toBeUndefined();
    expect(resolver.cancel).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing once the scan has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const resolver = fakeResolver({});

    await expect(
      lookupHostingNetwork(["93.184.216.34"], controller.signal, resolver),
    ).resolves.toBeUndefined();
    expect(resolver.queries).toEqual([]);
  });
});
