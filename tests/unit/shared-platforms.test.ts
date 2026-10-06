import { describe, expect, it } from "vitest";

import { isSharedPlatformHost } from "@/lib/domain/shared-platforms";

describe("isSharedPlatformHost", () => {
  it("recognizes path-tenanted platforms, ignoring www., case, and a trailing dot", () => {
    for (const host of [
      "github.com",
      "WWW.GitHub.com.",
      "raw.githubusercontent.com",
      "docs.google.com",
      "www.dropbox.com",
      "bit.ly",
    ]) {
      expect(isSharedPlatformHost(host), host).toBe(true);
    }
  });

  it("does not extend to lookalikes, other subdomains, or PSL tenants", () => {
    for (const host of [
      "evilgithub.com",
      "github.com.evil.test",
      "login.github.com.example",
      "safe.github.io",
      "accounts.google.com",
      "mail.dropbox.com",
    ]) {
      expect(isSharedPlatformHost(host), host).toBe(false);
    }
  });
});
