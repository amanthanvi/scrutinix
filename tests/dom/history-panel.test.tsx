import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HistoryPanel } from "@/components/scrutinix/history-panel";

describe("HistoryPanel", () => {
  it("offers unknown as a selectable verdict filter", () => {
    const onFilterVerdictChange = vi.fn();

    render(
      <HistoryPanel
        entries={[]}
        historyQuery=""
        onHistoryQueryChange={vi.fn()}
        filterVerdict="all"
        onFilterVerdictChange={onFilterVerdictChange}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        canUndoClear={false}
        onUndoClear={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "unknown" }));

    expect(onFilterVerdictChange).toHaveBeenCalledWith("unknown");
  });
});
