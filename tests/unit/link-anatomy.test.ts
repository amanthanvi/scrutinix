import { parse } from "tldts";
import { describe, expect, it } from "vitest";

import {
  findImpersonatedDomain,
  redirectDestination,
  registrableDomainOf,
  splitLinkAnatomy,
} from "@/lib/domain/link-anatomy";
import { getRegistrableDomain } from "@/lib/domain/registrable-domain";

const split = (url: string) => splitLinkAnatomy(parse, url);

describe("splitLinkAnatomy", () => {
  it("splits scheme, subdomain, registered domain, port, and path", () => {
    expect(split("https://www.example.co.uk:8443/a/b?c=1#d")).toEqual({
      href: "https://www.example.co.uk:8443/a/b?c=1#d",
      scheme: "https",
      userinfo: "",
      subdomain: "www",
      registeredDomain: "example.co.uk",
      port: ":8443",
      path: "/a/b?c=1#d",
      isIp: false,
      impersonates: null,
    });
  });

  it("names a domain spelled in the login name, which browsers ignore", () => {
    expect(split("https://www.paypal.com:pw@secure-login.xyz/")).toMatchObject({
      userinfo: "www.paypal.com",
      registeredDomain: "secure-login.xyz",
      impersonates: "paypal.com",
    });
    expect(split("https://user@example.com/")?.impersonates ?? null).toBeNull();
    expect(split("https://a:secret@example.com/")?.href).not.toContain(
      "secret",
    );
  });

  it("drops a bare root path and keeps private-suffix tenants whole", () => {
    expect(split("https://safe.github.io/")).toMatchObject({
      subdomain: "",
      registeredDomain: "safe.github.io",
      path: "",
    });
  });

  it("treats IP literals as their own owner", () => {
    expect(split("http://192.168.0.1/login")).toMatchObject({
      isIp: true,
      registeredDomain: "192.168.0.1",
      subdomain: "",
      impersonates: null,
    });
    expect(split("http://[::1]:8080/")).toMatchObject({
      isIp: true,
      registeredDomain: "[::1]",
      port: ":8080",
    });
  });

  it("rejects anything that is not an http(s) URL", () => {
    expect(split("not a url")).toBeNull();
    expect(split("ftp://example.com/file")).toBeNull();
    expect(split("javascript:alert(1)")).toBeNull();
  });
});

describe("impersonation", () => {
  it.each([
    [
      "https://paypal.com.secure-login.xyz/verify",
      "secure-login.xyz",
      "paypal.com",
    ],
    // A run followed by more labels: every contiguous run is tested.
    [
      "https://www.paypal.com.signin.secure-login.xyz/",
      "secure-login.xyz",
      "paypal.com",
    ],
    // The e2e fixture host: the owner is on a non-ICANN suffix.
    [
      "https://paypal.com.malicious.scrutinix.test/",
      "scrutinix.test",
      "paypal.com",
    ],
    [
      "https://login.paypal.co.uk.account-check.top/",
      "account-check.top",
      "paypal.co.uk",
    ],
    ["https://apple.com.de.verify-id.net/", "verify-id.net", "apple.com"],
    // A country-code run counts when it names an impersonated brand.
    [
      "https://amazon.de.account-verify.net/",
      "account-verify.net",
      "amazon.de",
    ],
    [
      "https://secure.paypal.fr.login-check.top/",
      "login-check.top",
      "paypal.fr",
    ],
  ])("%s belongs to %s, not %s", (url, owner, brand) => {
    const anatomy = split(url);
    expect(anatomy?.registeredDomain).toBe(owner);
    expect(anatomy?.impersonates).toBe(brand);
  });

  it.each([
    "https://accounts.google.com/signin",
    "https://www.example.com/report.pdf",
    "https://report.pdf.example.com/",
    "https://mail.app.example.com/",
    "https://files.zip.example.com/",
    "https://en.us.example.com/",
    "https://www.us.example.com/",
    "https://www.paypal.com/",
    // The subdomain spells the owner itself: not a look-alike.
    "https://example.com.example.com/",
    "https://a.b.c.example.net/",
    "https://en.wikipedia.org/wiki/Example.com",
    // Regional and tenant hostnames put a country code in the subdomain.
    "https://acme.us.auth0.com/login",
    "https://api.us.example.com/",
    "https://shop.de.example.com/",
    "https://docs.ai.example.com/",
    "https://bank.ca.example.com/",
    "https://news.uk.example.com/",
    "https://portal.eu.example.org/",
  ])("does not flag %s", (url) => {
    expect(split(url)?.impersonates).toBeNull();
  });

  it("returns the first spelled domain when several appear", () => {
    expect(
      findImpersonatedDomain(parse, "paypal.com.apple.com.x", "evil.xyz"),
    ).toBe("paypal.com");
  });
});

describe("registrableDomainOf", () => {
  it("shares one implementation with the server helper", () => {
    for (const host of [
      "www.example.co.uk",
      "tenant.vercel.app",
      "192.168.0.1",
      "localhost",
      "EXAMPLE.com.",
      "",
    ]) {
      expect(registrableDomainOf(parse, host)).toBe(getRegistrableDomain(host));
    }
    expect(registrableDomainOf(parse, "EXAMPLE.com.")).toBe("example.com");
  });
});

describe("redirectDestination", () => {
  it("names the final host only when it differs", () => {
    expect(
      redirectDestination("https://bit.example/x", "https://landing.example/"),
    ).toBe("landing.example");
    expect(
      redirectDestination("https://a.example/x", "https://a.example/y"),
    ).toBeNull();
    expect(redirectDestination("https://a.example/", null)).toBeNull();
    expect(redirectDestination("https://a.example/", "nonsense")).toBeNull();
  });
});
