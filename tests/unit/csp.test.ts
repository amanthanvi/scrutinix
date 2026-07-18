import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, createCspNonce } from "@/lib/server/csp";

describe("buildContentSecurityPolicy", () => {
  it("uses a nonce script-src without unsafe-inline and keeps connect-src local", () => {
    const nonce = createCspNonce();
    const csp = buildContentSecurityPolicy(nonce);
    const scriptSrc = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src"));

    expect(scriptSrc).toMatch(
      new RegExp(
        `^script-src 'self' 'nonce-${nonce}' 'strict-dynamic'(?: 'unsafe-eval')?$`,
      ),
    );
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toMatch(/connect-src 'self'/);
    expect(csp).not.toContain("virustotal.com");
    expect(csp).not.toContain("safebrowsing.googleapis.com");
    expect(csp).not.toContain("urlhaus-api.abuse.ch");
    expect(csp).not.toContain("openphish.com");
    expect(csp).not.toContain("huggingface.co");
    expect(csp).not.toContain("rdap.org");
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/);
  });
});
