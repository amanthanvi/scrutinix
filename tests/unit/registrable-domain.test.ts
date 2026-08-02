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

  it("keeps three labels for two-level public suffixes", () => {
    expect(getRegistrableDomain("www.example.co.uk")).toBe("example.co.uk");
    expect(getRegistrableDomain("shop.example.com.au")).toBe("example.com.au");
    expect(getRegistrableDomain("example.co.jp")).toBe("example.co.jp");
  });

  it("treats private suffix tenants as independent registrable domains", () => {
    expect(getRegistrableDomain("safe.github.io")).toBe("safe.github.io");
    expect(getRegistrableDomain("www.safe.github.io")).toBe("safe.github.io");
    expect(getRegistrableDomain("alpha.pages.dev")).toBe("alpha.pages.dev");
    expect(getRegistrableDomain("tenant.vercel.app")).toBe("tenant.vercel.app");
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
