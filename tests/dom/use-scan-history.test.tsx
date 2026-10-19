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

  it("searches legacy verdicts defensively and case-insensitively", async () => {
    const { result } = renderHook(() => useScanHistory());
    const missingVerdict = {
      ...buildResult("missing-verdict", "https://legacy.example/"),
      verdict: undefined,
    } as unknown as AnalysisResult;
    const uppercaseVerdict = {
      ...buildResult("uppercase-verdict", "https://case.example/"),
      verdict: "SAFE",
    } as unknown as AnalysisResult;

    await act(async () => {
      await result.current.addResult(missingVerdict);
      await result.current.addResult(uppercaseVerdict);
    });
    act(() => result.current.setHistoryQuery("safe"));

    await waitFor(() => {
      expect(result.current.filteredEntries.map((entry) => entry.id)).toEqual([
        "uppercase-verdict",
      ]);
    });
  });

  it("isolates unknown verdicts through the history query", async () => {
    const { result } = renderHook(() => useScanHistory());
    const unknownResult = {
      ...buildResult("unknown", "https://unreachable.example/"),
      verdict: "unknown" as const,
    };

    await act(async () => {
      await result.current.addResult(
        buildResult("safe", "https://reachable.example/"),
      );
      await result.current.addResult(unknownResult);
    });
    act(() => result.current.setHistoryQuery("unknown"));

    await waitFor(() => {
      expect(result.current.filteredEntries.map((entry) => entry.id)).toEqual([
        "unknown",
      ]);
    });
  });

  it("keeps only the latest scan per link, across batch and single scans", async () => {
    // A 5-URL batch after earlier single scans of some of the same links
    // used to leave 9 entries: one per scan, never replaced.
    const first = renderHook(() => useScanHistory());
    await act(async () => {
      await first.result.current.addResult(
        buildResult("single-a", "https://a.example/"),
      );
      await first.result.current.addResult(
        buildResult("single-b", "https://b.example/"),
      );
    });

    await act(async () => {
      await Promise.all(
        ["a", "b", "c", "d", "e"].map((name) =>
          first.result.current.addResult(
            buildResult(`batch-${name}`, `https://${name}.example/`),
          ),
        ),
      );
    });

    await waitFor(() => {
      expect(first.result.current.entries).toHaveLength(5);
    });
    expect(
      first.result.current.entries.map((entry) => entry.id).sort(),
    ).toEqual(["batch-a", "batch-b", "batch-c", "batch-d", "batch-e"]);

    // Spelling variants of one link are the same link.
    await act(async () => {
      await first.result.current.addResult(
        buildResult("rescan-a", "https://A.example:443/#top"),
      );
    });
    await waitFor(() => {
      expect(first.result.current.entries[0]?.id).toBe("rescan-a");
    });
    expect(first.result.current.entries).toHaveLength(5);
    first.unmount();

    // The replacement is persisted, not just hidden in memory.
    const second = renderHook(() => useScanHistory());
    await waitFor(() => {
      expect(second.result.current.entries).toHaveLength(5);
    });
    expect(
      second.result.current.entries.some((entry) => entry.id === "batch-a"),
    ).toBe(false);
  });

  it("hides duplicates saved before upserts, newest first", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("scrutinix-v2", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("scans", {
          keyPath: "id",
        });
        store.createIndex("by-saved-at", "savedAt");
      };
      request.onsuccess = () => {
        const tx = request.result.transaction("scans", "readwrite");
        tx.objectStore("scans").put({
          ...buildResult("old", "https://dup.example/"),
          savedAt: "2026-07-01T00:00:00.000Z",
        });
        tx.objectStore("scans").put({
          ...buildResult("new", "https://dup.example/"),
          savedAt: "2026-07-02T00:00:00.000Z",
        });
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    const { result } = renderHook(() => useScanHistory());

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.id)).toEqual(["new"]);
    });
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
