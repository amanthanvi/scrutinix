import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { ScanForm } from "@/components/scrutinix/scan-form";
import { announce, Announcer, retract } from "@/components/ui/announcer";
import * as linkAnatomy from "@/hooks/use-link-anatomy";
import { parse, splitLinkAnatomy } from "@/lib/client/link-parser";

const LINK = "https://paypal.com.secure-login.xyz/verify";
const GENERIC =
  "Link filled in: paypal.com.secure-login.xyz. Press Analyze to check it.";

afterEach(() => {
  cleanup();
  announce("");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the ?url= arrival announcement", () => {
  // The parser fails, so the arrival is said without its owner sentence;
  // focusing the field retries the parser, which can then load. Editing
  // the link must take back the words that were said, not the longer
  // message the recovered parser would now make.
  it.each([0, 100])(
    "takes back what was said after the parser recovers and the link is edited (%i ms in)",
    (waited) => {
      vi.useFakeTimers();
      const state = vi
        .spyOn(linkAnatomy, "useLinkAnatomy")
        .mockReturnValue({ status: "failed", anatomy: null });
      const app = () => (
        <AnalyzerRuntimeProvider prefill={LINK}>
          <ScanForm />
          <Announcer />
        </AnalyzerRuntimeProvider>
      );
      const view = render(app());
      act(() => {
        vi.advanceTimersByTime(waited);
      });
      expect(screen.getByRole("status").textContent).toBe(
        waited ? GENERIC : "",
      );

      state.mockReturnValue({
        status: "ready",
        anatomy: splitLinkAnatomy(parse, LINK),
      });
      view.rerender(app());
      fireEvent.change(
        screen.getByRole("textbox", { name: "URL to analyze" }),
        { target: { value: "https://example.com/" } },
      );
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByRole("status").textContent).toBe("");
    },
  );

  it("keeps a later message when an earlier arrival is taken back", () => {
    vi.useFakeTimers();
    render(<Announcer />);
    act(() => {
      announce("Arrival.");
      announce("Link copied.");
      retract("Arrival.");
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole("status").textContent).toBe("Link copied.");
  });
});
