import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HistoryPanel } from "@/components/scrutinix/history-panel";

describe("HistoryPanel", () => {
  it("offers every verdict as a filter, including unknown", () => {
    render(
      <HistoryPanel
        entries={[]}
        historyQuery=""
        onHistoryQueryChange={() => {}}
        filterVerdict="all"
        onFilterVerdictChange={() => {}}
        onSelect={() => {}}
        onClear={() => {}}
        canUndoClear={false}
        onUndoClear={() => {}}
      />,
    );

    for (const verdict of [
      "all",
      "safe",
      "suspicious",
      "malicious",
      "critical",
      "unknown",
      "error",
    ]) {
      expect(screen.getByRole("button", { name: verdict })).toBeDefined();
    }
  });
});
