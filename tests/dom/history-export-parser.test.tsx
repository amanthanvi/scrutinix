import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HistoryPanel } from "@/components/scrutinix/history-panel";
import { getLinkParserStatus } from "@/hooks/use-link-anatomy";
import { downloadTextFile } from "@/lib/client/export";
import type { HistoryEntry } from "@/lib/domain/types";
import {
  LOOK_ALIKE_URL,
  storedResult,
} from "@/tests/dom/helpers/parser-states";

// The browser's lazy parser chunk (tldts and `lib/client/link-parser.ts`):
// it fails, or waits for the test to release it (a slow network or a cold
// chunk on a first visit).
const parser = vi.hoisted(() => {
  const state = {
    fail: true,
    gate: Promise.resolve(),
    release: () => {},
    hold() {
      state.gate = new Promise<void>((resolve) => {
        state.release = resolve;
      });
    },
  };
  return state;
});
vi.mock("@/lib/client/link-parser", async (importOriginal) => {
  await parser.gate;
  if (parser.fail) {
    throw new TypeError("Failed to fetch dynamically imported module");
  }
  return importOriginal();
});

vi.mock("@/lib/client/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/export")>()),
  downloadTextFile: vi.fn(),
}));

const download = vi.mocked(downloadTextFile);

function renderHistory() {
  const entries: HistoryEntry[] = [
    {
      ...storedResult("safe", LOOK_ALIKE_URL),
      savedAt: "2026-10-06T00:00:02.000Z",
    },
  ];
  return render(
    <HistoryPanel
      entries={entries}
      totalCount={entries.length}
      historyQuery=""
      onHistoryQueryChange={() => {}}
      onSelect={() => {}}
      onClear={() => {}}
      canUndoClear={false}
      onUndoClear={() => {}}
    />,
  );
}

function exportedRow(): string {
  const csv = String(download.mock.calls.at(-1)?.[1] ?? "");
  return csv.replace(/^\uFEFF/, "").split("\r\n")[1] ?? "";
}

// In order: the parser is cached at module level once it loads.
describe("history CSV export while the link parser settles", () => {
  it("says the look-alike column wasn't checked when the parser can't load", async () => {
    const { unmount } = renderHistory();
    fireEvent.click(screen.getByRole("button", { name: "Export history CSV" }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1), {
      timeout: 3_000,
    });
    expect(getLinkParserStatus()).toBe("failed");
    // A blank cell would read as "not a look-alike".
    expect(exportedRow()).toContain('"safe","Not checked"');
    unmount();
  });

  it("waits for a load in progress, so the export names the look-alike", async () => {
    download.mockClear();
    parser.fail = false;
    parser.hold();
    const { unmount } = renderHistory();
    fireEvent.click(screen.getByRole("button", { name: "Export history CSV" }));

    // Nothing is written while the address parser is still on its way.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(download).not.toHaveBeenCalled();

    parser.release();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]?.[0]).toBe("scan-history.csv");
    expect(exportedRow()).toContain('"safe","paypal.com"');
    unmount();
  });
});
