"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  getSignalSeverity,
  type SharedSnapshot,
} from "@/components/shared/scrutinix-types";
import { useBatchStream } from "@/hooks/use-batch-stream";
import { useScanStream } from "@/hooks/use-scan-stream";
import type { HistoryEntry } from "@/lib/domain/types";
import {
  signalNames,
  type AnalysisResult,
  type Verdict,
} from "@/lib/domain/types";
import { normalizeUrlInput } from "@/lib/domain/url";

export type Tab = "single" | "batch";
export type ViewMode = "summary" | "full";

interface HistoryEvent {
  nonce: number;
  result: AnalysisResult;
}

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

function readSnapshot(): SharedSnapshot | null {
  if (typeof window === "undefined") return null;
  const payload = new URLSearchParams(window.location.search).get("shared");
  if (!payload) return null;

  const validVerdicts: Verdict[] = [
    "safe",
    "suspicious",
    "malicious",
    "critical",
    "error",
  ];
  const maxUrlLength = 2048;
  const maxSummaryLength = 600;
  const maxCapturedAtLength = 128;
  const toSnapshot = (value: unknown): SharedSnapshot | null => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as { url?: unknown }).url !== "string" ||
      typeof (value as { summary?: unknown }).summary !== "string" ||
      typeof (value as { capturedAt?: unknown }).capturedAt !== "string" ||
      typeof (value as { verdict?: unknown }).verdict !== "string"
    ) {
      return null;
    }

    const verdict = (value as { verdict: string }).verdict;
    if (!validVerdicts.includes(verdict as Verdict)) {
      return null;
    }

    const url = (value as { url: string }).url;
    const summary = (value as { summary: string }).summary;
    const capturedAt = (value as { capturedAt: string }).capturedAt;
    if (
      url.length > maxUrlLength ||
      summary.length > maxSummaryLength ||
      capturedAt.length > maxCapturedAtLength
    ) {
      return null;
    }

    return {
      verdict: verdict as Verdict,
      url,
      summary,
      capturedAt,
    };
  };

  try {
    return toSnapshot(JSON.parse(decodeURIComponent(atob(payload))));
  } catch {
    try {
      return toSnapshot(JSON.parse(atob(payload)));
    } catch {
      return null;
    }
  }
}

const severityRank = {
  malicious: 5,
  suspicious: 4,
  error: 3,
  neutral: 2,
  skipped: 1,
  safe: 0,
  pending: -1,
} as const;

function useCreateAnalyzerRuntime() {
  const [activeTab, setActiveTab] = useState<Tab>("single");
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [singleUrl, setSingleUrl] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<AnalysisResult | null>(
    null,
  );
  const [sharedSnapshot] = useState<SharedSnapshot | null>(() =>
    readSnapshot(),
  );
  const [historyEvent, setHistoryEvent] = useState<HistoryEvent | null>(null);

  const pushHistoryEvent = useCallback((result: AnalysisResult) => {
    setHistoryEvent((previous) => ({
      nonce: (previous?.nonce ?? 0) + 1,
      result,
    }));
  }, []);

  const scan = useScanStream((result) => {
    startTransition(() => setSelectedResult(result));
    pushHistoryEvent(result);
  });

  const batch = useBatchStream((result) => {
    pushHistoryEvent(result);
  });

  const active = selectedResult ?? scan.state.result;
  const signals = active?.signals ?? scan.state.signals;

  const live = scan.state.isStreaming || batch.state.isStreaming;

  const done = useMemo(
    () =>
      signalNames.filter(
        (signalName) =>
          signals[signalName].status === "success" ||
          signals[signalName].status === "error" ||
          signals[signalName].status === "skipped",
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
  const hasActivity = live || active !== null;
  const visibleSignals =
    viewMode === "summary" && summarySignals.length > 0
      ? summarySignals
      : hasActivity
        ? signalNames
        : [];

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
    const capturedAt = result.metadata?.completedAt ?? new Date().toISOString();
    const payload = JSON.stringify({
      verdict: result.verdict,
      url: result.url,
      summary: result.threatInfo?.summary ?? "",
      capturedAt,
    });
    const encodedPayload = btoa(encodeURIComponent(payload));
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set("shared", encodedPayload);

    try {
      await navigator.clipboard.writeText(targetUrl.toString());
      toast.success("Link copied to clipboard");
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
    formError,
    hasActivity,
    historyEvent,
    live,
    scan,
    selectedResult,
    setActiveTab,
    setBatchInput,
    setFormError,
    setSelectedResult,
    setSingleUrl,
    setViewMode,
    shareResult,
    sharedSnapshot,
    signals,
    singleUrl,
    startBatchScan,
    startSingleScan,
    summarySignals,
    viewMode,
    visibleSignals,
    rescanUrl,
    selectHistoryEntry,
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
