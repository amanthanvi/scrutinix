import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("dom test project wiring", () => {
  it("renders a component into jsdom", () => {
    render(<Button>clear</Button>);

    expect(screen.getByText("clear")).toBeDefined();
  });
});
