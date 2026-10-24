import { describe, expect, it } from "vitest";

import {
  extractSharedLink,
  isShareTargetLaunch,
  resolveLaunch,
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

describe("resolveLaunch", () => {
  it("prefills a checkable link, normalized, without scanning", () => {
    expect(resolveLaunch("example.com/a", undefined)).toEqual({
      url: "https://example.com/a",
      autoScan: false,
    });
  });

  it("scans only when the launch cookie names this exact link", () => {
    expect(
      resolveLaunch("https://example.com/a", "https://example.com/a"),
    ).toEqual({ url: "https://example.com/a", autoScan: true });
    expect(
      resolveLaunch("https://example.com/b", "https://example.com/a"),
    ).toEqual({ url: "https://example.com/b", autoScan: false });
  });

  it("prefills nothing for a missing, invalid, or unscannable value", () => {
    expect(resolveLaunch(null, null)).toBeNull();
    expect(resolveLaunch("", null)).toBeNull();
    expect(resolveLaunch("javascript:alert(1)", null)).toBeNull();
    expect(resolveLaunch("http://127.0.0.1/", "http://127.0.0.1/")).toBeNull();
    expect(resolveLaunch("not a link at all", null)).toBeNull();
  });
});
