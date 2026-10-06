import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnalyzerRuntimeProvider,
  UNVERIFIED_SHARE_TITLE,
  useAnalyzerRuntime,
} from "@/components/scrutinix/analyzer-runtime";
import { encodeSharedSnapshot } from "@/lib/domain/signal-signature";
import {
  createPendingSignalResults,
  type AnalysisResult,
} from "@/lib/domain/types";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

const writeText = vi.fn<(text: string) => Promise<void>>();

const base: AnalysisResult = {
  id: "scan-1",
  url: "https://example.com/",
  verdict: "safe",
  signals: createPendingSignalResults(),
  threatInfo: null,
  metadata: {
    scanId: "scan-1",
    startedAt: "2026-10-06T00:00:00.000Z",
    completedAt: "2026-10-06T00:00:01.000Z",
    cacheHit: false,
    partialFailure: false,
    signalCount: 8,
    durationMs: 1_000,
  },
};

const payload = encodeSharedSnapshot({
  verdict: "safe",
  url: base.url,
  summary: "",
  capturedAt: base.metadata.completedAt,
});
const SIG = "A".repeat(43);

function Share({ result }: { result: AnalysisResult }) {
  const { shareResult } = useAnalyzerRuntime();
  return (
    <button type="button" onClick={() => void shareResult(result)}>
      share
    </button>
  );
}

async function share(result: AnalysisResult): Promise<URL> {
  render(
    <AnalyzerRuntimeProvider>
      <Share result={result} />
    </AnalyzerRuntimeProvider>,
  );
  await act(async () => {
    screen.getByRole("button", { name: "share" }).click();
  });
  expect(writeText).toHaveBeenCalledTimes(1);
  return new URL(writeText.mock.calls[0]![0]);
}

beforeEach(() => {
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareResult", () => {
  it("copies a signed link with the plain success toast", async () => {
    const link = await share({ ...base, share: { payload, sig: SIG } });
    expect(link.searchParams.get("shared")).toBe(payload);
    expect(link.searchParams.get("sig")).toBe(SIG);
    expect(toastMock.success).toHaveBeenCalledWith("Link copied to clipboard");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("tells the sender a pre-signing result's link isn't verified", async () => {
    const link = await share(base);
    expect(link.searchParams.get("sig")).toBeNull();
    expect(link.searchParams.get("shared")).toBeTruthy();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      UNVERIFIED_SHARE_TITLE,
      expect.objectContaining({
        description: expect.stringContaining("check the link themselves"),
        // Saved before the server issued shares: a rescan can sign it.
        action: expect.objectContaining({ label: "Scan again" }),
      }),
    );
  });

  it("offers no rescan when signing is off for a current result", async () => {
    const link = await share({ ...base, share: { payload } });
    expect(link.searchParams.get("sig")).toBeNull();
    expect(link.searchParams.get("shared")).toBe(payload);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledTimes(1);
    const options = toastMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(toastMock.mock.calls[0]![0]).toBe(UNVERIFIED_SHARE_TITLE);
    expect(options).not.toHaveProperty("action");
  });
});
