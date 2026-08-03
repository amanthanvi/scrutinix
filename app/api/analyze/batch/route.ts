import { createErrorAnalysisResult } from "@/lib/domain/analysis-result";
import { runAnalysis, SCAN_BUDGET_MS } from "@/lib/server/analyze";
import { createApiError } from "@/lib/server/api-error";
import { parseScanRequest } from "@/lib/server/scan-request";
import { createNdjsonResponse } from "@/lib/server/stream";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONCURRENCY = 3;

export async function POST(request: Request) {
  const parsed = await parseScanRequest(request, "batch");
  if (!parsed.ok) {
    return parsed.response;
  }

  const targets = parsed.targets;

  return createNdjsonResponse(async (writer, clientGone) => {
    writer.startKeepalive();
    writer.send({
      type: "batch_started",
      total: targets.length,
      startedAt: new Date().toISOString(),
    });

    try {
      const dispatchSignal = AbortSignal.any([request.signal, clientGone]);
      const results = await mapWithConcurrency(
        targets,
        CONCURRENCY,
        dispatchSignal,
        async (target, index) => {
          const scanId = crypto.randomUUID();
          const startedAt = new Date().toISOString();
          const signal = AbortSignal.any([
            request.signal,
            clientGone,
            AbortSignal.timeout(SCAN_BUDGET_MS),
          ]);

          writer.send({
            type: "url_started",
            index,
            url: target.normalizedUrl,
          });

          let result;
          try {
            result = await runAnalysis(target, {
              scanId,
              startedAt,
              signal,
            });
          } catch (error) {
            result = createErrorAnalysisResult({
              url: target.normalizedUrl,
              scanId,
              startedAt,
              message:
                error instanceof Error
                  ? error.message
                  : "The batch item failed unexpectedly.",
            });
          }

          writer.send({
            type: "url_complete",
            index,
            url: result.url,
            result,
          });

          return result;
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
  signal: AbortSignal,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        signal.throwIfAborted();
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
