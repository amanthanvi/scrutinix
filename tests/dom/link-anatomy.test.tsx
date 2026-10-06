import { render, screen, waitFor } from "@testing-library/react";
import { parse } from "tldts";
import { describe, expect, it, vi } from "vitest";

import { BatchTable } from "@/components/scrutinix/batch-table";
import { HistoryPanel } from "@/components/scrutinix/history-panel";
import { LinkAnatomyView } from "@/components/scrutinix/link-anatomy";
import { splitLinkAnatomy } from "@/lib/domain/link-anatomy";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import type { AnalysisResult, HistoryEntry } from "@/lib/domain/types";
import { fixtureSignals } from "@/tests/fixtures/scenario-signals";

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
});
