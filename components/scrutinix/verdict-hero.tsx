"use client";

import {
  VerdictHeroIdle,
  VerdictHeroStreaming,
} from "@/components/scrutinix/verdict-hero-live";
import { VerdictHeroResult } from "@/components/scrutinix/verdict-hero-result";
import type { SharedSnapshot } from "@/components/shared/scrutinix-types";
import type { AnalysisResult } from "@/lib/domain/types";

interface VerdictHeroProps {
  result: AnalysisResult | null;
  isStreaming: boolean;
  streamUrl: string;
  sharedSnapshot: SharedSnapshot | null;
  completedSignals?: number;
  onRunSharedScan?: () => void;
}

/** Dispatches between the idle, streaming, and result/snapshot states. */
export function VerdictHero({
  result,
  isStreaming,
  streamUrl,
  sharedSnapshot,
  completedSignals = 0,
  onRunSharedScan,
}: VerdictHeroProps) {
  const announcement = result
    ? `Scan complete. Verdict: ${result.verdict}. Threat score ${result.threatInfo?.score ?? 0} out of 100.`
    : isStreaming
      ? "Scan in progress."
      : "";

  return (
    <>
      {/* Screen readers hear verdicts land; the region re-announces on change. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {!result && !isStreaming && !sharedSnapshot ? (
        <VerdictHeroIdle />
      ) : isStreaming && !result ? (
        <VerdictHeroStreaming
          streamUrl={streamUrl}
          completedSignals={completedSignals}
        />
      ) : (
        <VerdictHeroResult
          result={result}
          streamUrl={streamUrl}
          sharedSnapshot={sharedSnapshot}
          completedSignals={completedSignals}
          onRunSharedScan={onRunSharedScan}
        />
      )}
    </>
  );
}
