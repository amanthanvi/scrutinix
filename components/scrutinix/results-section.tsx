"use client";

import dynamic from "next/dynamic";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { LinkAnatomyView } from "@/components/scrutinix/link-anatomy";
import { SignalRow } from "@/components/scrutinix/signal-row";
import {
  SignalStrip,
  SignatureStrip,
} from "@/components/scrutinix/signal-strip";
import {
  VERDICT_HEADING_ID,
  VerdictBand,
  VerdictDetails,
} from "@/components/scrutinix/verdict-panel";
import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import { describeQuietChecks } from "@/components/shared/signal-selection";
import { Button } from "@/components/ui/button";
import { useLinkAnatomy, warmLinkParser } from "@/hooks/use-link-anatomy";
import { downloadTextFile } from "@/lib/client/export";
import {
  signalNames,
  type AnalysisResult,
  type SignalName,
  type SignalResults,
} from "@/lib/domain/types";
import { isLegacySignalRecord } from "@/lib/domain/signal-signature";
import { getVerdictAnnouncement } from "@/lib/domain/verdict-guidance";
import { cn } from "@/lib/utils";

const BatchTable = dynamic(
  () =>
    import("@/components/scrutinix/batch-table").then(
      (module) => module.BatchTable,
    ),
  {
    loading: () => (
      <p className="text-meta text-[var(--sx-text-soft)]">
        Loading batch results…
      </p>
    ),
  },
);

function RuntimeSignalRow<N extends SignalName>({
  index,
  name,
  scored,
  signals,
}: {
  index: number;
  name: N;
  scored: boolean;
  signals: SignalResults;
}) {
  return (
    <SignalRow
      name={name}
      result={signals[name]}
      index={index}
      scored={scored}
    />
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Text the person must see to decide: the verdict word and instruction. */
function bringVerdictIntoView(heading: HTMLElement) {
  const answer = heading.nextElementSibling ?? heading;
  const top = heading.getBoundingClientRect().top;
  const bottom = answer.getBoundingClientRect().bottom;
  if (top >= 0 && bottom <= window.innerHeight) return;
  heading.closest("section")?.scrollIntoView?.({
    block: "start",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

export function ResultsSection() {
  const {
    active,
    activeTab,
    batch,
    done,
    openStoredResult,
    rescanUrl,
    scan,
    setSingleUrl,
    setViewMode,
    shareResult,
    sharedAnatomy,
    sharedSnapshot,
    signals,
    summarySelection,
    verdictFocusRequest,
    viewMode,
    visibleSignals,
  } = useAnalyzerRuntime();

  const linkUrl =
    active?.url ??
    (scan.state.isStreaming ? scan.state.url : null) ??
    sharedSnapshot?.url ??
    null;
  // A shared link arrives with the anatomy the server computed (same tldts,
  // same splitLinkAnatomy), so the browser parser is fetched only for other
  // links, and a shared look-alike hedges from the first paint.
  const serverAnatomy =
    linkUrl && linkUrl === sharedSnapshot?.url ? sharedAnatomy : null;
  const parsed = useLinkAnatomy(
    activeTab === "single" && !serverAnatomy ? linkUrl : null,
  );
  // Prefer the server's result: with a null URL the hook can report ready
  // while its anatomy is null.
  const anatomy = serverAnatomy ?? (parsed.ready ? parsed.anatomy : null);
  const anatomyReady = serverAnatomy !== null || parsed.ready;
  const impersonates = anatomy?.impersonates ?? null;

  // Batch rows can be opened as results: have the parser ready by then.
  const hasBatchItems = batch.state.items.length > 0;
  useEffect(() => {
    if (hasBatchItems) warmLinkParser();
  }, [hasBatchItems]);

  // A stored result (history, batch "Open") replaced the view: move focus
  // to its verdict so keyboard and screen-reader users land on the answer,
  // and blank the live region for a beat so the same text (reopening the
  // same entry) is a real change and gets spoken again. The region itself
  // stays mounted: a freshly inserted live region is announced unreliably.
  const [announcedRequest, setAnnouncedRequest] = useState(0);
  // Hold a verdict announcement until the link's anatomy is known, so a
  // look-alike is spoken with its hedge, never first without it.
  const reannouncing =
    verdictFocusRequest !== announcedRequest ||
    Boolean(active && activeTab === "single" && !anatomyReady);
  useEffect(() => {
    if (verdictFocusRequest === 0) return;
    document.getElementById(VERDICT_HEADING_ID)?.focus();
    const timer = window.setTimeout(
      () => setAnnouncedRequest(verdictFocusRequest),
      100,
    );
    return () => window.clearTimeout(timer);
  }, [verdictFocusRequest]);

  // Re-scan removes the button that started it. Keep keyboard focus on the
  // band's heading: it reads "Checking" while the scan runs, and the same
  // node becomes the verdict when the result lands.
  const [bandFocusRequest, setBandFocusRequest] = useState(0);
  const focusOnLandRef = useRef(false);
  useEffect(() => {
    if (bandFocusRequest === 0) return;
    document.getElementById(VERDICT_HEADING_ID)?.focus({ preventScroll: true });
  }, [bandFocusRequest]);
  /** Any control that starts a scan of the shown link and then unmounts. */
  const rescanFromBand = (url: string) => {
    focusOnLandRef.current = true;
    setBandFocusRequest((previous) => previous + 1);
    void rescanUrl(url);
  };

  // Every time a scan stops. With a result: return focus to the verdict if
  // it was parked on the band (Re-scan) or fell to <body>, and bring the
  // answer into view when it is off-screen - on a phone the band often
  // starts below the fold. Without one (error, abort): the Checking band
  // unmounted, so focus that fell to <body> goes back to the input; the
  // stream error's role="alert" announces the failure. The one-shot
  // Re-scan flag is always consumed, so it can never carry into the next
  // ordinary scan and pull focus out of the input.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    const streaming = scan.state.isStreaming;
    const stopped = wasStreamingRef.current && !streaming;
    wasStreamingRef.current = streaming;
    if (!stopped) return;
    const parked = focusOnLandRef.current;
    focusOnLandRef.current = false;
    const lost =
      document.activeElement === document.body ||
      document.activeElement === null;
    const heading = document.getElementById(VERDICT_HEADING_ID);
    if (scan.state.result && heading) {
      if (parked || lost) heading.focus({ preventScroll: true });
      bringVerdictIntoView(heading);
      return;
    }
    if (lost) document.getElementById("sx-url-input")?.focus();
  }, [scan.state.isStreaming, scan.state.result]);

  // Revealing the quiet checks removes the button that did it; move focus
  // to the first newly revealed check that can expand, so keyboard users
  // land on new evidence rather than a row Summary already showed. If none
  // of the revealed rows expands, focus the list instead of <body>.
  const signalListRef = useRef<HTMLUListElement>(null);
  const revealedFromRef = useRef<ReadonlySet<SignalName> | null>(null);
  useEffect(() => {
    const shownBefore = revealedFromRef.current;
    if (!shownBefore || viewMode !== "full") return;
    revealedFromRef.current = null;
    const list = signalListRef.current;
    const target = Array.from(
      list?.querySelectorAll<HTMLElement>("li[data-signal]") ?? [],
    )
      .filter((row) => !shownBefore.has(row.dataset.signal as SignalName))
      .map((row) => row.querySelector<HTMLElement>("summary"))
      .find(Boolean);
    (target ?? list)?.focus();
  }, [viewMode]);

  // A strip cell reveals its row: switch to Full if Summary hides it, open
  // its evidence, and move focus there.
  const [revealRequest, setRevealRequest] = useState<{
    name: SignalName;
    at: number;
  } | null>(null);
  useEffect(() => {
    if (!revealRequest) return;
    const row = signalListRef.current?.querySelector<HTMLElement>(
      `li[data-signal="${revealRequest.name}"]`,
    );
    if (!row) return;
    const details = row.querySelector("details");
    if (details) details.open = true;
    (row.querySelector<HTMLElement>("summary") ?? row).focus({
      preventScroll: true,
    });
    row.scrollIntoView?.({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    setRevealRequest(null);
  }, [revealRequest, visibleSignals]);

  const activateSignal = (name: SignalName) => {
    if (!visibleSignals.includes(name)) setViewMode("full");
    setRevealRequest({ name, at: Date.now() });
  };

  // Saved before per-check results were kept: no strip, no rows to show.
  const legacyRecord =
    active !== null && !scan.state.isStreaming
      ? isLegacySignalRecord(active.signals)
      : false;
  const hasSignalActivity =
    !legacyRecord &&
    (scan.state.isStreaming ||
      signalNames.some((name) => signals[name].status !== "pending"));
  const quietChecks =
    viewMode === "summary" ? describeQuietChecks(summarySelection) : null;
  const showSnapshot = !active && !scan.state.isStreaming && sharedSnapshot;

  return (
    <section aria-label="Results" className="flex flex-col">
      <LiveStatus
        text={
          reannouncing
            ? ""
            : getLiveStatus({
                activeTab,
                active,
                scanStreaming: scan.state.isStreaming,
                done,
                batchStreaming: batch.state.isStreaming,
                batchDone: batch.state.results.length,
                batchTotal: batch.state.items.length,
                impersonates,
                registeredDomain: anatomy?.registeredDomain ?? null,
              })
        }
      />

      {activeTab === "batch" ? (
        <BatchTable
          items={batch.state.items}
          isStreaming={batch.state.isStreaming}
          results={batch.state.results}
          onSelectResult={openStoredResult}
        />
      ) : (
        <>
          <VerdictBand
            result={active}
            isStreaming={scan.state.isStreaming}
            sharedSnapshot={sharedSnapshot}
            completedSignals={done}
            impersonates={impersonates}
            driverRows={summarySelection.drivers.length}
            onCancelScan={() => {
              // Cancel unmounts with its band: hand focus back to the input.
              focusOnLandRef.current = false;
              scan.cancelScan();
              document.getElementById("sx-url-input")?.focus();
            }}
            onRunSharedScan={
              sharedSnapshot
                ? () => {
                    setSingleUrl(sharedSnapshot.url);
                    rescanFromBand(sharedSnapshot.url);
                  }
                : undefined
            }
          />

          {linkUrl ? (
            <div className="mt-6">
              <LinkAnatomyView
                url={linkUrl}
                anatomy={anatomy}
                signals={showSnapshot ? null : signals}
                visibleSignals={visibleSignals}
                streaming={scan.state.isStreaming && !active}
              />
            </div>
          ) : null}

          {showSnapshot && sharedSnapshot?.signature ? (
            <div className="mt-8">
              <SignatureStrip signature={sharedSnapshot.signature} />
            </div>
          ) : null}

          {legacyRecord ? (
            <p className="text-body mt-8 max-w-[60ch] text-[var(--sx-text-muted)]">
              This scan was saved before per-check results were kept, so its
              eight checks can&apos;t be shown. Re-scan for a fresh result.
            </p>
          ) : null}

          {hasSignalActivity ? (
            <>
              <div className="mt-8">
                <SignalStrip
                  signals={signals}
                  scored={summarySelection.scored}
                  streaming={scan.state.isStreaming && !active}
                  onActivate={activateSignal}
                />
              </div>

              <div className="mt-10 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4 border-b border-[var(--sx-border)]">
                  <h3 className="text-meta font-semibold text-[var(--sx-text)]">
                    Evidence
                  </h3>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={viewMode === "full"}
                    onClick={() =>
                      setViewMode(viewMode === "summary" ? "full" : "summary")
                    }
                    className="text-meta -mb-px inline-flex min-h-11 items-stretch gap-4 font-medium"
                  >
                    {(
                      [
                        ["summary", "Summary"],
                        ["full", "Full"],
                      ] as const
                    ).map(([mode, label]) => (
                      <Fragment key={mode}>
                        {mode === "full" ? " " : null}
                        <span
                          data-selected={viewMode === mode}
                          className={cn(
                            "sx-segment inline-flex items-center border-b-2 px-0.5 transition-colors",
                            viewMode === mode
                              ? "border-[var(--sx-accent)] text-[var(--sx-text)]"
                              : "border-transparent text-[var(--sx-text-soft)] hover:text-[var(--sx-text)]",
                          )}
                        >
                          {label}
                        </span>
                      </Fragment>
                    ))}
                    {/* Name stays "Summary Full …": visible text first (WCAG 2.5.3). */}
                    <span className="sr-only">{" signal list"}</span>
                  </button>
                </div>

                {visibleSignals.length > 0 ? (
                  <ul
                    ref={signalListRef}
                    aria-label="Signals"
                    tabIndex={-1}
                    className="divide-y divide-[var(--sx-border)] border-b border-[var(--sx-border)] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sx-focus-ring)]"
                  >
                    {visibleSignals.map((signalName, index) => (
                      <RuntimeSignalRow
                        key={signalName}
                        name={signalName}
                        signals={signals}
                        scored={summarySelection.scored.has(signalName)}
                        index={index}
                      />
                    ))}
                  </ul>
                ) : null}

                {quietChecks ? (
                  <button
                    type="button"
                    onClick={() => {
                      revealedFromRef.current = new Set(
                        summarySelection.drivers,
                      );
                      setViewMode("full");
                    }}
                    className="min-h-11 self-start py-2 text-left text-sm text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]"
                  >
                    {quietChecks}{" "}
                    <span className="sx-link whitespace-nowrap">
                      Show all checks
                    </span>
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {active ? (
            <>
              <div className="mt-6">
                <VerdictDetails result={active} impersonates={impersonates} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    downloadTextFile(
                      "scan.json",
                      JSON.stringify(active, null, 2),
                      "application/json",
                    );
                    toast.success("Downloaded scan.json");
                  }}
                >
                  Download result (JSON)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void shareResult(active)}
                >
                  Share
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => rescanFromBand(active.url)}
                >
                  Re-scan
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function LiveStatus({ text }: { text: string }) {
  return (
    <p className="sr-only" aria-live="polite">
      {text}
    </p>
  );
}

/** Polite live-region text: progress while streaming, the shown verdict after. */
function getLiveStatus({
  activeTab,
  active,
  scanStreaming,
  done,
  batchStreaming,
  batchDone,
  batchTotal,
  impersonates,
  registeredDomain,
}: {
  activeTab: "single" | "batch";
  active: AnalysisResult | null;
  scanStreaming: boolean;
  done: number;
  batchStreaming: boolean;
  batchDone: number;
  batchTotal: number;
  impersonates: string | null;
  registeredDomain: string | null;
}): string {
  if (activeTab === "batch") {
    if (batchStreaming) {
      return `${batchDone} of ${batchTotal} links scanned.`;
    }
    if (batchTotal === 0) return "";
    // Error, rate limit, or cancel: nothing completed the rest.
    return batchDone < batchTotal
      ? `Batch stopped: ${batchDone} of ${batchTotal} links scanned.`
      : `Batch complete: ${batchDone} of ${batchTotal} links scanned.`;
  }

  // A displayed result outranks progress, matching the verdict band: an
  // opened saved result is announced even while a scan streams behind it.
  if (scanStreaming && !active) {
    return `${done} of ${SIGNAL_COUNT} checks finished.`;
  }

  return active
    ? getVerdictAnnouncement({ ...active, impersonates, registeredDomain })
    : "";
}
