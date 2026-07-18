import {
  signalNames,
  type AnalysisResult,
  type AnalyzeEvent,
  type ApiError,
  type BatchEvent,
  type ClassificationFinding,
  type HistoryEntry,
  type ScanMetadata,
  type SignalName,
  type SignalPayloadMap,
  type SignalResult,
  type SignalResults,
  type SignalStatus,
  type ThreatInfo,
  type Verdict,
} from "@/lib/domain/types";
import { z } from "zod";

const validVerdicts = new Set<Verdict>([
  "safe",
  "suspicious",
  "malicious",
  "critical",
  "error",
]);

const validSignalStatuses = new Set<SignalStatus>([
  "pending",
  "success",
  "error",
  "skipped",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readVerdict(value: unknown, fallback: Verdict = "error"): Verdict {
  return typeof value === "string" && validVerdicts.has(value as Verdict)
    ? (value as Verdict)
    : fallback;
}

function readSignalStatus(value: unknown): SignalStatus {
  return typeof value === "string" &&
    validSignalStatuses.has(value as SignalStatus)
    ? (value as SignalStatus)
    : "pending";
}

function readClassificationFinding(
  value: unknown,
): ClassificationFinding | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const rawLabel = readString(record.label, "benign");
  const label: ClassificationFinding["label"] =
    rawLabel === "malicious" || rawLabel === "risky" || rawLabel === "benign"
      ? rawLabel
      : "benign";

  return {
    label,
    score: Math.min(Math.max(readNumber(record.score, 0), 0), 1),
    reasons: readStringArray(record.reasons),
    model: readString(record.model, "unknown"),
  };
}

function sanitizeVirusTotalData(
  value: Record<string, unknown>,
): SignalPayloadMap["virusTotal"] {
  const results = Array.isArray(value.results)
    ? value.results.flatMap((item) => {
        const record = asRecord(item);
        if (!record) {
          return [];
        }

        return [
          {
            engine: readString(record.engine, "Unknown engine"),
            category: readString(record.category, "unknown"),
            result: readNullableString(record.result),
          },
        ];
      })
    : [];

  return {
    malicious: readNumber(value.malicious, 0),
    suspicious: readNumber(value.suspicious, 0),
    harmless: readNumber(value.harmless, 0),
    undetected: readNumber(value.undetected, 0),
    timeout: readNumber(value.timeout, 0),
    results,
    permalink: readString(value.permalink, ""),
  };
}

function sanitizeMlSignalData(
  value: Record<string, unknown>,
): SignalPayloadMap["mlEnsemble"] {
  const lexicalModel = readClassificationFinding(value.lexicalModel) ?? {
    label: "benign",
    score: 0,
    reasons: [],
    model: "lexical-heuristic",
  };
  const hostedModel = readClassificationFinding(value.hostedModel);
  const rawConsensusLabel = readString(
    value.consensusLabel,
    lexicalModel.label,
  );
  const consensusLabel: ClassificationFinding["label"] =
    rawConsensusLabel === "malicious" ||
    rawConsensusLabel === "risky" ||
    rawConsensusLabel === "benign"
      ? rawConsensusLabel
      : lexicalModel.label;

  return {
    hostedModel,
    lexicalModel,
    consensusLabel,
    consensusScore: Math.min(
      Math.max(readNumber(value.consensusScore, 0), 0),
      1,
    ),
    reasons: readStringArray(value.reasons),
    warnings: readStringArray(value.warnings),
  };
}

function sanitizeGoogleSafeBrowsingData(
  value: Record<string, unknown>,
): SignalPayloadMap["googleSafeBrowsing"] {
  const matches = Array.isArray(value.matches)
    ? value.matches.flatMap((item) => {
        const record = asRecord(item);
        if (!record) {
          return [];
        }

        return [
          {
            threatType: readString(record.threatType, "UNKNOWN"),
            platformType: readString(record.platformType, "ANY_PLATFORM"),
            threatEntryType: readString(record.threatEntryType, "URL"),
          },
        ];
      })
    : [];

  return {
    checkedAt: readString(value.checkedAt, ""),
    matches,
  };
}

function sanitizeThreatFeedsData(
  value: Record<string, unknown>,
): SignalPayloadMap["threatFeeds"] {
  const matches = Array.isArray(value.matches)
    ? value.matches.flatMap((item) => {
        const record = asRecord(item);
        if (!record) {
          return [];
        }

        const rawFeed = readString(record.feed, "");
        if (rawFeed !== "urlhaus" && rawFeed !== "openphish") {
          return [];
        }

        const rawConfidence = readString(record.confidence, "medium");
        const feed: "urlhaus" | "openphish" =
          rawFeed === "urlhaus" ? "urlhaus" : "openphish";
        const confidence: "high" | "medium" =
          rawConfidence === "high" || rawConfidence === "medium"
            ? rawConfidence
            : "medium";

        return [
          {
            feed,
            matchedUrl: readString(record.matchedUrl, ""),
            detail: readString(record.detail, "listed"),
            confidence,
          },
        ];
      })
    : [];

  return {
    checkedAt: readString(value.checkedAt, ""),
    matches,
    observations: readStringArray(value.observations),
    warnings: readStringArray(value.warnings),
  };
}

function sanitizeSslData(
  value: Record<string, unknown>,
): SignalPayloadMap["ssl"] {
  const rawValidationState = readString(value.validationState, "unavailable");
  const validationState: SignalPayloadMap["ssl"]["validationState"] =
    rawValidationState === "trusted" ||
    rawValidationState === "warning" ||
    rawValidationState === "untrusted" ||
    rawValidationState === "invalid" ||
    rawValidationState === "unavailable"
      ? rawValidationState
      : "unavailable";

  return {
    protocol: readNullableString(value.protocol),
    available: readBoolean(value.available, false),
    validationState,
    authorized: readBoolean(value.authorized, false),
    authorizationError: readNullableString(value.authorizationError),
    issuer: readNullableString(value.issuer),
    subject: readNullableString(value.subject),
    validFrom: readNullableString(value.validFrom),
    validTo: readNullableString(value.validTo),
    daysRemaining: readNullableNumber(value.daysRemaining),
    selfSigned: readBoolean(value.selfSigned, false),
    fingerprint256: readNullableString(value.fingerprint256),
    observations: readStringArray(value.observations),
  };
}

function sanitizeWhoisData(
  value: Record<string, unknown>,
): SignalPayloadMap["whois"] {
  const rawSubjectType = readString(value.subjectType, "domain");
  const subjectType: SignalPayloadMap["whois"]["subjectType"] =
    rawSubjectType === "network" || rawSubjectType === "domain"
      ? rawSubjectType
      : "domain";

  return {
    subjectType,
    available: readBoolean(value.available, false),
    registrar: readNullableString(value.registrar),
    registeredAt: readNullableString(value.registeredAt),
    updatedAt: readNullableString(value.updatedAt),
    expiresAt: readNullableString(value.expiresAt),
    ageDays: readNullableNumber(value.ageDays),
    country: readNullableString(value.country),
    handle: readNullableString(value.handle),
    rdapUrl: readString(value.rdapUrl, ""),
    observations: readStringArray(value.observations),
  };
}

function sanitizeDnsData(
  value: Record<string, unknown>,
): SignalPayloadMap["dns"] {
  const rawSubjectType = readString(value.subjectType, "hostname");
  const subjectType: SignalPayloadMap["dns"]["subjectType"] =
    rawSubjectType === "ip" || rawSubjectType === "hostname"
      ? rawSubjectType
      : "hostname";

  return {
    subjectType,
    addresses: readStringArray(value.addresses),
    cnames: readStringArray(value.cnames),
    mx: readStringArray(value.mx),
    txt: readStringArray(value.txt),
    nameservers: readStringArray(value.nameservers),
    reverseHostnames: readStringArray(value.reverseHostnames),
    anomalies: readStringArray(value.anomalies),
    observations: readStringArray(value.observations),
  };
}

function sanitizeRedirectData(
  value: Record<string, unknown>,
): SignalPayloadMap["redirectChain"] {
  const hops = Array.isArray(value.hops)
    ? value.hops.flatMap((item) => {
        const record = asRecord(item);
        if (!record) {
          return [];
        }

        return [
          {
            url: readString(record.url, ""),
            status: readNumber(record.status, 0),
            location: readNullableString(record.location) ?? undefined,
          },
        ];
      })
    : [];

  return {
    finalUrl: readString(value.finalUrl, ""),
    totalHops: Math.max(0, readNumber(value.totalHops, 0)),
    httpsUpgraded: readBoolean(value.httpsUpgraded, false),
    reachable: readBoolean(value.reachable, false),
    terminalStatus: readNullableNumber(value.terminalStatus),
    terminalError: readNullableString(value.terminalError),
    hops,
    observations: readStringArray(value.observations),
  };
}

const signalPayloadSanitizers = {
  virusTotal: sanitizeVirusTotalData,
  mlEnsemble: sanitizeMlSignalData,
  googleSafeBrowsing: sanitizeGoogleSafeBrowsingData,
  threatFeeds: sanitizeThreatFeedsData,
  ssl: sanitizeSslData,
  whois: sanitizeWhoisData,
  dns: sanitizeDnsData,
  redirectChain: sanitizeRedirectData,
} satisfies {
  [K in SignalName]: (value: Record<string, unknown>) => SignalPayloadMap[K];
};

function sanitizeSignalPayload<K extends SignalName>(
  name: K,
  value: Record<string, unknown>,
): SignalPayloadMap[K] {
  return signalPayloadSanitizers[name](value) as SignalPayloadMap[K];
}

function createSignalErrorResult<K>(
  durationMs: number,
  message: string,
): SignalResult<K> {
  return {
    status: "error",
    data: null,
    error: message,
    durationMs,
  };
}

function sanitizeSignalResult<K extends SignalName>(
  name: K,
  value: unknown,
): SignalResult<SignalPayloadMap[K]> {
  const record = asRecord(value);
  if (!record) {
    return createSignalErrorResult(
      0,
      "Signal data was missing from the stored result.",
    );
  }

  const status = readSignalStatus(record.status);
  const durationMs = Math.max(0, readNumber(record.durationMs, 0));
  const error = readNullableString(record.error);

  if (status !== "success") {
    return {
      status,
      data: null,
      error,
      durationMs,
    };
  }

  const data = asRecord(record.data);
  if (!data) {
    return createSignalErrorResult(
      durationMs,
      error ?? "Signal data was missing from the stored result.",
    );
  }

  return {
    status: "success",
    data: sanitizeSignalPayload(name, data),
    error,
    durationMs,
  };
}

function sanitizeSignalResults(value: unknown): SignalResults {
  const record = asRecord(value);

  return {
    virusTotal: sanitizeSignalResult("virusTotal", record?.virusTotal),
    mlEnsemble: sanitizeSignalResult("mlEnsemble", record?.mlEnsemble),
    googleSafeBrowsing: sanitizeSignalResult(
      "googleSafeBrowsing",
      record?.googleSafeBrowsing,
    ),
    threatFeeds: sanitizeSignalResult("threatFeeds", record?.threatFeeds),
    ssl: sanitizeSignalResult("ssl", record?.ssl),
    whois: sanitizeSignalResult("whois", record?.whois),
    dns: sanitizeSignalResult("dns", record?.dns),
    redirectChain: sanitizeSignalResult("redirectChain", record?.redirectChain),
  };
}

function sanitizeThreatInfo(value: unknown): ThreatInfo | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const rawConfidenceLabel = readString(record.confidenceLabel, "low");

  return {
    verdict: readVerdict(record.verdict, "error"),
    confidence: Math.min(Math.max(readNumber(record.confidence, 0), 0), 1),
    confidenceLabel:
      rawConfidenceLabel === "high" ||
      rawConfidenceLabel === "moderate" ||
      rawConfidenceLabel === "low"
        ? rawConfidenceLabel
        : "low",
    confidenceReasons: readStringArray(record.confidenceReasons),
    hasPositiveEvidence: readBoolean(record.hasPositiveEvidence, false),
    score: Math.min(Math.max(readNumber(record.score, 0), 0), 100),
    summary: readString(record.summary, ""),
    categories: readStringArray(record.categories),
    reasons: readStringArray(record.reasons),
    recommendations: readStringArray(record.recommendations),
    limitations: readStringArray(record.limitations),
  };
}

function sanitizeMetadata(
  value: unknown,
  fallbackTimestamp: string,
): ScanMetadata {
  const record = asRecord(value);
  const completedAt = readString(record?.completedAt, fallbackTimestamp);
  const startedAt = readString(record?.startedAt, completedAt);

  return {
    scanId: readString(record?.scanId, ""),
    startedAt,
    completedAt,
    cacheHit: readBoolean(record?.cacheHit, false),
    partialFailure: readBoolean(record?.partialFailure, false),
    signalCount: Math.max(
      0,
      readNumber(record?.signalCount, signalNames.length),
    ),
    durationMs: Math.max(0, readNumber(record?.durationMs, 0)),
  };
}

const boundaryRecordSchema = z.record(z.string(), z.unknown());
const signalNameSchema = z.enum(signalNames);

function addBoundaryIssue(
  ctx: z.RefinementCtx,
  message: string,
): typeof z.NEVER {
  ctx.addIssue({
    code: "custom",
    message,
  });

  return z.NEVER;
}

function createAnalysisResultSchema(fallbackTimestamp: string) {
  return boundaryRecordSchema.transform((record): AnalysisResult => {
    const threatInfo = sanitizeThreatInfo(record.threatInfo);
    const metadata = sanitizeMetadata(record.metadata, fallbackTimestamp);

    return {
      id:
        readString(record.id) ||
        `restored-${metadata.completedAt}-${Math.random().toString(16).slice(2, 8)}`,
      url: readString(record.url, ""),
      verdict: readVerdict(record.verdict, threatInfo?.verdict ?? "error"),
      signals: sanitizeSignalResults(record.signals),
      threatInfo,
      metadata,
    };
  });
}

function createApiErrorSchema(fallbackMessage: string) {
  return z.unknown().transform((value) => {
    const record = asRecord(value);

    return {
      code: readString(record?.code, "unexpected_error"),
      message: readString(record?.message, fallbackMessage),
      retryable: readBoolean(record?.retryable, false),
    } satisfies ApiError;
  });
}

const analyzeEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("scan_started"),
      scanId: z.string().min(1),
      url: z.string().min(1),
      cached: z.unknown().optional(),
      startedAt: z.string().min(1),
    })
    .passthrough()
    .transform(
      (record): AnalyzeEvent => ({
        type: "scan_started",
        scanId: record.scanId,
        url: record.url,
        cached: readBoolean(record.cached, false),
        startedAt: record.startedAt,
      }),
    ),
  z
    .object({
      type: z.literal("signal_result"),
      name: signalNameSchema,
      result: z.unknown().optional(),
    })
    .passthrough()
    .transform(
      (record): AnalyzeEvent => ({
        type: "signal_result",
        name: record.name,
        result: sanitizeSignalResult(record.name, record.result),
      }),
    ),
  z
    .object({
      type: z.literal("scan_complete"),
      result: z.unknown(),
    })
    .passthrough()
    .transform((record, ctx): AnalyzeEvent => {
      const result = sanitizeAnalysisResult(record.result);
      if (!result) {
        return addBoundaryIssue(ctx, "Scan completion result is invalid.");
      }

      return {
        type: "scan_complete",
        result,
      };
    }),
  z
    .object({
      type: z.literal("scan_error"),
      error: z.unknown().optional(),
    })
    .passthrough()
    .transform(
      (record): AnalyzeEvent => ({
        type: "scan_error",
        error: sanitizeApiError(record.error, "The scan failed."),
      }),
    ),
]);

const batchEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("batch_started"),
      total: z.unknown().optional(),
      startedAt: z.string().min(1),
    })
    .passthrough()
    .transform(
      (record): BatchEvent => ({
        type: "batch_started",
        total: Math.max(0, readNumber(record.total, 0)),
        startedAt: record.startedAt,
      }),
    ),
  z
    .object({
      type: z.literal("url_started"),
      index: z.unknown().optional(),
      url: z.string().min(1),
    })
    .passthrough()
    .transform(
      (record): BatchEvent => ({
        type: "url_started",
        index: Math.max(0, readNumber(record.index, 0)),
        url: record.url,
      }),
    ),
  z
    .object({
      type: z.literal("url_complete"),
      index: z.unknown().optional(),
      url: z.unknown().optional(),
      result: z.unknown(),
    })
    .passthrough()
    .transform((record, ctx): BatchEvent => {
      const result = sanitizeAnalysisResult(record.result);
      if (!result) {
        return addBoundaryIssue(ctx, "Batch URL result is invalid.");
      }

      return {
        type: "url_complete",
        index: Math.max(0, readNumber(record.index, 0)),
        url: readString(record.url, result.url),
        result,
      };
    }),
  z
    .object({
      type: z.literal("batch_complete"),
      results: z.unknown().optional(),
    })
    .passthrough()
    .transform(
      (record): BatchEvent => ({
        type: "batch_complete",
        results: Array.isArray(record.results)
          ? record.results.flatMap((item) => {
              const result = sanitizeAnalysisResult(item);
              return result ? [result] : [];
            })
          : [],
      }),
    ),
  z
    .object({
      type: z.literal("batch_error"),
      error: z.unknown().optional(),
    })
    .passthrough()
    .transform(
      (record): BatchEvent => ({
        type: "batch_error",
        error: sanitizeApiError(record.error, "The batch scan failed."),
      }),
    ),
]);

export function sanitizeAnalysisResult(
  value: unknown,
  fallbackTimestamp = new Date().toISOString(),
): AnalysisResult | null {
  const result = createAnalysisResultSchema(fallbackTimestamp).safeParse(value);
  return result.success ? result.data : null;
}

export function sanitizeHistoryEntry(value: unknown): HistoryEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const savedAt = readString(record.savedAt, "");
  const fallbackTimestamp = savedAt || new Date().toISOString();
  const result = sanitizeAnalysisResult(record, fallbackTimestamp);
  if (!result) {
    return null;
  }

  return {
    ...result,
    savedAt: savedAt || result.metadata.completedAt || fallbackTimestamp,
  };
}

export function sanitizeApiError(
  value: unknown,
  fallbackMessage: string,
): ApiError {
  const result = createApiErrorSchema(fallbackMessage).safeParse(value);
  return result.success
    ? result.data
    : {
        code: "unexpected_error",
        message: fallbackMessage,
        retryable: false,
      };
}

export function sanitizeApiErrorResponse(
  value: unknown,
  fallbackMessage: string,
): ApiError {
  const record = asRecord(value);
  return sanitizeApiError(record?.error ?? value, fallbackMessage);
}

export function sanitizeAnalyzeEvent(value: unknown): AnalyzeEvent | null {
  const result = analyzeEventSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function sanitizeBatchEvent(value: unknown): BatchEvent | null {
  const result = batchEventSchema.safeParse(value);
  return result.success ? result.data : null;
}
