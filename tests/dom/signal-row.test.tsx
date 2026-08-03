import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SignalRow } from "@/components/scrutinix/signal-row";

describe("SignalRow", () => {
  it("renders every redirect hop without dropping terminal or content notes", () => {
    render(
      <SignalRow
        name="redirectChain"
        index={0}
        result={{
          status: "success",
          error: null,
          durationMs: 12,
          data: {
            finalUrl: "https://final.example.test/",
            totalHops: 2,
            httpsUpgraded: true,
            reachable: false,
            terminalStatus: 200,
            terminalError: "The terminal response could not be fully read.",
            hops: [
              {
                url: "http://start.example.test/",
                status: 302,
                location: "/middle",
              },
              {
                url: "http://start.example.test/middle",
                status: 301,
                location: "https://final.example.test/",
              },
              {
                url: "https://final.example.test/",
                status: 200,
              },
            ],
            observations: ["Redirect coverage was incomplete."],
            content: {
              title: "Final landing page",
              crossOriginFormHosts: [],
              passwordInputCount: 0,
              iframeCount: 0,
              hiddenIframeCount: 0,
              obfuscationHints: [],
              metaRefreshTarget: "https://refresh.example.test/",
            },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Redirect Chain signal: success"));

    expect(screen.getByText("Hop 1")).toBeTruthy();
    expect(
      screen.getByText(
        "URL: http://start.example.test/ · Status: 302 · Location: /middle",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Hop 2")).toBeTruthy();
    expect(
      screen.getByText(
        "URL: http://start.example.test/middle · Status: 301 · Location: https://final.example.test/",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Hop 3")).toBeTruthy();
    expect(
      screen.getByText(
        "URL: https://final.example.test/ · Status: 200 · Location: None",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("The terminal response could not be fully read."),
    ).toBeTruthy();
    expect(screen.getByText("Final landing page")).toBeTruthy();
    expect(screen.getByText("https://refresh.example.test/")).toBeTruthy();
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(
      screen.getAllByText("Redirect coverage was incomplete."),
    ).toHaveLength(2);
  });
});
