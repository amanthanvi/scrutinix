import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnalyzerRuntimeProvider,
  type Launch,
} from "@/components/scrutinix/analyzer-runtime";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";
import { SHARE_LAUNCH_COOKIE } from "@/lib/domain/share-launch";
import {
  encodeSharedSnapshot,
  type SharedView,
} from "@/lib/domain/signal-signature";
import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
} from "@/lib/domain/types";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { resolveSharedView } from "@/lib/server/share-metadata";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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
    id: "launch-scan",
    url,
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId: "launch-scan",
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: "2026-10-06T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

/** A scan stream that answers with one finished result. */
function stubScan(url: string) {
  const body = `${[
    {
      type: "scan_started",
      scanId: "launch-scan",
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

function renderApp({
  launch = null,
  shared = null,
}: {
  launch?: Launch | null;
  shared?: SharedView | null;
}) {
  return render(
    <AnalyzerRuntimeProvider launch={launch} shared={shared}>
      <ScanForm />
      <ResultsSection />
    </AnalyzerRuntimeProvider>,
  );
}

const LINK = "https://parcel-help.example/track";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  document.cookie = `${SHARE_LAUNCH_COOKIE}=; Max-Age=0; Path=/`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a /?url= link", () => {
  it("fills the Single field and focuses it, and never scans", async () => {
    const fetchMock = stubScan(LINK);
    window.history.replaceState(null, "", `/?url=${encodeURIComponent(LINK)}`);
    renderApp({ launch: { url: LINK, autoScan: false } });

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: /url to analyze/i,
    });
    expect(input.value).toBe(LINK);
    await waitFor(() => expect(document.activeElement).toBe(input));
    // Still on the address bar: nothing has replaced it yet.
    expect(window.location.search).toContain("url=");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Checking")).toBeNull();

    // The tap scans it, and the result replaces the prefill in the address.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /analyze url/i }));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.search).toBe(""));
  });
});

describe("a share-target launch", () => {
  it("scans once on arrival, spends its cookie, and clears the address", async () => {
    const fetchMock = stubScan(LINK);
    document.cookie = `${SHARE_LAUNCH_COOKIE}=${encodeURIComponent(LINK)}; Path=/`;
    window.history.replaceState(
      null,
      "",
      `/?url=${encodeURIComponent(LINK)}&utm=1`,
    );
    renderApp({ launch: { url: LINK, autoScan: true } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({ url: LINK });
    expect(document.cookie).not.toContain(SHARE_LAUNCH_COOKIE);
    expect(window.location.search).toBe("?utm=1");
    await waitFor(() =>
      expect(screen.getByLabelText(/^scan result: /i)).toBeDefined(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a shared link replaced by a fresh scan", () => {
  it("removes ?shared= and sig from the address", async () => {
    const payload = encodeSharedSnapshot({
      verdict: "safe",
      url: LINK,
      summary: "No check flagged this link.",
      capturedAt: "2026-10-06T09:00:00.000Z",
      signature: Array(8).fill("clear"),
    });
    const shared = resolveSharedView(payload, null, Date.now());
    expect(shared).not.toBeNull();
    stubScan(LINK);
    const params = new URLSearchParams({
      shared: payload,
      sig: "x".repeat(43),
      keep: "1",
    });
    window.history.replaceState(null, "", `/?${params.toString()}`);
    renderApp({ shared });

    // Opening the shared view leaves the address alone.
    expect(window.location.search).toContain("shared=");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scan this link" }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/^scan result: /i)).toBeDefined(),
    );
    expect(window.location.search).toBe("?keep=1");
  });
});
