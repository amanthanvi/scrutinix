import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";
import { SharedSnapshotPanel } from "@/components/scrutinix/shared-snapshot-panel";
import { decodeSharedSnapshot } from "@/lib/domain/shared-snapshot";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const phishingUrl = "https://malicious.scrutinix.test/login";

function encodePayload(value: unknown): string {
  return btoa(encodeURIComponent(JSON.stringify(value)));
}

const forgedPayload = encodePayload({
  verdict: "safe",
  url: phishingUrl,
  summary: "Verified safe by the Scrutinix security team.",
  capturedAt: "Checked by Scrutinix staff today",
});

function openShareLink(payload: string) {
  window.history.replaceState(
    null,
    "",
    `/?shared=${encodeURIComponent(payload)}`,
  );
}

function maliciousResult(url: string) {
  return {
    id: "fresh-scan",
    url,
    verdict: "malicious",
    signals: {},
    threatInfo: {
      verdict: "malicious",
      confidence: 0.9,
      confidenceLabel: "high",
      confidenceReasons: [],
      hasPositiveEvidence: true,
      score: 91,
      summary: "Malicious risk based on phishing signals.",
      categories: ["phishing"],
      reasons: ["VirusTotal: 7 engines flagged this URL."],
      recommendations: [],
      limitations: [],
    },
    metadata: {
      scanId: "fresh-scan",
      startedAt: "2026-10-10T12:00:00.000Z",
      completedAt: "2026-10-10T12:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

function scanResponse(url: string): Response {
  const lines = [
    {
      type: "scan_started",
      scanId: "fresh-scan",
      url,
      cached: false,
      startedAt: "2026-10-10T12:00:00.000Z",
    },
    { type: "scan_complete", result: maliciousResult(url) },
  ];
  return new Response(
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    { status: 200, headers: { "content-type": "application/x-ndjson" } },
  );
}

function renderResults() {
  return render(
    <AnalyzerRuntimeProvider>
      <ScanForm />
      <ResultsSection />
    </AnalyzerRuntimeProvider>,
  );
}

function failedScanResponse(): Response {
  return new Response(JSON.stringify({}), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState(null, "", "/");
});

describe("SharedSnapshotPanel", () => {
  it("presents the claim as unverified data, never as a scan result", () => {
    const { container } = render(
      <SharedSnapshotPanel
        snapshot={{
          verdict: "safe",
          url: phishingUrl,
          summary: "Verified safe by the Scrutinix security team.",
          capturedAt: "2026-03-21T00:00:00.000Z",
        }}
        onScan={() => {}}
      />,
    );

    const panel = screen.getByRole("region", { name: "Unverified snapshot" });
    expect(
      within(panel).getByRole("heading", { name: "Unverified snapshot" }),
    ).toBeTruthy();
    expect(within(panel).getByText(/anyone can edit/i)).toBeTruthy();
    expect(within(panel).getByText("safe").tagName).toBe("DD");
    expect(within(panel).getByText("Claimed scan time")).toBeTruthy();
    expect(
      within(panel).getByText("Verified safe by the Scrutinix security team.")
        .tagName,
    ).toBe("Q");
    expect(screen.queryByLabelText(/scan result/i)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    // Verdict colour is applied inline; a snapshot must carry none.
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("omits claims the link could not back with a real value", () => {
    render(
      <SharedSnapshotPanel
        snapshot={{
          verdict: "malicious",
          url: phishingUrl,
          summary: null,
          capturedAt: null,
        }}
        onScan={() => {}}
      />,
    );

    expect(screen.getByText("Claimed verdict")).toBeTruthy();
    expect(screen.queryByText("Claimed scan time")).toBeNull();
    expect(screen.queryByText("Claimed summary")).toBeNull();
  });

  it("offers a fresh scan as the primary action", () => {
    const onScan = vi.fn();
    render(
      <SharedSnapshotPanel
        snapshot={{
          verdict: "safe",
          url: phishingUrl,
          summary: null,
          capturedAt: null,
        }}
        onScan={onScan}
      />,
    );

    const button = screen.getByRole("button", { name: "Scan this URL" });
    expect(button.getAttribute("data-variant")).toBe("primary");
    fireEvent.click(button);
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});

describe("shared links", () => {
  it("replace a forged snapshot with a fresh scan of its URL on request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      scanResponse(phishingUrl),
    );
    vi.stubGlobal("fetch", fetchMock);
    openShareLink(forgedPayload);

    renderResults();

    const panel = await screen.findByRole("region", {
      name: "Unverified snapshot",
    });
    expect(within(panel).queryByText(/Checked by Scrutinix staff/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(panel).getByRole("button", { name: "Scan this URL" }),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] ?? [];
    expect(endpoint).toBe("/api/analyze");
    expect(JSON.parse(String(init?.body))).toEqual({ url: phishingUrl });
    expect(await screen.findByLabelText("Scan result: malicious")).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Unverified snapshot" }),
    ).toBeNull();
  });

  it("drop ?shared= from the address once a scan completes, keeping everything else", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => scanResponse(phishingUrl)),
    );
    window.history.replaceState(
      null,
      "",
      `/?ref=mail&shared=${encodeURIComponent(forgedPayload)}#top`,
    );
    const first = renderResults();

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Scan this URL" }),
      );
    });
    await screen.findByLabelText("Scan result: malicious");

    expect(window.location.search).toBe("?ref=mail");
    expect(window.location.hash).toBe("#top");

    // A reload mounts fresh state and reads the address again.
    first.unmount();
    renderResults();
    await act(async () => {});
    expect(
      screen.queryByRole("region", { name: "Unverified snapshot" }),
    ).toBeNull();
  });

  it("do not bring the snapshot back when a later re-scan fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => scanResponse(phishingUrl))
      .mockImplementation(async () => failedScanResponse());
    vi.stubGlobal("fetch", fetchMock);
    openShareLink(forgedPayload);
    renderResults();

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Scan this URL" }),
      );
    });
    await screen.findByLabelText("Scan result: malicious");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    });

    expect(
      await screen.findByText("Scan request failed with status 503."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText(/scan result/i)).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Unverified snapshot" }),
    ).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("drop ?shared= when the scan was of a different URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => scanResponse("https://other.scrutinix.test/")),
    );
    openShareLink(forgedPayload);
    renderResults();
    await screen.findByRole("region", { name: "Unverified snapshot" });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("URL to analyze"), {
        target: { value: "https://other.scrutinix.test/" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Analyze URL" }));
    });
    await screen.findByLabelText("Scan result: malicious");

    expect(window.location.search).toBe("");
    expect(
      screen.queryByRole("region", { name: "Unverified snapshot" }),
    ).toBeNull();
  });

  it("hide the snapshot beside a scan error, and keep the link for a reload", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => failedScanResponse());
    vi.stubGlobal("fetch", fetchMock);
    openShareLink(forgedPayload);
    const first = renderResults();

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Scan this URL" }),
      );
    });

    expect(
      await screen.findByText("Scan request failed with status 503."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Unverified snapshot" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan this URL" })).toBeNull();
    expect(
      (screen.getByLabelText("URL to analyze") as HTMLInputElement).value,
    ).toBe(phishingUrl);
    expect(new URLSearchParams(window.location.search).has("shared")).toBe(
      true,
    );

    first.unmount();
    renderResults();
    expect(
      await screen.findByRole("region", { name: "Unverified snapshot" }),
    ).toBeTruthy();
  });

  it("keep the snapshot hidden when a scan of another URL fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failedScanResponse()),
    );
    openShareLink(forgedPayload);
    renderResults();
    await screen.findByRole("region", { name: "Unverified snapshot" });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("URL to analyze"), {
        target: { value: "https://other.scrutinix.test/" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Analyze URL" }));
    });

    expect(
      await screen.findByText("Scan request failed with status 503."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Unverified snapshot" }),
    ).toBeNull();
  });

  it("share a fresh result as a link that opens unverified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => scanResponse(phishingUrl)),
    );
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    openShareLink(forgedPayload);
    renderResults();

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Scan this URL" }),
      );
    });
    await screen.findByLabelText("Scan result: malicious");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const link = new URL(writeText.mock.calls[0]?.[0] ?? "");
    expect(decodeSharedSnapshot(link.searchParams.get("shared") ?? "")).toEqual(
      {
        verdict: "malicious",
        url: phishingUrl,
        summary: "Malicious risk based on phishing signals.",
        capturedAt: "2026-10-10T12:00:01.000Z",
      },
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Link copied to clipboard",
      expect.objectContaining({
        description: expect.stringMatching(/unverified snapshot/i),
      }),
    );
  });

  it("show nothing for a snapshot whose URL a scan could not check", async () => {
    openShareLink(
      encodePayload({
        verdict: "safe",
        url: "Verified safe by the Scrutinix security team",
        summary: "",
        capturedAt: "2026-03-21T00:00:00.000Z",
      }),
    );

    renderResults();

    await act(async () => {});
    expect(
      screen.queryByRole("region", { name: "Unverified snapshot" }),
    ).toBeNull();
    expect(screen.queryByText(/Verified safe/)).toBeNull();
  });

  it("hydrate without a server/client mismatch", async () => {
    const tree = (
      <AnalyzerRuntimeProvider>
        <ResultsSection />
      </AnalyzerRuntimeProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);
    openShareLink(forgedPayload);

    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(
      within(container).getByRole("region", { name: "Unverified snapshot" }),
    ).toBeTruthy();

    act(() => root?.unmount());
    container.remove();
  });
});
