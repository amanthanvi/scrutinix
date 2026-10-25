import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain .mjs script without type declarations.
import { checkContrast } from "@/scripts/check-contrast.mjs";

interface Row {
  theme: string;
  fg: string;
  bg: string;
  min: number;
  ratio: number;
  ok: boolean;
}

describe("theme token contrast", () => {
  const rows = checkContrast() as Row[];

  it("checks both themes", () => {
    expect(new Set(rows.map((row) => row.theme))).toEqual(
      new Set(["light", "dark"]),
    );
  });

  it("keeps text at 4.5:1 and graphics at 3:1 in light and dark", () => {
    const failures = rows
      .filter((row) => !row.ok)
      .map(
        (row) =>
          `${row.theme}: ${row.fg} on ${row.bg} is ${row.ratio.toFixed(2)} (needs ${row.min})`,
      );
    expect(failures).toEqual([]);
  });
});

describe("strip cell shapes", () => {
  const css = readFileSync(
    path.join(process.cwd(), "app/scrutinix.css"),
    "utf8",
  );
  /** The rule drawing a state's mark: the full fill, or a smaller box. */
  const ruleFor = (severity: string) => {
    const pseudo = ["clear", "neutral"].includes(severity) ? "after" : "before";
    const match = css.match(
      new RegExp(
        `\\.sx-cell\\[data-severity="${severity}"\\]::${pseudo} \\{([^}]*)\\}`,
      ),
    );
    return match?.[1]?.replace(/var\(--sx-cell-[\w-]+\)/g, "").trim() ?? null;
  };

  const elementRuleFor = (severity: string) => {
    const match = css.match(
      new RegExp(`\\.sx-cell\\[data-severity="${severity}"\\] \\{([^}]*)\\}`),
    );
    return match?.[1]?.replace(/var\(--sx-cell-[\w-]+\)/g, "").trim() ?? null;
  };

  it("never tells flagged, caution, found-nothing, or partial apart by hue alone", () => {
    const shapes = ["malicious", "suspicious", "clear", "neutral"].map(ruleFor);
    expect(shapes.every(Boolean)).toBe(true);
    // With the colour stripped, every rule still differs from the others.
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("tells failed from didn't-apply by edge shape, not by colour", () => {
    const failed = elementRuleFor("error");
    const skipped = elementRuleFor("skipped");
    expect(failed).toBeTruthy();
    expect(skipped).toBeTruthy();
    expect(failed).not.toBe(skipped);
  });

  it("draws the smaller marks as their own boxes over a fill that never changes size", () => {
    // A check the verdict scores turns from a dash to a hatch as it lands:
    // the dash's box goes, the fill shows, and no box moves.
    const fills = css.match(
      /\.sx-cell\[data-severity="clear"\]::before,\s*\.sx-cell\[data-severity="neutral"\]::before \{([^}]*)\}/,
    )?.[1];
    expect(fills).toContain("background: transparent");
    expect(fills).not.toMatch(/inset|clip-path/);
    for (const severity of ["clear", "neutral"]) {
      const mark = ruleFor(severity) ?? "";
      expect(mark).toMatch(/inset: /);
      expect(mark).not.toContain("clip-path");
    }
    // Every fill keeps the cell's own box.
    expect(css).not.toMatch(/\.sx-cell\[[^\]]+\]::before \{[^}]*inset/);
  });

  it("draws a partial answer as a centred block, never a length", () => {
    const partial = ruleFor("neutral") ?? "";
    expect(partial).toContain("transform-origin: center");
    expect(partial).not.toMatch(/scaleX\(0\.\d+\)/);
  });

  it("redraws the strip in system colours under forced colours", () => {
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).toContain("forced-color-adjust: none");
    expect(forced).toContain("CanvasText");
  });
});
