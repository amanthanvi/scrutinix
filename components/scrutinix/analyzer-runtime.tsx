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
import { warmLinkParser } from "@/hooks/use-link-anatomy";
import { useScanStream } from "@/hooks/use-scan-stream";
import type { LinkAnatomy } from "@/lib/domain/link-anatomy";
import {
  buildSharedSnapshot,
  decodeSharedSnapshot,
  encodeSharedSnapshot,
} from "@/lib/domain/signal-signature";
import {
  signalNames,
  type AnalysisResult,
  type HistoryEntry,
} from "@/lib/domain/types";
import { normalizeUrlInput } from "@/lib/domain/url";

export type Tab = "single" | "batch";

/** The share link, read-only and selected on focus, when copying failed. */
function ShareLinkField({ link }: { link: string }) {
  return (
    <input
      readOnly
      value={link}
      aria-label="Share link"
      onFocus={(event) => event.currentTarget.select()}
      className="text-caption mt-1 w-full rounded-md border border-[var(--sx-control)] bg-[var(--sx-surface)] px-2 py-1.5 font-mono text-[var(--sx-text)]"
    />
  );
}
export type ViewMode = "summary" | "full";

function useCreateAnalyzerRuntime(
  sharedPayload: string | null,
  sharedAnatomy: LinkAnatomy | null,
) {
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
  // Decoded from the page's `?shared=` value, which the server passes in,
  // so the server render and hydration agree.
  const sharedSnapshot = useMemo<SharedSnapshot | null>(
    () => decodeSharedSnapshot(sharedPayload),
    [sharedPayload],
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
    warmLinkParser();
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
      setFormError(
        `That's ${urls.length} links. A batch checks up to 10 — remove some and try again.`,
      );
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
    // The snapshot (verdict, link, summary, and the eight-cell signature)
    // travels in the link itself; the server keeps no share database.
    const targetUrl = new URL(window.location.origin);
    targetUrl.searchParams.set(
      "shared",
      encodeSharedSnapshot(buildSharedSnapshot(result)),
    );

    const link = targetUrl.toString();
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied to clipboard");
    } catch {
      // Never drop the link: hand it to the system share sheet, or keep it
      // on screen to copy by hand.
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ url: link });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      }
      toast.error(
        "Couldn't copy the link — select it below and copy it yourself.",
        {
          duration: Infinity,
          closeButton: true,
          description: <ShareLinkField link={link} />,
        },
      );
    }
  }, []);

  const rescanUrl = useCallback(
    async (url: string) => {
      setFormError(null);
      setSelectedResult(null);
      setSingleUrl(url);
      setInputEditedSinceResult(false);
      setActiveTab("single");
      warmLinkParser();
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
    sharedAnatomy,
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

export function AnalyzerRuntimeProvider({
  children,
  sharedPayload = null,
  sharedAnatomy = null,
}: {
  children: ReactNode;
  /** The raw `?shared=` value, when the page was opened from a share. */
  sharedPayload?: string | null;
  /**
   * The shared link's anatomy, computed on the server, so the first render
   * of a shared look-alike already hedges before the browser parser loads.
   */
  sharedAnatomy?: LinkAnatomy | null;
}) {
  const value = useCreateAnalyzerRuntime(sharedPayload, sharedAnatomy);
  return (
    <AnalyzerRuntimeContext.Provider value={value}>
      {children}
    </AnalyzerRuntimeContext.Provider>
  );
}
