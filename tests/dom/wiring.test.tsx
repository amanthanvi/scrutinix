import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge";

describe("dom test project wiring", () => {
  it("renders a component into jsdom", () => {
    render(<Badge variant="safe">clear</Badge>);

    expect(screen.getByText("clear")).toBeDefined();
  });
});
