import { describe, expect, it } from "vitest";

import { parseAbuseChTimestamp } from "@/lib/server/providers/abuse-ch";
import { threatFeedsDataSchema } from "@/lib/domain/schemas";

describe("parseAbuseChTimestamp", () => {
  it("reads abuse.ch UTC timestamps as ISO", () => {
    expect(parseAbuseChTimestamp("2026-10-23 07:12:45 UTC")).toBe(
      "2026-10-23T07:12:45.000Z",
    );
    expect(parseAbuseChTimestamp("2026-10-23T07:12:45Z")).toBe(
      "2026-10-23T07:12:45.000Z",
    );
  });

  it("returns undefined for anything else", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "yesterday",
      "2026-10-23",
      "2026-13-45 99:00:00 UTC",
      "2026-10-23 07:12:45 PST",
    ]) {
      expect(parseAbuseChTimestamp(value)).toBeUndefined();
    }
  });

  it("rejects calendar dates that do not exist instead of rolling them over", () => {
    for (const value of [
      "2026-02-31 07:12:45 UTC",
      "2026-02-30 00:00:00 UTC",
      "2025-02-29 12:00:00 UTC",
      "2026-04-31T00:00:00Z",
      "2026-10-23 24:00:00 UTC",
      "2026-10-23 07:60:00 UTC",
    ]) {
      expect(parseAbuseChTimestamp(value), value).toBeUndefined();
    }
    expect(parseAbuseChTimestamp("2024-02-29 12:00:00 UTC")).toBe(
      "2024-02-29T12:00:00.000Z",
    );
    expect(parseAbuseChTimestamp("2026-10-23 07:12:45.999 UTC")).toBe(
      "2026-10-23T07:12:45.000Z",
    );
  });
});

describe("feed listedAt schema", () => {
  const match = {
    feed: "urlhaus",
    matchedUrl: "https://evil.example/",
    detail: "lists this link as malware",
    confidence: "high",
    matchType: "url",
  };

  it("keeps a valid listing time and loads matches saved without one", () => {
    const parsed = threatFeedsDataSchema.parse({
      checkedAt: "",
      matches: [
        { ...match, listedAt: "2026-10-23T07:12:45.000Z" },
        match,
        { ...match, listedAt: "not a date" },
      ],
      observations: [],
      warnings: [],
    });

    expect(parsed.matches.map((entry) => entry.listedAt)).toEqual([
      "2026-10-23T07:12:45.000Z",
      undefined,
      undefined,
    ]);
    expect(parsed.matches).toHaveLength(3);
  });
});
