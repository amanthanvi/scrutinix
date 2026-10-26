import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";
import { announce, Announcer } from "@/components/ui/announcer";
import { resolvePrefill } from "@/lib/domain/share-launch";
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
  prefill = null,
  shared = null,
}: {
  prefill?: string | null;
  shared?: SharedView | null;
}) {
  return render(
    <AnalyzerRuntimeProvider prefill={prefill} shared={shared}>
      <ScanForm />
      <ResultsSection />
      <Announcer />
    </AnalyzerRuntimeProvider>,
  );
}

const LINK = "https://parcel-help.example/track";

/** The Single field. */
function urlInput() {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: /url to analyze/i,
  });
}

function analyzeButton() {
  return screen.getByRole("button", { name: /analyze url/i });
}

/** The links each scan request asked for, in order. */
function scannedUrls(fetchMock: ReturnType<typeof stubScan>) {
  return (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
    ([, init]) => (JSON.parse(String(init.body)) as { url: string }).url,
  );
}

/** Let every effect, and anything it starts, run. */
async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  announce("");
});

describe("a link handed to the page (?url=, or the share target's redirect to it)", () => {
  it("fills in the field, takes the link apart, focuses Analyze, and scans only when Analyze is tapped", async () => {
    const fetchMock = stubScan(LINK);
    const raw = "HTTPS://Parcel-Help.Example:443/track#top";
    window.history.replaceState(
      null,
      "",
      `/?url=${encodeURIComponent(raw)}&utm=1`,
    );
    // The page normalizes `?url=` on the server and hands the result on.
    renderApp({ prefill: resolvePrefill(raw) });

    const input = urlInput();
    expect(input.value).toBe(LINK);
    // Analyze takes focus, not the field: no phone keyboard over the link.
    await waitFor(() => expect(document.activeElement).toBe(analyzeButton()));
    const anatomy = await screen.findByRole("region", {
      name: "The link, taken apart",
    });
    expect(anatomy.textContent).toContain("parcel-help.example");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^scan result/i)).toBeNull();
    // Still on the address bar: nothing has replaced it yet.
    expect(window.location.search).toContain("url=");

    // The tap scans it, once, and the result replaces the prefill in the
    // address (other parameters stay).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /analyze url/i }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/^scan result: /i)).toBeDefined(),
    );
    await settle();
    expect(scannedUrls(fetchMock)).toEqual([LINK]);
    expect(window.location.search).toBe("?utm=1");
  });

  it("still waits for Analyze when the page is rendered again with the same link", async () => {
    // Back restores the cached render, props and all, into a new component.
    const fetchMock = stubScan(LINK);
    for (let visit = 0; visit < 2; visit += 1) {
      const view = renderApp({ prefill: LINK });
      expect(urlInput().value).toBe(LINK);
      await waitFor(() => expect(document.activeElement).toBe(analyzeButton()));
      await settle();
      view.unmount();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says once that a link was filled in, and whose it really is", async () => {
    stubScan(LINK);
    const lookAlike = "https://paypal.com.secure-login.xyz/verify";
    renderApp({ prefill: resolvePrefill(lookAlike) });
    const status = screen.getByRole("status");
    // Not by moving focus to the field (the phone keyboard would cover the
    // link): a polite message, once the address check knows the owner.
    await waitFor(() =>
      expect(status.textContent).toBe(
        "Link filled in: paypal.com.secure-login.xyz. This link belongs to secure-login.xyz, not paypal.com. Press Analyze to check it.",
      ),
    );
    expect(document.activeElement).toBe(analyzeButton());
  });

  it("says a link that imitates nothing was filled in, without an owner sentence", async () => {
    stubScan(LINK);
    renderApp({ prefill: LINK });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Link filled in: parcel-help.example. Press Analyze to check it.",
      ),
    );
  });

  it("leaves an empty field alone when there is nothing to fill in", async () => {
    const fetchMock = stubScan(LINK);
    renderApp({ prefill: resolvePrefill("http://localhost/") });
    expect(urlInput().value).toBe("");
    await settle();
    expect(document.activeElement).not.toBe(urlInput());
    expect(document.activeElement).not.toBe(analyzeButton());
    expect(fetchMock).not.toHaveBeenCalled();
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
