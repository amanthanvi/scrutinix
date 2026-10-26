import {
  capitalize,
  countOf,
  formatAge,
  formatElapsed,
  formatList,
} from "@/lib/domain/copy";
import {
  describeFeedFinding,
  describeFeedMatch,
  describeSafeBrowsingThreat,
  describeSafeBrowsingThreats,
  feedDisplayName,
  humanizeToken,
  isElsewhereOnHost,
} from "@/lib/domain/feed-copy";
import { REDIRECT_STATUSES } from "@/lib/domain/signal-severity";
import type {
  DNSData,
  GoogleSafeBrowsingData,
  HostingNetwork,
  MLSignalData,
  RedirectData,
  SignalName,
  SignalPayloadMap,
  SignalResult,
  SSLData,
  ThreatFeedsData,
  VirusTotalData,
  WhoisData,
} from "@/lib/domain/types";

/** The finding as one sentence: what this check found, not its status. */
/** Model labels in plain words: "benign" is jargon for "normal". */
function plainModelLabel(label: string): string {
  switch (label) {
    case "benign":
      return "Normal";
    case "risky":
      return "Looks risky";
    case "malicious":
      return "Looks malicious";
    default:
      return `Looks like ${label}`;
  }
}

export function getSignalFinding<N extends SignalName>(
  name: N,
  result: SignalResult<SignalPayloadMap[N]>,
): string {
  switch (result.status) {
    case "pending":
      return "Waiting.";
    case "skipped":
      return result.error ?? "Not applicable.";
    case "error":
      return result.error ?? "This check failed.";
    default:
      return result.data
        ? getSignalSummary(name, result.data)
        : "Check complete.";
  }
}

export function getSignalSummary(
  name: SignalName,
  data: SignalPayloadMap[SignalName],
): string {
  switch (name) {
    case "virusTotal": {
      const d = data as VirusTotalData;
      if (d.malicious === 0 && d.suspicious === 0) {
        return "No engines flagged this link.";
      }
      if (d.suspicious === 0) {
        return `${countOf(d.malicious, "engine")} flagged this link as malicious.`;
      }
      if (d.malicious === 0) {
        return `${countOf(d.suspicious, "engine")} flagged this link as suspicious.`;
      }
      return `${countOf(d.malicious, "engine")} flagged this link as malicious, ${d.suspicious} as suspicious.`;
    }
    case "mlEnsemble": {
      const d = data as MLSignalData;
      if (d.consensusLabel === "benign") {
        return "The link's wording and structure look normal.";
      }

      return `The link's wording and structure look ${d.consensusLabel} (risk ${(d.consensusScore * 100).toFixed(0)} of 100).`;
    }
    case "googleSafeBrowsing": {
      const d = data as GoogleSafeBrowsingData;
      return (d.matches?.length ?? 0) > 0
        ? `Google lists this link for ${describeSafeBrowsingThreats(d.matches)}.`
        : "No threat matches.";
    }
    case "threatFeeds": {
      const d = data as ThreatFeedsData;
      if (d.matches?.length) {
        return describeFeedMatches(d.matches);
      }

      if (d.warnings?.length) {
        return "No feed matches, but one or more feed checks had caveats.";
      }

      if (d.observations?.length) {
        return "No matches for this exact URL — see details for listing context.";
      }

      return "No matches in the checked feeds.";
    }
    case "ssl": {
      const d = data as SSLData;
      // Fixed plain sentences; the provider's own wording stays in Notes.
      if (d.noHttps) {
        return "This link never moves to HTTPS, so there's no certificate to check.";
      }
      if (!d.available) {
        // Unavailable covers DNS failures and timeouts too: say what we
        // know (no answer), never that the site refused encryption.
        return "We couldn't check the site's certificate.";
      }

      if (d.validationState === "trusted") {
        return "The site's certificate is valid.";
      }

      if (d.validationState === "warning") {
        return "We couldn't fully verify the site's certificate.";
      }

      // The probe's plain words (`problem`); older results have none.
      return d.problem ?? "The site's certificate isn't trusted.";
    }
    case "whois": {
      const d = data as WhoisData;
      if (!d.available) {
        return "Registration records weren't available.";
      }

      return d.ageDays !== null
        ? `Registered ${formatAge(d.ageDays)} ago.`
        : "The registration records don't say when it was registered.";
    }
    case "dns": {
      const d = data as DNSData;
      if (d.subjectType === "ip") {
        return "This link uses a raw IP address instead of a domain name.";
      }

      // The name may not exist, or the lookup got no answer: Notes say which.
      if ((d.addresses?.length ?? 0) === 0 && (d.cnames?.length ?? 0) === 0) {
        return "We found no address for this name.";
      }

      return `${countOf(d.addresses?.length ?? 0, "address", "addresses")}, ${countOf(d.mx?.length ?? 0, "mail record")}.`;
    }
    case "redirectChain": {
      const d = data as RedirectData;
      // Where a chain stopped is not where it ends (Summary says the same):
      // a last response that still redirects points somewhere the probe
      // doesn't open, and a chain cut off after a redirect never got there.
      const last = d.hops?.at(-1);
      if (d.reachable && last?.location && REDIRECT_STATUSES.has(last.status)) {
        const followed = Math.max(0, d.totalHops - 1);
        return followed > 0
          ? `${countOf(followed, "redirect")}, then one to an address we don't open.`
          : "It redirects to an address we don't open.";
      }
      if (!d.reachable) {
        return d.totalHops > 0
          ? `We followed ${countOf(d.totalHops, "redirect")} but couldn't reach the end.`
          : "The site didn't respond when we tried to open it.";
      }

      return d.totalHops === 0
        ? "Resolved without redirects."
        : `${countOf(d.totalHops, "redirect")} to ${d.finalUrl}.`;
    }
    default:
      return "Signal complete.";
  }
}

/**
 * The Threat Feeds finding. A feed listing this link (or its domain) is a
 * direct listing and keeps the feed's own description; a feed listing a
 * different link on the same host must not read as if this link were
 * listed.
 */
function describeFeedMatches(matches: ThreatFeedsData["matches"]): string {
  const direct = matches.filter((match) => !isElsewhereOnHost(match));
  const elsewhereFeeds = [
    ...new Set(
      matches
        .filter((match) => isElsewhereOnHost(match))
        .map((match) => feedDisplayName(match.feed)),
    ),
  ];
  const elsewhere =
    elsewhereFeeds.length > 0
      ? `${formatList(elsewhereFeeds)} ${
          elsewhereFeeds.length === 1 ? "lists" : "list"
        } other links on this site`
      : null;

  if (direct.length === 0) {
    return `No listing for this link; ${elsewhere ?? "no feed lists it"}.`;
  }

  const directSentences = [...new Set(direct.map(describeFeedMatch))].join(" ");
  return elsewhere
    ? `${directSentences} ${capitalize(elsewhere)}.`
    : directSentences;
}

export interface DetailEntry {
  label: string;
  value: string;
}

const VIRUSTOTAL_CATEGORY_RANK: Record<string, number> = {
  malicious: 0,
  suspicious: 1,
};

/**
 * Engines that flagged the link first (malicious, then suspicious), the
 * rest in VirusTotal's order. Details show only the first few, and VT
 * returns engines alphabetically, so an unsorted slice could hide every
 * engine that flagged it. Sorting here, not in the provider, also orders
 * results saved before this ranking existed.
 */
export function rankVirusTotalResults<T extends { category: string }>(
  results: readonly T[],
): T[] {
  const rank = (category: string) => VIRUSTOTAL_CATEGORY_RANK[category] ?? 2;
  return [...results].sort((a, b) => rank(a.category) - rank(b.category));
}

/**
 * The expanded evidence for one check: one plain fact per row. `now`
 * anchors what is still running (certificate expiry); `evidenceTime`
 * anchors ages of what was seen ("listed 6 hours ago", certificate age),
 * so a reopened result's ages count from its check time, as Summary's do.
 * Tests pass fixed times.
 */
export function getSignalDetailEntries(
  name: SignalName,
  data: SignalPayloadMap[SignalName],
  now: number = Date.now(),
  evidenceTime: number = now,
): DetailEntry[] {
  switch (name) {
    case "virusTotal": {
      const d = data as VirusTotalData;
      const entries: DetailEntry[] = [];
      const breakdown = describeEngineBreakdown(d);
      if (breakdown) {
        entries.push({ label: "Engine results", value: breakdown });
      }
      entries.push(
        ...rankVirusTotalResults(d.results ?? [])
          .slice(0, 5)
          .map((r) => ({
            label: r.engine,
            value: r.result ?? r.category,
          })),
      );
      if (d.lastAnalysisDate) {
        entries.push({
          label: "Last analyzed",
          value: new Date(d.lastAnalysisDate).toLocaleDateString(),
        });
      }
      return entries;
    }
    case "mlEnsemble": {
      const d = data as MLSignalData;
      const entries: DetailEntry[] = [
        {
          label: "Combined result",
          value: `${plainModelLabel(d.consensusLabel)} · risk ${Math.round(d.consensusScore * 100)} of 100`,
        },
        {
          label: "Structure checks",
          value: `${plainModelLabel(d.lexicalModel.label)} · risk ${Math.round(d.lexicalModel.score * 100)} of 100`,
        },
      ];
      if (d.transformerModel) {
        // No percentage: the model's score is its distance from the bar
        // it must clear (lib/server/ml/local-classifier.ts), not a
        // calibrated certainty.
        entries.push({
          label: "Model reading",
          value: plainModelLabel(d.transformerModel.label),
        });
      }
      if (d.reasons?.length) {
        entries.push({ label: "Why", value: d.reasons.slice(0, 2).join(" ") });
      }
      if (d.warnings?.length) {
        entries.push({ label: "Warnings", value: d.warnings.join(" ") });
      }
      return entries;
    }
    case "googleSafeBrowsing": {
      const d = data as GoogleSafeBrowsingData;
      return (d.matches ?? []).map((m) => ({
        label: capitalize(describeSafeBrowsingThreat(m.threatType)),
        value: `${humanizeToken(m.platformType)} / ${humanizeToken(m.threatEntryType)}`,
      }));
    }
    case "threatFeeds": {
      const d = data as ThreatFeedsData;
      const entries: DetailEntry[] = (d.matches ?? []).flatMap((m) => {
        const listedAt = m.listedAt ? Date.parse(m.listedAt) : Number.NaN;
        return [
          { label: feedDisplayName(m.feed), value: describeFeedFinding(m) },
          // The row right after its feed, so each date names one listing.
          ...(Number.isFinite(listedAt)
            ? [
                {
                  label: "Listed",
                  value: `${formatElapsed(evidenceTime - listedAt)} ago`,
                },
              ]
            : []),
        ];
      });
      if (d.observations?.length) {
        entries.push({
          label: "Notes",
          value: d.observations.join(" "),
        });
      }
      if (d.warnings?.length) {
        entries.push({ label: "Warnings", value: d.warnings.join(" ") });
      }
      return entries;
    }
    case "ssl": {
      const d = data as SSLData;
      // No certificate in the link's path: nothing to list beyond the row.
      if (d.noHttps) {
        return [];
      }
      const entries: DetailEntry[] = [
        {
          label: "Validation",
          value: d.validationState,
        },
        { label: "Issuer", value: d.issuer ?? "Unknown" },
        { label: "Subject", value: d.subject ?? "Unknown" },
        {
          label: "Valid from",
          value: d.validFrom
            ? new Date(d.validFrom).toLocaleDateString()
            : "Unknown",
        },
        {
          label: "Valid to",
          value: d.validTo
            ? new Date(d.validTo).toLocaleDateString()
            : "Unknown",
        },
      ];
      const expiry = describeCertificateExpiry(d, now);
      if (expiry) {
        entries.push(expiry);
      }
      const certAgeDays = getCertificateAgeDays(d.validFrom, evidenceTime);
      if (certAgeDays !== null) {
        entries.push({
          label: "Certificate age",
          value: countOf(certAgeDays, "day"),
        });
      }
      if (d.protocol && /^TLSv\d/.test(d.protocol)) {
        entries.push({
          label: "TLS version",
          value: d.protocol.replace(/^TLSv/, "TLS "),
        });
      }
      if (d.selfSigned) {
        entries.push({ label: "Self-signed", value: "Yes" });
      }
      if (d.fingerprint256) {
        entries.push({
          label: "SHA-256",
          value: shortenFingerprint(d.fingerprint256),
        });
      }
      if (d.observations?.length) {
        entries.push({
          label: "Notes",
          value: d.observations.join(" "),
        });
      }
      return entries;
    }
    case "whois": {
      const d = data as WhoisData;
      const entries: DetailEntry[] = [
        { label: "Lookup", value: d.available ? "Available" : "Unavailable" },
        { label: "Registrar", value: d.registrar ?? "Unknown" },
        { label: "Country", value: d.country ?? "Unknown" },
        {
          label: "Registered",
          value: d.registeredAt
            ? new Date(d.registeredAt).toLocaleDateString()
            : "Unknown",
        },
        {
          label: "Expires",
          value: d.expiresAt
            ? new Date(d.expiresAt).toLocaleDateString()
            : "Unknown",
        },
      ];
      if (d.observations?.length) {
        entries.push({ label: "Notes", value: d.observations.join(" ") });
      }
      return entries;
    }
    case "dns": {
      const d = data as DNSData;
      const entries: DetailEntry[] = [
        { label: "A records", value: d.addresses?.join(", ") || "None" },
      ];
      if (d.hosting) {
        entries.push({
          label: "Network",
          value: describeHostingNetwork(d.hosting, d.addresses?.length ?? 0),
        });
      }
      if (d.cnames?.length) {
        entries.push({ label: "CNAME", value: d.cnames.join(", ") });
      }
      entries.push({ label: "MX records", value: d.mx?.join(", ") || "None" });
      if (d.nameservers?.length) {
        entries.push({ label: "Nameservers", value: d.nameservers.join(", ") });
      }
      if (d.txt?.length) {
        entries.push({
          label: "TXT records",
          value: describeTxtRecords(d.txt),
        });
      }
      if (d.reverseHostnames?.length) {
        entries.push({
          label: "Reverse DNS",
          value: d.reverseHostnames.join(", "),
        });
      }
      if (d.anomalies?.length) {
        entries.push({ label: "Anomalies", value: d.anomalies.join(" ") });
      }
      if (d.observations?.length) {
        entries.push({ label: "Notes", value: d.observations.join(" ") });
      }
      return entries;
    }
    case "redirectChain": {
      const d = data as RedirectData;
      // SignalRow renders exactly these entries, so the hop list itself
      // must be here - each observed response, in order.
      const entries: DetailEntry[] = (d.hops ?? []).map((hop) => ({
        label: `${hop.status}`,
        value: hop.location ? `${hop.url} → ${hop.location}` : hop.url,
      }));
      if (d.terminalError) {
        entries.push({
          label: "What happened",
          value: d.terminalError,
        });
      }
      if (d.content) {
        if (d.content.title) {
          entries.push({ label: "Page title", value: d.content.title });
        }
        if (d.content.crossOriginFormHosts.length) {
          entries.push({
            label: "Cross-origin forms",
            value: `Submits to ${d.content.crossOriginFormHosts.join(", ")}`,
          });
        }
        if (d.content.passwordInputCount > 0) {
          entries.push({
            label: "Credential fields",
            value: `${countOf(d.content.passwordInputCount, "password input")} on the final page`,
          });
        }
        if (d.content.crossOriginPasswordFormHosts?.length) {
          entries.push({
            label: "Password form",
            value: `Sends the password to ${formatList(d.content.crossOriginPasswordFormHosts)}`,
          });
        }
        if (d.content.iframeCount > 0 || d.content.hiddenIframeCount > 0) {
          // Hidden iframes are a subset of all iframes.
          const total = Math.max(
            d.content.iframeCount,
            d.content.hiddenIframeCount,
          );
          entries.push({
            label: "Iframes",
            value:
              d.content.hiddenIframeCount > 0
                ? `${countOf(total, "iframe")}, ${d.content.hiddenIframeCount} hidden`
                : countOf(total, "iframe"),
          });
        }
        if (d.content.obfuscationHints.length) {
          entries.push({
            label: "Obfuscation hints",
            value: d.content.obfuscationHints.join(", "),
          });
        }
        if (d.content.metaRefreshTarget) {
          entries.push({
            label: "Meta refresh",
            value: d.content.metaRefreshTarget,
          });
        }
      }
      if (d.observations?.length) {
        entries.push({
          label: "Notes",
          value: d.observations.join(" "),
        });
      }
      return entries;
    }
    default:
      return [];
  }
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** Whole days since the certificate's validFrom; null when unknown/invalid. */
export function getCertificateAgeDays(
  validFrom: string | null,
  now: number = Date.now(),
): number | null {
  if (!validFrom) {
    return null;
  }

  const issued = new Date(validFrom).getTime();
  if (Number.isNaN(issued) || issued > now) {
    return null;
  }

  return Math.floor((now - issued) / DAY_MS);
}

/** "7 malicious, 2 suspicious, 40 harmless, 21 undetected"; null with no engine counts. */
function describeEngineBreakdown(d: VirusTotalData): string | null {
  const counts = [d.malicious, d.suspicious, d.harmless, d.undetected] as const;
  if (counts.every((count) => !count)) {
    return null;
  }

  const [malicious, suspicious, harmless, undetected] = counts;
  return `${malicious} malicious, ${suspicious} suspicious, ${harmless} harmless, ${undetected} undetected`;
}

/**
 * Days until expiry, from `validTo` against `now` so a saved result does
 * not repeat the scan day's count; the stored `daysRemaining` otherwise.
 * Expired is decided before rounding: a certificate that lapsed six hours
 * ago is expired, not "less than a day" from expiring. `validTo` itself is
 * the last valid instant (RFC 5280).
 */
function describeCertificateExpiry(
  d: SSLData,
  now: number,
): DetailEntry | null {
  const validTo = d.validTo ? Date.parse(d.validTo) : Number.NaN;
  const remainingMs = Number.isFinite(validTo)
    ? validTo - now
    : d.daysRemaining === null
      ? null
      : d.daysRemaining * DAY_MS;
  if (remainingMs === null) {
    return null;
  }

  const days = Math.floor(Math.abs(remainingMs) / DAY_MS);
  const duration = days === 0 ? "less than a day" : countOf(days, "day");
  return remainingMs < 0
    ? { label: "Expired", value: `${duration} ago` }
    : { label: "Expires in", value: duration };
}

/** "AB:CD:EF:01…6E:7F:80:91": enough to compare, short enough to read. */
export function shortenFingerprint(fingerprint: string): string {
  const pairs = fingerprint.split(":");
  const isHexPairs =
    pairs.length > 8 && pairs.every((pair) => /^[0-9a-f]{2}$/i.test(pair));
  return isHexPairs
    ? `${pairs.slice(0, 4).join(":")}…${pairs.slice(-4).join(":")}`.toUpperCase()
    : fingerprint;
}

/**
 * "AS64500 EXAMPLE-NET, registered in NL". The country is the network's
 * registration, never where the server is. The address is named only when
 * the hostname resolved to more than one.
 */
export function describeHostingNetwork(
  hosting: HostingNetwork,
  addressCount: number,
): string {
  const forAddress = addressCount > 1 ? ` (for ${hosting.ip})` : "";
  if (hosting.asn === null) {
    return `No network routes this address publicly${forAddress}`;
  }

  const network = hosting.asName
    ? `AS${hosting.asn} ${hosting.asName}`
    : `AS${hosting.asn}`;
  const country = hosting.registeredCountry
    ? `, registered in ${hosting.registeredCountry}`
    : "";
  return `${network}${country}${forAddress}`;
}

const TXT_KINDS: ReadonlyArray<[RegExp, string]> = [
  [/^v=spf1(\s|$)/i, "SPF"],
  [/^v=DMARC1(;|\s|$)/i, "DMARC"],
  [/^google-site-verification=/i, "Google site verification"],
  [/^MS=ms\d+/i, "Microsoft 365 verification"],
  [/^facebook-domain-verification=/i, "Facebook domain verification"],
  [/^apple-domain-verification=/i, "Apple domain verification"],
  [/^atlassian-domain-verification=/i, "Atlassian domain verification"],
  [/^docusign=/i, "DocuSign domain verification"],
  [/verification[=:]/i, "domain verification"],
];

/**
 * "3 records: SPF, Google site verification, and 1 other". Names the kinds
 * it recognises and counts the rest; raw TXT values are never shown.
 */
export function describeTxtRecords(records: readonly string[]): string {
  const kinds = new Set<string>();
  let other = 0;

  for (const record of records) {
    const kind = TXT_KINDS.find(([pattern]) => pattern.test(record.trim()));
    if (kind) {
      kinds.add(kind[1]);
    } else {
      other += 1;
    }
  }

  const total = countOf(records.length, "record");
  if (kinds.size === 0) {
    return total;
  }

  const parts = [...kinds, ...(other > 0 ? [countOf(other, "other")] : [])];
  return `${total}: ${formatList(parts)}`;
}
