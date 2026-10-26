import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Announcer } from "@/components/ui/announcer";
import { getToast, LazyToaster } from "@/components/ui/lazy-toaster";

vi.mock("@/components/ui/sonner", () => {
  throw new Error("Chunk unavailable");
});

it("keeps the page and manual share link usable if the toast chunk fails", async () => {
  const retry = vi.fn();
  render(
    <>
      <input aria-label="URL to analyze" />
      <Announcer />
      <LazyToaster />
    </>,
  );
  await act(async () => {
    void getToast().then((toast) =>
      toast.error("Copy the link below", {
        description: (
          <input
            aria-label="Share link"
            readOnly
            value="https://example.com/share"
          />
        ),
        action: { label: "Scan again", onClick: retry },
      }),
    );
  });
  expect(await screen.findByText("Copy the link below")).toBeTruthy();
  // Spoken by the status region, like every notification.
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Copy the link below"),
  );
  expect(screen.getByRole("textbox", { name: "URL to analyze" })).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: "Share link" }).getAttribute("value"),
  ).toBe("https://example.com/share");
  fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
  expect(retry).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(document.querySelector("[data-notice]")).toBeNull();
});
