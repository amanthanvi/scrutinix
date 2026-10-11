import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnalyzerRuntimeProvider,
  EXPIRED_SHARE_TITLE,
  UNVERIFIED_SHARE_TITLE,
  VERIFIED_SHARE_NOTE,
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
  // Only the clock is faked: an hour after the result's check.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T01:00:00.000Z"));
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shareResult", () => {
  it("copies a signed link and states its 3-day window", async () => {
    const link = await share({ ...base, share: { payload, sig: SIG } });
    expect(link.searchParams.get("shared")).toBe(payload);
    expect(link.searchParams.get("sig")).toBe(SIG);
    expect(toastMock.success).toHaveBeenCalledWith("Link copied to clipboard", {
      description: VERIFIED_SHARE_NOTE,
    });
    // The sender learns the window in one plain line.
    expect(VERIFIED_SHARE_NOTE).toBe(
      "It shows this result for 3 days after the check.",
    );
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("tells the sender a signed result older than three days has expired", async () => {
    vi.setSystemTime(new Date("2026-10-09T00:00:02.000Z"));
    const link = await share({ ...base, share: { payload, sig: SIG } });
    // The link is still the signed one; it just opens the neutral view.
    expect(link.searchParams.get("sig")).toBe(SIG);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      EXPIRED_SHARE_TITLE,
      expect.objectContaining({
        description: expect.stringContaining("3 days after the check"),
        // A new scan is signed with a current check time.
        action: expect.objectContaining({ label: "Scan again" }),
      }),
    );
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
