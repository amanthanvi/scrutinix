import { createErrorAnalysisResult } from "@/lib/domain/analysis-result";
import { runAnalysis, SCAN_BUDGET_MS } from "@/lib/server/analyze";
import { createApiError } from "@/lib/server/api-error";
import {
  checkFailureMessage,
  exposeClientError,
  type ClientErrorView,
} from "@/lib/server/client-error";
import { parseScanRequest } from "@/lib/server/scan-request";
import { withResultShare } from "@/lib/server/share-signing";
import { createNdjsonResponse } from "@/lib/server/stream";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONCURRENCY = 3;

function batchErrorEvent(failure: ClientErrorView) {
  return {
    type: "batch_error" as const,
    error: createApiError(failure.code, failure.message, failure.retryable),
  };
}

export async function POST(request: Request) {
  const parsed = await parseScanRequest(request, "batch");
  if (!parsed.ok) {
    return parsed.response;
  }

  const targets = parsed.targets;
  const batchId = crypto.randomUUID();

  return createNdjsonResponse(
    async (writer, clientGone) => {
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

            let analysed;
            try {
              analysed = await runAnalysis(target, {
                scanId,
                startedAt,
                signal,
              });
            } catch (error) {
              // The message lands in all eight rows; the result shows its
              // reference (this scan id) once, in the verdict details.
              analysed = createErrorAnalysisResult({
                url: target.normalizedUrl,
                scanId,
                startedAt,
                message: checkFailureMessage(error, {
                  correlationId: scanId,
                  summary: "This URL could not be scanned.",
                  logEvent: "scan.failed",
                  redact: [target.normalizedUrl, target.hostname],
                  logFields: { batchId },
                }),
              });
            }

            // The server-issued (signed) share link travels with the result.
            const result = withResultShare(analysed);
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
        const failure = exposeClientError(error, {
          correlationId: batchId,
          summary: "The batch failed unexpectedly.",
          code: "batch_failed",
          logEvent: "batch.failed",
          redact: targets.flatMap((target) => [
            target.normalizedUrl,
            target.hostname,
          ]),
        });
        writer.send(batchErrorEvent(failure));
      }
    },
    {
      terminalError: batchErrorEvent,
      failureSummary: "The batch failed unexpectedly.",
      correlationId: batchId,
    },
  );
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
