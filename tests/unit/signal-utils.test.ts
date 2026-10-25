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
  getSignalDetailEntries,
  getSignalFinding,
  getSignalSummary,
} from "@/components/shared/signal-utils";
import type {
  RedirectData,
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

  it("keeps a plain multi-hop chain expandable without notes or content", () => {
    const entries = getSignalDetailEntries(
      "redirectChain",
      buildRedirectData({ observations: [], content: null }),
    );

    expect(entries.length).toBeGreaterThan(0);
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
