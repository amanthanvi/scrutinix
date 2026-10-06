import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalyzerRuntimeProvider,
  useAnalyzerRuntime,
} from "@/components/scrutinix/analyzer-runtime";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";
import { VERDICT_HEADING_ID } from "@/components/scrutinix/verdict-panel";
import { sanitizeHistoryEntry } from "@/lib/domain/runtime-safety";
import { encodeSharedSnapshot } from "@/lib/domain/signal-signature";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import { resetEnvForTests } from "@/lib/config/env";
import type { SharedView } from "@/lib/domain/signal-signature";
import { resolveSharedView } from "@/lib/server/share-metadata";
import { signSharePayload } from "@/lib/server/share-signing";
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

const TEST_SHARE_SECRET = "dom-test-share-secret-0123456789abcdef";

/**
 * What `app/page.tsx` hands the runtime for a `?shared=` link, resolved by
 * the real server code: signed (verified) by default, or as it arrives
 * without a valid signature.
 */
function withTestSecret<T>(run: () => T): T {
  vi.stubEnv("SHARE_SIGNING_SECRET", TEST_SHARE_SECRET);
  resetEnvForTests();
  try {
    return run();
  } finally {
    vi.unstubAllEnvs();
    resetEnvForTests();
  }
}

/** The request time shared links are judged against (3h after capture). */
const SHARE_NOW = Date.parse("2026-10-06T12:00:00.000Z");

function sharedViewFor(
  payload: string,
  { signed = true, now = SHARE_NOW }: { signed?: boolean; now?: number } = {},
): SharedView | null {
  return withTestSecret(() =>
    resolveSharedView(payload, signed ? signSharePayload(payload) : null, now),
  );
}

function renderApp(
  extra?: React.ReactNode,
  shared?: { payload: string; signed?: boolean; now?: number },
) {
  return render(
    <AnalyzerRuntimeProvider
      shared={
        shared
          ? sharedViewFor(shared.payload, {
              signed: shared.signed,
              now: shared.now,
            })
          : null
      }
    >
      <ScanForm />
      <ResultsSection />
      {extra}
    </AnalyzerRuntimeProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const lookalikeShare = encodeSharedSnapshot({
  verdict: "safe",
  url: "https://paypal.com.secure-login.xyz/verify",
  summary: "No check flagged this link.",
  capturedAt: "2026-10-06T09:00:00.000Z",
  signature: Array(8).fill("clear"),
});

// First in the file on purpose: the Public Suffix List parser is cached at
// module level once any test loads it, which would hide the server path.
describe("shared snapshot first paint", () => {
  it("hedges a shared look-alike from the first render, before the parser loads", () => {
    renderApp(undefined, { payload: lookalikeShare });
    expect(document.querySelector("#sx-link-anatomy")?.textContent).toBe(
      "https://paypal.com.secure-login.xyz/verify",
    );

    // Synchronous: no waiting on the lazily loaded parser.
    const band = screen.getByLabelText(/^scan result: safe$/i);
    expect(
      within(band).getByText("Don't sign in or enter details here."),
    ).toBeTruthy();
    expect(band.getAttribute("style")).toContain("var(--sx-unknown-surface)");
    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === "P" &&
          /This link belongs to secure-login\.xyz, not paypal\.com\./.test(
            node.textContent ?? "",
          ),
      ),
    ).toBeTruthy();
  });

  it("names the impersonated brand in one visible sentence", () => {
    renderApp(undefined, { payload: lookalikeShare });
    // Visible prose outside the anatomy breakdown (the link itself) and
    // outside screen-reader-only text.
    const sentences = Array.from(
      document.querySelectorAll("p, li, dd, h2, h3"),
    ).filter(
      (node) =>
        node.id !== "sx-link-anatomy" &&
        !node.closest(".sr-only, [aria-live]") &&
        /paypal\.com/.test(node.textContent ?? ""),
    );
    expect(sentences).toHaveLength(1);
    expect(sentences[0]?.textContent).toBe(
      "This link belongs to secure-login.xyz, not paypal.com.",
    );
  });
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
      ["malicious.scrutinix.test", "engines flagged", /engines flagged/g],
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

  it("names each strip cell by its finding and reveals its row", async () => {
    const signals = buildSignals(7);
    signals.dns = cleanSignals().dns;
    renderApp(
      <OpenStored
        result={resultFrom("strip", signals, "https://evil.example/")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));

    const strip = await screen.findByRole("toolbar", { name: "Checks" });
    const cells = within(strip).getAllByRole("button");
    expect(cells).toHaveLength(8);
    expect(cells[0]?.getAttribute("aria-label")).toBe(
      "VirusTotal: 7 engines flagged this link as malicious.",
    );
    // One cell in the tab order; arrows move between them.
    expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
    cells[0]?.focus();
    fireEvent.keyDown(cells[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cells[1]);
    fireEvent.keyDown(cells[1]!, { key: "End" });
    expect(document.activeElement).toBe(cells[7]);

    // DNS is hidden on Summary: its cell switches to Full, opens the row,
    // and focuses it.
    expect(screen.queryByLabelText(/^DNS Profile signal:/)).toBeNull();
    const dnsCell = cells.find(
      (cell) => cell.dataset.signal === "dns",
    ) as HTMLElement;
    fireEvent.click(dnsCell);
    await waitFor(() => {
      const row = screen.getByLabelText(/^DNS Profile signal:/);
      expect(document.activeElement).toBe(row);
      expect(row.closest("details")?.open).toBe(true);
    });
    expect(
      screen
        .getByRole("switch", { name: /^Summary Full/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("keeps keyboard focus on the band through a Re-scan", async () => {
    const stored = buildResult("stored-rescan", 7);
    const fresh = buildResult("fresh-rescan", 7);
    const stream: {
      controller?: ReadableStreamDefaultController<Uint8Array>;
    } = {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.controller = controller;
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
    renderApp(<OpenStored result={stored} />);
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));

    const rescan = await screen.findByRole("button", { name: "Re-scan" });
    rescan.focus();
    await act(async () => {
      fireEvent.click(rescan);
    });

    // The button is gone; focus is parked on the band, not <body>.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Re-scan" })).toBeNull();
      expect(document.activeElement?.id).toBe(VERDICT_HEADING_ID);
      expect(document.activeElement?.textContent).toBe("Checking");
    });

    await act(async () => {
      stream.controller?.enqueue(new TextEncoder().encode(scanNdjson(fresh)));
      stream.controller?.close();
    });
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(VERDICT_HEADING_ID);
      expect(document.activeElement?.textContent).toBe("malicious");
    });
  });
});

/** A held-open scan stream the test can finish later. */
function stubHeldStream() {
  const stream: {
    controller?: ReadableStreamDefaultController<Uint8Array>;
  } = {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream.controller = controller;
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
  return stream;
}

describe("shared links and their signature", () => {
  const maliciousShare = encodeSharedSnapshot({
    verdict: "malicious",
    url: "https://example.com/login",
    summary: "Google Safe Browsing lists this link as phishing.",
    capturedAt: "2026-10-06T09:00:00.000Z",
    signature: Array(8).fill("malicious"),
  });
  // What an attacker would forge: a reassuring verdict for a look-alike.
  const forgedSafe = encodeSharedSnapshot({
    verdict: "safe",
    url: "https://paypal.com.secure-login.xyz/verify",
    summary: "Scrutinix checked this link and it is safe.",
    capturedAt: "2026-10-06T09:00:00.000Z",
    signature: Array(8).fill("clear"),
  });

  it("states a signed snapshot's verdict, summary, strip, and verification", () => {
    renderApp(undefined, { payload: maliciousShare });
    const band = screen.getByLabelText(/^scan result: malicious$/i);
    expect(within(band).getByRole("heading").textContent).toBe("malicious");
    expect(band.getAttribute("style")).toContain("var(--sx-malicious-surface)");
    expect(
      within(band).getByText(
        "Google Safe Browsing lists this link as phishing.",
      ),
    ).toBeTruthy();
    expect(band.textContent).toMatch(
      /Verified Scrutinix result · checked Oct 6, 2026, 09:00 AM UTC\. It may be out of date\./,
    );
    expect(
      within(screen.getByRole("list", { name: "Checks" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(8);
    expect(
      within(band).getByRole("button", { name: "Run a fresh scan" }),
    ).toBeTruthy();
  });

  it("shows nothing an unsigned payload claims", () => {
    renderApp(undefined, { payload: forgedSafe, signed: false });

    const band = screen.getByLabelText("Shared link, not verified");
    expect(within(band).getByRole("heading").textContent).toBe(
      "Check this shared link yourself",
    );
    expect(
      within(band).getByText(
        "We can't confirm the result in this link came from Scrutinix. It may be old or edited, so we're not showing it.",
      ),
    ).toBeTruthy();
    // The viewer saw no earlier scan, so nothing is "fresh".
    expect(
      within(band).getByRole("button", { name: "Scan this link" }),
    ).toBeTruthy();
    expect(
      within(band).queryByRole("button", { name: "Run a fresh scan" }),
    ).toBeNull();
    // Neutral surface, no verdict word, score, summary, or strip.
    expect(band.getAttribute("style")).toContain("var(--sx-pending-surface)");
    expect(band.textContent).not.toMatch(/safe|malicious|verified scrutinix/i);
    expect(screen.queryByLabelText(/^scan result/i)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText(/checked this link and it is safe/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Checks" })).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();

    // The link's anatomy is Scrutinix's own computation, so it stays.
    expect(document.querySelector("#sx-link-anatomy")?.textContent).toBe(
      "https://paypal.com.secure-login.xyz/verify",
    );
    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === "P" &&
          /This link belongs to secure-login\.xyz, not paypal\.com\./.test(
            node.textContent ?? "",
          ),
      ),
    ).toBeTruthy();
  });

  it("treats a payload edited after signing as unverified", () => {
    // A real signature, carried over to a different payload.
    const view = withTestSecret(() =>
      resolveSharedView(
        forgedSafe,
        signSharePayload(maliciousShare),
        SHARE_NOW,
      ),
    );
    expect(view?.snapshot).toBeNull();

    render(
      <AnalyzerRuntimeProvider shared={view}>
        <ResultsSection />
      </AnalyzerRuntimeProvider>,
    );
    expect(screen.getByLabelText("Shared link, not verified")).toBeTruthy();
    expect(screen.queryByLabelText(/^scan result/i)).toBeNull();
  });

  it("shows nothing from a signed result older than three days, and says why", () => {
    // The attack: a genuine signed verdict, captured while the link was
    // benign, reshared after it turned. 72 hours and a minute later.
    renderApp(undefined, {
      payload: forgedSafe,
      now: Date.parse("2026-10-09T09:01:00.000Z"),
    });

    const band = screen.getByLabelText("Shared result, expired");
    expect(within(band).getByRole("heading").textContent).toBe(
      "Check this shared link yourself",
    );
    expect(
      within(band).getByText(
        "This shared result is more than 3 days old, so we're not showing it.",
      ),
    ).toBeTruthy();
    expect(
      within(band).getByRole("button", { name: "Scan this link" }),
    ).toBeTruthy();
    expect(band.getAttribute("style")).toContain("var(--sx-pending-surface)");
    expect(band.textContent).not.toMatch(/safe|malicious|verified scrutinix/i);
    expect(screen.queryByLabelText(/^scan result/i)).toBeNull();
    expect(screen.queryByText(/checked this link and it is safe/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Checks" })).toBeNull();
    expect(screen.queryByText("Shared link, not verified")).toBeNull();
  });

  it("still shows a signed result just inside three days", () => {
    renderApp(undefined, {
      payload: maliciousShare,
      now: Date.parse("2026-10-09T09:00:00.000Z"),
    });
    expect(screen.getByLabelText(/^scan result: malicious$/i)).toBeTruthy();
  });
});

describe("ResultsSection focus and states", () => {
  it("keeps focus on the band when a shared snapshot's fresh scan starts", async () => {
    const stream = stubHeldStream();
    const fresh = buildResult(
      "fresh-shared",
      7,
      "https://paypal.com.secure-login.xyz/verify",
    );
    renderApp(undefined, { payload: lookalikeShare });

    const run = screen.getByRole("button", { name: "Run a fresh scan" });
    run.focus();
    await act(async () => {
      fireEvent.click(run);
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Run a fresh scan" }),
      ).toBeNull();
      expect(document.activeElement?.id).toBe(VERDICT_HEADING_ID);
      expect(document.activeElement?.textContent).toBe("Checking");
    });

    await act(async () => {
      stream.controller?.enqueue(new TextEncoder().encode(scanNdjson(fresh)));
      stream.controller?.close();
    });
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(VERDICT_HEADING_ID);
      expect(document.activeElement?.textContent).toBe("malicious");
    });
  });

  it("hands focus to the link field when a scan is cancelled", async () => {
    stubHeldStream();
    renderApp();
    fireEvent.change(screen.getByRole("textbox", { name: "URL to analyze" }), {
      target: { value: "slow.example" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Analyze URL" }));
    });

    const cancel = await screen.findByRole("button", { name: "Cancel scan" });
    cancel.focus();
    await act(async () => {
      fireEvent.click(cancel);
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Cancel scan" })).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "URL to analyze" }),
      );
    });
  });

  it("says plainly when a saved entry predates per-check results", async () => {
    const legacy = sanitizeHistoryEntry({
      id: "legacy-1",
      url: "https://old.example/",
      verdict: "safe",
      signals: {},
      metadata: { scanId: "legacy-1" },
      savedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(legacy).not.toBeNull();
    renderApp(<OpenStored result={legacy!} />);
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));

    expect(
      await screen.findByText(/saved before per-check results were kept/),
    ).toBeTruthy();
    // No strip claiming eight failed checks, and no rows.
    expect(screen.queryByRole("toolbar", { name: "Checks" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Signals" })).toBeNull();
  });

  it("draws eight failed cells for a real scan whose checks all failed", async () => {
    const signals = createPendingSignalResults();
    for (const name of signalNames) {
      signals[name] = {
        status: "error",
        data: null,
        error: "The provider timed out.",
        durationMs: 0,
      };
    }
    const failed = resultFrom("all-failed", signals, "https://down.example/");
    renderApp(<OpenStored result={failed} />);
    fireEvent.click(screen.getByRole("button", { name: "open stored" }));

    const strip = await screen.findByRole("toolbar", { name: "Checks" });
    expect(strip.querySelectorAll('[data-severity="error"]').length).toBe(8);
    expect(screen.queryByText(/saved before per-check results/)).toBeNull();
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
