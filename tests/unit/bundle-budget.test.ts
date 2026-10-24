import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
// @ts-expect-error Build scripts are plain JavaScript.
import * as budget from "../../scripts/check-bundle-budget.mjs";

const { budgetFailures, summarizeAssets } = budget;

describe("first-load bundle budget", () => {
  it("counts scripts by gzip and raw size, and font transfer bytes separately", () => {
    const body = Buffer.from("const ready = true;".repeat(50));
    const measured = summarizeAssets([
      { path: "/first.js", type: "script", body },
      { path: "/font.woff2", type: "font", body: Buffer.alloc(123) },
    ]);
    expect(measured).toMatchObject({
      scriptCount: 1,
      jsRawBytes: body.length,
      jsGzipBytes: gzipSync(body).length,
      fontBytes: 123,
    });
    expect(
      budgetFailures(measured, {
        jsGzipBytes: measured.jsGzipBytes,
        fontBytes: 123,
      }),
    ).toEqual([]);
    expect(budgetFailures(measured, { jsGzipBytes: 1, fontBytes: 0 })).toEqual([
      expect.stringContaining("jsGzipBytes grew"),
      expect.stringContaining("fontBytes grew"),
    ]);
  });
});
