import "fake-indexeddb/auto";

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getLinkParserStatus, warmLinkParser } from "@/hooks/use-link-anatomy";
import {
  resetHistoryDatabaseForTests,
  useScanHistory,
} from "@/hooks/use-scan-history";
import {
  LOOK_ALIKE_URL,
  storedResult,
} from "@/tests/dom/helpers/parser-states";

// The browser's lazy parser chunk (tldts and `lib/client/link-parser.ts`):
// every attempt fails until the test lets one load.
const parser = vi.hoisted(() => ({ calls: 0, load: false }));
vi.mock("@/lib/client/link-parser", async (importOriginal) => {
  parser.calls += 1;
  if (!parser.load) {
    throw new TypeError("Failed to fetch dynamically imported module");
  }
  return importOriginal();
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe("history search while the link parser settles", () => {
  it("follows the word each row shows as the parser fails, then loads, without a new query", async () => {
    await resetHistoryDatabaseForTests();
    const { result } = renderHook(() => useScanHistory());
    await act(async () => {
      await result.current.addResult(
        storedResult("safe", "https://example.com/"),
      );
      await result.current.addResult(storedResult("safe", LOOK_ALIKE_URL));
      await result.current.addResult(
        storedResult("malicious", "https://evil.scrutinix.test/"),
      );
    });
    const found = () =>
      result.current.filteredEntries.map((entry) => entry.url).sort();

    // Pending: rows are held, so no row says Unconfirmed yet.
    act(() => result.current.setHistoryQuery("unconfirmed"));
    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(getLinkParserStatus()).toBe("pending");
    expect(found()).toEqual([]);

    // Fails, after its one retry: both Safe rows now read Unconfirmed.
    act(() => warmLinkParser());
    await waitFor(() => expect(getLinkParserStatus()).toBe("failed"), {
      timeout: 3_000,
    });
    expect(parser.calls).toBe(2);
    await waitFor(() => {
      expect(found()).toEqual(["https://example.com/", LOOK_ALIKE_URL]);
    });

    // A later attempt loads it: the look-alike's row reads Look-alike.
    act(() => result.current.setHistoryQuery("look-alike"));
    expect(found()).toEqual([]);
    parser.load = true;
    act(() => warmLinkParser());
    await waitFor(() => expect(getLinkParserStatus()).toBe("ready"));
    await waitFor(() => expect(found()).toEqual([LOOK_ALIKE_URL]));
  });
});
