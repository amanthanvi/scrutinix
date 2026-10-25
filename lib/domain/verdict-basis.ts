import { hasConfirmedReputationHit } from "@/lib/domain/reputation";
import type {
  ScanMetadata,
  SignalResults,
  ThreatInfo,
  VerdictBasis,
} from "@/lib/domain/types";

/**
 * The facts a verdict's instruction rests on besides the verdict itself:
 * how confident the engine was, whether it scored anything against the
 * link, whether every check finished, and whether a reputation source
 * confirmed the threat. `getVerdictGuidance` words the instruction from
 * these alone, so a result and a shared snapshot that carries its basis
 * read the same. Pure and isomorphic, like `reputation.ts`.
 *
 * Missing evidence never reassures: no threatInfo reads as "low"
 * confidence and not clean, and no signals as not confirmed, which is the
 * hedged wording a snapshot without a basis has always had. A VirusTotal
 * analysis is aged as of the scan's own check time, so a result reopened
 * days later (or shared) reads as it did when it was checked.
 */
export function getVerdictBasis(result: {
  threatInfo?: Pick<
    ThreatInfo,
    "confidenceLabel" | "hasPositiveEvidence"
  > | null;
  metadata?:
    | (Pick<ScanMetadata, "partialFailure"> &
        Partial<Pick<ScanMetadata, "checkedAt" | "completedAt">>)
    | null;
  signals?: SignalResults | null;
}): VerdictBasis {
  const threatInfo = result.threatInfo;
  return {
    confidence: threatInfo?.confidenceLabel ?? "low",
    clean: Boolean(threatInfo && !threatInfo.hasPositiveEvidence),
    partial: Boolean(result.metadata?.partialFailure),
    confirmed: result.signals
      ? hasConfirmedReputationHit(
          result.signals,
          evidenceTimeOf(result.metadata ?? {}) ?? Date.now(),
        )
      : false,
  };
}

/**
 * When a result's evidence was gathered: `checkedAt` (a cache hit keeps
 * the original scan's), else `completedAt`. A reopened result's ages count
 * from here, never from when it is reopened, so a certificate "issued 2
 * hours ago" stays beside the domain "registered 3 days ago" it was
 * checked with, and a VirusTotal analysis is as current as it was then.
 */
export function evidenceTimeOf(metadata: {
  checkedAt?: string;
  completedAt?: string;
}): number | undefined {
  for (const value of [metadata.checkedAt, metadata.completedAt]) {
    const time = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(time)) return time;
  }
  return undefined;
}
