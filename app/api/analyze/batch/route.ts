import { normalizeUrlInput } from "@/lib/domain/url";
import { runAnalysis } from "@/lib/server/analyze";
import { createApiError } from "@/lib/server/api-error";
import { readJsonBody } from "@/lib/server/request-body";
import { createNdjsonResponse } from "@/lib/server/stream";
import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
} from "@/lib/domain/types";

export const runtime = "nodejs";

const MAX_BATCH_SIZE = 10;
const CONCURRENCY = 3;

export async function POST(request: Request) {
  const body = await readJsonBody<{ urls?: unknown[] }>(request);
  if (!body || !Array.isArray(body.urls)) {
    return Response.json(
      {
        error: createApiError(
          "invalid_request",
          "Request body must include a urls array.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  const urls = body.urls;

  if (urls.length === 0 || urls.length > MAX_BATCH_SIZE) {
    return Response.json(
      {
        error: createApiError(
          "invalid_batch_size",
          `Batch scans must contain between 1 and ${MAX_BATCH_SIZE} URLs.`,
          false,
        ),
      },
      { status: 400 },
    );
  }

  if (!urls.every((item): item is string => typeof item === "string")) {
    return Response.json(
      {
        error: createApiError(
          "invalid_request",
          "Each batch item must be a string URL.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  const validated = urls.map((item) => normalizeUrlInput(item));
  const invalid = validated.find((result) => !result.ok);
  if (invalid && !invalid.ok) {
    return Response.json(
      {
        error: createApiError("invalid_url", invalid.error, false),
      },
      { status: 400 },
    );
  }

  return createNdjsonResponse(async (writer) => {
    writer.send({
      type: "batch_started",
      total: urls.length,
      startedAt: new Date().toISOString(),
    });

    try {
      const results = await mapWithConcurrency(
        urls,
        CONCURRENCY,
        async (url, index) => {
          const scanId = crypto.randomUUID();
          const startedAt = new Date().toISOString();

          writer.send({
            type: "url_started",
            index,
            url,
          });

          try {
            const outcome = await runAnalysis(url, {
              scanId,
              startedAt,
            });

            const result = outcome.ok
              ? outcome.result
              : createBatchErrorResult(
                  url,
                  scanId,
                  startedAt,
                  outcome.error.message,
                );

            writer.send({
              type: "url_complete",
              index,
              url: result.url,
              result,
            });

            return result;
          } catch (error) {
            const result = createBatchErrorResult(
              url,
              scanId,
              startedAt,
              error instanceof Error
                ? error.message
                : "The batch item failed unexpectedly.",
            );

            writer.send({
              type: "url_complete",
              index,
              url: result.url,
              result,
            });

            return result;
          }
        },
      );

      writer.send({
        type: "batch_complete",
        results,
      });
    } catch (error) {
      writer.send({
        type: "batch_error",
        error: createApiError(
          "batch_failed",
          error instanceof Error
            ? error.message
            : "The batch failed unexpectedly.",
          true,
        ),
      });
    }
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        if (item === undefined) {
          continue;
        }

        results[currentIndex] = await worker(item, currentIndex);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

function createBatchErrorResult(
  input: string,
  scanId: string,
  startedAt: string,
  message: string,
): AnalysisResult {
  const normalized = normalizeUrlInput(input);
  const url = normalized.ok ? normalized.value.normalizedUrl : input;
  const completedAt = new Date().toISOString();
  const signals = createPendingSignalResults();
  const signalMessage = `Batch item failed before Scrutinix could complete signal execution: ${message}`;

  for (const signalName of signalNames) {
    signals[signalName] = {
      status: "error",
      data: null,
      error: signalMessage,
      durationMs: 0,
    };
  }

  return {
    id: scanId,
    url,
    verdict: "error",
    threatInfo: null,
    signals,
    metadata: {
      scanId,
      startedAt,
      completedAt,
      cacheHit: false,
      partialFailure: true,
      signalCount: signalNames.length,
      durationMs:
        new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    },
  };
}
