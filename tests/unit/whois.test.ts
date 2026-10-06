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

  it("identifies itself to rdap.org, which rejects anonymous clients", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 404 }));

    await runWhoisSignal("https://example.com");

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("user-agent")).toMatch(/^scrutinix\//);
  });

  it("looks up the registered domain, keeping private-suffix tenants distinct", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 404 }));

    await runWhoisSignal("https://www.wikipedia.org/wiki/Main_Page");
    await runWhoisSignal("https://login.example.co.uk/");
    await runWhoisSignal("https://safe.github.io/");

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://rdap.org/domain/wikipedia.org",
      "https://rdap.org/domain/example.co.uk",
      "https://rdap.org/domain/safe.github.io",
    ]);
  });

  it("marks deeper subdomains so the parent's age cannot vouch for them", async () => {
    const rdap = () =>
      Response.json({
        events: [
          {
            eventAction: "registration",
            eventDate: "2010-01-01T00:00:00.000Z",
          },
        ],
      });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => rdap());

    const apex = await runWhoisSignal("https://www.example.com./");
    expect(apex.subdomainOf).toBeUndefined();

    const tenant = await runWhoisSignal("https://tenant.example.com/");
    expect(tenant.subdomainOf).toBe("example.com");
    expect(tenant.observations.join(" ")).toContain(
      "parent domain example.com",
    );
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
