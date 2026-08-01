import type {
  DNSData,
  GoogleSafeBrowsingData,
  MLSignalData,
  RedirectData,
  SignalName,
  SignalPayloadMap,
  SSLData,
  ThreatFeedsData,
  VirusTotalData,
  WhoisData,
} from "@/lib/domain/types";

export function getSignalSummary(
  name: SignalName,
  data: SignalPayloadMap[SignalName],
): string {
  switch (name) {
    case "virusTotal": {
      const d = data as VirusTotalData;
      return `${d.malicious} malicious and ${d.suspicious} suspicious engines across the last analysis run.`;
    }
    case "mlEnsemble": {
      const d = data as MLSignalData;
      if (d.consensusLabel === "benign") {
        return "The ensemble stayed below the risk threshold after comparing the hosted and lexical models.";
      }

      return `The ensemble raised a ${d.consensusLabel} result with a ${(d.consensusScore * 100).toFixed(0)} risk score.`;
    }
    case "googleSafeBrowsing": {
      const d = data as GoogleSafeBrowsingData;
      return (d.matches?.length ?? 0) > 0
        ? `${d.matches.length} Safe Browsing threat match${d.matches.length === 1 ? "" : "es"} found.`
        : "No Safe Browsing threat matches were reported.";
    }
    case "threatFeeds": {
      const d = data as ThreatFeedsData;
      if (d.matches?.length) {
        return `${d.matches.length} community feed match${d.matches.length === 1 ? "" : "es"} found.`;
      }

      if (d.warnings?.length) {
        return "No community-feed matches were found, but one or more feed checks completed with caveats.";
      }

      if (d.observations?.length) {
        return "No feed matches for this exact URL; see signal notes for URLhaus listing context.";
      }

      return "No matches were found in the checked community feeds.";
    }
    case "ssl": {
      const d = data as SSLData;
      if (!d.available) {
        return d.observations?.[0] ?? "No TLS service responded on port 443.";
      }

      if (d.validationState === "trusted") {
        return `TLS is available via ${d.protocol ?? "unknown protocol"} and the certificate looks valid.`;
      }

      if (d.validationState === "warning") {
        return "TLS responded, but certificate verification was only partially conclusive from this scan runtime.";
      }

      return (
        d.observations?.[0] ??
        "TLS responded, but the certificate was not trusted."
      );
    }
    case "whois": {
      const d = data as WhoisData;
      if (!d.available) {
        return (
          d.observations?.[0] ??
          "Registration data was unavailable during this scan."
        );
      }

      return d.ageDays !== null
        ? `The domain was first registered ${d.ageDays} day${d.ageDays === 1 ? "" : "s"} ago.`
        : "Registration data was returned without a domain age.";
    }
    case "dns": {
      const d = data as DNSData;
      if (d.subjectType === "ip") {
        return d.observations?.[0] ?? "The target is a literal IP address.";
      }

      if ((d.addresses?.length ?? 0) === 0 && (d.cnames?.length ?? 0) === 0) {
        return (
          d.observations?.[0] ??
          "The hostname did not resolve to web-facing address records."
        );
      }

      return `${d.addresses?.length ?? 0} address${(d.addresses?.length ?? 0) === 1 ? "" : "es"} and ${d.mx?.length ?? 0} mail exchange record${(d.mx?.length ?? 0) === 1 ? "" : "s"} were found.`;
    }
    case "redirectChain": {
      const d = data as RedirectData;
      if (!d.reachable) {
        return (
          d.observations?.[0] ??
          "The target did not accept a redirect probe, so chain analysis was limited."
        );
      }

      return d.totalHops === 0
        ? `The URL resolved without redirects to ${d.finalUrl}.`
        : `${d.totalHops} redirect hop${d.totalHops === 1 ? "" : "s"} led to ${d.finalUrl}.`;
    }
    default:
      return "Signal complete.";
  }
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
          value: `${d.domain.malicious} malicious engine${d.domain.malicious === 1 ? "" : "s"}, reputation ${d.domain.reputation}`,
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
          label: "Ensemble verdict",
          value: `${d.consensusLabel} (${(d.consensusScore * 100).toFixed(0)} risk)`,
        },
        {
          label: "Lexical heuristic",
          value: `${d.lexicalModel.label} (${(d.lexicalModel.score * 100).toFixed(0)}%)`,
        },
      ];
      if (d.hostedModel) {
        entries.push({
          label: "Hosted model",
          value: `${d.hostedModel.label} (${((d.hostedModel.score ?? 0) * 100).toFixed(0)}%)`,
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
        label: m.threatType,
        value: `${m.platformType} / ${m.threatEntryType}`,
      }));
    }
    case "threatFeeds": {
      const d = data as ThreatFeedsData;
      const entries: DetailEntry[] = (d.matches ?? []).map((m) => ({
        label: m.matchType === "host" ? `${m.feed} (host)` : m.feed,
        value: m.detail,
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
          value: `${certAgeDays} day${certAgeDays === 1 ? "" : "s"}`,
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
      const entries = (d.hops ?? []).map((hop) => ({
        label: `${hop.status}`,
        value: hop.location ? `${hop.url} → ${hop.location}` : hop.url,
      }));
      if (d.terminalError) {
        entries.push({
          label: "Probe",
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
            value: `${d.content.passwordInputCount} password input${d.content.passwordInputCount === 1 ? "" : "s"} on the final page`,
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
