import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RowVerdict } from "@/components/scrutinix/result-row";

describe("RowVerdict", () => {
  it("names a look-alike Safe as Look-alike, in the neutral colour", () => {
    render(<RowVerdict verdict="safe" impersonates="paypal.com" />);
    const word = screen.getByText("Look-alike");
    expect(word.getAttribute("style")).toContain("var(--sx-unknown-fg)");
  });

  it("holds a Safe row's word until it is known not to be a look-alike", () => {
    render(
      <RowVerdict verdict="safe" impersonates={null} anatomyStatus="pending" />,
    );
    expect(screen.queryByText("Safe")).toBeNull();
    expect(screen.queryByText("Look-alike")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("says Unconfirmed, in the neutral colour, when the parser failed", () => {
    render(
      <RowVerdict verdict="safe" impersonates={null} anatomyStatus="failed" />,
    );
    expect(screen.queryByText("Safe")).toBeNull();
    const word = screen.getByText("Unconfirmed");
    expect(word.getAttribute("style")).toContain("var(--sx-unknown-fg)");
  });

  it("names every other verdict at once, whatever the parser's state", () => {
    render(
      <>
        <RowVerdict
          verdict="malicious"
          impersonates={null}
          anatomyStatus="pending"
        />
        <RowVerdict
          verdict="suspicious"
          impersonates={null}
          anatomyStatus="failed"
        />
      </>,
    );
    expect(screen.getByText("Malicious")).toBeTruthy();
    expect(screen.getByText("Suspicious").getAttribute("style")).toContain(
      "var(--sx-suspicious-fg)",
    );
  });

  it("names every other result by its verdict", () => {
    render(
      <>
        <RowVerdict verdict="safe" impersonates={null} />
        <RowVerdict verdict="malicious" impersonates="paypal.com" />
        <RowVerdict verdict={null} impersonates={null} label="Checking" />
      </>,
    );
    expect(screen.getByText("Safe").getAttribute("style")).toContain(
      "var(--sx-safe-fg)",
    );
    expect(screen.getByText("Malicious")).toBeTruthy();
    expect(screen.getByText("Checking")).toBeTruthy();
  });
});
