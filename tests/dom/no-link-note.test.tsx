import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { NoLinkNote } from "@/components/scrutinix/no-link-note";
import { announce, Announcer } from "@/components/ui/announcer";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";
import { NO_LINK_NOTE } from "@/lib/domain/share-launch";
import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
} from "@/lib/domain/types";
import { buildThreatAssessment } from "@/lib/domain/verdict";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const LINK = "https://parcel-help.example/track";

function resultFor(url: string): AnalysisResult {
  const signals = createPendingSignalResults();
  for (const name of signalNames) {
    signals[name] = {
      status: "skipped",
      data: null,
      error: "Not applicable in this test.",
      durationMs: 1,
    };
  }
  const { verdict, threatInfo } = buildThreatAssessment(signals);
  return {
    id: "no-link-scan",
    url,
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId: "no-link-scan",
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: "2026-10-06T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

function stubScan(url: string) {
  const body = `${[
    {
      type: "scan_started",
      scanId: "no-link-scan",
      url,
      cached: false,
      startedAt: "2026-10-06T00:00:00.000Z",
    },
    { type: "scan_complete", result: resultFor(url) },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n")}\n`;
  const fetchMock = vi.fn(
    async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The page as `/?nolink=1` renders it: the note under the form. */
function renderArrival() {
  return render(
    <AnalyzerRuntimeProvider>
      <ScanForm />
      <NoLinkNote note={NO_LINK_NOTE} />
      <ResultsSection />
      <Announcer />
    </AnalyzerRuntimeProvider>,
  );
}

function urlInput() {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: /url to analyze/i,
  });
}

/** The visible line (in reading order too), if drawn. */
function visibleNote() {
  return (
    [...document.querySelectorAll("p:not([role='status'])")].find(
      (node) => node.textContent === NO_LINK_NOTE,
    ) ?? null
  );
}

function noteStatus() {
  return (
    screen
      .queryAllByRole("status")
      .find((node) => node.textContent === NO_LINK_NOTE) ?? null
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/?nolink=1");
  // The page's status region is one per page; start each test with it empty.
  announce("");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("arriving from a share with no link to fill in (/?nolink=1)", () => {
  it("says so in one line, announces it once politely, and fills in and scans nothing", async () => {
    const fetchMock = stubScan(LINK);
    renderArrival();

    // Drawn from the first render; the status region is there, empty, so
    // the sentence that lands in it is a change a screen reader speaks.
    expect(visibleNote()).not.toBeNull();
    const regions = screen.getAllByRole("status");
    expect(regions.some((node) => node.textContent === "")).toBe(true);
    expect(noteStatus()).toBeNull();
    await waitFor(() => expect(noteStatus()).not.toBeNull());

    expect(urlInput().value).toBe("");
    expect(document.activeElement).toBe(document.body);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("speaks once: the sentence lands in the region one time and stays put", async () => {
    stubScan(LINK);
    renderArrival();
    const region = screen
      .getAllByRole("status")
      .find(
        (node) => node.textContent === "" && node.classList.contains("sr-only"),
      )!;
    const changes: string[] = [];
    const observer = new MutationObserver(() => {
      changes.push(region.textContent ?? "");
    });
    observer.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    await waitFor(() => expect(region.textContent).toBe(NO_LINK_NOTE));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1_000)));
    observer.disconnect();
    expect(region.isConnected).toBe(true);
    expect(region.textContent).toBe(NO_LINK_NOTE);
    expect(changes).toEqual([NO_LINK_NOTE]);
  });

  it("goes for good once the person types, even if they clear the field", async () => {
    stubScan(LINK);
    renderArrival();
    fireEvent.change(urlInput(), { target: { value: "h" } });
    expect(visibleNote()).toBeNull();
    expect(noteStatus()).toBeNull();
    fireEvent.change(urlInput(), { target: { value: "" } });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(visibleNote()).toBeNull();
    expect(noteStatus()).toBeNull();
  });

  it("goes once the person types in Batch instead", async () => {
    stubScan(LINK);
    renderArrival();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Batch" }));
    const batchInput = await screen.findByRole("textbox", {
      name: /urls to analyze/i,
    });
    // Switching tabs alone changes nothing the note says.
    expect(visibleNote()).not.toBeNull();
    fireEvent.change(batchInput, { target: { value: "example.com" } });
    expect(visibleNote()).toBeNull();
    expect(noteStatus()).toBeNull();
  });

  it("gives way to the form's own error on an empty Analyze, so it is said once", async () => {
    const fetchMock = stubScan(LINK);
    renderArrival();
    fireEvent.click(screen.getByRole("button", { name: /analyze url/i }));
    await screen.findByText("Paste a link to check.");
    expect(visibleNote()).toBeNull();
    expect(noteStatus()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the address once a result lands", async () => {
    stubScan(LINK);
    renderArrival();
    fireEvent.change(urlInput(), { target: { value: LINK } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /analyze url/i }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/^scan result: /i)).toBeDefined(),
    );
    expect(window.location.search).toBe("");
  });
});
