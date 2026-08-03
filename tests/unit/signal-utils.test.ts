import { describe, expect, it } from "vitest";

import { getSignalDetailEntries } from "@/components/shared/signal-utils";
import type { RedirectData } from "@/lib/domain/types";

function buildRedirectData(overrides: Partial<RedirectData>): RedirectData {
  return {
    finalUrl: "https://landing.example/",
    totalHops: 1,
    httpsUpgraded: false,
    reachable: true,
    terminalStatus: 200,
    terminalError: null,
    hops: [
      {
        url: "https://short.example/x",
        status: 302,
        location: "https://landing.example/",
      },
      { url: "https://landing.example/", status: 200 },
    ],
    observations: [],
    content: null,
    ...overrides,
  };
}

describe("getSignalDetailEntries", () => {
  it("lists every redirect hop in order", () => {
    // SignalRow renders exactly these entries; without the hop rows the
    // intermediate URLs, statuses, and Location targets are invisible.
    const entries = getSignalDetailEntries(
      "redirectChain",
      buildRedirectData({}),
    );

    expect(entries.slice(0, 2)).toEqual([
      {
        label: "302",
        value: "https://short.example/x → https://landing.example/",
      },
      { label: "200", value: "https://landing.example/" },
    ]);
  });

  it("keeps a plain multi-hop chain expandable without notes or content", () => {
    const entries = getSignalDetailEntries(
      "redirectChain",
      buildRedirectData({ observations: [], content: null }),
    );

    expect(entries.length).toBeGreaterThan(0);
  });
});
