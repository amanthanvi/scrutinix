"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getToast } from "@/components/ui/lazy-toaster";

import { useBatchStream } from "@/hooks/use-batch-stream";
import { warmLinkParser } from "@/hooks/use-link-anatomy";
import { useScanStream } from "@/hooks/use-scan-stream";
import {
  SHARE_MAX_AGE_WORDS,
  buildSharedSnapshot,
  encodeSharedSnapshot,
  sharedSnapshotAge,
  type SharedView,
} from "@/lib/domain/signal-signature";
import {
  signalNames,
  type AnalysisResult,
  type HistoryEntry,
  type SignalName,
} from "@/lib/domain/types";
import { normalizeUrlInput } from "@/lib/domain/url";
import { PREFILL_PARAM, SHARE_LAUNCH_COOKIE } from "@/lib/domain/share-launch";

/** A link handed to the page from outside: `?url=`, or the share target. */
export interface Launch {
  url: string;
  /** Only a share-target launch from this device's share sheet. */
  autoScan: boolean;
}

/** Query parameters that describe what the page opened on. */
const LAUNCH_PARAMS = ["shared", "sig", PREFILL_PARAM] as const;

/**
 * Drop the link the page opened on from the address bar once something
 * else replaced it, so a reload doesn't reopen a stale share, prefill, or
 * launch. Other parameters stay.
 */
function clearLaunchParams() {
  const url = new URL(window.location.href);
  if (!LAUNCH_PARAMS.some((name) => url.searchParams.has(name))) return;
  for (const name of LAUNCH_PARAMS) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
}

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

/** The toast for a signed result already past `SHARE_MAX_AGE`. */
export const EXPIRED_SHARE_TITLE = "Link copied, but this result has expired";
const EXPIRED_SHARE_NOTE = `Shared results show for ${SHARE_MAX_AGE_WORDS} after the check, so whoever opens it is asked to check the link themselves.`;

/** The one line a sender needs about a verified link. */
export const VERIFIED_SHARE_NOTE = `It shows this result for ${SHARE_MAX_AGE_WORDS} after the check.`;

function useCreateAnalyzerRuntime(
  shared: SharedView | null,
  launch: Launch | null,
) {
  const [activeTab, setActiveTab] = useState<Tab>("single");
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [singleUrl, setSingleUrl] = useState(launch?.url ?? "");
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

  // Set when the person opens a saved result while a scan runs: that scan
  // still lands in history, but it must not replace what they chose to read.
  const keepOpenedResultRef = useRef(false);

  const scan = useScanStream((result) => {
    if (keepOpenedResultRef.current) {
      keepOpenedResultRef.current = false;
    } else {
      startTransition(() => setSelectedResult(result));
    }
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

  // The checks the verdict engine scored against the link: the strip and
  // the Full rows never draw them as "found nothing".
  const scoredSignals = active?.threatInfo?.scoredSignals;
  const scored = useMemo<ReadonlySet<SignalName>>(
    () => new Set(scoredSignals ?? []),
    [scoredSignals],
  );

  const updateSingleUrl = useCallback((value: string) => {
    setSingleUrl(value);
    setInputEditedSinceResult(true);
  }, []);

  const startSingleScan = useCallback(async () => {
    setFormError(null);
    keepOpenedResultRef.current = false;
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
      keepOpenedResultRef.current = false;
      setSelectedResult(null);
      setSingleUrl(url);
      setInputEditedSinceResult(false);
      setActiveTab("single");
      warmLinkParser();
      await scan.startScan(url);
    },
    [scan],
  );

  // A share-target launch scans once, on arrival. The cookie that allowed
  // it is spent first, so a reload (or the same link opened again) only
  // prefills.
  const autoScanRef = useRef(launch?.autoScan ? launch.url : null);
  useEffect(() => {
    const url = autoScanRef.current;
    if (!url) return;
    autoScanRef.current = null;
    document.cookie = `${SHARE_LAUNCH_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`;
    clearLaunchParams();
    void rescanUrl(url);
  }, [rescanUrl]);

  // A result (a fresh scan, or one opened from history or a batch) has
  // replaced what the page opened on.
  const hasActive = active !== null;
  useEffect(() => {
    if (hasActive) clearLaunchParams();
  }, [hasActive]);

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
      const signed = Boolean(result.share?.sig);
      if (result.share?.sig) {
        targetUrl.searchParams.set("sig", result.share.sig);
      }
      // A signed result shows for SHARE_MAX_AGE after its check; sharing an
      // older one (from history) opens the neutral view, so say so.
      const expired =
        signed &&
        sharedSnapshotAge(
          buildSharedSnapshot(result).capturedAt,
          Date.now(),
        ) === "expired";

      const link = targetUrl.toString();
      // Only a result saved before the server issued shares, or one past its
      // window, gains a current signature by scanning again; a current
      // result without one means signing is off, and a rescan would not
      // change that.
      const scanAgain =
        result.share && !expired
          ? undefined
          : {
              label: "Scan again",
              onClick: () => void rescanUrl(result.url),
            };
      const notice =
        signed && !expired
          ? null
          : expired
            ? {
                title: EXPIRED_SHARE_TITLE,
                lead: "This result has expired.",
                note: EXPIRED_SHARE_NOTE,
              }
            : {
                title: UNVERIFIED_SHARE_TITLE,
                lead: "It isn't verified.",
                note: UNVERIFIED_SHARE_NOTE,
              };
      const tellNotice = async () => {
        if (!notice) return;
        (await getToast())(notice.title, {
          description: notice.note,
          ...(scanAgain ? { action: scanAgain } : {}),
        });
      };

      try {
        await navigator.clipboard.writeText(link);
        if (notice) {
          await tellNotice();
        } else {
          (await getToast()).success("Link copied to clipboard", {
            description: VERIFIED_SHARE_NOTE,
          });
        }
      } catch {
        // Never drop the link: hand it to the system share sheet, or keep
        // it on screen to copy by hand.
        if (typeof navigator.share === "function") {
          try {
            await navigator.share({ url: link });
            await tellNotice();
            return;
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
          }
        }
        (await getToast()).error(
          "Couldn't copy the link — select it below and copy it yourself.",
          {
            duration: Infinity,
            closeButton: true,
            description: (
              <>
                {notice ? (
                  <span className="block">
                    {notice.lead} {notice.note}
                  </span>
                ) : null}
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
    keepOpenedResultRef.current = true;
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
    // Arrived with a link to check (`?url=`) that waits for a tap.
    prefilled: Boolean(launch && !launch.autoScan),
    rescanUrl,
    scan,
    scored,
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
    verdictFocusRequest,
    viewMode,
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
  launch = null,
}: {
  children: ReactNode;
  /**
   * The page's `?shared=` link, resolved on the server: the link and its
   * anatomy (so a shared look-alike hedges before the browser parser
   * loads), and the snapshot only when Scrutinix signed it.
   */
  shared?: SharedView | null;
  /** `?url=`, normalized on the server, and whether to scan it now. */
  launch?: Launch | null;
}) {
  const value = useCreateAnalyzerRuntime(shared, launch);
  return (
    <AnalyzerRuntimeContext.Provider value={value}>
      {children}
    </AnalyzerRuntimeContext.Provider>
  );
}
