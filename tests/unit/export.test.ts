import { describe, expect, it } from "vitest";

import { resultsToCsv } from "@/lib/client/export";
import {
  createPendingSignalResults,
  type AnalysisResult,
} from "@/lib/domain/types";

function buildResult(url: string): AnalysisResult {
  return {
    id: "scan-1",
    url,
    verdict: "safe",
    signals: createPendingSignalResults(),
    threatInfo: null,
    metadata: {
      scanId: "scan-1",
      startedAt: "2026-07-01T00:00:00.000Z",
      completedAt: "2026-07-01T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

describe("resultsToCsv", () => {
  it("neutralizes spreadsheet formula injection in scanned URLs", () => {
    const csv = resultsToCsv([
      buildResult('=HYPERLINK("http://evil.example","click")'),
      buildResult("+1234567890"),
      buildResult("@cmd"),
      buildResult("-2+3"),
    ]);

    // A scanned URL is attacker-controlled; leading formula characters must
    // be prefixed so Excel/Sheets render text instead of executing.
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csv).toContain(`"'+1234567890"`);
    expect(csv).toContain(`"'@cmd"`);
    expect(csv).toContain(`"'-2+3"`);
    expect(csv).not.toMatch(/"=HYPERLINK/);
  });

  it("starts with a UTF-8 BOM and uses CRLF line endings", () => {
    const csv = resultsToCsv([buildResult("https://example.com/")]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain('"https://example.com/"');
  });

  it("escapes embedded quotes", () => {
    const csv = resultsToCsv([buildResult('https://example.com/?q="x"')]);

    expect(csv).toContain('"https://example.com/?q=""x"""');
  });
});
