import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalyzerRuntimeProvider,
  useAnalyzerRuntime,
} from "@/components/scrutinix/analyzer-runtime";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";
import { VERDICT_HEADING_ID } from "@/components/scrutinix/verdict-panel";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
  type SignalResults,
} from "@/lib/domain/types";
import { cleanSignals } from "@/tests/fixtures/lure-signals";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

/** Eight finished checks; VirusTotal convicts when `malicious` is set. */
function buildSignals(malicious: number): SignalResults {
  const signals = createPendingSignalResults();
  for (const name of signalNames) {
    signals[name] = {
      status: "skipped",
      data: null,
      error: "Not applicable in this test.",
      durationMs: 1,
    };
  }
  signals.virusTotal = {
    status: "success",
    error: null,
    durationMs: 20,
    data: {
      malicious,
      suspicious: 0,
      harmless: 40,
      undetected: 20,
      timeout: 0,
      results: [],
      permalink: "https://www.virustotal.com/gui/url/x",
    },
  };
  signals.googleSafeBrowsing = {
    status: "success",
    error: null,
    durationMs: 8,
    data: { checkedAt: "", matches: [] },
  };
  return signals;
}

function buildResult(
  id: string,
  malicious: number,
  url = "https://evil.example/",
): AnalysisResult {
  return resultFrom(id, buildSignals(malicious), url);
}

function resultFrom(
  id: string,
  signals: SignalResults,
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
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

function scanNdjson(result: AnalysisResult) {
  return `${[
    {
      type: "scan_started",
      scanId: result.id,
      url: result.url,
      cached: false,
      startedAt: "2026-10-06T00:00:00.000Z",
    },
    { type: "scan_complete", result },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n")}\n`;
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
    <AnalyzerRuntimeProvider>
      <ScanForm />
      <ResultsSection />
      {extra}
    </AnalyzerRuntimeProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ResultsSection", () => {
  it("explains an empty submit instead of a dead, disabled button", async () => {
    renderApp();

    const analyze = screen.getByRole("button", { name: "Analyze URL" });
    expect(analyze.hasAttribute("disabled")).toBe(false);
    fireEvent.click(analyze);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Paste a link to check.",
    );
  });

  it("announces the verdict and shows only the signals that drove it", async () => {
    const result = buildResult("scan-1", 7);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(scanNdjson(result), {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          }),
      ),
    );
    renderApp();

    fireEvent.change(screen.getByRole("textbox", { name: "URL to analyze" }), {
      target: { value: "evil.example" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Analyze URL" }));
    });

    await waitFor(() => {
      expect(document.querySelector("[aria-live='polite']")?.textContent).toBe(
        `Result for evil.example: Malicious, ${result.threatInfo?.score} out of 100. Don't open this link.`,
      );
    });

    // Summary: VirusTotal drove the verdict; nothing else gets a row.
    expect(
      screen.getByLabelText(/^VirusTotal signal: /).getAttribute("aria-label"),
    ).toBe("VirusTotal signal: 7 engines flagged this link as malicious.");
    expect(screen.queryByLabelText(/^Google Safe Browsing signal:/)).toBeNull();
    const quiet = screen.getByRole("button", {
      name: /1 other check found nothing and 6 couldn't give a full answer\. Show all checks/,
    });

    // The switch's name contains its visible labels (WCAG 2.5.3).
    const viewSwitch = screen.getByRole("switch", { name: /^Summary Full/ });
    expect(viewSwitch.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(quiet);
    expect(viewSwitch.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText(/^Google Safe Browsing signal:/)).toBeTruthy();
    // The button that revealed the rows is gone. None of the newly
    // revealed rows can expand here, so focus lands on the list - not
    // <body>, and not the VirusTotal row Summary already showed.
    const signalsList = screen.getByRole("list", { name: "Signals" });
    await waitFor(() => {
      expect(document.activeElement).toBe(signalsList);
    });

    // Result actions follow the evidence and say what they export.
    const download = screen.getByRole("button", {
      name: "Download result (JSON)",
    });
    const list = screen.getByRole("list", { name: "Signals" });
    expect(
      list.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // With a result on screen, Analyze steps back until the input changes.
    const analyze = screen.getByRole("button", { name: "Analyze URL" });
    expect(analyze.getAttribute("data-variant")).toBe("outline");
    fireEvent.change(screen.getByRole("textbox", { name: "URL to analyze" }), {
      target: { value: "other.example" },
    });
    expect(analyze.getAttribute("data-variant")).toBe("primary");
  });

  it("focuses the first newly revealed check after Show all checks", async () => {
    const signals = buildSignals(7);
    // Expandable rows: VirusTotal (a driver) and DNS (newly revealed).
    if (signals.virusTotal.data) {
      signals.virusTotal.data.lastAnalysisDate = new Date().toISOString();
    }
    signals.dns = cleanSignals().dns;
    renderApp(
      <OpenStored
        result={resultFrom("revealed", signals, "https://evil.example/")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));

    // Summary already shows VirusTotal, the first expandable row in Full.
    const virusTotal = await screen.findByLabelText(/^VirusTotal signal:/);
    expect(virusTotal.tagName).toBe("SUMMARY");
    expect(screen.queryByLabelText(/^DNS Profile signal:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show all checks/ }));

    await waitFor(() => {
      const row = (
        document.activeElement as HTMLElement | null
      )?.closest<HTMLElement>("li[data-signal]");
      expect(row?.dataset.signal).toBe("dns");
      expect(document.activeElement?.tagName).toBe("SUMMARY");
      expect(document.activeElement?.getAttribute("aria-label")).toMatch(
        /^DNS Profile signal:/,
      );
    });
  });

  it("moves focus to the verdict when a stored result opens", async () => {
    const stored = buildResult("stored-1", 0);
    renderApp(<OpenStored result={stored} />);

    fireEvent.click(screen.getByRole("button", { name: "open stored" }));

    await waitFor(() => {
      expect(document.activeElement?.id).toBe(VERDICT_HEADING_ID);
    });
    await waitFor(() => {
      expect(
        document.querySelector("[aria-live='polite']")?.textContent,
      ).toMatch(/^Result for evil\.example: Safe/);
    });
  });

  it("announces an opened saved verdict even while a scan is streaming", async () => {
    const stream: {
      controller?: ReadableStreamDefaultController<Uint8Array>;
    } = {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.controller = controller;
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({
              type: "scan_started",
              scanId: "live",
              url: "https://live.example/",
              cached: false,
              startedAt: "2026-10-06T00:00:00.000Z",
            })}\n`,
          ),
        );
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          }),
      ),
    );
    const { unmount } = renderApp(
      <OpenStored result={buildResult("stored-1", 0)} />,
    );
    const region = document.querySelector("[aria-live='polite']")!;

    try {
      fireEvent.change(
        screen.getByRole("textbox", { name: "URL to analyze" }),
        { target: { value: "live.example" } },
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Analyze URL" }));
      });
      await waitFor(() => {
        expect(region.textContent).toBe("0 of 8 checks finished.");
      });

      fireEvent.click(screen.getByRole("button", { name: "open stored" }));

      await waitFor(() => {
        expect(region.textContent).toMatch(/^Result for evil\.example: Safe/);
      });
      expect(region.textContent).not.toMatch(/checks finished/);
    } finally {
      unmount();
      try {
        stream.controller?.close();
      } catch {
        // Already cancelled by the unmount.
      }
    }
  });

  it("re-announces every opened result, even one that reads the same", async () => {
    const first = buildResult("stored-a", 0, "https://one.example/");
    const second = buildResult("stored-b", 0, "https://two.example/");

    function OpenBoth() {
      const { openStoredResult } = useAnalyzerRuntime();
      return (
        <>
          <button type="button" onClick={() => openStoredResult(first)}>
            open first
          </button>
          <button type="button" onClick={() => openStoredResult(second)}>
            open second
          </button>
        </>
      );
    }
    renderApp(<OpenBoth />);
    const region = document.querySelector("[aria-live='polite']")!;
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      seen.push(region.textContent ?? "");
    });
    observer.observe(region, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    const announce = (host: string) =>
      `Result for ${host}: Safe, ${first.threatInfo?.score} out of 100. ${
        first.threatInfo?.confidenceLabel === "high"
          ? "Looks safe to open."
          : "Probably safe — still check who sent it."
      }`;

    for (const [button, host] of [
      ["open first", "one.example"],
      ["open second", "two.example"],
      ["open second", "two.example"],
    ] as const) {
      seen.length = 0;
      fireEvent.click(screen.getByRole("button", { name: button }));
      await waitFor(() => {
        expect(region.textContent).toBe(announce(host));
        // Blanked, then refilled: a real change even for identical text.
        // (The first open starts from an empty region already.)
        if (button !== "open first") expect(seen).toContain("");
      });
    }
    observer.disconnect();
  });

  it("states the clean Safe result once", async () => {
    const result = resultFrom(
      "clean",
      await fixtureSignals("example.com"),
      "https://example.com/",
    );
    renderApp(<OpenStored result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));

    expect(await screen.findByText("Looks safe to open.")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /^All 8 checks found nothing\. Show all checks/,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("No check flagged this link.")).toBeNull();
  });

  it("states each driving fact once on the default Summary view", async () => {
    for (const [host, fact, pattern] of [
      ["malicious.scrutinix.test", "VirusTotal engines", /VirusTotal engines/g],
      ["feed-hit.scrutinix.test", "lists this link", /lists this link/g],
    ] as const) {
      const result = resultFrom(
        host,
        await fixtureSignals(host),
        `https://${host}/`,
      );
      const { unmount, container } = renderApp(<OpenStored result={result} />);
      fireEvent.click(screen.getByRole("button", { name: "open stored" }));
      await screen.findByRole("heading", { level: 2, name: "malicious" });

      const visible = visibleText(container);
      expect(visible.match(pattern)?.length, `${host}: ${fact}`).toBe(1);
      unmount();
    }
  });
});

/** Text a sighted user sees: closed <details> show only their <summary>. */
function visibleText(root: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.classList.contains("sr-only")) return;
    if (node.tagName === "DETAILS" && !(node as HTMLDetailsElement).open) {
      const summary = node.querySelector(":scope > summary");
      if (summary) walk(summary);
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(root);
  return parts.join(" ");
}
