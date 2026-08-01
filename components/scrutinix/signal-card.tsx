"use client";

import { clsx } from "clsx";
import {
  ArrowRightLeft,
  Brain,
  Globe,
  Lock,
  Network,
  Rss,
  Search,
  Shield,
  TriangleAlert,
} from "lucide-react";
import { memo, useState, type ComponentType } from "react";

import {
  getSignalSummary,
  getSignalDetailEntries,
} from "@/components/shared/signal-utils";
import {
  getSignalSeverity,
  getLedColorFromSeverity,
  getEdgeClassFromSeverity,
} from "@/components/shared/scrutinix-types";
import { Badge } from "@/components/ui/badge";
import { signalLabels } from "@/lib/domain/types";
import type {
  SignalName,
  SignalResults,
  RedirectData,
} from "@/lib/domain/types";

const signalIconMap = {
  virusTotal: Shield,
  mlEnsemble: Brain,
  googleSafeBrowsing: Search,
  threatFeeds: Rss,
  ssl: Lock,
  whois: Globe,
  dns: Network,
  redirectChain: ArrowRightLeft,
} satisfies Record<SignalName, ComponentType<{ className?: string }>>;

interface SignalCardProps {
  name: SignalName;
  result: SignalResults[SignalName];
  viewMode: "summary" | "full";
  isStreaming?: boolean;
  index?: number;
}

/** The redirect chain keeps its bespoke ordered hop list; everything else
 * renders the shared detail entries so formatting lives in one place. */
function renderRichDetails(name: SignalName, data: unknown): React.ReactNode {
  const hops =
    name === "redirectChain" ? ((data as RedirectData).hops ?? []) : [];
  const entries = getSignalDetailEntries(name, data as never);

  if (hops.length === 0 && entries.length === 0) {
    return null;
  }

  return (
    <>
      {hops.length > 0 ? (
        <ol className="sx-font-hack mt-2 list-inside list-decimal space-y-1.5">
          {hops.map((hop) => (
            <li
              key={`${hop.url}-${hop.status}`}
              className="rounded bg-[var(--sx-bg)] px-3 py-1.5 text-xs text-[var(--sx-text)]"
            >
              <span className="mr-1 text-[var(--sx-info)]">{hop.status}</span>
              <span className="break-all">{hop.url}</span>
              {hop.location && (
                <span className="break-all text-[var(--sx-text-muted)]">
                  {" "}
                  → {hop.location}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {entries.length > 0 ? (
        <div className="sx-font-hack mt-2 space-y-1.5">
          {entries.map((entry, index) => (
            <div
              key={`${entry.label}-${index}`}
              className="flex gap-2 rounded bg-[var(--sx-bg)] px-3 py-1.5 text-xs"
            >
              <span className="shrink-0 text-[var(--sx-text-muted)]">
                {entry.label}:
              </span>
              <span className="break-words text-[var(--sx-text)]">
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

function SignalCardInner({
  name,
  result,
  viewMode,
  isStreaming = false,
  index = 0,
}: SignalCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const severity = getSignalSeverity(result.status, result.data, name);
  const edgeClass = getEdgeClassFromSeverity(severity);
  const ledColor = getLedColorFromSeverity(severity);
  const isPending = result.status === "pending";
  const isError = result.status === "error";
  const isSkipped = result.status === "skipped";
  const isSuccess = result.status === "success";
  const isActivelyScanning = isPending && isStreaming;
  const SignalIcon = signalIconMap[name];
  const statusBadge =
    severity === "malicious"
      ? { label: "high risk", variant: "malicious" as const }
      : severity === "suspicious"
        ? { label: "review", variant: "suspicious" as const }
        : severity === "neutral"
          ? { label: "caveat", variant: "neutral" as const }
          : severity === "error"
            ? { label: "failed", variant: "error" as const }
            : severity === "skipped"
              ? { label: "n/a", variant: "skipped" as const }
              : { label: "clear", variant: "safe" as const };
  const statusCopy = isPending
    ? isStreaming
      ? "Resolving this signal now."
      : "Queued for the next scan."
    : isError
      ? result.error
      : isSkipped
        ? (result.error ?? "This signal does not apply to the current target.")
        : result.data
          ? getSignalSummary(name, result.data)
          : null;

  return (
    <article
      style={{
        transitionDelay: index > 0 ? `${index * 40}ms` : undefined,
      }}
      className={clsx(
        "sx-panel sx-signal-enter border-border h-full rounded-lg border px-5 py-5 transition-[border-color,box-shadow,transform] duration-200",
        edgeClass,
        "hover:border-[color-mix(in_srgb,var(--sx-active-accent)_45%,var(--sx-border))]",
      )}
      aria-label={`${signalLabels[name]} signal: ${result.status}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "sx-status-pip mt-1.5",
            isActivelyScanning && "sx-status-pip-live",
          )}
          style={{ backgroundColor: ledColor, color: ledColor }}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <SignalIcon
                  className="h-4 w-4 shrink-0 text-[var(--sx-text-muted)]"
                  aria-hidden="true"
                />
                <span className="text-xs font-medium text-[var(--sx-text-muted)]">
                  {signalLabels[name]}
                </span>
              </div>
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            </div>

            {result.durationMs > 0 ? (
              <span className="sx-font-hack shrink-0 text-xs text-[var(--sx-text-soft)] tabular-nums">
                {result.durationMs}ms
              </span>
            ) : null}
          </div>

          {isPending && isStreaming ? (
            <p className="sx-pulse mt-4 text-xs text-[var(--sx-suspicious)]">
              Resolving
            </p>
          ) : null}

          {isError ? (
            <div className="mt-4 flex items-start gap-2">
              <TriangleAlert
                className="mt-1 h-4 w-4 shrink-0 text-[var(--sx-error)]"
                aria-hidden="true"
              />
              <p className="text-sm leading-6 text-[var(--sx-error)]">
                {statusCopy}
              </p>
            </div>
          ) : statusCopy ? (
            <p
              className={clsx(
                "mt-5 text-sm leading-6",
                isPending
                  ? "text-[var(--sx-text-soft)]"
                  : "text-[var(--sx-text)]",
                isSuccess && viewMode === "summary" ? "line-clamp-3" : "",
              )}
            >
              {statusCopy}
            </p>
          ) : null}
        </div>
      </div>

      {viewMode === "full" &&
        isSuccess &&
        result.data &&
        (() => {
          const details = renderRichDetails(name, result.data);
          if (!details) return null;

          return (
            <details
              className="border-border mt-5 border-t pt-4"
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-xs text-[var(--sx-info)]">
                Full evidence
              </summary>
              {details}
            </details>
          );
        })()}
    </article>
  );
}

export const SignalCard = memo(SignalCardInner);
