import { describe, expect, it } from "vitest";

import { readNdjsonStream } from "@/lib/client/ndjson";
import { streamFailureApiError } from "@/lib/client/stream-error";

describe("readNdjsonStream", () => {
  it("skips isolated malformed lines instead of killing the stream", async () => {
    const response = new Response('{"type":"a"}\nnot-json\n{"type":"b"}\n', {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });

    const events: unknown[] = [];
    await readNdjsonStream(response, (event) => events.push(event));

    expect(events).toEqual([{ type: "a" }, { type: "b" }]);
  });

  it("rejects when the stream is riddled with malformed lines", async () => {
    const junk = Array.from({ length: 7 }, (_, i) => `garbage-${i}`).join("\n");
    const response = new Response(`${junk}\n{"type":"ok"}\n`, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });

    await expect(readNdjsonStream(response, () => {})).rejects.toThrow(
      /too many malformed lines/,
    );
  });

  it("reassembles events split across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // One JSON event split mid-token across three chunks.
        controller.enqueue(encoder.encode('{"type":"spl'));
        controller.enqueue(encoder.encode('it","value":4'));
        controller.enqueue(encoder.encode('2}\n{"type":"next"}\n'));
        controller.close();
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });

    const events: unknown[] = [];
    await readNdjsonStream(response, (event) => events.push(event));

    expect(events).toEqual([{ type: "split", value: 42 }, { type: "next" }]);
  });

  it("parses a final line without a trailing newline", async () => {
    const response = new Response('{"type":"a"}\n{"type":"final"}', {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });

    const events: unknown[] = [];
    await readNdjsonStream(response, (event) => events.push(event));

    expect(events).toEqual([{ type: "a" }, { type: "final" }]);
  });

  it("rejects when the stream ends mid-line", async () => {
    const response = new Response('{"type":"a"}\n{"type":"trunca', {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });

    await expect(readNdjsonStream(response, () => {})).rejects.toThrow(
      /ended before completing/,
    );
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
    expect(
      streamFailureApiError({}, "The scan stream failed unexpectedly."),
    ).toEqual({
      code: "unexpected_error",
      message: "The scan stream failed unexpectedly.",
      retryable: false,
    });
  });
});
