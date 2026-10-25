import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { HistorySection } from "@/components/scrutinix/history-section";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { resetHistoryDatabaseForTests } from "@/hooks/use-scan-history";
import { buildThreatAssessment } from "@/lib/domain/verdict";
import {
  cleanSignals,
  withDomainAge,
  withLureRedirect,
} from "@/tests/fixtures/lure-signals";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

beforeEach(async () => {
  await resetHistoryDatabaseForTests();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("scrutinix-v2");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

/** Writes a Suspicious result the way history stored it before scoredSignals. */
async function seedLegacySuspiciousEntry() {
  const signals = cleanSignals();
  withLureRedirect(signals, { hiddenIframe: true });
  withDomainAge(signals, 100);
  const { verdict, threatInfo } = buildThreatAssessment(signals);
  expect(verdict).toBe("suspicious");
  const legacyThreatInfo: Record<string, unknown> = { ...threatInfo };
  delete legacyThreatInfo.scoredSignals;

  const db = await openDB("scrutinix-v2", 1, {
    upgrade(database) {
      const store = database.createObjectStore("scans", { keyPath: "id" });
      store.createIndex("by-saved-at", "savedAt");
    },
  });
  await db.put("scans", {
    id: "legacy",
    url: "https://short.example/a",
    verdict,
    signals,
    threatInfo: legacyThreatInfo,
    metadata: {
      scanId: "legacy",
      startedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-01T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
    savedAt: "2026-09-01T00:00:01.000Z",
  });
  db.close();
}

describe("history saved before scoredSignals", () => {
  it("marks the checks that drove the verdict when reopened", async () => {
    await seedLegacySuspiciousEntry();
    render(
      <AnalyzerRuntimeProvider>
        <ResultsSection />
        <HistorySection />
      </AnalyzerRuntimeProvider>,
    );

    const entry = await screen.findByRole("button", {
      name: /suspicious.*short\.example/i,
    });
    fireEvent.click(entry);

    // The re-derived scored checks draw as warnings, never "found nothing",
    // and the questions state what they found.
    const strip = await screen.findByRole("toolbar", { name: "Checks" });
    await waitFor(() => {
      for (const name of ["redirectChain", "whois"]) {
        expect(
          strip
            .querySelector(`[data-signal="${name}"] [data-severity]`)
            ?.getAttribute("data-severity"),
        ).toBe("suspicious");
      }
    });
    const questions = screen.getByRole("list", { name: "Questions" });
    expect(questions.textContent).toContain(
      "Its domain was registered about 3 months ago.",
    );
    expect(questions.textContent).toContain("1 hidden frame");
  });
});

vi.mock("@/components/ui/lazy-toaster", () => ({
  getToast: async () => (await import("sonner")).toast,
}));
