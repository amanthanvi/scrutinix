import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalyzerRuntimeProvider,
  useAnalyzerRuntime,
} from "@/components/scrutinix/analyzer-runtime";
import { HistoryPanel } from "@/components/scrutinix/history-panel";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";
import {
  ANNOUNCEMENT_MS,
  announce,
  Announcer,
} from "@/components/ui/announcer";
import type { AnalysisResult, HistoryEntry } from "@/lib/domain/types";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { spokenTextNodes } from "@/tests/dom/helpers/speech";
import { cleanSignals } from "@/tests/fixtures/lure-signals";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

/*
 * What screen readers are given, checked against what TalkBack (Chrome on
 * Android) and VoiceOver (Safari) actually said in round one.
 */

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  announce("");
});

async function resultFor(host: string, url = `https://${host}/`) {
  const signals = await fixtureSignals(host);
  return resultFrom(host, signals, url);
}

function resultFrom(
  id: string,
  signals: AnalysisResult["signals"],
  url: string,
): AnalysisResult {
  const { verdict, threatInfo } = buildThreatAssessment(signals);
  return {
    id,
    url,
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId: id,
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: "2026-10-06T00:00:01.000Z",
      checkedAt: "2026-10-06T00:00:00.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

function OpenStored({ result }: { result: AnalysisResult }) {
  const { openStoredResult } = useAnalyzerRuntime();
  return (
    <button type="button" onClick={() => openStoredResult(result)}>
      open stored
    </button>
  );
}

function renderApp(extra?: React.ReactNode) {
  return render(
    <AnalyzerRuntimeProvider shared={null}>
      <ScanForm />
      <ResultsSection />
      {extra}
      <Announcer />
    </AnalyzerRuntimeProvider>,
  );
}

function liveRegion() {
  const region = document.querySelector("[aria-live='polite']");
  if (!region) throw new Error("no live region");
  return region;
}

describe("the scan mode tabs", () => {
  it("switch only when chosen, never because a screen reader moved focus", async () => {
    renderApp(
      <OpenStored
        result={resultFrom("safe", cleanSignals(), "https://example.com/")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));
    await screen.findByLabelText(/^scan result: safe$/i);

    // VoiceOver moves focus as it reads; Batch must not take over then.
    const batch = screen.getByRole("tab", {
      name: "Batch",
      description: "up to 10 links",
    });
    act(() => batch.focus());
    expect(document.activeElement).toBe(batch);
    expect(
      screen.getByRole("tab", { name: "Single" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByLabelText(/^scan result: safe$/i)).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "URL to analyze" }),
    ).toBeTruthy();

    // Enter (or Space, or a click) chooses it.
    fireEvent.keyDown(batch, { key: "Enter" });
    expect(batch.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByLabelText(/^scan result: safe$/i)).toBeNull();
  });

  it("names the URL field once, with no hidden label of its own", () => {
    renderApp();
    expect(
      screen.getByRole("textbox", { name: "URL to analyze" }),
    ).toBeTruthy();
    expect(document.querySelector("label[for='sx-url-input']")).toBeNull();
  });
});

describe("the result's live region", () => {
  it("says a scan started, not every check that finishes", async () => {
    const stream: { controller?: ReadableStreamDefaultController<Uint8Array> } =
      {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream.controller = controller;
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/x-ndjson" },
            },
          ),
      ),
    );
    renderApp();
    fireEvent.change(screen.getByRole("textbox", { name: "URL to analyze" }), {
      target: { value: "example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Analyze URL" }));
    });
    const send = (event: unknown) =>
      stream.controller?.enqueue(
        new TextEncoder().encode(`${JSON.stringify(event)}\n`),
      );
    const clean = cleanSignals();
    await act(async () => {
      send({
        type: "scan_started",
        scanId: "live",
        url: "https://example.com/",
        cached: false,
        startedAt: "2026-10-06T00:00:00.000Z",
      });
    });
    await waitFor(() => {
      expect(liveRegion().textContent).toBe(
        "Checking the link: 8 checks running.",
      );
    });
    await act(async () => {
      send({ type: "signal_result", name: "ssl", result: clean.ssl });
      send({ type: "signal_result", name: "dns", result: clean.dns });
    });
    // The band counts; the live region doesn't announce each one.
    await screen.findByText("2 of 8 checks finished");
    expect(liveRegion().textContent).toBe(
      "Checking the link: 8 checks running.",
    );
    await act(async () => {
      stream.controller?.close();
    });
  });

  it("clears a result once it has been said, and says it again when reopened", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const result = await resultFor("malicious.scrutinix.test");
    renderApp(<OpenStored result={result} />);
    const said =
      /^Result for malicious\.scrutinix\.test: Malicious, \d+ out of 100\. Don't open this link\.$/;

    fireEvent.click(screen.getByRole("button", { name: "open stored" }));
    await waitFor(() => expect(liveRegion().textContent).toMatch(said));

    // It sits before the band: a reader moving through the page must not
    // meet the result twice.
    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_MS);
    });
    expect(liveRegion().textContent).toBe("");
    expect(screen.getByLabelText(/^scan result: malicious$/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "open stored" }));
    await waitFor(() => expect(liveRegion().textContent).toMatch(said));
  });
});

describe("lists, rows, and cells", () => {
  it("marks every unstyled list as a list, so Safari counts its items", async () => {
    const result = await resultFor("malicious.scrutinix.test");
    renderApp(<OpenStored result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));
    const questions = await screen.findByRole("list", { name: "Questions" });
    expect(questions.getAttribute("role")).toBe("list");
    fireEvent.click(screen.getByRole("switch", { name: /^Summary Full/ }));
    expect(
      screen.getByRole("list", { name: "Signals" }).getAttribute("role"),
    ).toBe("list");
    for (const list of document.querySelectorAll("ul")) {
      expect(list.getAttribute("role"), list.outerHTML.slice(0, 80)).toBe(
        "list",
      );
    }
  });

  it("reads a Full row with evidence once, by its name", async () => {
    const result = await resultFor("malicious.scrutinix.test");
    renderApp(<OpenStored result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));
    await screen.findByRole("list", { name: "Questions" });
    fireEvent.click(screen.getByRole("switch", { name: /^Summary Full/ }));

    const summary = screen.getByLabelText(/^VirusTotal: /, {
      selector: "summary",
    });
    // TalkBack read the visible text, then the name: the name alone now.
    expect(spokenTextNodes(summary)).toEqual([]);
    expect(summary.textContent).toContain("VirusTotal");
  });

  it("names each strip cell once, its full name and state only on hover", async () => {
    const result = await resultFor("malicious.scrutinix.test");
    renderApp(<OpenStored result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));
    const strip = await screen.findByRole("toolbar", { name: "Checks" });
    const cells = within(strip).getAllByRole("button");
    expect(cells).toHaveLength(8);
    for (const cell of cells) {
      // A title on the cell was read as a second name.
      expect(cell.hasAttribute("title")).toBe(false);
      const hover = cell.querySelector("[title]");
      expect(hover?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(cells[0]?.querySelector("[title]")?.getAttribute("title")).toBe(
      "VirusTotal — flagged the link",
    );
  });

  it("draws the strip's key for the eye only", async () => {
    const result = await resultFor("malicious.scrutinix.test");
    renderApp(<OpenStored result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));
    await screen.findByRole("toolbar", { name: "Checks" });
    expect(
      document.querySelector(".sx-legend")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});

describe("history", () => {
  function History() {
    const [entries, setEntries] = useState<HistoryEntry[]>(saved);
    const [cleared, setCleared] = useState<HistoryEntry[]>([]);
    return (
      <>
        <HistoryPanel
          entries={entries}
          totalCount={entries.length}
          historyQuery=""
          onHistoryQueryChange={() => {}}
          onSelect={() => {}}
          onClear={() => {
            setCleared(entries);
            setEntries([]);
          }}
          canUndoClear={cleared.length > 0}
          onUndoClear={() => {
            setEntries(cleared);
            setCleared([]);
          }}
        />
        <Announcer />
      </>
    );
  }
  let saved: HistoryEntry[] = [];

  it("says what Clear and Undo did, and keeps focus on the button that reverses it", async () => {
    saved = [
      {
        ...resultFrom("safe", cleanSignals(), "https://example.com/"),
        savedAt: new Date().toISOString(),
      },
    ];
    render(<History />);
    const status = screen.getByRole("status");
    expect(
      screen.getByRole("heading", { level: 2, name: "History (1 scan)" }),
    ).toBeTruthy();
    expect(screen.getByRole("list").getAttribute("role")).toBe("list");

    fireEvent.click(screen.getByRole("button", { name: "Clear all history" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm clear all history" }),
    );
    const undo = await screen.findByRole("button", {
      name: "Undo clear history",
    });
    expect(document.activeElement).toBe(undo);
    await waitFor(() =>
      expect(status.textContent).toBe(
        "History was cleared. Undo restores the previous list.",
      ),
    );

    fireEvent.click(undo);
    const clear = await screen.findByRole("button", {
      name: "Clear all history",
    });
    expect(document.activeElement).toBe(clear);
    await waitFor(() => expect(status.textContent).toBe("History restored."));
  });
});

vi.mock("@/components/ui/lazy-toaster", () => ({
  getToast: async () => (await import("sonner")).toast,
}));
