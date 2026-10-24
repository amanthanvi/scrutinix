import { describe, expect, it } from "vitest";

import {
  extractSharedLink,
  isShareTargetLaunch,
  resolvePrefill,
} from "@/lib/domain/share-launch";

describe("extractSharedLink", () => {
  it("takes the link Android puts inside the shared text", () => {
    expect(
      extractSharedLink({
        url: "",
        text: "Your parcel is waiting: https://parcel-help.example/track?id=42 reply STOP to opt out",
        title: "Delivery",
      }),
    ).toBe("https://parcel-help.example/track?id=42");
  });

  it("prefers the url field, then text, then title", () => {
    expect(
      extractSharedLink({
        url: "https://first.example/",
        text: "https://second.example/",
      }),
    ).toBe("https://first.example/");
    expect(
      extractSharedLink({ text: "no link here", title: "https://t.example/a" }),
    ).toBe("https://t.example/a");
  });

  it("drops sentence punctuation and unpaired closers, keeps paired ones", () => {
    expect(extractSharedLink({ text: "See https://a.example/x." })).toBe(
      "https://a.example/x",
    );
    expect(extractSharedLink({ text: "(https://a.example/x)" })).toBe(
      "https://a.example/x",
    );
    expect(
      extractSharedLink({
        text: "https://en.wikipedia.org/wiki/Mercury_(planet), right?",
      }),
    ).toBe("https://en.wikipedia.org/wiki/Mercury_(planet)");
    expect(extractSharedLink({ text: '"https://a.example/q?x=1"!' })).toBe(
      "https://a.example/q?x=1",
    );
  });

  it("takes the url field whole: its punctuation is part of the link", () => {
    expect(extractSharedLink({ url: "https://example.com/a'b" })).toBe(
      "https://example.com/a'b",
    );
    expect(extractSharedLink({ url: "https://example.com/important!" })).toBe(
      "https://example.com/important!",
    );
    expect(extractSharedLink({ url: "  https://example.com/q?x=1.)  " })).toBe(
      "https://example.com/q?x=1.)",
    );
    // Not a link: look in the text instead.
    expect(
      extractSharedLink({ url: "Delivery", text: "https://t.example/a" }),
    ).toBe("https://t.example/a");
  });

  it("takes text that is one link and nothing else as written", () => {
    expect(extractSharedLink({ text: "https://example.com/important!" })).toBe(
      "https://example.com/important!",
    );
    expect(
      extractSharedLink({ text: "\nhttps://example.com/it's-here.\n" }),
    ).toBe("https://example.com/it's-here.");
    expect(extractSharedLink({ title: "https://example.com/a)" })).toBe(
      "https://example.com/a)",
    );
  });

  it("keeps apostrophes inside a link in a sentence, and trims the sentence's own", () => {
    expect(
      extractSharedLink({ text: "Mark's link: https://example.com/a'b, ok?" }),
    ).toBe("https://example.com/a'b");
    expect(extractSharedLink({ text: "Open 'https://example.com/x'." })).toBe(
      "https://example.com/x",
    );
    expect(
      extractSharedLink({
        text: "Look at this https://example.com/important!",
      }),
    ).toBe("https://example.com/important");
    expect(
      extractSharedLink({
        text: "(see https://en.wikipedia.org/wiki/Mercury_(planet))",
      }),
    ).toBe("https://en.wikipedia.org/wiki/Mercury_(planet)");
  });

  it("normalizes centrally: scheme case, default port, fragment", () => {
    expect(
      extractSharedLink({ text: "HTTPS://Login.Example:443/path#frag" }),
    ).toBe("https://login.example/path");
  });

  it("returns null without an http(s) link, or when the first can't be checked", () => {
    expect(extractSharedLink({})).toBeNull();
    expect(extractSharedLink({ text: "just words" })).toBeNull();
    expect(extractSharedLink({ text: "ftp://files.example/x" })).toBeNull();
    expect(extractSharedLink({ text: "bare.example/no-scheme" })).toBeNull();
    expect(
      extractSharedLink({
        text: "http://localhost:8080/admin then https://public.example/",
      }),
    ).toBeNull();
    expect(extractSharedLink({ url: "http://192.168.1.1/" })).toBeNull();
  });
});

describe("isShareTargetLaunch", () => {
  const headers = (site?: string) =>
    new Headers(site ? { "sec-fetch-site": site } : {});

  it("accepts only a POST the browser made itself (Sec-Fetch-Site: none)", () => {
    expect(isShareTargetLaunch("POST", headers("none"))).toBe(true);
  });

  it("refuses forms other sites post, and same-site or same-origin ones", () => {
    expect(isShareTargetLaunch("POST", headers("cross-site"))).toBe(false);
    expect(isShareTargetLaunch("POST", headers("same-site"))).toBe(false);
    expect(isShareTargetLaunch("POST", headers("same-origin"))).toBe(false);
  });

  it("fails closed without the header, and for anything but POST", () => {
    expect(isShareTargetLaunch("POST", headers())).toBe(false);
    // A link tapped in another app opens as a browser-initiated GET.
    expect(isShareTargetLaunch("GET", headers("none"))).toBe(false);
  });
});

describe("resolvePrefill", () => {
  it("prefills a checkable link, normalized", () => {
    expect(resolvePrefill("example.com/a")).toBe("https://example.com/a");
    expect(resolvePrefill("HTTPS://Example.com:443/a#x")).toBe(
      "https://example.com/a",
    );
  });

  it("prefills nothing for a missing, invalid, or unscannable value", () => {
    expect(resolvePrefill(null)).toBeNull();
    expect(resolvePrefill("")).toBeNull();
    expect(resolvePrefill("javascript:alert(1)")).toBeNull();
    expect(resolvePrefill("http://127.0.0.1/")).toBeNull();
    expect(resolvePrefill("not a link at all")).toBeNull();
  });
});
