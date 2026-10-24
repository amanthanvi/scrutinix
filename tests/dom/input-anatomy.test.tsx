import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { ScanForm } from "@/components/scrutinix/scan-form";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function renderForm() {
  return render(
    <AnalyzerRuntimeProvider shared={null}>
      <ScanForm />
    </AnalyzerRuntimeProvider>,
  );
}

function typeLink(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "URL to analyze" }), {
    target: { value },
  });
}

describe("the link, taken apart on paste", () => {
  it("shows nothing until the field holds a web link", () => {
    renderForm();
    typeLink("not a link");
    expect(
      screen.queryByRole("region", { name: "The link, taken apart" }),
    ).toBeNull();
  });

  it("names each part and states a look-alike before any scan", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");

    const region = await screen.findByRole("region", {
      name: "The link, taken apart",
    });
    // The link reads as one string; the captions are visual.
    expect(
      within(region).getByText("https://paypal.com.secure-login.xyz/verify"),
    ).toBeTruthy();
    expect(region.textContent).toContain("A label anyone can add");
    expect(region.textContent).toContain("Registered domain");
    expect(region.textContent).toContain("A page on that domain");
    expect(region.textContent).toContain(
      "This link belongs to secure-login.xyz, not paypal.com.",
    );
  });

  it("answers 'Expecting a particular site?' instantly", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Expecting a particular site?",
      }),
    );

    const expected = screen.getByRole("textbox", {
      name: "Which site were you expecting?",
    });
    expect(document.activeElement).toBe(expected);

    fireEvent.change(expected, { target: { value: "PayPal" } });
    expect(
      screen.getByText("This link belongs to secure-login.xyz, not PayPal."),
    ).toBeTruthy();

    fireEvent.change(expected, { target: { value: "secure-login.xyz" } });
    expect(screen.getByText("Matches secure-login.xyz.")).toBeTruthy();
  });
});
