import { capitalize, countOf, formatAge, formatList } from "@/lib/domain/copy";
import {
  describeFeedFinding,
  describeFeedMatch,
  describeSafeBrowsingThreat,
  describeSafeBrowsingThreats,
  feedDisplayName,
  humanizeToken,
  isElsewhereOnHost,
} from "@/lib/domain/feed-copy";
import type {
  DNSData,
  GoogleSafeBrowsingData,
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

      return `The link's wording and structure look ${d.consensusLabel} (${(d.consensusScore * 100).toFixed(0)}/100).`;
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
      if (!d.available) {
        return "The site didn't accept a secure connection.";
      }

      if (d.validationState === "trusted") {
        return "The site's security certificate is valid.";
      }

      if (d.validationState === "warning") {
        return "We couldn't fully verify the site's security certificate.";
      }

      return "The site's security certificate isn't trusted.";
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

      if ((d.addresses?.length ?? 0) === 0 && (d.cnames?.length ?? 0) === 0) {
        return "This address doesn't point to any server.";
      }

      return `${countOf(d.addresses?.length ?? 0, "address", "addresses")}, ${countOf(d.mx?.length ?? 0, "mail record")}.`;
    }
    case "redirectChain": {
      const d = data as RedirectData;
      if (!d.reachable) {
        return "The site didn't respond when we tried to open it.";
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

export function getSignalDetailEntries(
  name: SignalName,
  data: SignalPayloadMap[SignalName],
): DetailEntry[] {
  switch (name) {
    case "virusTotal": {
      const d = data as VirusTotalData;
      const entries: DetailEntry[] = (d.results ?? []).slice(0, 5).map((r) => ({
        label: r.engine,
        value: r.result ?? r.category,
      }));
      if (d.lastAnalysisDate) {
        entries.push({
          label: "Last analyzed",
          value: new Date(d.lastAnalysisDate).toLocaleDateString(),
        });
      }
      if (d.domain) {
        entries.push({
          label: "Domain reputation",
          value: `${countOf(d.domain.malicious, "malicious engine")}, reputation ${d.domain.reputation}`,
        });
        if (d.domain.categories.length) {
          entries.push({
            label: "Domain categories",
            value: d.domain.categories.join(", "),
          });
        }
      }
      return entries;
    }
    case "mlEnsemble": {
      const d = data as MLSignalData;
      const entries: DetailEntry[] = [
        {
          label: "Combined result",
          value: `${d.consensusLabel} (${(d.consensusScore * 100).toFixed(0)} risk)`,
        },
        {
          label: "Rule-based check",
          value: `${d.lexicalModel.label} (${(d.lexicalModel.score * 100).toFixed(0)}%)`,
        },
      ];
      if (d.transformerModel) {
        entries.push({
          label: "Local model",
          value: `${d.transformerModel.label} (${((d.transformerModel.score ?? 0) * 100).toFixed(0)}%)`,
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
      const entries: DetailEntry[] = (d.matches ?? []).map((m) => ({
        label: feedDisplayName(m.feed),
        value: describeFeedFinding(m),
      }));
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
      const certAgeDays = getCertificateAgeDays(d.validFrom);
      if (certAgeDays !== null) {
        entries.push({
          label: "Certificate age",
          value: countOf(certAgeDays, "day"),
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
        { label: "MX records", value: d.mx?.join(", ") || "None" },
      ];
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

/** Whole days since the certificate's validFrom; null when unknown/invalid. */
export function getCertificateAgeDays(validFrom: string | null): number | null {
  if (!validFrom) {
    return null;
  }

  const issued = new Date(validFrom).getTime();
  if (Number.isNaN(issued) || issued > Date.now()) {
    return null;
  }

  return Math.floor((Date.now() - issued) / (1000 * 60 * 60 * 24));
}
