import "fake-indexeddb/auto";

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HistoryPanel } from "@/components/scrutinix/history-panel";
import {
  getLinkParserStatus,
  getLoadedLinkParser,
  warmLinkParser,
} from "@/hooks/use-link-anatomy";
import {
  resetHistoryDatabaseForTests,
  useScanHistory,
} from "@/hooks/use-scan-history";
import {
  LOOK_ALIKE_URL,
  VERDICT_SAFE,
  band,
  liveRegion,
  recordHeadings,
  renderResults,
  storedResult,
} from "@/tests/dom/helpers/parser-states";

// The browser's lazy parser chunk (tldts and `lib/client/link-parser.ts`)
// always fails: offline after the page loaded, or a chunk a deploy removed.
const parser = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/client/link-parser", async () => {
  parser.calls += 1;
  throw new TypeError("Failed to fetch dynamically imported module");
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

/** Past `RETRY_DELAY_MS` in `hooks/use-link-anatomy.ts`. */
const PAST_RETRY = 1_300;

// In order: each new link starts another attempt, so call counts follow
// the tests above them.
describe("when the link parser fails to load", () => {
  it("retries once, then shows a Safe result as Unconfirmed, never Safe", async () => {
    const { unmount } = renderResults([storedResult("safe", LOOK_ALIKE_URL)]);
    const headings = recordHeadings();
    fireEvent.click(screen.getByRole("button", { name: /^open / }));

    // First attempt failed; the retry is pending: still held.
    await waitFor(() => expect(parser.calls).toBe(1));
    expect(band().getAttribute("aria-label")).toBe(
      "Checking the link's address",
    );

    await waitFor(
      () => {
        expect(band().getAttribute("aria-label")).toBe(
          "Scan result: Unconfirmed",
        );
      },
      { timeout: 3_000 },
    );
    expect(parser.calls).toBe(2);
    expect(getLinkParserStatus()).toBe("failed");
    expect(getLoadedLinkParser()).toBeNull();

    const shown = band();
    // Neutral, no score, and why in place of the confidence line.
    expect(shown.getAttribute("style")).toContain("var(--sx-unknown-surface)");
    expect(within(shown).queryByRole("meter")).toBeNull();
    expect(
      within(shown).getByText("Check the link's address before you open it."),
    ).toBeTruthy();
    expect(
      within(shown).getByText(
        "We couldn't check whether this address imitates another site.",
      ),
    ).toBeTruthy();
    expect(shown.textContent).not.toMatch(VERDICT_SAFE);
    // The stored verdict and score are stated in the details.
    expect(
      screen.getByText(
        "No check flagged it: on their own, the checks scored it Safe, 4 out of 100.",
      ),
    ).toBeTruthy();

    await waitFor(() => {
      expect(liveRegion()).toBe(
        "Result for paypal.com.safe.scrutinix.test: Unconfirmed. Check the link's address before you open it. We couldn't check whether this address imitates another site.",
      );
    });
    headings.stop();
    expect(headings.words).toEqual(["Checking", "Unconfirmed"]);

    // Once: a failure is final for this link.
    await new Promise((resolve) => setTimeout(resolve, PAST_RETRY));
    expect(parser.calls).toBe(2);
    unmount();
  });

  it("says Unconfirmed in history rows at once, with no new attempt; other rows unchanged", () => {
    const calls = parser.calls;
    const savedAt = "2026-10-06T00:00:02.000Z";
    render(
      <HistoryPanel
        entries={[
          { ...storedResult("safe", "https://example.com/"), savedAt },
          {
            ...storedResult("malicious", "https://evil.scrutinix.test/"),
            savedAt,
          },
        ]}
        totalCount={2}
        historyQuery=""
        onHistoryQueryChange={() => {}}
        onSelect={() => {}}
        onClear={() => {}}
        canUndoClear={false}
        onUndoClear={() => {}}
      />,
    );

    const word = screen.getByText("Unconfirmed");
    expect(word.getAttribute("style")).toContain("var(--sx-unknown-fg)");
    expect(screen.getByText("Malicious")).toBeTruthy();
    expect(screen.queryByText("Safe")).toBeNull();
    // Rows mounting never re-run a failed load.
    expect(parser.calls).toBe(calls);
  });

  it("keeps Unconfirmed on screen while a new scan tries the parser again", async () => {
    const { unmount } = renderResults([
      storedResult("safe", "https://example.com/"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^open / }));
    expect(band().getAttribute("aria-label")).toBe("Scan result: Unconfirmed");

    const calls = parser.calls;
    const headings = recordHeadings();
    // What starting a scan or focusing the link field does.
    act(() => warmLinkParser());
    await waitFor(() => expect(parser.calls).toBe(calls + 1));
    expect(getLinkParserStatus()).toBe("failed");
    await waitFor(() => expect(parser.calls).toBe(calls + 2), {
      timeout: 3_000,
    });
    headings.stop();
    expect(headings.words).toEqual(["Unconfirmed"]);
    unmount();
  });

  it("finds a Safe entry by the word its row shows, Unconfirmed", async () => {
    await resetHistoryDatabaseForTests();
    expect(getLinkParserStatus()).toBe("failed");
    const { result } = renderHook(() => useScanHistory());
    await act(async () => {
      await result.current.addResult(
        storedResult("safe", "https://example.com/"),
      );
      await result.current.addResult(
        storedResult("malicious", "https://evil.scrutinix.test/"),
      );
    });
    act(() => result.current.setHistoryQuery("unconfirmed"));

    await waitFor(() => {
      expect(result.current.filteredEntries.map((entry) => entry.url)).toEqual([
        "https://example.com/",
      ]);
    });
  });

  it("shows a non-Safe verdict at once, whatever the parser does", () => {
    const { unmount } = renderResults([
      storedResult("malicious", "https://evil.scrutinix.test/"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^open / }));

    const shown = band();
    expect(shown.getAttribute("aria-label")).toBe("Scan result: Malicious");
    expect(within(shown).getByRole("meter")).toBeTruthy();
    unmount();
  });
});
