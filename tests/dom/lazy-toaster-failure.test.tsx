import { act, render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getToast, LazyToaster } from "@/components/ui/lazy-toaster";

vi.mock("@/components/ui/sonner", () => {
  throw new Error("Chunk unavailable");
});

it("keeps the page and manual share link usable if the toast chunk fails", async () => {
  const retry = vi.fn();
  render(
    <>
      <input aria-label="URL to analyze" />
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
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "URL to analyze" })).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: "Share link" }).getAttribute("value"),
  ).toBe("https://example.com/share");
  fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
  expect(retry).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
