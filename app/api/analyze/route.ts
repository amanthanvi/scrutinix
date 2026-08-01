import { runAnalysis, SCAN_BUDGET_MS } from "@/lib/server/analyze";
import { createApiError } from "@/lib/server/api-error";
import { parseScanRequest } from "@/lib/server/scan-request";
import { createNdjsonResponse } from "@/lib/server/stream";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const parsed = await parseScanRequest(request, "single");
  if (!parsed.ok) {
    return parsed.response;
  }

  const target = parsed.targets[0];
  if (!target) {
    return Response.json(
      {
        error: createApiError(
          "invalid_request",
          "Request body must include a string url.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  const scanId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  return createNdjsonResponse(async (writer, clientGone) => {
    writer.startKeepalive();
    const signal = AbortSignal.any([
      request.signal,
      clientGone,
      AbortSignal.timeout(SCAN_BUDGET_MS),
    ]);

    try {
      const result = await runAnalysis(target, {
        scanId,
        startedAt,
        signal,
        onScanReady: ({ cached, normalizedUrl }) => {
          writer.send({
            type: "scan_started",
            scanId,
            url: normalizedUrl,
            cached,
            startedAt,
          });
        },
        onSignal: ({ name, result }) => {
          writer.send({
            type: "signal_result",
            name,
            result,
          });
        },
      });

      writer.send({
        type: "scan_complete",
        result,
      });
    } catch (error) {
      writer.send({
        type: "scan_error",
        error: createApiError(
          "scan_failed",
          error instanceof Error
            ? error.message
            : "The scan failed unexpectedly.",
          true,
        ),
      });
    }
  });
}
