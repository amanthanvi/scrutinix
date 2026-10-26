import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScanForm } from "@/components/scrutinix/scan-form";
import { getLinkParserStatus } from "@/hooks/use-link-anatomy";
import { downloadTextFile } from "@/lib/client/export";

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

vi.mock("@/components/scrutinix/analyzer-runtime", () => ({
  useAnalyzerRuntime: () => ({
    active: null,
    activeTab: "batch",
    batchInput: "",
    formError: null,
    inputEditedSinceResult: false,
    shared: null,
    singleUrl: "",
    scan: { state: { isStreaming: false, error: null }, cancelScan: vi.fn() },
    batch: {
      state: {
        results: [storedResult("safe", LOOK_ALIKE_URL)],
        isStreaming: false,
        error: null,
      },
      cancelBatch: vi.fn(),
    },
    setActiveTab: vi.fn(),
    setBatchInput: vi.fn(),
    setFormError: vi.fn(),
    startBatchScan: vi.fn(),
    startSingleScan: vi.fn(),
    updateSingleUrl: vi.fn(),
  }),
}));
function renderForm() {
  return render(<ScanForm />);
}

function exportedRow(): string {
  const csv = String(download.mock.calls.at(-1)?.[1] ?? "");
  return csv.replace(/^\uFEFF/, "").split("\r\n")[1] ?? "";
}

// In order: the parser is cached at module level once it loads.
describe("batch CSV export while the link parser settles", () => {
  it("says the look-alike column wasn't checked when the parser can't load", async () => {
    const { unmount } = renderForm();
    // Batch loads on demand: wait for its controls.
    fireEvent.click(
      await screen.findByRole("button", { name: "Export batch CSV" }),
    );

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
    const { unmount } = renderForm();
    // Batch loads on demand: wait for its controls.
    fireEvent.click(
      await screen.findByRole("button", { name: "Export batch CSV" }),
    );

    // Nothing is written while the address parser is still on its way.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(download).not.toHaveBeenCalled();

    parser.release();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]?.[0]).toBe("batch.csv");
    expect(exportedRow()).toContain('"safe","paypal.com"');
    unmount();
  });
});
