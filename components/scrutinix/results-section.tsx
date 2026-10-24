"use client";

import dynamic from "next/dynamic";
import { Fragment, useEffect, useRef, useState } from "react";
import { getToast } from "@/components/ui/lazy-toaster";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { LinkAnatomyView } from "@/components/scrutinix/link-anatomy";
import { retryableChunk } from "@/components/scrutinix/retryable-chunk";
import { SignalRow } from "@/components/scrutinix/signal-row";
import { SignalCell } from "@/components/scrutinix/signal-cell";
import {
  SignalStrip,
  SignatureStrip,
} from "@/components/scrutinix/signal-strip";
import {
  SummaryQuestionList,
  questionHeadingId,
} from "@/components/scrutinix/summary-questions";
import {
  VERDICT_HEADING_ID,
  VerdictBand,
  VerdictDetails,
} from "@/components/scrutinix/verdict-panel";
import { SIGNAL_COUNT } from "@/components/shared/scrutinix-types";
import { Button } from "@/components/ui/button";
import {
  getLoadedLinkParser,
  useLinkAnatomy,
  warmLinkParser,
} from "@/hooks/use-link-anatomy";
import { downloadTextFile } from "@/lib/client/export";
import { registrableDomainOf } from "@/lib/domain/link-anatomy";
import {
  signalNames,
  type AnalysisResult,
  type SignalName,
  type SignalResults,
} from "@/lib/domain/types";
import { capitalize } from "@/lib/domain/copy";
import type { Severity } from "@/lib/domain/signal-severity";
import {
  getSignalSignature,
  isLegacySignalRecord,
  severityWords,
} from "@/lib/domain/signal-signature";
import {
  evidenceTimeOf,
  getSummaryQuestions,
  questionCiting,
} from "@/lib/domain/summary-questions";
import { getVerdictAnnouncement } from "@/lib/domain/verdict-guidance";
import { cn } from "@/lib/utils";

// Opened with the Batch tab, like Batch's input: a failed chunk stays here
// rather than hiding the scan form.
const loadBatchTable = retryableChunk(
  () =>
    import("@/components/scrutinix/batch-table").then(
      (module) => module.BatchTable,
    ),
  "Batch results didn't load. Check your connection and try again.",
);

const BatchTable = dynamic(() => loadBatchTable(), {
  loading: () => (
    <p className="text-meta text-[var(--sx-text-soft)]">
      Loading batch results…
    </p>
  ),
});

function RuntimeSignalRow<N extends SignalName>({
  evidenceTime,
  index,
  name,
  scored,
  signals,
}: {
  evidenceTime: number | undefined;
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
      evidenceTime={evidenceTime}
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
    scored,
    setSingleUrl,
    setViewMode,
    shareResult,
    shared,
    sharedSnapshot,
    signals,
    verdictFocusRequest,
    viewMode,
  } = useAnalyzerRuntime();

  const linkUrl =
    active?.url ??
    (scan.state.isStreaming ? scan.state.url : null) ??
    shared?.url ??
    null;
  // A shared link arrives with the anatomy the server computed (same tldts,
  // same splitLinkAnatomy), so the browser parser is fetched only for other
  // links, and a shared look-alike hedges from the first paint.
  const serverAnatomy =
    shared && linkUrl === shared.url ? shared.anatomy : null;
  const parsed = useLinkAnatomy(
    activeTab === "single" && !serverAnatomy ? linkUrl : null,
  );
  const anatomy = serverAnatomy ?? parsed.anatomy;
  // Whether `impersonates` is final. A Safe band holds while "pending" and
  // reads "Unconfirmed" if the parser "failed": absent anatomy never means
  // "not a look-alike".
  const addressCheck = serverAnatomy ? "ready" : parsed.status;
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
  // Hold a Safe verdict's announcement until the link's anatomy is settled,
  // so a look-alike is spoken with its hedge, never first as "Safe". A
  // failed parser settles it too: the announcement then says so. Any other
  // verdict is already a warning and is spoken at once.
  const reannouncing =
    verdictFocusRequest !== announcedRequest ||
    (active?.verdict === "safe" &&
      activeTab === "single" &&
      addressCheck === "pending");
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
      // Only when the band shows this scan: if the person opened a history
      // or batch result while it ran, a background finish must not pull the
      // page away from what they are reading.
      if (active === scan.state.result) bringVerdictIntoView(heading);
      return;
    }
    if (lost) document.getElementById("sx-url-input")?.focus();
  }, [active, scan.state.isStreaming, scan.state.result]);

  // A strip cell leads to its evidence: in Summary, the question citing
  // its check; in Full, its row, opened. Focus moves there.
  const signalListRef = useRef<HTMLUListElement>(null);
  const [revealRequest, setRevealRequest] = useState<{
    name: SignalName;
    at: number;
  } | null>(null);
  useEffect(() => {
    if (!revealRequest) return;
    const row = signalListRef.current?.querySelector<HTMLElement>(
      `li[data-signal="${revealRequest.name}"]`,
    );
    const target =
      row ??
      document.getElementById(
        questionHeadingId(questionCiting(revealRequest.name)),
      );
    if (!target) return;
    const details = row?.querySelector("details");
    if (details) details.open = true;
    (row?.querySelector<HTMLElement>("summary") ?? target).focus({
      preventScroll: true,
    });
    target.scrollIntoView?.({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    setRevealRequest(null);
  }, [revealRequest]);

  const activateSignal = (name: SignalName) => {
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
  // Summary answers five questions. A failed scan has nothing to answer
  // with, so it keeps its eight rows; Full always shows the rows.
  const showQuestions =
    hasSignalActivity &&
    viewMode === "summary" &&
    !(active?.verdict === "error");
  // One clock for every relative age, in Summary and Full: a finished
  // result's own check time, or the server's start time while a scan
  // streams, so ages don't jump when the verdict lands.
  const evidenceTime = active
    ? evidenceTimeOf(active.metadata)
    : scan.state.isStreaming && scan.state.startedAt
      ? evidenceTimeOf({ checkedAt: scan.state.startedAt })
      : undefined;
  const parse = getLoadedLinkParser();
  const questions =
    showQuestions && linkUrl
      ? getSummaryQuestions({
          url: linkUrl,
          signals,
          now: evidenceTime,
          registeredDomainOf: parse
            ? (host) => registrableDomainOf(parse, host)
            : null,
        })
      : null;
  // A shared link with nothing else on screen: its band (verified snapshot
  // or the neutral "check it yourself") and Scrutinix's own anatomy.
  const showShared = !active && !scan.state.isStreaming && shared !== null;

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
                addressUnchecked: addressCheck === "failed",
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
            unverifiedShare={shared !== null && sharedSnapshot === null}
            expiredShare={shared?.expired ?? false}
            completedSignals={done}
            impersonates={impersonates}
            addressCheck={addressCheck}
            registeredDomain={anatomy?.registeredDomain ?? null}
            holdDomain={linkUrl !== null && addressCheck === "pending"}
            evidenceShown={hasSignalActivity}
            onCancelScan={() => {
              // Cancel unmounts with its band: hand focus back to the input.
              focusOnLandRef.current = false;
              scan.cancelScan();
              document.getElementById("sx-url-input")?.focus();
            }}
            onRunSharedScan={
              shared
                ? () => {
                    setSingleUrl(shared.url);
                    rescanFromBand(shared.url);
                  }
                : undefined
            }
          />

          {linkUrl ? (
            <section
              aria-labelledby="sx-link-anatomy-heading"
              className="mt-9 sm:mt-11"
            >
              <h3 id="sx-link-anatomy-heading" className="sx-rail-heading">
                The link, taken apart
              </h3>
              <LinkAnatomyView
                url={linkUrl}
                anatomy={anatomy}
                captions
                signals={showShared ? null : signals}
                // The questions and rows state every check's facts, so the
                // anatomy keeps them only while a scan streams.
                visibleSignals={hasSignalActivity ? signalNames : []}
                streaming={scan.state.isStreaming && !active}
              />
            </section>
          ) : null}

          {showShared && sharedSnapshot?.signature ? (
            <div className="mt-10 sm:mt-12">
              <SignatureStrip signature={sharedSnapshot.signature} />
            </div>
          ) : null}

          {legacyRecord ? (
            <p className="text-body mt-10 max-w-[65ch] text-[var(--sx-text-muted)]">
              This scan was saved before per-check results were kept, so its
              eight checks can&apos;t be shown. Re-scan for a fresh result.
            </p>
          ) : null}

          {hasSignalActivity ? (
            <section
              aria-labelledby="sx-evidence-heading"
              className="mt-10 flex flex-col sm:mt-14"
            >
              <div className="flex items-end justify-between gap-4 border-b border-[var(--sx-text)]">
                <h3
                  id="sx-evidence-heading"
                  className="sx-section-title pb-3 sm:pb-3.5"
                >
                  Evidence
                </h3>
                <button
                  type="button"
                  role="switch"
                  aria-checked={viewMode === "full"}
                  onClick={() =>
                    setViewMode(viewMode === "summary" ? "full" : "summary")
                  }
                  className="text-body -mb-px inline-flex min-h-11 items-stretch gap-6 font-medium"
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
                          "sx-segment inline-flex min-w-11 items-center justify-center border-b-2 transition-colors",
                          viewMode === mode
                            ? "border-[var(--sx-text)] text-[var(--sx-text)]"
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

              {/* The strip heads the evidence as its index: each numbered
                  cell leads to the question citing it (or its row in Full). */}
              <div className="sx-strip-index">
                <SignalStrip
                  signals={signals}
                  scored={scored}
                  streaming={scan.state.isStreaming && !active}
                  leadsTo={questions ? "question" : "row"}
                  onActivate={activateSignal}
                />
                {active ? (
                  <StripLegend signals={signals} scored={scored} />
                ) : null}
              </div>

              {questions ? (
                <SummaryQuestionList questions={questions} />
              ) : (
                <ul
                  ref={signalListRef}
                  aria-label="Signals"
                  className="divide-y divide-[var(--sx-border)] border-b border-[var(--sx-border)]"
                >
                  {signalNames.map((signalName, index) => (
                    <RuntimeSignalRow
                      key={signalName}
                      name={signalName}
                      signals={signals}
                      scored={scored.has(signalName)}
                      index={index}
                      evidenceTime={evidenceTime}
                    />
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {active ? (
            <>
              <div className="mt-8">
                <VerdictDetails
                  result={active}
                  impersonates={impersonates}
                  addressCheck={addressCheck}
                />
              </div>
              {/* Phones: Download on its own row, Share and Re-scan halves. */}
              <div className="mt-5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="col-span-2"
                  onClick={async () => {
                    downloadTextFile(
                      "scan.json",
                      JSON.stringify(active, null, 2),
                      "application/json",
                    );
                    (await getToast()).success("Downloaded scan.json");
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

/** Legend order: the states that say most first. */
const LEGEND_ORDER: readonly Severity[] = [
  "malicious",
  "suspicious",
  "neutral",
  "clear",
  "error",
  "skipped",
];

/**
 * A key to the strip's shapes: only the states it actually draws, in the
 * words its names and titles use. For the eye (each cell already states
 * its own answer), so hidden from assistive technology.
 */
function StripLegend({
  signals,
  scored,
}: {
  signals: SignalResults;
  scored: ReadonlySet<SignalName>;
}) {
  const present = new Set(getSignalSignature(signals, scored));
  const states = LEGEND_ORDER.filter((severity) => present.has(severity));
  return states.length > 0 ? (
    <p aria-hidden="true" className="sx-legend">
      {states.map((severity) => (
        <span key={severity}>
          <SignalCell severity={severity} settled />
          {capitalize(severityWords[severity])}
        </span>
      ))}
    </p>
  ) : null;
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
  addressUnchecked,
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
  addressUnchecked: boolean;
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
    ? getVerdictAnnouncement({
        ...active,
        impersonates,
        addressUnchecked,
        registeredDomain,
      })
    : "";
}
