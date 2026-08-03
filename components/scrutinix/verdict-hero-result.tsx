"use client";

import { clsx } from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { threatScoreBandLabel } from "@/lib/domain/score-bands";
import { formatDisplayUrl } from "@/lib/domain/url";
import {
  createPendingSignalResults,
  type AnalysisResult,
} from "@/lib/domain/types";
import {
  SIGNAL_COUNT,
  verdictColor,
  verdictInk,
  type SharedSnapshot,
} from "@/components/shared/scrutinix-types";
import { ScoreRing } from "@/components/scrutinix/score-ring";

interface VerdictHeroResultProps {
  result: AnalysisResult | null;
  streamUrl: string;
  sharedSnapshot: SharedSnapshot | null;
  completedSignals: number;
  onRunSharedScan?: () => void;
}

function verdictScore(result: AnalysisResult): number {
  return result.threatInfo?.score ?? 0;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VerdictHeroResult({
  result,
  streamUrl,
  sharedSnapshot,
  completedSignals,
  onRunSharedScan,
}: VerdictHeroResultProps) {
  const isMalicious =
    result?.verdict === "malicious" || result?.verdict === "critical";
  const sharedVerdict = sharedSnapshot?.verdict ?? null;

  const color = result ? verdictColor(result.verdict) : "var(--sx-accent)";
  const score = result ? verdictScore(result) : 0;
  const scoreBandLabel =
    result?.verdict === "unknown"
      ? "Unknown — not a safety verdict"
      : result?.verdict === "error"
        ? "Error — no safety verdict"
        : threatScoreBandLabel(score);
  const resultSignals = result?.signals ?? createPendingSignalResults();
  const resultMetadata = result?.metadata;
  const displayUrl = result
    ? formatDisplayUrl(result.url)
    : sharedSnapshot
      ? formatDisplayUrl(sharedSnapshot.url)
      : formatDisplayUrl(streamUrl);
  const summaryText =
    result?.threatInfo?.summary ??
    sharedSnapshot?.summary ??
    "Signal cards will populate independently as each provider finishes.";
  const threatInfo = result?.threatInfo ?? null;
  const failedSignals = result
    ? Object.values(resultSignals).filter((signal) => signal.status === "error")
        .length
    : 0;
  const skippedSignals = result
    ? Object.values(resultSignals).filter(
        (signal) => signal.status === "skipped",
      ).length
    : 0;
  const completedSignalCount = result
    ? Object.values(resultSignals).filter(
        (signal) => signal.status !== "pending",
      ).length
    : completedSignals;
  const evidenceReasons =
    threatInfo?.hasPositiveEvidence && threatInfo?.reasons
      ? threatInfo.reasons
      : [];
  const unavailableEvidenceText =
    result?.verdict === "unknown"
      ? "The host could not be inspected, so this scan cannot establish whether the URL is safe."
      : result?.verdict === "error"
        ? "The scan did not return enough evidence to establish a safety verdict."
        : "Supporting evidence details are unavailable for this verdict.";
  const confidenceLabel = threatInfo?.confidenceLabel
    ? threatInfo.confidenceLabel.toUpperCase()
    : "LOW";
  const confidenceReasons = threatInfo?.confidenceReasons ?? [];
  const recommendations = threatInfo?.recommendations ?? [];
  const limitations = threatInfo?.limitations ?? [];
  const confidenceValue = threatInfo?.confidence ?? 0;
  const showLimitedCoverage = Boolean(resultMetadata?.partialFailure);
  const showProvisionalSafe =
    result?.verdict === "safe" && confidenceValue < 0.5;
  const coverageCallout =
    showLimitedCoverage || showProvisionalSafe
      ? {
          title:
            showLimitedCoverage && showProvisionalSafe
              ? "Limited coverage and low confidence"
              : showProvisionalSafe
                ? "Provisional safe verdict"
                : "Limited coverage",
          body:
            showLimitedCoverage && showProvisionalSafe
              ? `This verdict is based on ${completedSignalCount}/${SIGNAL_COUNT} completed signals. ${failedSignals > 0 ? `${failedSignals} failed` : "No signals failed"}${skippedSignals > 0 ? ` and ${skippedSignals} were not applicable` : ""}. The completed signals did not show direct malicious indicators, but the confidence is still low enough that this result should not be treated as a clean bill of health.`
              : showProvisionalSafe
                ? "The completed signals did not show direct malicious indicators, but the confidence is low enough that this result should not be treated as a clean bill of health."
                : `This verdict is based on ${completedSignalCount}/${SIGNAL_COUNT} completed signals. ${failedSignals > 0 ? `${failedSignals} failed` : "No signals failed"}${skippedSignals > 0 ? ` and ${skippedSignals} were not applicable` : ""}.`,
        }
      : null;

  return (
    <section
      className={clsx(
        "sx-panel rounded-lg border p-6 transition-all duration-200 sm:p-8",
        isMalicious
          ? "border-[var(--sx-malicious)]"
          : "border-[var(--sx-border)]",
      )}
      aria-label={`Scan result: ${result?.verdict ?? sharedVerdict ?? "pending"}`}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(18rem,0.72fr)]">
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="border-border bg-card rounded-md border px-2.5 py-1 text-[0.65rem] font-medium tracking-[0.06em] text-[var(--sx-text-muted)] uppercase">
                  {result ? "Live result" : "Shared snapshot"}
                </span>
                {result ? (
                  <span
                    className="sx-verdict-badge"
                    style={{
                      color: verdictInk(result.verdict),
                      borderColor: color,
                      backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
                    }}
                  >
                    {result.verdict}
                  </span>
                ) : sharedVerdict ? (
                  <span
                    className="sx-verdict-badge"
                    style={{
                      color: verdictInk(sharedVerdict),
                      borderColor: verdictColor(sharedVerdict),
                      backgroundColor: `color-mix(in srgb, ${verdictColor(sharedVerdict)} 10%, transparent)`,
                    }}
                  >
                    {sharedVerdict}
                  </span>
                ) : null}
                {result ? (
                  <span className="text-xs text-[var(--sx-text-muted)]">
                    {result.verdict === "unknown"
                      ? "Unknown — host could not be inspected"
                      : threatScoreBandLabel(score)}
                  </span>
                ) : null}
              </div>

              <h2 className="text-2xl font-semibold tracking-[-0.02em] break-all text-[var(--sx-text)] sm:text-3xl">
                {displayUrl}
              </h2>
            </div>

            {!result && onRunSharedScan ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRunSharedScan}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Run fresh scan
              </Button>
            ) : null}
          </div>

          {!result && sharedSnapshot ? (
            <div className="border-border bg-card rounded-lg border px-4 py-4 text-sm leading-6 text-[var(--sx-text-muted)]">
              This snapshot is client-shared state. Run a fresh scan to verify
              the verdict against current provider results.
            </div>
          ) : null}

          <p className="max-w-3xl text-base leading-8 text-[var(--sx-text-muted)]">
            {summaryText}
          </p>

          {coverageCallout ? (
            <div className="rounded-lg border border-[var(--sx-suspicious)] bg-[color-mix(in_srgb,var(--sx-suspicious)_10%,transparent)] px-4 py-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sx-suspicious)]"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-xs font-medium text-[var(--sx-suspicious)]">
                    {coverageCallout.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--sx-text-muted)]">
                    {coverageCallout.body}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {evidenceReasons.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-xs text-[var(--sx-text-muted)]">
                Why this verdict
              </h3>
              <div className="grid gap-4">
                {evidenceReasons.slice(0, 6).map((reason, index) => (
                  <div
                    key={`${index}-${reason}`}
                    className="border-border bg-card rounded-lg border px-5 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <p className="text-sm leading-6 text-[var(--sx-text)]">
                        {reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : result?.verdict === "safe" ? (
            <div className="border-border bg-card rounded-lg border px-4 py-4 text-sm leading-6 text-[var(--sx-text-muted)]">
              <CheckCircle2
                className="mr-2 inline h-4 w-4 align-[-2px] text-[var(--sx-safe)]"
                aria-hidden="true"
              />
              No direct malicious indicators were found in the completed
              signals.
            </div>
          ) : result ? (
            <div className="border-border bg-card rounded-lg border px-4 py-4 text-sm leading-6 text-[var(--sx-text-muted)]">
              <AlertTriangle
                className="mr-2 inline h-4 w-4 align-[-2px]"
                style={{ color }}
                aria-hidden="true"
              />
              {unavailableEvidenceText}
            </div>
          ) : null}

          {(recommendations.length > 0 || limitations.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {recommendations.length > 0 ? (
                <div className="border-border bg-card rounded-lg border px-4 py-4">
                  <h3 className="text-xs text-[var(--sx-text-muted)]">
                    Recommended next steps
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {recommendations.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2 text-sm leading-6 text-[var(--sx-text)]"
                      >
                        <ShieldAlert
                          className="mt-1 h-4 w-4 shrink-0 text-[var(--sx-info)]"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {limitations.length > 0 ? (
                <div className="border-border bg-card rounded-lg border px-4 py-4">
                  <h3 className="text-xs text-[var(--sx-text-muted)]">
                    Signal caveats
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {limitations.slice(0, 4).map((item, index) => (
                      <li
                        key={`${index}-${item}`}
                        className="text-sm leading-6 text-[var(--sx-text-muted)]"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <aside className="space-y-6">
          {result ? (
            <div className="border-border bg-card flex flex-col items-center rounded-lg border px-5 py-5">
              <p className="mb-3 self-start text-xs text-[var(--sx-text-muted)]">
                Threat score
              </p>
              <span className="sr-only">
                Threat score {score} out of 100. {scoreBandLabel}.
              </span>
              <ScoreRing
                score={score}
                color={color}
                bandLabel={scoreBandLabel}
              />
              <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-[var(--sx-border)]">
                <div
                  className="sx-threat-fill h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.min(Math.max(score, 0), 100)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="border-border bg-card rounded-lg border px-5 py-5">
              <p className="text-xs text-[var(--sx-text-muted)]">
                Shared verdict
              </p>
              <p
                className="mt-3 text-3xl font-semibold capitalize"
                style={{ color }}
              >
                {sharedVerdict}
              </p>
              {sharedSnapshot ? (
                <p className="mt-2 text-sm leading-6 text-[var(--sx-text-soft)]">
                  Captured {formatTimestamp(sharedSnapshot.capturedAt)}.
                </p>
              ) : null}
            </div>
          )}

          {result ? (
            <div className="border-border bg-card rounded-lg border px-5 py-5">
              <p className="text-xs text-[var(--sx-text-muted)]">Confidence</p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <p className="text-2xl font-semibold text-[var(--sx-text)]">
                  {confidenceLabel}
                </p>
                <p className="sx-font-hack text-sm text-[var(--sx-text-soft)] tabular-nums">
                  {Math.round(confidenceValue * 100)}%
                </p>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--sx-border)]">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${Math.round(confidenceValue * 100)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              {confidenceReasons.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {confidenceReasons.slice(0, 4).map((reason) => (
                    <li
                      key={reason}
                      className="text-sm leading-6 text-[var(--sx-text-muted)]"
                    >
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <div className="border-border bg-card rounded-lg border px-5 py-5">
              <p className="text-xs text-[var(--sx-text-muted)]">
                Scan metadata
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div>
                  <p className="text-xs text-[var(--sx-text-muted)]">
                    Coverage
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[var(--sx-text)] tabular-nums">
                    {completedSignalCount}/{SIGNAL_COUNT} signals
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--sx-text-muted)]">
                    Duration
                  </p>
                  <p className="sx-font-hack mt-1 text-sm text-[var(--sx-text)] tabular-nums">
                    {resultMetadata?.durationMs ?? 0}ms
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--sx-text-muted)]">
                    Completed
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--sx-text-soft)]">
                    {formatTimestamp(resultMetadata?.completedAt ?? "")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--sx-text-muted)]">
                    Signal balance
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--sx-text-muted)]">
                    {threatInfo?.hasPositiveEvidence
                      ? "Direct risk indicators influenced the final score."
                      : result.verdict === "safe"
                        ? "No direct malicious indicators across completed signals."
                        : unavailableEvidenceText}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-border bg-card rounded-lg border px-5 py-5">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sx-info)]"
                  aria-hidden="true"
                />
                <p className="text-sm leading-6 text-[var(--sx-text-muted)]">
                  Shared links embed a browser-generated snapshot only. They do
                  not rely on a server-side share store.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
