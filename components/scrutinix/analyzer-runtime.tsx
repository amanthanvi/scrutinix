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

import { getSignalSummary } from "@/components/shared/signal-utils";
import {
  getActiveAccent,
  getSignalSeverity,
  type SharedSnapshot,
} from "@/components/shared/scrutinix-types";
import { useBatchStream } from "@/hooks/use-batch-stream";
import { useScanStream } from "@/hooks/use-scan-stream";
import { threatScoreToVerdict } from "@/lib/domain/score-bands";
import { sharedSnapshotSchema } from "@/lib/domain/schemas";
import {
  signalLabels,
  signalNames,
  type AnalysisResult,
} from "@/lib/domain/types";
import { normalizeUrlInput } from "@/lib/domain/url";

export type Tab = "single" | "batch";
export type ViewMode = "summary" | "full";

interface TickerEvent {
  id: string;
  time: string;
  text: string;
}

/** Requests the scan inputs adopt a URL (rescan, history selection). */
interface InputPrefill {
  url: string;
  nonce: number;
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

  const toSnapshot = (value: unknown): SharedSnapshot | null => {
    const parsed = sharedSnapshotSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
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

function fmtTime(date: Date) {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function deriveTickerTime(
  durationMs: number,
  startedAt: string | null,
  completedAt: string | null,
) {
  if (startedAt) {
    const started = new Date(startedAt).getTime();
    if (!Number.isNaN(started)) {
      return fmtTime(new Date(started + durationMs));
    }
  }

  if (completedAt) {
    const completed = new Date(completedAt);
    if (!Number.isNaN(completed.getTime())) {
      return fmtTime(completed);
    }
  }

  return fmtTime(new Date());
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
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<AnalysisResult | null>(
    null,
  );
  const [sharedSnapshot] = useState<SharedSnapshot | null>(() =>
    readSnapshot(),
  );
  const [prefill, setPrefill] = useState<InputPrefill | null>(null);
  // A queue, not a single slot: React batches state updates, so several
  // url_complete events can land in one render pass - a single slot
  // silently dropped all but the last batch result from history.
  const [historyQueue, setHistoryQueue] = useState<AnalysisResult[]>([]);

  const pushHistoryEvent = useCallback((result: AnalysisResult) => {
    setHistoryQueue((previous) => [...previous, result]);
  }, []);

  const drainHistoryQueue = useCallback(() => {
    setHistoryQueue([]);
  }, []);

  const requestPrefill = useCallback((url: string) => {
    setPrefill((previous) => ({ url, nonce: (previous?.nonce ?? 0) + 1 }));
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
  const isMalicious =
    active?.verdict === "malicious" || active?.verdict === "critical";
  const score = active?.threatInfo?.score ?? 0;
  const scoreColor = getActiveAccent(threatScoreToVerdict(score));
  const accentColor = getActiveAccent(active?.verdict);
  const scanStartedAt = active?.metadata?.startedAt ?? scan.state.startedAt;
  const scanCompletedAt = active?.metadata?.completedAt ?? null;

  const ticker = useMemo(() => {
    const events: TickerEvent[] = [];
    for (const signalName of signalNames) {
      const signal = signals[signalName];
      if (signal.status === "success" && signal.data) {
        events.push({
          id: `${signalName}-${signal.durationMs}`,
          time: deriveTickerTime(
            signal.durationMs,
            scanStartedAt,
            scanCompletedAt,
          ),
          text: `${signalLabels[signalName]}: ${getSignalSummary(signalName, signal.data)}`,
        });
      }
      if (signal.status === "error" && signal.error) {
        events.push({
          id: `${signalName}-err`,
          time: deriveTickerTime(
            signal.durationMs,
            scanStartedAt,
            scanCompletedAt,
          ),
          text: `${signalLabels[signalName]}: ERROR - ${signal.error}`,
        });
      }
    }
    return events.slice(-8);
  }, [scanCompletedAt, scanStartedAt, signals]);

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
  const visibleSignals = useMemo(
    () =>
      viewMode === "summary" && summarySignals.length > 0
        ? summarySignals
        : hasActivity
          ? [...signalNames]
          : [],
    [viewMode, summarySignals, hasActivity],
  );

  const submitSingle = useCallback(
    async (rawUrl: string) => {
      setFormError(null);
      setSelectedResult(null);
      const value = normalizeUrlInput(rawUrl);
      if (!value.ok) {
        setFormError(value.error);
        return;
      }
      await scan.startScan(value.value.normalizedUrl);
    },
    [scan],
  );

  const submitBatch = useCallback(
    async (rawInput: string) => {
      setFormError(null);
      const urls = rawInput
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
    },
    [batch],
  );

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
      requestPrefill(url);
      setActiveTab("single");
      await scan.startScan(url);
    },
    [scan, requestPrefill],
  );

  const selectHistoryEntry = useCallback(
    (entry: AnalysisResult) => {
      setSelectedResult(entry);
      requestPrefill(entry.url);
      setActiveTab("single");
    },
    [requestPrefill],
  );

  return useMemo(
    () => ({
      active,
      accentColor,
      activeTab,
      batch,
      done,
      drainHistoryQueue,
      formError,
      hasActivity,
      historyQueue,
      isMalicious,
      live,
      prefill,
      scan,
      score,
      scoreColor,
      selectedResult,
      setActiveTab,
      setFormError,
      setSelectedResult,
      setViewMode,
      shareResult,
      sharedSnapshot,
      signals,
      submitBatch,
      submitSingle,
      summarySignals,
      ticker,
      viewMode,
      visibleSignals,
      rescanUrl,
      selectHistoryEntry,
    }),
    [
      active,
      accentColor,
      activeTab,
      batch,
      done,
      drainHistoryQueue,
      formError,
      hasActivity,
      historyQueue,
      isMalicious,
      live,
      prefill,
      scan,
      score,
      scoreColor,
      selectedResult,
      shareResult,
      sharedSnapshot,
      signals,
      submitBatch,
      submitSingle,
      summarySignals,
      ticker,
      viewMode,
      visibleSignals,
      rescanUrl,
      selectHistoryEntry,
    ],
  );
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
