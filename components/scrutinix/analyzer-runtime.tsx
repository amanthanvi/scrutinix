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

import { selectSummarySignals } from "@/components/shared/signal-selection";
import { useBatchStream } from "@/hooks/use-batch-stream";
import { warmLinkParser } from "@/hooks/use-link-anatomy";
import { useScanStream } from "@/hooks/use-scan-stream";
import {
  buildSharedSnapshot,
  encodeSharedSnapshot,
  type SharedView,
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

/** The toast for a share link without a Scrutinix signature. */
export const UNVERIFIED_SHARE_TITLE = "Link copied, but it isn't verified";
const UNVERIFIED_SHARE_NOTE =
  "Whoever opens it is asked to check the link themselves; it won't show this result.";

function useCreateAnalyzerRuntime(shared: SharedView | null) {
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
  // The page's `?shared=` link, verified and parsed on the server, so the
  // server render and hydration agree. The snapshot is present only when
  // Scrutinix signed it; the browser never decodes the payload itself.
  const sharedSnapshot = shared?.snapshot ?? null;
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

  const shareResult = useCallback(
    async (result: AnalysisResult) => {
      // The snapshot (verdict, link, summary, and the eight-cell signature)
      // travels in the link itself; the server keeps no share database. The
      // server issued the payload and its signature with the result, and
      // only a signed link opens as a Scrutinix result. Without one (saved
      // before signing, or signing off) the link still carries the
      // snapshot, opens as "check this shared link yourself", and the
      // sender is told so.
      const targetUrl = new URL(window.location.origin);
      targetUrl.searchParams.set(
        "shared",
        result.share?.payload ??
          encodeSharedSnapshot(buildSharedSnapshot(result)),
      );
      const verified = Boolean(result.share?.sig);
      if (result.share?.sig) {
        targetUrl.searchParams.set("sig", result.share.sig);
      }

      const link = targetUrl.toString();
      // Only a result saved before the server issued shares can gain a
      // signature by scanning again; a current result without one means
      // signing is off, and a rescan would not change that.
      const scanAgain = result.share
        ? undefined
        : {
            label: "Scan again",
            onClick: () => void rescanUrl(result.url),
          };
      const tellUnverified = () =>
        toast(UNVERIFIED_SHARE_TITLE, {
          description: UNVERIFIED_SHARE_NOTE,
          ...(scanAgain ? { action: scanAgain } : {}),
        });

      try {
        await navigator.clipboard.writeText(link);
        if (verified) {
          toast.success("Link copied to clipboard");
        } else {
          tellUnverified();
        }
      } catch {
        // Never drop the link: hand it to the system share sheet, or keep
        // it on screen to copy by hand.
        if (typeof navigator.share === "function") {
          try {
            await navigator.share({ url: link });
            if (!verified) tellUnverified();
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
            description: (
              <>
                {verified ? null : (
                  <span className="block">
                    It isn&apos;t verified. {UNVERIFIED_SHARE_NOTE}
                  </span>
                )}
                <ShareLinkField link={link} />
              </>
            ),
          },
        );
      }
    },
    [rescanUrl],
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
    shared,
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
  shared = null,
}: {
  children: ReactNode;
  /**
   * The page's `?shared=` link, resolved on the server: the link and its
   * anatomy (so a shared look-alike hedges before the browser parser
   * loads), and the snapshot only when Scrutinix signed it.
   */
  shared?: SharedView | null;
}) {
  const value = useCreateAnalyzerRuntime(shared);
  return (
    <AnalyzerRuntimeContext.Provider value={value}>
      {children}
    </AnalyzerRuntimeContext.Provider>
  );
}
