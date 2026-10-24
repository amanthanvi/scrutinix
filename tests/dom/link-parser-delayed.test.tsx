import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  LOOK_ALIKE_URL,
  VERDICT_SAFE,
  band,
  liveRegion,
  recordHeadings,
  renderResults,
  storedResult,
} from "@/tests/dom/helpers/parser-states";

// The browser's lazy tldts import, held until the test releases it: a slow
// network or a cold chunk.
const parser = vi.hoisted(() => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { calls: 0, gate, release: () => release() };
});
vi.mock("tldts", async (importOriginal) => {
  parser.calls += 1;
  await parser.gate;
  return importOriginal();
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// In order: the parser is cached at module level once released.
describe("while the link parser is still loading", () => {
  it("shows a non-Safe verdict at once", async () => {
    const malicious = storedResult(
      "malicious",
      "https://paypal.com.evil.scrutinix.test/",
    );
    const { unmount } = renderResults([malicious]);
    fireEvent.click(screen.getByRole("button", { name: /^open / }));

    const shown = band();
    expect(shown.getAttribute("aria-label")).toBe("Scan result: Malicious");
    expect(within(shown).getByRole("meter").getAttribute("aria-valuenow")).toBe(
      "73",
    );
    expect(within(shown).getByText("Don't open this link.")).toBeTruthy();
    // The parser was asked for, and is still held.
    await waitFor(() => expect(parser.calls).toBe(1));
    unmount();
  });

  it("never shows a Safe look-alike as Safe, then shows Look-alike once it loads", async () => {
    const { unmount } = renderResults([storedResult("safe", LOOK_ALIKE_URL)]);
    const headings = recordHeadings();
    fireEvent.click(screen.getByRole("button", { name: /^open / }));

    // Held: no word, tone, score, or confidence until the address is known.
    const held = band();
    expect(held.getAttribute("aria-label")).toBe("Checking the link's address");
    expect(held.getAttribute("style")).toContain("var(--sx-pending-surface)");
    expect(within(held).getByRole("heading").textContent).toBe("Checking");
    expect(within(held).queryByRole("meter")).toBeNull();
    expect(held.textContent).not.toMatch(VERDICT_SAFE);
    // The announcement waits too.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(liveRegion()).toBe("");

    await act(async () => {
      parser.release();
    });

    await waitFor(() => {
      expect(band().getAttribute("aria-label")).toBe("Scan result: Look-alike");
    });
    expect(band().getAttribute("style")).toContain("var(--sx-unknown-surface)");
    expect(within(band()).queryByRole("meter")).toBeNull();
    await waitFor(() => {
      expect(liveRegion()).toBe(
        "Result for paypal.com.safe.scrutinix.test: Look-alike. Don't sign in or enter details here. This link belongs to scrutinix.test, not paypal.com.",
      );
    });
    headings.stop();
    expect(headings.words).not.toContain("Safe");
    expect(headings.words).toEqual(["Checking", "Look-alike"]);
    unmount();
  });

  it("shows a Safe link that imitates nothing as Safe, unchanged", async () => {
    renderResults([storedResult("safe", "https://example.com/")]);
    fireEvent.click(screen.getByRole("button", { name: /^open / }));

    const shown = band();
    expect(shown.getAttribute("aria-label")).toBe("Scan result: Safe");
    expect(shown.getAttribute("style")).toContain("var(--sx-safe-surface)");
    expect(within(shown).getByText("Looks safe to open.")).toBeTruthy();
    expect(within(shown).getByText("High confidence")).toBeTruthy();
    expect(within(shown).getByRole("meter").getAttribute("aria-valuenow")).toBe(
      "4",
    );
    await waitFor(() => {
      expect(liveRegion()).toBe(
        "Result for example.com: Safe, 4 out of 100. Looks safe to open.",
      );
    });
    expect(parser.calls).toBe(1);
  });
});
