import type { AnalyzeEvent, BatchEvent } from "@/lib/domain/types";

type StreamEvent = AnalyzeEvent | BatchEvent | { type: "keepalive" };

const KEEPALIVE_INTERVAL_MS = 15_000;

/**
 * NDJSON streaming response. `run` receives the writer plus an AbortSignal
 * that fires when the client disconnects, so in-flight signal work can stop
 * instead of burning provider quota on an audience of zero.
 */
export function createNdjsonResponse(
  run: (writer: NdjsonWriter, clientGone: AbortSignal) => Promise<void>,
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
          writer.markClosed();
          controller.error(error);
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
