"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { getSignalSeverity } from "@/components/shared/scrutinix-types";
import { useBatchStream } from "@/hooks/use-batch-stream";
import { useScanStream } from "@/hooks/use-scan-stream";
import {
  clearSharedPayload,
  readSharedPayload,
  subscribeToSharedPayload,
} from "@/lib/client/shared-link";
import {
  decodeSharedSnapshot,
  encodeSharedSnapshot,
} from "@/lib/domain/shared-snapshot";
import {
  signalNames,
  type AnalysisResult,
  type HistoryEntry,
} from "@/lib/domain/types";
import { normalizeUrlInput } from "@/lib/domain/url";

export type Tab = "single" | "batch";
export type ViewMode = "summary" | "full";

const summarySignalOrder = [
  "googleSafeBrowsing",
  "threatFeeds",
  "virusTotal",
  "mlEnsemble",
  "ssl",
  "redirectChain",
  "whois",
  "dns",
] as const;

const severityRank = {
  malicious: 5,
  suspicious: 4,
  error: 3,
  neutral: 2,
  skipped: 1,
  safe: 0,
  pending: -1,
} as const;

/**
 * The server render never sees the query string, so the payload is read
 * only after hydration; reading it during the first render would make the
 * client tree disagree with the server HTML.
 */
function useSharedSnapshot() {
  const payload = useSyncExternalStore(
    subscribeToSharedPayload,
    readSharedPayload,
    () => null,
  );
  return useMemo(
    () => (payload ? decodeSharedSnapshot(payload) : null),
    [payload],
  );
}

function useCreateAnalyzerRuntime() {
  const [activeTab, setActiveTab] = useState<Tab>("single");
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [singleUrl, setSingleUrl] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<AnalysisResult | null>(
    null,
  );
  const sharedSnapshot = useSharedSnapshot();
  // React can batch several url_complete events into one render. Keep every
  // result so a fast batch cannot silently drop history entries.
  const [historyQueue, setHistoryQueue] = useState<AnalysisResult[]>([]);

  const pushHistoryEvent = useCallback((result: AnalysisResult) => {
    setHistoryQueue((previous) => [...previous, result]);
  }, []);

  const drainHistoryQueue = useCallback(() => {
    setHistoryQueue([]);
  }, []);

  const scan = useScanStream((result) => {
    startTransition(() => setSelectedResult(result));
    pushHistoryEvent(result);
    clearSharedPayload();
  });

  const batch = useBatchStream((result) => {
    pushHistoryEvent(result);
  });

  const active = selectedResult ?? scan.state.result;
  // The link's claim is the page's subject only until something replaces it.
  // Any scan attempt does, even a failed or cancelled one: the error already
  // shows in the scan form, and the claim reappearing beside it would read as
  // part of that failure (or, after a scan of another URL, as unrelated to it).
  // The param stays in the URL until a scan completes, so a reload reopens it.
  const unverifiedSnapshot =
    active || scan.state.url !== "" ? null : sharedSnapshot;
  const signals = active?.signals ?? scan.state.signals;
  const live = scan.state.isStreaming || batch.state.isStreaming;

  const done = useMemo(
    () =>
      signalNames.filter((signalName) =>
        ["success", "error", "skipped"].includes(signals[signalName].status),
      ).length,
    [signals],
  );

  const summarySignals = useMemo(
    () =>
      [...summarySignalOrder]
        .filter((signalName) => signals[signalName].status !== "pending")
        .sort((left, right) => {
          const leftSeverity = getSignalSeverity(
            signals[left].status,
            signals[left].data,
            left,
          );
          const rightSeverity = getSignalSeverity(
            signals[right].status,
            signals[right].data,
            right,
          );
          return severityRank[rightSeverity] - severityRank[leftSeverity];
        })
        .slice(0, 3),
    [signals],
  );

  const visibleSignals = useMemo(
    () =>
      viewMode === "summary" && summarySignals.length > 0
        ? summarySignals
        : [...signalNames],
    [summarySignals, viewMode],
  );

  const startSingleScan = useCallback(async () => {
    setFormError(null);
    setSelectedResult(null);
    const value = normalizeUrlInput(singleUrl);
    if (!value.ok) {
      setFormError(value.error);
      return;
    }
    await scan.startScan(value.value.normalizedUrl);
  }, [scan, singleUrl]);

  const startBatchScan = useCallback(async () => {
    setFormError(null);
    const urls = batchInput
      .split("\n")
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (!urls.length) {
      setFormError("Add at least one URL.");
      return;
    }
    if (urls.length > 10) {
      setFormError("Batch capped at 10 URLs.");
      return;
    }

    const invalid = urls
      .map((url) => normalizeUrlInput(url))
      .find((result) => !result.ok);
    if (invalid && !invalid.ok) {
      setFormError(invalid.error);
      return;
    }

    await batch.startBatch(urls);
  }, [batch, batchInput]);

  const shareResult = useCallback(async (result: AnalysisResult) => {
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set("shared", encodeSharedSnapshot(result));

    try {
      await navigator.clipboard.writeText(targetUrl.toString());
      toast.success("Link copied to clipboard", {
        description:
          "It opens as an unverified snapshot until the recipient scans the URL.",
      });
    } catch {
      toast.error("Clipboard access was blocked");
    }
  }, []);

  const rescanUrl = useCallback(
    async (url: string) => {
      setFormError(null);
      setSelectedResult(null);
      setSingleUrl(url);
      setActiveTab("single");
      await scan.startScan(url);
    },
    [scan],
  );

  const selectHistoryEntry = useCallback((entry: HistoryEntry) => {
    setSelectedResult(entry);
    setSingleUrl(entry.url);
    setActiveTab("single");
  }, []);

  return {
    active,
    activeTab,
    batch,
    batchInput,
    done,
    drainHistoryQueue,
    formError,
    historyQueue,
    live,
    rescanUrl,
    scan,
    selectedResult,
    selectHistoryEntry,
    setActiveTab,
    setBatchInput,
    setFormError,
    setSelectedResult,
    setSingleUrl,
    setViewMode,
    shareResult,
    signals,
    singleUrl,
    startBatchScan,
    startSingleScan,
    summarySignals,
    unverifiedSnapshot,
    viewMode,
    visibleSignals,
  };
}

type AnalyzerRuntimeValue = ReturnType<typeof useCreateAnalyzerRuntime>;

const AnalyzerRuntimeContext = createContext<AnalyzerRuntimeValue | null>(null);

export function useAnalyzerRuntime() {
  const context = useContext(AnalyzerRuntimeContext);
  if (!context) {
    throw new Error("Analyzer runtime context is unavailable.");
  }
  return context;
}

export function AnalyzerRuntimeProvider({ children }: { children: ReactNode }) {
  const value = useCreateAnalyzerRuntime();
  return (
    <AnalyzerRuntimeContext.Provider value={value}>
      {children}
    </AnalyzerRuntimeContext.Provider>
  );
}
