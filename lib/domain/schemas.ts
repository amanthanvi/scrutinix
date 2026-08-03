import { z } from "zod";

/**
 * Single source of truth for every data shape that crosses a trust boundary:
 * the NDJSON stream, the shared result cache, IndexedDB history, and shared
 * snapshots. Types are inferred from these schemas (see lib/domain/types.ts),
 * so a field exists exactly once.
 *
 * Tolerance contract: leaves recover with `.catch(default)` so a single
 * malformed field never rejects a stored result, while envelope gates
 * (event discriminators, required ids/urls) reject outright. Fields added
 * later MUST be `.optional().catch(undefined)` so older cached results,
 * stream events, and history entries keep parsing — that is the whole
 * versioning strategy.
 */

export const signalNames = [
  "virusTotal",
  "mlEnsemble",
  "googleSafeBrowsing",
  "threatFeeds",
  "ssl",
  "whois",
  "dns",
  "redirectChain",
] as const;

export type SignalName = (typeof signalNames)[number];

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const clampScore = (value: number) => Math.min(Math.max(value, 0), 100);
const nonNegative = (value: number) => Math.max(0, value);

const tolerantString = (fallback = "") => z.string().catch(fallback);
const nullableString = z.string().nullable().catch(null);
const tolerantBoolean = (fallback = false) => z.boolean().catch(fallback);
const finiteNumber = (fallback = 0) => z.number().finite().catch(fallback);
const nullableNumber = z.number().finite().nullable().catch(null);

const stringArray = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items.filter((item): item is string => typeof item === "string"),
  );

/** Array that drops invalid items instead of rejecting the whole array. */
function lenientArray<Schema extends z.ZodType>(item: Schema) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((candidate) => {
        const parsed = item.safeParse(candidate);
        return parsed.success ? [parsed.data as z.infer<Schema>] : [];
      }),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const verdictSchema = z.enum([
  "safe",
  "suspicious",
  "malicious",
  "critical",
  // A dead/unreachable host: the absence of findings is not evidence of safety.
  "unknown",
  "error",
]);

export type Verdict = z.infer<typeof verdictSchema>;

const signalStatusSchema = z
  .enum(["pending", "success", "error", "skipped"])
  .catch("pending");

export type SignalStatus = z.infer<typeof signalStatusSchema>;

export const classificationFindingSchema = z.object({
  label: z.enum(["benign", "risky", "malicious"]).catch("benign"),
  score: finiteNumber(0).transform(clamp01),
  reasons: stringArray,
  model: tolerantString("unknown"),
});

export type ClassificationFinding = z.infer<typeof classificationFindingSchema>;

export const virusTotalDataSchema = z.object({
  malicious: finiteNumber(0),
  suspicious: finiteNumber(0),
  harmless: finiteNumber(0),
  undetected: finiteNumber(0),
  timeout: finiteNumber(0),
  results: lenientArray(
    z.object({
      engine: tolerantString("Unknown engine"),
      category: tolerantString("unknown"),
      result: nullableString,
    }),
  ),
  permalink: tolerantString(""),
  /** ISO timestamp of the VT analysis this verdict is based on. */
  lastAnalysisDate: z.string().nullable().optional().catch(undefined),
  /** Registrable-domain reputation from VT's /domains endpoint. */
  domain: z
    .object({
      malicious: finiteNumber(0),
      suspicious: finiteNumber(0),
      harmless: finiteNumber(0),
      reputation: finiteNumber(0),
      categories: stringArray,
    })
    .nullable()
    .optional()
    .catch(undefined),
});

export type VirusTotalData = z.infer<typeof virusTotalDataSchema>;

const defaultLexicalFinding: ClassificationFinding = {
  label: "benign",
  score: 0,
  reasons: [],
  model: "lexical-heuristic",
};

export const mlSignalDataSchema = z.preprocess(
  // Legacy alias: results stored before the local-model migration used
  // `hostedModel`; keep old history entries and cached results loading.
  (value) => {
    if (isRecord(value) && value.transformerModel === undefined) {
      const { hostedModel, ...rest } = value;
      if (hostedModel !== undefined) {
        return { ...rest, transformerModel: hostedModel };
      }
    }
    return value;
  },
  z
    .object({
      transformerModel: classificationFindingSchema.nullable().catch(null),
      lexicalModel: classificationFindingSchema.catch(defaultLexicalFinding),
      consensusLabel: z
        .enum(["benign", "risky", "malicious"])
        .nullable()
        .catch(null),
      consensusScore: finiteNumber(0).transform(clamp01),
      reasons: stringArray,
      warnings: stringArray,
    })
    .transform((value) => ({
      ...value,
      consensusLabel: value.consensusLabel ?? value.lexicalModel.label,
    })),
);

export type MLSignalData = z.infer<typeof mlSignalDataSchema>;

export const googleSafeBrowsingDataSchema = z.object({
  checkedAt: tolerantString(""),
  matches: lenientArray(
    z.object({
      threatType: tolerantString("UNKNOWN"),
      platformType: tolerantString("ANY_PLATFORM"),
      threatEntryType: tolerantString("URL"),
    }),
  ),
});

export type GoogleSafeBrowsingData = z.infer<
  typeof googleSafeBrowsingDataSchema
>;

export const threatFeedsDataSchema = z.object({
  checkedAt: tolerantString(""),
  // Items with an unknown feed are dropped rather than coerced.
  matches: lenientArray(
    z.object({
      feed: z.enum([
        "urlhaus",
        "openphish",
        "threatfox",
        "spamhaus-dbl",
        "surbl",
      ]),
      matchedUrl: tolerantString(""),
      detail: tolerantString("listed"),
      confidence: z.enum(["medium", "high"]).catch("medium"),
      /** "url" = exact listing, "host" = hostname-level listing. */
      matchType: z.enum(["url", "host"]).optional().catch(undefined),
    }),
  ),
  /** Informational notes (e.g. URLhaus responded but this exact URL is not listed). */
  observations: stringArray,
  warnings: stringArray,
});

export type ThreatFeedsData = z.infer<typeof threatFeedsDataSchema>;

export const sslDataSchema = z.object({
  protocol: nullableString,
  available: tolerantBoolean(false),
  validationState: z
    .enum(["trusted", "warning", "untrusted", "invalid", "unavailable"])
    .catch("unavailable"),
  authorized: tolerantBoolean(false),
  authorizationError: nullableString,
  issuer: nullableString,
  subject: nullableString,
  validFrom: nullableString,
  validTo: nullableString,
  daysRemaining: nullableNumber,
  selfSigned: tolerantBoolean(false),
  fingerprint256: nullableString,
  observations: stringArray,
});

export type SSLData = z.infer<typeof sslDataSchema>;

export const whoisDataSchema = z.object({
  subjectType: z.enum(["domain", "network"]).catch("domain"),
  available: tolerantBoolean(false),
  registrar: nullableString,
  registeredAt: nullableString,
  updatedAt: nullableString,
  expiresAt: nullableString,
  ageDays: nullableNumber,
  country: nullableString,
  handle: nullableString,
  rdapUrl: tolerantString(""),
  observations: stringArray,
});

export type WhoisData = z.infer<typeof whoisDataSchema>;

export const dnsDataSchema = z.object({
  subjectType: z.enum(["hostname", "ip"]).catch("hostname"),
  addresses: stringArray,
  cnames: stringArray,
  mx: stringArray,
  txt: stringArray,
  nameservers: stringArray,
  reverseHostnames: stringArray,
  anomalies: stringArray,
  observations: stringArray,
});

export type DNSData = z.infer<typeof dnsDataSchema>;

export const pageContentFindingsSchema = z.object({
  title: nullableString,
  crossOriginFormHosts: stringArray,
  /** Hosts of cross-origin forms that themselves contain a password input. */
  crossOriginPasswordFormHosts: stringArray.optional().catch(undefined),
  passwordInputCount: finiteNumber(0).transform(nonNegative),
  iframeCount: finiteNumber(0).transform(nonNegative),
  hiddenIframeCount: finiteNumber(0).transform(nonNegative),
  obfuscationHints: stringArray,
  metaRefreshTarget: nullableString,
});

export type PageContentFindings = z.infer<typeof pageContentFindingsSchema>;

export const redirectDataSchema = z.object({
  finalUrl: tolerantString(""),
  totalHops: finiteNumber(0).transform(nonNegative),
  httpsUpgraded: tolerantBoolean(false),
  reachable: tolerantBoolean(false),
  terminalStatus: nullableNumber,
  terminalError: nullableString,
  hops: lenientArray(
    z.object({
      url: tolerantString(""),
      status: finiteNumber(0),
      location: z.string().optional().catch(undefined),
    }),
  ),
  observations: stringArray,
  /** Lightweight analysis of the terminal page's HTML, when captured. */
  content: pageContentFindingsSchema.nullable().optional().catch(undefined),
});

export type RedirectData = z.infer<typeof redirectDataSchema>;

export const signalPayloadSchemas = {
  virusTotal: virusTotalDataSchema,
  mlEnsemble: mlSignalDataSchema,
  googleSafeBrowsing: googleSafeBrowsingDataSchema,
  threatFeeds: threatFeedsDataSchema,
  ssl: sslDataSchema,
  whois: whoisDataSchema,
  dns: dnsDataSchema,
  redirectChain: redirectDataSchema,
} as const;

export type SignalPayloadMap = {
  [K in SignalName]: z.infer<(typeof signalPayloadSchemas)[K]>;
};

export interface SignalResult<T> {
  status: SignalStatus;
  data: T | null;
  error: string | null;
  durationMs: number;
}

export type SignalResults = {
  [K in SignalName]: SignalResult<SignalPayloadMap[K]>;
};

const MISSING_SIGNAL_DATA = "Signal data was missing from the stored result.";

function parseSignalResult<K extends SignalName>(
  name: K,
  value: unknown,
): SignalResult<SignalPayloadMap[K]> {
  if (!isRecord(value)) {
    return {
      status: "error",
      data: null,
      error: MISSING_SIGNAL_DATA,
      durationMs: 0,
    };
  }

  const status = signalStatusSchema.parse(value.status);
  const durationMs = nonNegative(finiteNumber(0).parse(value.durationMs));
  const error = nullableString.parse(value.error);

  if (status !== "success") {
    return { status, data: null, error, durationMs };
  }

  const data = signalPayloadSchemas[name].safeParse(value.data);
  if (!data.success) {
    return {
      status: "error",
      data: null,
      error: error ?? MISSING_SIGNAL_DATA,
      durationMs,
    };
  }

  return {
    status: "success",
    data: data.data as SignalPayloadMap[K],
    error,
    durationMs,
  };
}

export const signalResultsSchema = z
  .unknown()
  .transform((value): SignalResults => {
    const record = isRecord(value) ? value : {};
    const results = {} as Record<SignalName, SignalResult<unknown>>;
    for (const name of signalNames) {
      results[name] = parseSignalResult(name, record[name]);
    }
    return results as SignalResults;
  });

export const threatInfoSchema = z.object({
  verdict: verdictSchema.catch("error"),
  confidence: finiteNumber(0).transform(clamp01),
  confidenceLabel: z.enum(["low", "moderate", "high"]).catch("low"),
  confidenceReasons: stringArray,
  hasPositiveEvidence: tolerantBoolean(false),
  score: finiteNumber(0).transform(clampScore),
  summary: tolerantString(""),
  categories: stringArray,
  reasons: stringArray,
  recommendations: stringArray,
  limitations: stringArray,
});

export type ThreatInfo = z.infer<typeof threatInfoSchema>;

export interface ScanMetadata {
  scanId: string;
  startedAt: string;
  completedAt: string;
  cacheHit: boolean;
  partialFailure: boolean;
  signalCount: number;
  durationMs: number;
}

function parseScanMetadata(
  value: unknown,
  fallbackTimestamp: string,
): ScanMetadata {
  const record = isRecord(value) ? value : {};
  const completedAt = tolerantString(fallbackTimestamp).parse(
    record.completedAt,
  );
  const startedAt = tolerantString(completedAt).parse(record.startedAt);

  return {
    scanId: tolerantString("").parse(record.scanId),
    startedAt,
    completedAt,
    cacheHit: tolerantBoolean(false).parse(record.cacheHit),
    partialFailure: tolerantBoolean(false).parse(record.partialFailure),
    signalCount: nonNegative(
      finiteNumber(signalNames.length).parse(record.signalCount),
    ),
    durationMs: nonNegative(finiteNumber(0).parse(record.durationMs)),
  };
}

export interface AnalysisResult {
  id: string;
  url: string;
  verdict: Verdict;
  signals: SignalResults;
  threatInfo: ThreatInfo | null;
  metadata: ScanMetadata;
}

export type HistoryEntry = AnalysisResult & { savedAt: string };

export function createAnalysisResultSchema(fallbackTimestamp: string) {
  return z
    .object({
      id: z.unknown().optional(),
      url: z.string().trim().min(1),
      verdict: z.unknown().optional(),
      signals: z.record(z.string(), z.unknown()),
      threatInfo: z.unknown().optional(),
      metadata: z.record(z.string(), z.unknown()),
    })
    .passthrough()
    .superRefine((record, ctx) => {
      const id = tolerantString("").parse(record.id).trim();
      const scanId = tolerantString("").parse(record.metadata.scanId).trim();
      if (!id && !scanId) {
        ctx.addIssue({
          code: "custom",
          message: "Analysis result requires a scan identifier.",
        });
      }
    })
    .transform((record): AnalysisResult => {
      const threatInfoParsed = threatInfoSchema.safeParse(record.threatInfo);
      const threatInfo = threatInfoParsed.success
        ? threatInfoParsed.data
        : null;
      const metadata = parseScanMetadata(record.metadata, fallbackTimestamp);
      const id = tolerantString("").parse(record.id).trim() || metadata.scanId;

      return {
        id,
        url: record.url,
        verdict: verdictSchema
          .catch(threatInfo?.verdict ?? "error")
          .parse(record.verdict),
        signals: signalResultsSchema.parse(record.signals),
        threatInfo,
        metadata,
      };
    });
}

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
}

export function createApiErrorSchema(fallbackMessage: string) {
  return z.unknown().transform((value): ApiError => {
    const record = isRecord(value) ? value : {};

    return {
      code: tolerantString("unexpected_error").parse(record.code),
      message: tolerantString(fallbackMessage).parse(record.message),
      retryable: tolerantBoolean(false).parse(record.retryable),
    };
  });
}

export type AnalyzeEvent =
  | {
      type: "scan_started";
      scanId: string;
      url: string;
      cached: boolean;
      startedAt: string;
    }
  | {
      type: "signal_result";
      name: SignalName;
      result: SignalResult<unknown>;
    }
  | {
      type: "scan_complete";
      result: AnalysisResult;
    }
  | {
      type: "scan_error";
      error: ApiError;
    };

export type BatchEvent =
  | {
      type: "batch_started";
      total: number;
      startedAt: string;
    }
  | {
      type: "url_started";
      index: number;
      url: string;
    }
  | {
      type: "url_complete";
      index: number;
      url: string;
      result: AnalysisResult;
    }
  | {
      type: "batch_complete";
      results: AnalysisResult[];
    }
  | {
      type: "batch_error";
      error: ApiError;
    };

function parseAnalysisResult(value: unknown): AnalysisResult | null {
  const parsed = createAnalysisResultSchema(new Date().toISOString()).safeParse(
    value,
  );
  return parsed.success ? parsed.data : null;
}

function invalid(ctx: z.RefinementCtx, message: string): typeof z.NEVER {
  ctx.addIssue({ code: "custom", message });
  return z.NEVER;
}

export const analyzeEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("scan_started"),
      scanId: z.string().min(1),
      url: z.string().min(1),
      cached: z.unknown().optional(),
      startedAt: z.string().min(1),
    })
    .transform(
      (record): AnalyzeEvent => ({
        type: "scan_started",
        scanId: record.scanId,
        url: record.url,
        cached: tolerantBoolean(false).parse(record.cached),
        startedAt: record.startedAt,
      }),
    ),
  z
    .object({
      type: z.literal("signal_result"),
      name: z.enum(signalNames),
      result: z.unknown().optional(),
    })
    .transform(
      (record): AnalyzeEvent => ({
        type: "signal_result",
        name: record.name,
        result: parseSignalResult(record.name, record.result),
      }),
    ),
  z
    .object({
      type: z.literal("scan_complete"),
      result: z.unknown(),
    })
    .transform((record, ctx): AnalyzeEvent => {
      const result = parseAnalysisResult(record.result);
      if (!result) {
        return invalid(ctx, "Scan completion result is invalid.");
      }

      return { type: "scan_complete", result };
    }),
  z
    .object({
      type: z.literal("scan_error"),
      error: z.unknown().optional(),
    })
    .transform(
      (record): AnalyzeEvent => ({
        type: "scan_error",
        error: createApiErrorSchema("The scan failed.").parse(record.error),
      }),
    ),
]);

export const batchEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("batch_started"),
      total: z.unknown().optional(),
      startedAt: z.string().min(1),
    })
    .transform(
      (record): BatchEvent => ({
        type: "batch_started",
        total: nonNegative(finiteNumber(0).parse(record.total)),
        startedAt: record.startedAt,
      }),
    ),
  z
    .object({
      type: z.literal("url_started"),
      index: z.unknown().optional(),
      url: z.string().min(1),
    })
    .transform(
      (record): BatchEvent => ({
        type: "url_started",
        index: nonNegative(finiteNumber(0).parse(record.index)),
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
    .transform((record, ctx): BatchEvent => {
      const result = parseAnalysisResult(record.result);
      if (!result) {
        return invalid(ctx, "Batch URL result is invalid.");
      }

      return {
        type: "url_complete",
        index: nonNegative(finiteNumber(0).parse(record.index)),
        url: tolerantString(result.url).parse(record.url),
        result,
      };
    }),
  z
    .object({
      type: z.literal("batch_complete"),
      results: z.unknown().optional(),
    })
    .transform(
      (record): BatchEvent => ({
        type: "batch_complete",
        results: Array.isArray(record.results)
          ? record.results.flatMap((item) => {
              const result = parseAnalysisResult(item);
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
    .transform(
      (record): BatchEvent => ({
        type: "batch_error",
        error: createApiErrorSchema("The batch scan failed.").parse(
          record.error,
        ),
      }),
    ),
]);

/**
 * Shared snapshots ride in a URL query parameter, so unlike stored results
 * this gate is strict: wrong types or oversized fields reject outright.
 */
export const sharedSnapshotSchema = z.object({
  verdict: verdictSchema,
  url: z.string().max(2048),
  summary: z.string().max(600),
  capturedAt: z.string().max(128),
});

export type SharedSnapshot = z.infer<typeof sharedSnapshotSchema>;
