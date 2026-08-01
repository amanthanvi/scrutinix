import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalSkipError } from "@/lib/server/signal-error";
import { runWhoisSignal } from "@/lib/server/signals/whois";

describe("runWhoisSignal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns normalized RDAP data when the lookup succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          handle: "EXAMPLE-1",
          country: "US",
          links: [{ href: "https://rdap.example.test/domain/example.com" }],
          entities: [
            {
              roles: ["registrar"],
              vcardArray: [
                "vcard",
                [["fn", {}, "text", "Example Registrar LLC"]],
              ],
            },
          ],
          events: [
            {
              eventAction: "registration",
              eventDate: "2015-01-01T00:00:00.000Z",
            },
            {
              eventAction: "expiration",
              eventDate: "2030-01-01T00:00:00.000Z",
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    const result = await runWhoisSignal("https://example.com");

    expect(result).toMatchObject({
      subjectType: "domain",
      available: true,
      registrar: "Example Registrar LLC",
      country: "US",
      handle: "EXAMPLE-1",
      rdapUrl: "https://rdap.example.test/domain/example.com",
    });
    expect(result.registeredAt).toBe("2015-01-01T00:00:00.000Z");
    expect(result.observations).toEqual([]);
  });

  it("propagates network failures as signal errors instead of fake success", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Timed out after 8000ms"),
    );

    await expect(runWhoisSignal("https://example.com")).rejects.toThrow(
      "Timed out after 8000ms",
    );
  });

  it("propagates RDAP server errors as signal errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 504 }),
    );

    await expect(runWhoisSignal("https://example.com")).rejects.toThrow(
      "RDAP lookup failed with status 504.",
    );
  });

  it("treats RDAP 404 as an honest no-record answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );

    const result = await runWhoisSignal("https://example.com");

    expect(result).toMatchObject({
      subjectType: "domain",
      available: false,
      registrar: null,
      registeredAt: null,
      expiresAt: null,
    });
    expect(result.observations[0]).toContain(
      "Registration data was unavailable for this scan.",
    );
    expect(result.observations[0]).toContain("no RDAP record");
  });

  it("marks literal IP targets as not applicable", async () => {
    await expect(
      runWhoisSignal("https://45.151.155.223/x86_64"),
    ).rejects.toBeInstanceOf(SignalSkipError);
  });
});
