import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
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
      <LazyToaster />
    </ThemeProvider>,
  );
  expect(document.querySelector("[data-sonner-toaster]")).toBeNull();
  let notification: Promise<unknown>;
  await act(async () => {
    notification = getToast().then((toast) =>
      toast.error("First notification"),
    );
  });
  expect(await screen.findByText("First notification")).toBeTruthy();
  await notification!;
});
