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
 * hedged wording a snapshot without a basis has always had.
 */
export function getVerdictBasis(result: {
  threatInfo?: Pick<
    ThreatInfo,
    "confidenceLabel" | "hasPositiveEvidence"
  > | null;
  metadata?: Pick<ScanMetadata, "partialFailure"> | null;
  signals?: SignalResults | null;
}): VerdictBasis {
  const threatInfo = result.threatInfo;
  return {
    confidence: threatInfo?.confidenceLabel ?? "low",
    clean: Boolean(threatInfo && !threatInfo.hasPositiveEvidence),
    partial: Boolean(result.metadata?.partialFailure),
    confirmed: result.signals
      ? hasConfirmedReputationHit(result.signals)
      : false,
  };
}
