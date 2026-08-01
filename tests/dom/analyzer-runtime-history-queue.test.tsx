import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalyzerRuntimeProvider,
  useAnalyzerRuntime,
} from "@/components/scrutinix/analyzer-runtime";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function minimalResult(id: string, url: string) {
  return {
    id,
    url,
    verdict: "safe",
    signals: {},
    threatInfo: null,
    metadata: {
      scanId: id,
      startedAt: "2026-07-01T00:00:00.000Z",
      completedAt: "2026-07-01T00:00:01.000Z",
    },
  };
}

function batchNdjson(urls: string[]): string {
  const lines = [
    JSON.stringify({
      type: "batch_started",
      total: urls.length,
      startedAt: "2026-07-01T00:00:00.000Z",
    }),
    ...urls.map((url, index) =>
      JSON.stringify({
        type: "url_complete",
        index,
        url,
        result: minimalResult(`scan-${index}`, url),
      }),
    ),
    JSON.stringify({
      type: "batch_complete",
      results: urls.map((url, index) => minimalResult(`scan-${index}`, url)),
    }),
  ];
  return `${lines.join("\n")}\n`;
}

function Probe() {
  const { historyQueue, submitBatch } = useAnalyzerRuntime();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void submitBatch(
            "https://a.example\nhttps://b.example\nhttps://c.example",
          )
        }
      >
        go
      </button>
      <output data-testid="queue-size">{historyQueue.length}</output>
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analyzer runtime history queue", () => {
  it("keeps every batch result even when events land in one chunk", async () => {
    const urls = [
      "https://a.example/",
      "https://b.example/",
      "https://c.example/",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(batchNdjson(urls), {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          }),
      ),
    );

    render(
      <AnalyzerRuntimeProvider>
        <Probe />
      </AnalyzerRuntimeProvider>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "go" }).click();
      // Let the whole stream drain inside a single act pass - this is the
      // scenario where the old single-slot state cell dropped results.
      await Promise.resolve();
    });

    await screen.findByText("3");
    expect(screen.getByTestId("queue-size").textContent).toBe("3");
  });
});
