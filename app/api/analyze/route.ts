import { normalizeUrlInput } from "@/lib/domain/url";
import { runAnalysis } from "@/lib/server/analyze";
import { createApiError } from "@/lib/server/api-error";
import { readJsonBody } from "@/lib/server/request-body";
import { createNdjsonResponse } from "@/lib/server/stream";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readJsonBody<{ url?: unknown }>(request);
  if (!body || typeof body.url !== "string") {
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

  const url = body.url;
  const validation = normalizeUrlInput(url);
  if (!validation.ok) {
    return Response.json(
      {
        error: createApiError("invalid_url", validation.error, false),
      },
      { status: 400 },
    );
  }

  const scanId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  return createNdjsonResponse(async (writer) => {
    try {
      const outcome = await runAnalysis(url, {
        scanId,
        startedAt,
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

      if (!outcome.ok) {
        writer.send({
          type: "scan_error",
          error: outcome.error,
        });
        return;
      }

      writer.send({
        type: "scan_complete",
        result: outcome.result,
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
