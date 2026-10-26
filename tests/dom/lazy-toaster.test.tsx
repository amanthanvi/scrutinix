import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
import { Announcer } from "@/components/ui/announcer";
import { getToast, LazyToaster } from "@/components/ui/lazy-toaster";

vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}));

it("mounts Sonner on demand and delivers the very first toast", async () => {
  render(
    <ThemeProvider attribute="class">
      <Announcer />
      <LazyToaster />
    </ThemeProvider>,
  );
  // The status region is in the page before any toast: one inserted with
  // its message (Sonner's) went unannounced in VoiceOver.
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("");
  expect(document.querySelector("[data-sonner-toaster]")).toBeNull();
  let notification: Promise<unknown>;
  await act(async () => {
    notification = getToast().then((toast) =>
      toast.success("Link copied to clipboard", {
        description: "It shows this result for 3 days after the check.",
      }),
    );
  });
  expect(await screen.findByText("Link copied to clipboard")).toBeTruthy();
  await notification!;

  // Said once, by the page's own region; Sonner's own region is muted, so
  // TalkBack no longer reads "Close toast", the parts, then the whole.
  await waitFor(() =>
    expect(status.textContent).toBe(
      "Link copied to clipboard It shows this result for 3 days after the check.",
    ),
  );
  const sonner = document
    .querySelector("[data-sonner-toaster]")
    ?.closest("section");
  expect(sonner).toBeTruthy();
  expect(sonner?.hasAttribute("aria-live")).toBe(false);
  expect(document.querySelectorAll("[aria-live]")).toHaveLength(0);
});
