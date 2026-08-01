import "fake-indexeddb/auto";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetHistoryDatabaseForTests,
  useScanHistory,
} from "@/hooks/use-scan-history";
import {
  createPendingSignalResults,
  type AnalysisResult,
} from "@/lib/domain/types";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function buildResult(id: string, url: string): AnalysisResult {
  return {
    id,
    url,
    verdict: "safe",
    signals: createPendingSignalResults(),
    threatInfo: null,
    metadata: {
      scanId: id,
      startedAt: "2026-07-01T00:00:00.000Z",
      completedAt: "2026-07-01T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

beforeEach(async () => {
  await resetHistoryDatabaseForTests();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("scrutinix-v2");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("useScanHistory", () => {
  it("adds, clears, and restores entries", async () => {
    const { result } = renderHook(() => useScanHistory());

    await act(async () => {
      await result.current.addResult(buildResult("a", "https://a.example/"));
      await result.current.addResult(buildResult("b", "https://b.example/"));
    });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    // Newest first.
    expect(result.current.entries[0]?.id).toBe("b");

    await act(async () => {
      await result.current.clearHistory();
    });
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(0);
    });
    expect(result.current.canUndoClear).toBe(true);

    await act(async () => {
      await result.current.undoClearHistory();
    });
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    expect(result.current.historyUnavailable).toBe(false);
  });

  it("persists entries across hook instances", async () => {
    const first = renderHook(() => useScanHistory());
    await act(async () => {
      await first.result.current.addResult(
        buildResult("persisted", "https://persisted.example/"),
      );
    });
    first.unmount();

    const second = renderHook(() => useScanHistory());
    await waitFor(() => {
      expect(second.result.current.entries).toHaveLength(1);
    });
    expect(second.result.current.entries[0]?.url).toBe(
      "https://persisted.example/",
    );
  });

  it("degrades to historyUnavailable instead of throwing when IndexedDB is broken", async () => {
    const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new Error("IndexedDB is disabled in this session.");
    });

    const { result } = renderHook(() => useScanHistory());

    await waitFor(() => {
      expect(result.current.historyUnavailable).toBe(true);
    });

    // Mutations must not produce unhandled rejections either.
    await act(async () => {
      await result.current.addResult(buildResult("x", "https://x.example/"));
      await result.current.clearHistory();
    });
    expect(result.current.entries).toHaveLength(0);

    openSpy.mockRestore();
  });
});
