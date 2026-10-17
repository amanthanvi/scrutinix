import type { AnalyzeEvent, BatchEvent } from "@/lib/domain/types";
import {
  exposeClientError,
  type ClientErrorView,
} from "@/lib/server/client-error";

type StreamEvent = AnalyzeEvent | BatchEvent | { type: "keepalive" };
type TerminalErrorEvent = Extract<
  StreamEvent,
  { type: "scan_error" | "batch_error" }
>;

const KEEPALIVE_INTERVAL_MS = 15_000;

/**
 * NDJSON streaming response. `run` receives the writer plus an AbortSignal
 * that fires when the client disconnects, so in-flight signal work can stop
 * instead of burning provider quota on an audience of zero.
 *
 * `terminalError` turns an escaped exception into a line the client schema
 * accepts. `controller.error()` would drop that line: the browser only sees
 * a broken stream and never receives the reference id. It is required and
 * has no default because the right terminal event depends on the route
 * (`scan_error` for a single scan, `batch_error` for a batch); a guessed
 * default would end a batch stream with an event its client ignores.
 */
export function createNdjsonResponse(
  run: (writer: NdjsonWriter, clientGone: AbortSignal) => Promise<void>,
  options: {
    terminalError: (failure: ClientErrorView) => TerminalErrorEvent;
  },
) {
  const encoder = new TextEncoder();
  const disconnect = new AbortController();
  let activeWriter: NdjsonWriter | null = null;

  return new Response(
    new ReadableStream({
      async start(controller) {
        const writer = new NdjsonWriter(controller, encoder);
        activeWriter = writer;
        try {
          await run(writer, disconnect.signal);
        } catch (error) {
          // Route handlers normally catch and emit a terminal event. This is
          // the backstop so a leak never becomes the stream's error reason.
          const failure = exposeClientError(error, {
            correlationId: crypto.randomUUID(),
            summary: "The scan stream failed unexpectedly.",
            code: "stream_failed",
            logEvent: "stream.failed",
          });
          writer.send(options.terminalError(failure));
          writer.close();
          return;
        }
        writer.close();
      },
      cancel() {
        activeWriter?.markClosed();
        disconnect.abort(new Error("The client disconnected."));
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

export class NdjsonWriter {
  private closed = false;
  private keepalive: NodeJS.Timeout | null = null;

  constructor(
    private readonly controller: ReadableStreamDefaultController<Uint8Array>,
    private readonly encoder: TextEncoder,
  ) {}

  send(event: StreamEvent) {
    if (this.closed) {
      return;
    }

    // A disconnected client makes enqueue throw; treat that as a close
    // instead of letting the error reject the whole scan pipeline.
    try {
      this.controller.enqueue(
        this.encoder.encode(`${JSON.stringify(event)}\n`),
      );
    } catch {
      this.markClosed();
    }
  }

  /**
   * Emit periodic `{"type":"keepalive"}` lines so slow providers (VT polls
   * can take 60s+) don't leave the stream silent long enough for
   * intermediaries to kill it. Clients drop unknown event types.
   */
  startKeepalive(intervalMs = KEEPALIVE_INTERVAL_MS) {
    if (this.keepalive || this.closed) {
      return;
    }

    this.keepalive = setInterval(() => {
      this.send({ type: "keepalive" });
    }, intervalMs);
    this.keepalive.unref?.();
  }

  /** Mark the stream unusable without touching the controller. */
  markClosed() {
    this.closed = true;
    if (this.keepalive) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
  }

  close() {
    if (this.closed) {
      return;
    }

    this.markClosed();
    try {
      this.controller.close();
    } catch {
      // Already errored or cancelled upstream.
    }
  }
}
