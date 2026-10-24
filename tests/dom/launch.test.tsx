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
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a /?url= link", () => {
  it("fills the Single field and focuses it, and never scans", async () => {
    const fetchMock = stubScan(LINK);
    window.history.replaceState(null, "", `/?url=${encodeURIComponent(LINK)}`);
    renderApp({ launch: { url: LINK, grantId: null } });

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
  // The server clears the grant's cookie (proxy.ts) and checks it names
  // this link (launchGrantId); the browser scans each grant id once.
  it("scans once on arrival and clears the address", async () => {
    const fetchMock = stubScan(LINK);
    window.history.replaceState(
      null,
      "",
      `/?url=${encodeURIComponent(LINK)}&utm=1`,
    );
    renderApp({ launch: { url: LINK, grantId: "arrival-launch-id" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({ url: LINK });
    expect(window.location.search).toBe("?utm=1");
    await waitFor(() =>
      expect(screen.getByLabelText(/^scan result: /i)).toBeDefined(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a launch the page is rendered with again", () => {
  /** Mount with `launch`, let any scan it starts finish, and unmount. */
  async function visit(launch: Launch) {
    const view = renderApp({ launch });
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: /url to analyze/i,
    });
    expect(input.value).toBe(launch.url);
    // Long enough for an effect's scan to have been asked for.
    await new Promise((resolve) => setTimeout(resolve, 50));
    view.unmount();
  }

  it("scans once across a remount: the second only prefills", async () => {
    const fetchMock = stubScan(LINK);
    // Back restores the cached render (same props) into a new component.
    const launch = { url: LINK, grantId: "remount-launch-id" };
    await visit(launch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await visit(launch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The browser keeps the random id, never the link.
    const stored = localStorage.getItem("sx-launches") ?? "";
    expect(stored).toContain("remount-launch-id");
    expect(stored).not.toContain("parcel-help");
    // A new launch of the same link is a new grant, and scans.
    await visit({ url: LINK, grantId: "next-launch-id" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only prefills in a tab that finds the id another tab recorded", async () => {
    const fetchMock = stubScan(LINK);
    localStorage.setItem(
      "sx-launches",
      JSON.stringify([["other-tab-launch-id", Date.now()]]),
    );
    await visit({ url: LINK, grantId: "other-tab-launch-id" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still scans once when storage is refused (private modes)", async () => {
    const fetchMock = stubScan(LINK);
    const refuse = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(refuse);
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(refuse);
    try {
      const launch = { url: LINK, grantId: "no-storage-launch-id" };
      await visit(launch);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await visit(launch);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("keeps a few recent ids and drops ones over ten minutes old", async () => {
    stubScan(LINK);
    const now = Date.now();
    localStorage.setItem(
      "sx-launches",
      JSON.stringify([
        ["stale-launch-id", now - 11 * 60_000],
        ["not-an-entry"],
        ...Array.from({ length: 10 }, (_, index) => [
          `recent-${index}`,
          now - 60_000,
        ]),
      ]),
    );
    await visit({ url: LINK, grantId: "pruning-launch-id" });
    const ids = (
      JSON.parse(localStorage.getItem("sx-launches")!) as [string, number][]
    ).map(([id]) => id);
    expect(ids).toHaveLength(8);
    expect(ids.at(-1)).toBe("pruning-launch-id");
    expect(ids).not.toContain("stale-launch-id");

    // Opening the page with no launch forgets ids once they are old.
    localStorage.setItem(
      "sx-launches",
      JSON.stringify([["stale-launch-id", now - 11 * 60_000]]),
    );
    renderApp({}).unmount();
    expect(localStorage.getItem("sx-launches")).toBeNull();
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
