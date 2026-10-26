import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicError } from "@/lib/domain/public-error";
import { SignalSkipError } from "@/lib/server/signal-error";
import packageJson from "@/package.json";
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
    // The release's own version: 4.0.0 still sent "scrutinix/3.0".
    expect(headers.get("user-agent")).toBe(`scrutinix/${packageJson.version}`);
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
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

    const platform = await runWhoisSignal("https://github.com/vercel/next.js");
    expect(platform.sharedPlatform).toBe(true);
    expect(platform.observations.join(" ")).toContain(
      "github.com is a shared platform",
    );
    expect(apex.sharedPlatform).toBeUndefined();

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

  it("does not attach parser exception text to RDAP failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not-json redis://default:s3cret-token@cache.internal", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    try {
      await runWhoisSignal("https://example.com");
      expect.fail("RDAP parse failure should reject");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicError);
      expect(error).toMatchObject({
        message: "The RDAP response could not be parsed.",
      });
      expect((error as Error).message).not.toContain("s3cret-token");
      expect((error as Error).message).not.toContain("redis://");
    }
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

  it("says a TLD without an RDAP service publishes none, not that the domain has no record", async () => {
    // rdap.org's own answer for .be (no redirect to a registry).
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        {
          rdapConformance: ["rdap_level_0"],
          lang: "en",
          errorCode: 404,
          title: "No RDAP service is available for this resource",
        },
        { status: 404 },
      ),
    );

    const result = await runWhoisSignal("https://youtu.be/jNQXAC9IVRw");

    expect(result.available).toBe(false);
    expect(result.observations).toEqual([
      "The .be registry doesn't publish registration data over RDAP, so we couldn't look this domain up.",
    ]);

    // An internationalized TLD as people write it, not its xn-- form.
    const idn = await runWhoisSignal("https://пример.рф/");
    expect(idn.observations).toEqual([
      "The .рф registry doesn't publish registration data over RDAP, so we couldn't look this domain up.",
    ]);
  });

  it("bounds the 404 body it reads, so a stalled body can't hold the scan", async () => {
    vi.useFakeTimers();
    try {
      const stalled = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"title":'));
        },
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(stalled, { status: 404 }),
      );

      const pending = runWhoisSignal("https://example.com");
      await vi.advanceTimersByTimeAsync(2_100);

      // Answered by its status: no record.
      await expect(pending).resolves.toMatchObject({
        available: false,
        observations: [
          "Registration data was unavailable for this scan. The registry has no RDAP record for this domain.",
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a registry's own 404 a missing record, whatever its title", async () => {
    const answer = Response.json(
      {
        errorCode: 404,
        title: "No RDAP service is available for this resource",
      },
      { status: 404 },
    );
    // Redirected: the registry answered, not rdap.org.
    Object.defineProperty(answer, "redirected", { value: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(answer);

    const result = await runWhoisSignal("https://unregistered.example.com");

    expect(result.observations[0]).toBe(
      "Registration data was unavailable for this scan. The registry has no RDAP record for this domain.",
    );
  });

  it("marks literal IP targets as not applicable", async () => {
    await expect(
      runWhoisSignal("https://45.151.155.223/x86_64"),
    ).rejects.toBeInstanceOf(SignalSkipError);
    await expect(
      runWhoisSignal("https://[2606:4700:4700::1111]/"),
    ).rejects.toBeInstanceOf(SignalSkipError);
  });
});
