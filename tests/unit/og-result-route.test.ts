import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvForTests } from "@/lib/config/env";
import { encodeSharedSnapshot } from "@/lib/domain/signal-signature";
import { ResultCard } from "@/lib/og/cards";
import { signSharePayload } from "@/lib/server/share-signing";

// Stand-ins for the renderer: record what the card would draw.
const rendered = vi.hoisted(() => [] as unknown[]);
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(
      element: { props: unknown },
      init?: { headers?: Record<string, string> },
    ) {
      rendered.push(element.props);
      super("png", {
        headers: { "content-type": "image/png", ...init?.headers },
      });
    }
  },
}));
vi.mock("@/lib/og/fonts", () => ({ loadOgFonts: async () => [] }));

const { GET } = await import("@/app/og/result/route");

const SECRET = "unit-test-share-secret-0123456789abcdef";
const payload = encodeSharedSnapshot({
  verdict: "safe",
  url: "https://paypal.com.secure-login.xyz/verify",
  summary: "No check flagged this link.",
  capturedAt: "2026-10-06T09:00:00.000Z",
});

function imageRequest(params: Record<string, string>) {
  const url = new URL("https://scrutinix.test/og/result");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

/** Every string a card element tree draws, components expanded. */
function textOf(node: unknown): string[] {
  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as {
    type: unknown;
    props: { children?: unknown };
  };
  if (typeof element.type === "function") {
    return textOf((element.type as (props: unknown) => unknown)(element.props));
  }
  return textOf(element.props.children);
}

function expectDefaultCard(response: Response) {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    "https://scrutinix.test/opengraph-image",
  );
  expect(rendered).toHaveLength(0);
}

beforeEach(() => {
  // The route reads the request time from the clock; only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
  rendered.length = 0;
  vi.stubEnv("SHARE_SIGNING_SECRET", SECRET);
  resetEnvForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /og/result", () => {
  it("draws the verdict card for a payload this server signed", async () => {
    const sig = signSharePayload(payload)!;
    const response = await GET(imageRequest({ shared: payload, sig }));
    expect(response.status).toBe(200);
    expect(rendered).toEqual([
      expect.objectContaining({
        verdict: "safe",
        domain: "secure-login.xyz",
        impersonates: "paypal.com",
      }),
    ]);
    // Revocable: a forged image must age out after a leaked key is pulled.
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("max-age=3600");
    expect(cacheControl).not.toContain("immutable");
    expect(cacheControl).not.toContain("stale-while-revalidate");
  });

  it('never leads a Safe look-alike\'s card with "Safe"', async () => {
    const sig = signSharePayload(payload)!;
    await GET(imageRequest({ shared: payload, sig }));
    const text = textOf(
      ResultCard(rendered[0] as Parameters<typeof ResultCard>[0]),
    );
    expect(text).toContain("Look-alike");
    expect(text).not.toContain("Safe");

    const plain = textOf(
      ResultCard({
        ...(rendered[0] as Parameters<typeof ResultCard>[0]),
        domain: "example.com",
        impersonates: null,
      }),
    );
    expect(plain).toContain("Safe");
  });

  it("sends an unsigned payload to the default card", async () => {
    expectDefaultCard(await GET(imageRequest({ shared: payload })));
  });

  it("sends a tampered payload or signature to the default card", async () => {
    const sig = signSharePayload(payload)!;
    const forged = encodeSharedSnapshot({
      verdict: "safe",
      url: "https://evil.example/login",
      summary: "Safe.",
      capturedAt: "2026-10-06T09:00:00.000Z",
    });
    expectDefaultCard(await GET(imageRequest({ shared: forged, sig })));
    expectDefaultCard(
      await GET(
        imageRequest({
          shared: payload,
          sig: `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`,
        }),
      ),
    );
  });

  it("sends a signed result older than three days to the default card", async () => {
    const sig = signSharePayload(payload)!;
    // 72 hours after the check, the card is still drawn.
    vi.setSystemTime(new Date("2026-10-09T09:00:00.000Z"));
    expect((await GET(imageRequest({ shared: payload, sig }))).status).toBe(
      200,
    );
    rendered.length = 0;
    // A millisecond later, the genuine signature no longer vouches for it.
    vi.setSystemTime(new Date("2026-10-09T09:00:00.001Z"));
    expectDefaultCard(await GET(imageRequest({ shared: payload, sig })));
  });

  it("sends a check time in the future to the default card", async () => {
    const sig = signSharePayload(payload)!;
    vi.setSystemTime(new Date("2026-10-06T08:54:59.999Z"));
    expectDefaultCard(await GET(imageRequest({ shared: payload, sig })));
  });

  it("sends everything to the default card when signing is off", async () => {
    const sig = signSharePayload(payload)!;
    vi.stubEnv("SHARE_SIGNING_SECRET", "");
    resetEnvForTests();
    expectDefaultCard(await GET(imageRequest({ shared: payload, sig })));
  });
});
