import { render, screen, waitFor } from "@testing-library/react";
import { parse } from "tldts";
import { describe, expect, it, vi } from "vitest";

import { BatchTable } from "@/components/scrutinix/batch-table";
import { HistoryPanel } from "@/components/scrutinix/history-panel";
import {
  LinkAnatomyView,
  spokenLink,
} from "@/components/scrutinix/link-anatomy";
import { splitLinkAnatomy } from "@/lib/domain/link-anatomy";
import { createPendingSignalResults, signalNames } from "@/lib/domain/types";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import type { AnalysisResult, HistoryEntry } from "@/lib/domain/types";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";
import { spokenText } from "@/tests/dom/helpers/speech";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const LOOKALIKE = "https://paypal.com.secure-login.xyz/verify";

async function resultFor(url: string, host: string): Promise<AnalysisResult> {
  const signals = await fixtureSignals(host);
  const { verdict, threatInfo } = buildThreatAssessment(signals);
  return {
    id: `scan-${host}`,
    url,
    verdict,
    signals,
    threatInfo,
    metadata: {
      scanId: `scan-${host}`,
      startedAt: "2026-10-06T09:00:00.000Z",
      completedAt: "2026-10-06T09:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

/** The owner renders as its own element, never inside the truncating part. */
async function expectOwnerIsolated() {
  await waitFor(() =>
    expect(document.querySelector('[data-part="owner"]')).not.toBeNull(),
  );
  const owner = document.querySelector('[data-part="owner"]');
  expect(owner?.textContent).toBe("secure-login.xyz");
  expect(owner?.className).toContain("font-semibold");
  expect(owner?.className).not.toContain("truncate");
  const subdomain = document.querySelector('[data-part="subdomain"]');
  expect(subdomain?.textContent).toBe("paypal.com.");
  expect(subdomain?.contains(owner ?? null)).toBe(false);
  expect(subdomain?.textContent).not.toContain("secure-login.xyz");
  // The row says its link once, as one string: the drawn parts are hidden
  // on themselves, not only by the `display: contents` wrapper that WebKit
  // ignores (Safari read "…not paypal.com paypal.com.secure-login.xyz
  // /verify"). The spoken string names the owner twice; a drawn part
  // would add a third.
  const row = owner?.closest("li");
  if (!row) throw new Error("no row");
  expect(spokenText(row).match(/secure-login\.xyz/g)).toHaveLength(2);
}

describe("compact link anatomy in result rows", () => {
  it("keeps a look-alike's owner whole in a history row", async () => {
    const entry: HistoryEntry = {
      ...(await resultFor(LOOKALIKE, "example.com")),
      savedAt: "2026-10-06T09:00:02.000Z",
    };
    render(
      <HistoryPanel
        entries={[entry]}
        totalCount={1}
        historyQuery=""
        onHistoryQueryChange={() => {}}
        onSelect={() => {}}
        onClear={() => {}}
        canUndoClear={false}
        onUndoClear={() => {}}
      />,
    );
    await expectOwnerIsolated();
    // One accessible string, not flex parts read as separate words.
    expect(
      screen.getByRole("button", {
        name: /paypal\.com\.secure-login\.xyz\/verify, belongs to secure-login\.xyz, not paypal\.com/,
      }),
    ).toBeTruthy();
  });

  it("speaks a long link briefly, then when it was checked", async () => {
    const long = `https://paypal.com.secure-login.xyz/verify${"/".repeat(1_500)}step`;
    const entry: HistoryEntry = {
      ...(await resultFor(long, "example.com")),
      savedAt: new Date().toISOString(),
    };
    const { container } = render(
      <HistoryPanel
        entries={[entry]}
        totalCount={1}
        historyQuery=""
        onHistoryQueryChange={() => {}}
        onSelect={() => {}}
        onClear={() => {}}
        canUndoClear={false}
        onUndoClear={() => {}}
      />,
    );
    await expectOwnerIsolated();
    // The host and the path's first 40 characters, a run of slashes in
    // them said once, then how much is left, instead of eleven seconds of
    // slashes; the time set off from the site it follows.
    const shown = "paypal.com.secure-login.xyz/verify/";
    const left = long.length - "https://".length - shown.length - 32;
    const row = screen.getByRole("button", {
      name: new RegExp(
        `^Look-alike\\s*${shown.replaceAll(".", "\\.")}, and ${left} more characters, belongs to secure-login\\.xyz, not paypal\\.com\\s*, scanned \\d{2}:\\d{2}$`,
      ),
    });
    expect(row).toBeTruthy();
    // Safari's name for it is the same string, the drawn link left out.
    expect(spokenText(row)).toMatch(
      new RegExp(
        `^Look-alike${shown.replaceAll(".", "\\.")}, and ${left} more characters, belongs to secure-login\\.xyz, not paypal\\.com, scanned \\d{2}:\\d{2}$`,
      ),
    );
    // The heading has one name, its count spelled out.
    expect(
      screen.getByRole("heading", { level: 2 }).getAttribute("aria-label"),
    ).toBe("History (1 scan)");
    // The full link stays on hover, never in what is spoken.
    const titled = container.querySelector("[title]");
    expect(titled?.getAttribute("title")).toBe(long);
    expect(titled?.closest("[aria-hidden='true']")).toBe(titled);
  });

  it("speaks a link of ordinary length whole", () => {
    expect(spokenLink("example.com/account/settings")).toBe(
      "example.com/account/settings",
    );
    // Exactly as written, runs and all, while it is short.
    expect(spokenLink("example.com/a----b////c")).toBe(
      "example.com/a----b////c",
    );
    // A long one says a run of one symbol once ("/", not 33 slashes), and
    // never touches the host or letters and digits.
    expect(spokenLink(`a--b.example.com/x${"-".repeat(60)}0000`)).toBe(
      "a--b.example.com/x-, and 26 more characters",
    );
    expect(spokenLink(`example.com/${"ab".repeat(30)}`)).toBe(
      `example.com/${"ab".repeat(19)}a, and 21 more characters`,
    );
    expect(spokenLink(`example.com/a/${"..".repeat(30)}`)).toBe(
      "example.com/a/., and 23 more characters",
    );
    const fortyEight = `example.com/${"a".repeat(47)}`;
    expect(spokenLink(fortyEight)).toBe(fortyEight);
    expect(spokenLink(`${fortyEight}b`)).toBe(
      `example.com/${"a".repeat(39)}, and 9 more characters`,
    );
  });

  it("keeps a look-alike's owner whole in a batch row", async () => {
    const result = await resultFor(LOOKALIKE, "example.com");
    render(
      <BatchTable
        items={[{ index: 0, url: LOOKALIKE, status: "complete", result }]}
        isStreaming={false}
        results={[result]}
        onSelectResult={() => {}}
      />,
    );
    await expectOwnerIsolated();
  });
});

describe("LinkAnatomyView facts", () => {
  it("says an unreachable https link's certificate couldn't be checked", async () => {
    const url = "https://unreachable.scrutinix.test/";
    const signals = await fixtureSignals("unreachable.scrutinix.test");
    render(
      <LinkAnatomyView
        url={url}
        anatomy={splitLinkAnatomy(parse, url)}
        signals={signals}
      />,
    );
    expect(screen.getAllByText("https://").length).toBeGreaterThan(0);
    expect(screen.getByText("Couldn't check the certificate")).toBeTruthy();
    expect(screen.queryByText("No secure connection")).toBeNull();
  });

  it("holds no fact slot for evidence on screen, so nothing under the band collapses when a verdict lands", async () => {
    const url = "https://unreachable.scrutinix.test/";
    const anatomy = splitLinkAnatomy(parse, url);
    const { container, rerender } = render(
      <LinkAnatomyView
        url={url}
        anatomy={anatomy}
        signals={createPendingSignalResults()}
        visibleSignals={signalNames}
        streaming
      />,
    );
    expect(container.querySelector("dl")).toBeNull();

    rerender(
      <LinkAnatomyView
        url={url}
        anatomy={anatomy}
        signals={await fixtureSignals("unreachable.scrutinix.test")}
        visibleSignals={signalNames}
      />,
    );
    expect(container.querySelector("dl")).toBeNull();
  });

  it("holds a slot, reading Checking…, for a fact no evidence on screen states", () => {
    const url = "https://unreachable.scrutinix.test/";
    render(
      <LinkAnatomyView
        url={url}
        anatomy={splitLinkAnatomy(parse, url)}
        signals={createPendingSignalResults()}
        streaming
      />,
    );
    expect(screen.getAllByText("Checking…").length).toBeGreaterThan(0);
  });
});

describe("LinkAnatomyView captions", () => {
  const captioned = (url: string) =>
    render(
      <LinkAnatomyView url={url} anatomy={splitLinkAnatomy(parse, url)} />,
    ).container.querySelector("#sx-link-anatomy");

  it("brackets each part inline when every part can carry its caption", () => {
    const line = captioned("https://paypal.com.secure-login.xyz/verify");
    expect(line?.classList.contains("sx-anat")).toBe(true);
    expect(line?.classList.contains("sx-anat-stacked")).toBe(false);
  });

  it("stacks the parts when a middle one is too short for its caption", () => {
    // "a." would carry "A label anyone can add" a word per line.
    expect(
      captioned("https://a.example.com/x")?.classList.contains(
        "sx-anat-stacked",
      ),
    ).toBe(true);
    // A short last part may run its caption past its text.
    expect(
      captioned("https://www.example.com/x")?.classList.contains(
        "sx-anat-stacked",
      ),
    ).toBe(false);
  });
});

vi.mock("@/components/ui/lazy-toaster", () => ({
  getToast: async () => (await import("sonner")).toast,
}));
