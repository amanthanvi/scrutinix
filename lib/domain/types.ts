export { signalNames } from "@/lib/domain/schemas";
export type {
  AnalysisResult,
  AnalyzeEvent,
  ApiError,
  BatchEvent,
  ClassificationFinding,
  DNSData,
  GoogleSafeBrowsingData,
  HistoryEntry,
  MLSignalData,
  PageContentFindings,
  RedirectData,
  ScanMetadata,
  SharedSnapshot,
  SignalName,
  SignalPayloadMap,
  SignalResult,
  SignalResults,
  SignalStatus,
  SSLData,
  ThreatFeedsData,
  ThreatInfo,
  Verdict,
  VirusTotalData,
  WhoisData,
} from "@/lib/domain/schemas";

import {
  signalNames as names,
  type SignalName,
  type SignalResult,
  type SignalResults,
} from "@/lib/domain/schemas";

export const signalLabels: Record<SignalName, string> = {
  virusTotal: "VirusTotal",
  mlEnsemble: "ML Ensemble",
  googleSafeBrowsing: "Google Safe Browsing",
  threatFeeds: "Threat Feeds",
  ssl: "TLS Certificate",
  whois: "Domain Registration",
  dns: "DNS Profile",
  redirectChain: "Redirect Chain",
};

export function createPendingSignalResults(): SignalResults {
  const results = {} as Record<SignalName, SignalResult<unknown>>;
  for (const name of names) {
    results[name] = createPendingSignalResult();
  }
  return results as SignalResults;
}

function createPendingSignalResult<T>(): SignalResult<T> {
  return {
    status: "pending",
    data: null,
    error: null,
    durationMs: 0,
  };
}
