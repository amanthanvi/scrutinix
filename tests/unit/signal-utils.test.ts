import {
  fixtureHosts,
  fixtureSignals,
} from "@/tests/fixtures/scenario-signals";
import { signalNames } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

import {
  getSignalSeverity,
  severityColor,
} from "@/components/shared/scrutinix-types";
import {
  describeHostingNetwork,
  describeTxtRecords,
  getSignalDetailEntries,
  getSignalFinding,
  getSignalSummary,
  shortenFingerprint,
} from "@/components/shared/signal-utils";
import { formatElapsed } from "@/lib/domain/copy";
import { dnsDataSchema } from "@/lib/domain/schemas";
import type {
  DNSData,
  RedirectData,
  SSLData,
  ThreatFeedsData,
  VirusTotalData,
} from "@/lib/domain/types";

function buildRedirectData(overrides: Partial<RedirectData>): RedirectData {
  return {
    finalUrl: "https://landing.example/",
    totalHops: 1,
    httpsUpgraded: false,
    reachable: true,
    terminalStatus: 200,
    terminalError: null,
    hops: [
      {
        url: "https://short.example/x",
        status: 302,
        location: "https://landing.example/",
      },
      { url: "https://landing.example/", status: 200 },
    ],
    observations: [],
    content: null,
    ...overrides,
  };
}

describe("the redirect finding", () => {
  const finding = (data: RedirectData) =>
    getSignalFinding("redirectChain", {
      status: "success",
      data,
      error: null,
      durationMs: 1,
    });

  it("never names where an unfinished chain stopped as its end", () => {
    // A redirect to mailto: or to a Location that isn't a link: the probe
    // stops there, but a browser would go on.
    const toMail = buildRedirectData({
      finalUrl: "https://short.example/x",
      totalHops: 1,
      hops: [
        {
          url: "https://short.example/x",
          status: 302,
          location: "mailto:help@short.example",
        },
      ],
    });
    expect(finding(toMail)).toBe("It redirects to an address we don't open.");
    expect(finding(toMail)).not.toContain(
      "redirect to https://short.example/x",
    );

    const afterOne = buildRedirectData({
      finalUrl: "https://landing.example/",
      totalHops: 2,
      hops: [
        {
          url: "https://short.example/x",
          status: 301,
          location: "https://landing.example/",
        },
        {
          url: "https://landing.example/",
          status: 302,
          location: "intent://open#Intent;end",
        },
      ],
    });
    expect(finding(afterOne)).toBe(
      "1 redirect, then one to an address we don't open.",
    );
  });

  it("never says a site didn't respond after it answered with a redirect", () => {
    // The next address was private (or failed): a response was recorded.
    const blocked = buildRedirectData({
      finalUrl: "https://short.example/x",
      totalHops: 1,
      reachable: false,
      terminalStatus: 302,
      hops: [
        {
          url: "https://short.example/x",
          status: 302,
          location: "http://10.0.0.8/",
        },
      ],
    });
    expect(finding(blocked)).toBe(
      "We followed 1 redirect but couldn't reach the end.",
    );

    const silent = buildRedirectData({
      reachable: false,
      totalHops: 0,
      hops: [],
    });
    expect(finding(silent)).toBe(
      "The site didn't respond when we tried to open it.",
    );
  });

  it("still states a finished chain's end", () => {
    expect(finding(buildRedirectData({}))).toBe(
      "1 redirect to https://landing.example/.",
    );
    expect(
      finding(
        buildRedirectData({
          totalHops: 0,
          hops: [{ url: "https://landing.example/", status: 200 }],
        }),
      ),
    ).toBe("Resolved without redirects.");
  });
});

describe("getSignalDetailEntries", () => {
  it("lists every redirect hop in order", () => {
    // SignalRow renders exactly these entries; without the hop rows the
    // intermediate URLs, statuses, and Location targets are invisible.
    const entries = getSignalDetailEntries(
      "redirectChain",
      buildRedirectData({}),
    );

    expect(entries.slice(0, 2)).toEqual([
      {
        label: "302",
        value: "https://short.example/x → https://landing.example/",
      },
      { label: "200", value: "https://landing.example/" },
    ]);
  });

  it("lists the VirusTotal engines that flagged the link first", () => {
    // VT returns engines alphabetically; an unsorted five could hide every
    // engine that flagged the link behind harmless ones.
    const results = [
      ...[
        "Acronis",
        "Avira",
        "BitDefender",
        "CRDF",
        "Emsisoft",
        "Fortinet",
      ].map((engine) => ({ engine, category: "harmless", result: "clean" })),
      { engine: "Sophos", category: "suspicious", result: "suspicious" },
      { engine: "Webroot", category: "malicious", result: "phishing" },
      { engine: "Kaspersky", category: "malicious", result: "malware" },
    ];
    const entries = getSignalDetailEntries(
      "virusTotal",
      buildVirusTotal({ malicious: 2, suspicious: 1, results }),
    );

    expect(entries.map((entry) => entry.label)).toEqual([
      "Engine results",
      "Webroot",
      "Kaspersky",
      "Sophos",
      "Acronis",
      "Avira",
    ]);
  });

  it("keeps a plain multi-hop chain expandable without notes or content", () => {
    const entries = getSignalDetailEntries(
      "redirectChain",
      buildRedirectData({ observations: [], content: null }),
    );

    expect(entries.length).toBeGreaterThan(0);
  });
});

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const HOUR = 1000 * 60 * 60;

function buildDns(overrides: Partial<DNSData>): DNSData {
  return {
    subjectType: "hostname",
    addresses: ["93.184.216.34"],
    cnames: [],
    mx: [],
    txt: [],
    nameservers: [],
    reverseHostnames: [],
    anomalies: [],
    observations: [],
    ...overrides,
  };
}

function buildSsl(overrides: Partial<SSLData>): SSLData {
  return {
    protocol: "TLSv1.3",
    available: true,
    validationState: "trusted",
    authorized: true,
    authorizationError: null,
    issuer: "Example CA",
    subject: "example.com",
    validFrom: "2026-10-01T00:00:00.000Z",
    validTo: "2026-12-23T12:00:00.000Z",
    daysRemaining: 90,
    selfSigned: false,
    fingerprint256:
      "5E:2A:9C:41:0B:7D:E3:88:12:F4:6A:C0:39:D5:7E:21:AB:04:CF:93:60:1E:B8:4D:72:E9:0A:35:C6:5B:F1:8D",
    observations: [],
    ...overrides,
  };
}

const rowsOf = (entries: { label: string; value: string }[]) =>
  Object.fromEntries(entries.map((entry) => [entry.label, entry.value]));

describe("evidence rows", () => {
  it("states the DNS hosting network as a registration, never a location", () => {
    const rows = rowsOf(
      getSignalDetailEntries(
        "dns",
        buildDns({
          cnames: ["edge.example-cdn.net"],
          nameservers: ["ns1.example.com", "ns2.example.com"],
          txt: [
            "v=spf1 include:_spf.example.com -all",
            "google-site-verification=abc",
            "MS=ms12345678",
            "some-vendor-domain-verification=xyz",
            "opaque token",
          ],
          hosting: {
            ip: "93.184.216.34",
            asn: 64500,
            asName: "EXAMPLE-NET",
            prefix: "93.184.216.0/24",
            registeredCountry: "NL",
          },
        }),
        NOW,
      ),
    );

    expect(rows).toMatchObject({
      Network: "AS64500 EXAMPLE-NET, registered in NL",
      CNAME: "edge.example-cdn.net",
      Nameservers: "ns1.example.com, ns2.example.com",
      "TXT records":
        "5 records: SPF, Google site verification, Microsoft 365 verification, domain verification, and 1 other",
    });
    expect(JSON.stringify(rows)).not.toMatch(/located|abc|xyz|opaque/);
  });

  it("omits empty DNS rows and words the hosting edge cases", () => {
    const labels = getSignalDetailEntries("dns", buildDns({}), NOW).map(
      (entry) => entry.label,
    );
    expect(labels).toEqual(["A records", "MX records"]);

    const hosting = {
      ip: "93.184.216.34",
      asn: 64500,
      asName: null,
      prefix: null,
      registeredCountry: null,
    };
    expect(describeHostingNetwork(hosting, 1)).toBe("AS64500");
    expect(describeHostingNetwork(hosting, 3)).toBe(
      "AS64500 (for 93.184.216.34)",
    );
    expect(describeHostingNetwork({ ...hosting, asn: null }, 1)).toBe(
      "No network routes this address publicly",
    );
  });

  it("counts TXT records without naming unknown kinds", () => {
    expect(describeTxtRecords(["opaque", "another"])).toBe("2 records");
    expect(describeTxtRecords(["v=spf1 -all"])).toBe("1 record: SPF");
  });

  it("dates what was seen from the check time, and expiry from now", () => {
    const checkedAt = NOW - 30 * 24 * HOUR;
    const rows = rowsOf(
      getSignalDetailEntries(
        "ssl",
        buildSsl({
          validFrom: new Date(checkedAt - 2 * HOUR).toISOString(),
          validTo: new Date(NOW + 10 * 24 * HOUR).toISOString(),
        }),
        NOW,
        checkedAt,
      ),
    );
    expect(rows).toMatchObject({
      "Certificate age": "0 days",
      "Expires in": "10 days",
    });
  });

  it("adds certificate facts, self-signed only when true", () => {
    const rows = rowsOf(getSignalDetailEntries("ssl", buildSsl({}), NOW));
    expect(rows).toMatchObject({
      "Expires in": "60 days",
      "TLS version": "TLS 1.3",
      "SHA-256": "5E:2A:9C:41…C6:5B:F1:8D",
    });
    expect(rows).not.toHaveProperty("Self-signed");

    const selfSigned = rowsOf(
      getSignalDetailEntries(
        "ssl",
        buildSsl({
          selfSigned: true,
          protocol: "unknown",
          validTo: "2026-10-21T12:00:00.000Z",
        }),
        NOW,
      ),
    );
    expect(selfSigned).toMatchObject({
      "Self-signed": "Yes",
      Expired: "3 days ago",
    });
    expect(selfSigned).not.toHaveProperty("TLS version");
    expect(shortenFingerprint("fixture")).toBe("fixture");
  });

  it("calls a certificate expired the moment it lapses, not after a rounded day", () => {
    const expiryAt = (offsetMs: number) => {
      const rows = rowsOf(
        getSignalDetailEntries(
          "ssl",
          buildSsl({ validTo: new Date(NOW + offsetMs).toISOString() }),
          NOW,
        ),
      );
      return rows["Expired"] !== undefined
        ? { Expired: rows["Expired"] }
        : { "Expires in": rows["Expires in"] };
    };

    expect(expiryAt(-6 * HOUR)).toEqual({ Expired: "less than a day ago" });
    expect(expiryAt(-1)).toEqual({ Expired: "less than a day ago" });
    expect(expiryAt(0)).toEqual({ "Expires in": "less than a day" });
    expect(expiryAt(1)).toEqual({ "Expires in": "less than a day" });
    expect(expiryAt(23 * HOUR)).toEqual({ "Expires in": "less than a day" });
    expect(expiryAt(-36 * HOUR)).toEqual({ Expired: "1 day ago" });
    expect(expiryAt(36 * HOUR)).toEqual({ "Expires in": "1 day" });
  });

  it("names iframes and password receivers only when present", () => {
    const content = {
      title: null,
      crossOriginFormHosts: ["collect.example"],
      crossOriginPasswordFormHosts: ["collect.example"],
      passwordInputCount: 1,
      iframeCount: 3,
      hiddenIframeCount: 1,
      obfuscationHints: [],
      metaRefreshTarget: null,
    };
    const rows = rowsOf(
      getSignalDetailEntries(
        "redirectChain",
        buildRedirectData({ content }),
        NOW,
      ),
    );
    expect(rows).toMatchObject({
      "Password form": "Sends the password to collect.example",
      Iframes: "3 iframes, 1 hidden",
    });

    const quiet = rowsOf(
      getSignalDetailEntries(
        "redirectChain",
        buildRedirectData({
          content: {
            ...content,
            crossOriginPasswordFormHosts: [],
            iframeCount: 0,
            hiddenIframeCount: 0,
          },
        }),
        NOW,
      ),
    );
    expect(quiet).not.toHaveProperty("Password form");
    expect(quiet).not.toHaveProperty("Iframes");
  });

  it("puts each feed's listing time right after its match", () => {
    const entries = getSignalDetailEntries(
      "threatFeeds",
      {
        checkedAt: "",
        matches: [
          {
            feed: "urlhaus",
            matchedUrl: "https://evil.example/",
            detail: "lists this link as a malware download",
            confidence: "high",
            matchType: "url",
            listedAt: new Date(NOW - 6 * HOUR).toISOString(),
          },
          {
            feed: "openphish",
            matchedUrl: "https://evil.example/",
            detail: "lists this link as phishing",
            confidence: "high",
            matchType: "url",
          },
        ],
        observations: [],
        warnings: [],
      },
      NOW,
    );

    expect(entries).toEqual([
      { label: "URLhaus", value: "Lists this link as a malware download." },
      { label: "Listed", value: "6 hours ago" },
      { label: "OpenPhish", value: "Lists this link as phishing." },
    ]);
  });

  it("adds one VirusTotal breakdown row", () => {
    const entries = getSignalDetailEntries(
      "virusTotal",
      buildVirusTotal({ malicious: 7, suspicious: 2 }),
      NOW,
    );
    expect(entries[0]).toEqual({
      label: "Engine results",
      value: "7 malicious, 2 suspicious, 60 harmless, 10 undetected",
    });
    expect(
      getSignalDetailEntries(
        "virusTotal",
        buildVirusTotal({ harmless: 0, undetected: 0 }),
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("dns hosting schema", () => {
  it("loads results saved before hosting existed and drops a malformed one", () => {
    const legacy = buildDns({});
    expect(dnsDataSchema.parse(legacy)).not.toHaveProperty("hosting");
    expect(dnsDataSchema.parse({ ...legacy, hosting: "AS1" }).hosting).toBe(
      undefined,
    );
  });

  it("keeps an explicit unrouted answer but drops a missing or invalid ASN", () => {
    const legacy = buildDns({ addresses: ["1.1.1.1"] });
    const hostingOf = (hosting: unknown) =>
      dnsDataSchema.parse({ ...legacy, hosting }).hosting;

    expect(hostingOf({ ip: "1.1.1.1", asn: null })).toEqual({
      ip: "1.1.1.1",
      asn: null,
      asName: null,
      prefix: null,
      registeredCountry: null,
    });
    expect(hostingOf({ ip: "1.1.1.1", asn: 4_294_967_295 })?.asn).toBe(
      4_294_967_295,
    );
    for (const asn of [
      "garbage",
      -4,
      0,
      1.5,
      4_294_967_296,
      Number.NaN,
      undefined,
    ]) {
      expect(hostingOf({ ip: "1.1.1.1", asn }), String(asn)).toBeUndefined();
    }
    expect(hostingOf({ ip: "1.1.1.1" })).toBeUndefined();

    const kept = dnsDataSchema.parse({
      ...legacy,
      hosting: { ip: "1.1.1.1", asn: "garbage" },
    });
    expect(kept.addresses).toEqual(["1.1.1.1"]);
    expect(getSignalDetailEntries("dns", kept, NOW)).not.toContainEqual(
      expect.objectContaining({ value: expect.stringContaining("No network") }),
    );
  });
});

describe("formatElapsed", () => {
  it("words hours, then days and months", () => {
    expect(formatElapsed(-5 * HOUR)).toBe("less than an hour");
    expect(formatElapsed(59 * 60 * 1000)).toBe("less than an hour");
    expect(formatElapsed(HOUR)).toBe("1 hour");
    expect(formatElapsed(47 * HOUR)).toBe("47 hours");
    expect(formatElapsed(48 * HOUR)).toBe("2 days");
    expect(formatElapsed(90 * 24 * HOUR)).toBe("about 3 months");
  });
});

function buildVirusTotal(overrides: Partial<VirusTotalData>): VirusTotalData {
  return {
    malicious: 0,
    suspicious: 0,
    harmless: 60,
    undetected: 10,
    timeout: 0,
    results: [],
    permalink: "https://www.virustotal.com/gui/url/x",
    ...overrides,
  };
}

describe("getSignalSummary", () => {
  it("states VirusTotal findings with count agreement", () => {
    expect(getSignalSummary("virusTotal", buildVirusTotal({}))).toBe(
      "No engines flagged this link.",
    );
    expect(
      getSignalSummary("virusTotal", buildVirusTotal({ malicious: 1 })),
    ).toBe("1 engine flagged this link as malicious.");
    expect(
      getSignalSummary(
        "virusTotal",
        buildVirusTotal({ malicious: 7, suspicious: 2 }),
      ),
    ).toBe("7 engines flagged this link as malicious, 2 as suspicious.");
  });

  it("names threat feeds by their proper names", () => {
    const data: ThreatFeedsData = {
      checkedAt: "",
      matches: [
        {
          feed: "spamhaus-dbl",
          matchedUrl: "evil.example",
          detail: "lists this domain as a phishing domain",
          confidence: "high",
          matchType: "host",
        },
        {
          feed: "urlhaus",
          matchedUrl: "https://evil.example/",
          detail: "lists this link as a malware download",
          confidence: "high",
          matchType: "url",
        },
      ],
      observations: [],
      warnings: [],
    };

    expect(getSignalSummary("threatFeeds", data)).toBe(
      "Spamhaus DBL lists this domain as a phishing domain. URLhaus lists this link as a malware download.",
    );
    expect(getSignalDetailEntries("threatFeeds", data).slice(0, 2)).toEqual([
      {
        label: "Spamhaus DBL",
        value: "Lists this domain as a phishing domain.",
      },
      { label: "URLhaus", value: "Lists this link as a malware download." },
    ]);
  });
});

describe("getSignalFinding", () => {
  it("describes the finding rather than the transport status", () => {
    expect(
      getSignalFinding("virusTotal", {
        status: "success",
        data: buildVirusTotal({ malicious: 7 }),
        error: null,
        durationMs: 10,
      }),
    ).toBe("7 engines flagged this link as malicious.");
    expect(
      getSignalFinding("dns", {
        status: "error",
        data: null,
        error: "DNS timed out.",
        durationMs: 10,
      }),
    ).toBe("DNS timed out.");
    expect(
      getSignalFinding("ssl", {
        status: "pending",
        data: null,
        error: null,
        durationMs: 0,
      }),
    ).toBe("Waiting.");
  });
});

describe("signal severity", () => {
  it("calls a source that found nothing clear, in gray rather than green", () => {
    const severity = getSignalSeverity(
      "success",
      buildVirusTotal({}),
      "virusTotal",
    );

    expect(severity).toBe("clear");
    expect(severityColor.clear.dot).toBe("var(--sx-clear)");
    expect(
      Object.values(severityColor).map((color) => color.dot),
    ).not.toContain("var(--sx-safe)");
  });

  it("says the certificate check didn't apply to a link that never reaches HTTPS", () => {
    const ssl = buildSsl({
      available: false,
      validationState: "unavailable",
      authorized: false,
      issuer: null,
      subject: null,
      validFrom: null,
      validTo: null,
      daysRemaining: null,
      fingerprint256: null,
      noHttps: true,
      observations: [
        "This link never moves to HTTPS, so there's no certificate to check.",
      ],
    });

    // Not "gave a partial answer": nothing was lost.
    expect(getSignalSeverity("success", ssl, "ssl")).toBe("skipped");
    expect(getSignalSummary("ssl", ssl)).toBe(
      "This link never moves to HTTPS, so there's no certificate to check.",
    );
    // No certificate fields to list, so the row has no disclosure.
    expect(getSignalDetailEntries("ssl", ssl)).toEqual([]);
  });
});

describe("plain findings for checks that couldn't run", () => {
  const JARGON = /TLS|probe|RDAP|DNS zone|handshake|port 443|literal IP/i;

  it("uses fixed plain sentences and keeps provider text in Notes", async () => {
    const signals = await fixtureSignals("unreachable.scrutinix.test");
    const ssl = signals.ssl.data!;
    const dns = signals.dns.data!;
    const redirect = signals.redirectChain.data!;

    expect(getSignalSummary("ssl", ssl)).toBe(
      "We couldn't check the site's security certificate.",
    );
    expect(getSignalSummary("dns", dns)).toBe(
      "This address doesn't point to any server.",
    );
    expect(getSignalSummary("redirectChain", redirect)).toBe(
      "The site didn't respond when we tried to open it.",
    );
    // The raw provider wording is still one click away.
    expect(getSignalDetailEntries("ssl", ssl)).toContainEqual({
      label: "Notes",
      value: "No TLS handshake could be completed.",
    });

    const states = [
      ["invalid", "The site's security certificate isn't trusted."],
      ["untrusted", "The site's security certificate isn't trusted."],
      ["warning", "We couldn't fully verify the site's security certificate."],
      ["trusted", "The site's security certificate is valid."],
    ] as const;
    for (const [validationState, sentence] of states) {
      expect(
        getSignalSummary("ssl", {
          ...ssl,
          available: true,
          validationState,
          authorizationError: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          observations: ["TLS authorization failed: CERT_HAS_EXPIRED"],
        }),
      ).toBe(sentence);
    }

    expect(
      getSignalSummary("dns", {
        ...dns,
        subjectType: "ip",
        observations: ["DNS zone records do not apply to literal IP targets."],
      }),
    ).toBe("This link uses a raw IP address instead of a domain name.");

    const whois = (await fixtureSignals("example.com")).whois.data!;
    expect(
      getSignalSummary("whois", {
        ...whois,
        available: false,
        observations: ["RDAP returned 404."],
      }),
    ).toBe("Registration records weren't available.");
    expect(getSignalSummary("whois", whois)).toBe(
      "Registered about 8 years ago.",
    );
    expect(getSignalSummary("whois", { ...whois, ageDays: 12 })).toBe(
      "Registered 12 days ago.",
    );
  });

  it("keeps jargon out of every fixture summary", async () => {
    for (const host of fixtureHosts) {
      const signals = await fixtureSignals(host);
      for (const name of signalNames) {
        const data = signals[name].data;
        if (data) {
          expect(getSignalSummary(name, data)).not.toMatch(JARGON);
        }
      }
    }
  });
});

describe("scored severity", () => {
  it("turns a quiet row into a warning when the verdict scored it", () => {
    const vt = buildVirusTotal({});
    expect(getSignalSeverity("success", vt, "virusTotal", true)).toBe(
      "suspicious",
    );
    expect(getSignalSeverity("error", null, "virusTotal", true)).toBe("error");
  });
});
