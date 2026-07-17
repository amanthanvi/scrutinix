import { describe, expect, it } from "vitest";

import { readNdjsonStream } from "@/lib/client/ndjson";
import { streamFailureApiError } from "@/lib/client/stream-error";

describe("readNdjsonStream", () => {
  it("rejects when a line is not valid JSON", async () => {
    const response = new Response('{"type":"ok"}\nnot-json\n', {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });

    await expect(
      readNdjsonStream(response, () => {
        // no-op
      }),
    ).rejects.toThrow(SyntaxError);
  });
});

describe("streamFailureApiError", () => {
  it("maps Error messages into ApiError without rethrowing shapes", () => {
    expect(streamFailureApiError(new Error("bad line"), "fallback")).toEqual({
      code: "unexpected_error",
      message: "bad line",
      retryable: false,
    });
  });

  it("uses the fallback when the thrown value has no message", () => {
    expect(streamFailureApiError({}, "The scan stream failed unexpectedly.")).toEqual(
      {
        code: "unexpected_error",
        message: "The scan stream failed unexpectedly.",
        retryable: false,
      },
    );
  });
});
