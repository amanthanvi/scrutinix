/** Malformed lines tolerated before the stream is treated as corrupt. */
const MAX_SKIPPED_LINES = 5;

export async function readNdjsonStream(
  response: Response,
  onEvent: (event: unknown) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Readable response body is not available.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let skipped = 0;

  // A single malformed line is skipped rather than killing the stream; only
  // repeated corruption aborts.
  const handleLine = (line: string) => {
    if (!line.trim()) {
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      skipped += 1;
      if (skipped > MAX_SKIPPED_LINES) {
        throw new Error(
          "The result stream contained too many malformed lines.",
        );
      }
      return;
    }

    onEvent(event);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        handleLine(line);
      }
    }

    // A non-empty buffer after done means the stream ended mid-line
    // (truncated). Parse it if possible; a truncated final line is an error
    // because it usually holds the scan_complete payload.
    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer));
      } catch {
        throw new Error("The result stream ended before completing.");
      }
    }
  } finally {
    // Stop the underlying stream on early exit (consumer threw); harmless
    // when the stream already finished.
    void reader.cancel().catch(() => {});
  }
}
