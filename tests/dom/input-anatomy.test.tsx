import { fireEvent, render, screen } from "@testing-library/react";
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

/** Text a screen reader gets: everything outside aria-hidden subtrees. */
function spokenText(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") {
    return "";
  }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return Array.from(node.childNodes).map(spokenText).join("");
}

function linkLine() {
  const line = document.getElementById("sx-input-anatomy");
  if (!line) throw new Error("no captioned link");
  return line;
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
    // Each part is spoken after its name; the visual captions are hidden
    // from assistive technology so nothing is read twice.
    expect(spokenText(linkLine())).toBe(
      "https://A label anyone can add: paypal.com.Registered domain: secure-login.xyzA page on that domain: /verify",
    );
    expect(region.textContent).toContain(
      "This link belongs to secure-login.xyz, not paypal.com.",
    );
  });

  it("tells a screen reader which part is the registered domain on any link", async () => {
    renderForm();
    typeLink("https://accounts.example.com/login");
    await screen.findByRole("region", { name: "The link, taken apart" });
    expect(spokenText(linkLine())).toContain("Registered domain: example.com");
  });

  it("keeps a fragment route in the page part", async () => {
    renderForm();
    typeLink("https://example.com/#/login");
    await screen.findByRole("region", { name: "The link, taken apart" });
    expect(spokenText(linkLine())).toContain("A page on that domain: /#/login");
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

    // A name is never confirmed or denied.
    fireEvent.change(expected, { target: { value: "PayPal" } });
    expect(
      screen.getByText(
        "We can't tell from a name whether secure-login.xyz is PayPal's site. Type its address to compare.",
      ),
    ).toBeTruthy();

    // The site the link spells out: the owner is stated once, above.
    fireEvent.change(expected, { target: { value: "paypal.com" } });
    expect(
      screen.getByText("No. The link only spells out paypal.com."),
    ).toBeTruthy();
    const region = screen.getByRole("region", {
      name: "The link, taken apart",
    });
    const owner = "This link belongs to secure-login.xyz, not paypal.com.";
    expect(region.textContent?.split(owner)).toHaveLength(2);

    fireEvent.change(expected, { target: { value: "secure-login.xyz" } });
    expect(screen.getByText("Matches secure-login.xyz.")).toBeTruthy();
  });
});
