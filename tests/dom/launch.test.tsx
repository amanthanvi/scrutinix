import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
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
import * as launchClaims from "@/lib/client/launch-claims";
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

/** The server's time when it issued the grant and rendered the page. */
const ISSUED = Date.parse("2026-10-24T12:00:00.000Z");
const RENDERED = ISSUED + 1_000;

function renderApp({
  launch = null,
  shared = null,
}: {
  launch?: Launch | null;
  shared?: SharedView | null;
}) {
  return render(
    <AnalyzerRuntimeProvider
      launch={launch}
      shared={shared}
      renderedAt={RENDERED}
    >
      <ScanForm />
      <ResultsSection />
    </AnalyzerRuntimeProvider>,
  );
}

const LINK = "https://parcel-help.example/track";

function launchOf(id: string): Launch {
  return { url: LINK, grant: { id, issuedAt: ISSUED } };
}

/** The Single field. */
function urlInput() {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: /url to analyze/i,
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a /?url= link", () => {
  it("fills the Single field and focuses it, and never scans", async () => {
    const fetchMock = stubScan(LINK);
    window.history.replaceState(null, "", `/?url=${encodeURIComponent(LINK)}`);
    renderApp({ launch: { url: LINK, grant: null } });

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
  // this link (readLaunchGrant); the browser scans each grant id once,
  // within the grant's minute.
  it("scans once on arrival and clears the address", async () => {
    const fetchMock = stubScan(LINK);
    window.history.replaceState(
      null,
      "",
      `/?url=${encodeURIComponent(LINK)}&utm=1`,
    );
    renderApp({ launch: launchOf("arrival-launch-id") });

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
  /**
   * Mount with `launch`, wait until it has either asked for its scan or
   * settled on a prefill (the field takes focus), and unmount.
   */
  async function visit(launch: Launch, fetchMock: ReturnType<typeof stubScan>) {
    const scansBefore = fetchMock.mock.calls.length;
    const view = renderApp({ launch });
    const input = urlInput();
    expect(input.value).toBe(launch.url);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.length > scansBefore ||
          document.activeElement === input,
      ).toBe(true),
    );
    view.unmount();
  }

  it("scans once across a remount: the second only prefills", async () => {
    const fetchMock = stubScan(LINK);
    // Back restores the cached render (same props) into a new component.
    const launch = launchOf("remount-launch-id");
    await visit(launch, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await visit(launch, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A new launch of the same link is a new grant, and scans.
    await visit(launchOf("next-launch-id"), fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only prefills in a tab that finds the id another tab recorded", async () => {
    const fetchMock = stubScan(LINK);
    // The other tab: its own copy of the module, the same IndexedDB.
    vi.resetModules();
    const otherTab = await import("@/lib/client/launch-claims");
    const launch = launchOf("other-tab-launch-id");
    expect(await otherTab.claimLaunch(launch.grant!, RENDERED)).toBe(true);
    await visit(launch, fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only prefills where IndexedDB is unavailable", async () => {
    const fetchMock = stubScan(LINK);
    vi.stubGlobal("indexedDB", undefined);
    await visit(launchOf("no-storage-launch-id"), fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only prefills when the page hydrates after the launch's minute", async () => {
    // Rendered a second after the share, then a minute on the way in.
    const fetchMock = stubScan(LINK);
    const now = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => now() + 60_000);
    await visit(launchOf("late-launch-id"), fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only prefills a second page whose clock runs eleven minutes ahead", async () => {
    // Round 3 repro B: that page dropped the first page's record as stale
    // by its own Date.now(), and scanned again.
    const fetchMock = stubScan(LINK);
    const launch = launchOf("skewed-launch-id");
    await visit(launch, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The second page: its own modules (so its own in-page record).
    vi.resetModules();
    const [{ AnalyzerRuntimeProvider: SecondPage }, { ScanForm: SecondForm }] =
      await Promise.all([
        import("@/components/scrutinix/analyzer-runtime"),
        import("@/components/scrutinix/scan-form"),
      ]);
    const now = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => now() + 11 * 60_000);
    const view = render(
      <SecondPage launch={launch} renderedAt={RENDERED + 500}>
        <SecondForm />
      </SecondPage>,
    );
    await waitFor(() => expect(document.activeElement).toBe(urlInput()));
    view.unmount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a launch still being claimed", () => {
  /** Hold `claimLaunch` open until the test commits it. */
  function holdClaim() {
    let commit: (claimed: boolean) => void = () => {};
    vi.spyOn(launchClaims, "claimLaunch").mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          commit = resolve;
        }),
    );
    return { commit: (claimed: boolean) => commit(claimed) };
  }

  function scannedUrls(fetchMock: ReturnType<typeof stubScan>) {
    return (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => (JSON.parse(String(init.body)) as { url: string }).url,
    );
  }

  it("only prefills when its claim commits after the launch's minute", async () => {
    const fetchMock = stubScan(LINK);
    const claim = holdClaim();
    renderApp({ launch: launchOf("slow-commit-launch-id") });
    await waitFor(() => expect(launchClaims.claimLaunch).toHaveBeenCalled());

    // The page was paused mid-transaction past the grant's minute.
    const now = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => now() + 61_000);
    await act(async () => claim.commit(true));

    await waitFor(() => expect(document.activeElement).toBe(urlInput()));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives way to the person's own scan", async () => {
    const other = "https://example.com/other";
    const fetchMock = stubScan(other);
    const claim = holdClaim();
    renderApp({ launch: launchOf("overridden-launch-id") });
    await waitFor(() => expect(launchClaims.claimLaunch).toHaveBeenCalled());

    fireEvent.change(urlInput(), { target: { value: other } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /analyze url/i }));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => claim.commit(true));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(scannedUrls(fetchMock)).toEqual([other]);
  });

  it("gives way to a switch to Batch and an edit there", async () => {
    const fetchMock = stubScan(LINK);
    const claim = holdClaim();
    renderApp({ launch: launchOf("batch-edit-launch-id") });
    await waitFor(() => expect(launchClaims.claimLaunch).toHaveBeenCalled());

    const batchTab = screen.getByRole("tab", { name: /batch/i });
    fireEvent.mouseDown(batchTab);
    fireEvent.click(batchTab);
    await waitFor(() =>
      expect(batchTab.getAttribute("aria-selected")).toBe("true"),
    );
    await act(async () => claim.commit(true));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(batchTab.getAttribute("aria-selected")).toBe("true");
  });

  it("gives way to an edit of the field", async () => {
    const fetchMock = stubScan(LINK);
    const claim = holdClaim();
    renderApp({ launch: launchOf("edited-launch-id") });
    await waitFor(() => expect(launchClaims.claimLaunch).toHaveBeenCalled());

    fireEvent.change(urlInput(), { target: { value: `${LINK}?edited` } });
    await act(async () => claim.commit(true));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(urlInput().value).toBe(`${LINK}?edited`);
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
