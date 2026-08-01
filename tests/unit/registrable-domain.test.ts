import { describe, expect, it } from "vitest";

import {
  getRegistrableDomain,
  getRegistrableLabel,
} from "@/lib/domain/registrable-domain";

describe("getRegistrableDomain", () => {
  it("returns the last two labels for generic TLDs", () => {
    expect(getRegistrableDomain("www.example.com")).toBe("example.com");
    expect(getRegistrableDomain("a.b.c.example.net")).toBe("example.net");
    expect(getRegistrableDomain("example.org")).toBe("example.org");
  });

  it("keeps three labels for known two-level public suffixes", () => {
    expect(getRegistrableDomain("www.example.co.uk")).toBe("example.co.uk");
    expect(getRegistrableDomain("shop.example.com.au")).toBe("example.com.au");
    expect(getRegistrableDomain("example.co.jp")).toBe("example.co.jp");
  });

  it("passes through IPs, single labels, and trailing dots", () => {
    expect(getRegistrableDomain("192.0.2.10")).toBe("192.0.2.10");
    expect(getRegistrableDomain("localhost")).toBe("localhost");
    expect(getRegistrableDomain("Example.COM.")).toBe("example.com");
  });
});

describe("getRegistrableLabel", () => {
  it("returns the leftmost label of the registrable domain", () => {
    expect(getRegistrableLabel("www.paypal.com")).toBe("paypal");
    expect(getRegistrableLabel("login.paypal.co.uk")).toBe("paypal");
    expect(getRegistrableLabel("paypal.com.evil.example")).toBe("evil");
  });
});
