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

import type { SharedSnapshot } from "@/components/shared/scrutinix-types";
import { selectSummarySignals } from "@/components/shared/signal-selection";
import { useBatchStream } from "@/hooks/use-batch-stream";
import { useScanStream } from "@/hooks/use-scan-stream";
import { sharedSnapshotSchema } from "@/lib/domain/schemas";
import {
  signalNames,
  type AnalysisResult,
  type HistoryEntry,
} from "@/lib/domain/types";
import { normalizeUrlInput } from "@/lib/domain/url";

export type Tab = "single" | "batch";
export type ViewMode = "summary" | "full";

function readSnapshot(): SharedSnapshot | null {
  if (typeof window === "undefined") return null;
  const payload = new URLSearchParams(window.location.search).get("shared");
  if (!payload) return null;

  const parseSnapshot = (value: unknown): SharedSnapshot | null => {
    const parsed = sharedSnapshotSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

  try {
    return parseSnapshot(JSON.parse(decodeURIComponent(atob(payload))));
  } catch {
    try {
      return parseSnapshot(JSON.parse(atob(payload)));
    } catch {
      return null;
    }
  }
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
  // True once the person edits the URL after a result is shown; Analyze then
  // returns to the primary style. Until then the verdict owns the color.
  const [inputEditedSinceResult, setInputEditedSinceResult] = useState(false);
  // Bumped when a stored result (history, batch "Open") replaces the view,
  // so the results section can move focus to the verdict heading.
  const [verdictFocusRequest, setVerdictFocusRequest] = useState(0);
  const [sharedSnapshot] = useState<SharedSnapshot | null>(() =>
    readSnapshot(),
  );
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
  });

  const batch = useBatchStream((result) => {
    pushHistoryEvent(result);
  });

  const active = selectedResult ?? scan.state.result;
  const signals = active?.signals ?? scan.state.signals;
  const live = scan.state.isStreaming || batch.state.isStreaming;

  const done = useMemo(
    () =>
      signalNames.filter((signalName) =>
        ["success", "error", "skipped"].includes(signals[signalName].status),
      ).length,
    [signals],
  );

  const scoredSignals = active?.threatInfo?.scoredSignals;
  const summarySelection = useMemo(
    () => selectSummarySignals(signals, scoredSignals),
    [signals, scoredSignals],
  );

  const visibleSignals = useMemo(
    () =>
      viewMode === "summary" ? summarySelection.drivers : [...signalNames],
    [summarySelection, viewMode],
  );

  const updateSingleUrl = useCallback((value: string) => {
    setSingleUrl(value);
    setInputEditedSinceResult(true);
  }, []);

  const startSingleScan = useCallback(async () => {
    setFormError(null);
    setSelectedResult(null);
    setInputEditedSinceResult(false);
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
      setFormError("Paste at least one link to check.");
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
      setInputEditedSinceResult(false);
      setActiveTab("single");
      await scan.startScan(url);
    },
    [scan],
  );

  /** Show a stored result (history entry or batch row) as the active one. */
  const openStoredResult = useCallback((result: AnalysisResult) => {
    setSelectedResult(result);
    setSingleUrl(result.url);
    setInputEditedSinceResult(false);
    setActiveTab("single");
    setVerdictFocusRequest((previous) => previous + 1);
  }, []);

  const selectHistoryEntry = useCallback(
    (entry: HistoryEntry) => openStoredResult(entry),
    [openStoredResult],
  );

  return {
    active,
    activeTab,
    batch,
    batchInput,
    done,
    drainHistoryQueue,
    formError,
    historyQueue,
    inputEditedSinceResult,
    live,
    openStoredResult,
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
    updateSingleUrl,
    shareResult,
    sharedSnapshot,
    signals,
    singleUrl,
    startBatchScan,
    startSingleScan,
    summarySelection,
    verdictFocusRequest,
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
