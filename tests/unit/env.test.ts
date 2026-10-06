import { describe, expect, it, vi } from "vitest";

import {
  getEnv,
  isProviderConfigured,
  resetEnvForTests,
} from "@/lib/config/env";

describe("env parsing", () => {
  it("applies defaults for optional values", () => {
    delete process.env.OPENPHISH_FEED_URL;
    resetEnvForTests();

    const env = getEnv();

    expect(env.OPENPHISH_FEED_URL).toBe("https://openphish.com/feed.txt");
  });

  it("reports provider availability", () => {
    process.env.VIRUSTOTAL_API_KEY = "vt-test-key";
    resetEnvForTests();

    expect(isProviderConfigured("VIRUSTOTAL_API_KEY")).toBe(true);
  });

  it("treats empty strings as unset instead of throwing", () => {
    // A copied .env.example ships KEY= placeholders; those must degrade the
    // provider, not brick every scan with a ZodError.
    process.env.VIRUSTOTAL_API_KEY = "";
    process.env.NEXT_PUBLIC_APP_URL = "";
    process.env.OPENPHISH_FEED_URL = "   ";
    resetEnvForTests();

    const env = getEnv();

    expect(env.VIRUSTOTAL_API_KEY).toBeUndefined();
    expect(env.NEXT_PUBLIC_APP_URL).toBeUndefined();
    expect(env.OPENPHISH_FEED_URL).toBe("https://openphish.com/feed.txt");
    expect(isProviderConfigured("VIRUSTOTAL_API_KEY")).toBe(false);
  });

  it("still rejects malformed non-empty values", () => {
    process.env.UPSTASH_REDIS_REST_URL = "not-a-url";
    resetEnvForTests();

    expect(() => getEnv()).toThrow();

    delete process.env.UPSTASH_REDIS_REST_URL;
    resetEnvForTests();
  });

  it("ignores the published e2e key outside an e2e run", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const published = "e2e-only-share-signing-key-not-a-real-secret-0001";
    vi.stubEnv("SHARE_SIGNING_SECRET", published);
    vi.stubEnv("SCRUTINIX_E2E", "");
    resetEnvForTests();
    expect(getEnv().SHARE_SIGNING_SECRET).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("published e2e test key");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(published);

    vi.stubEnv("SCRUTINIX_E2E", "1");
    resetEnvForTests();
    expect(getEnv().SHARE_SIGNING_SECRET).toBe(published);
    warn.mockRestore();
  });

  it("keeps a share-signing secret only when it is at least 32 characters", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("SHARE_SIGNING_SECRET", ` ${"s".repeat(32)} `);
    vi.stubEnv("SHARE_SIGNING_SECRET_PREVIOUS", "");
    resetEnvForTests();
    expect(getEnv().SHARE_SIGNING_SECRET).toBe("s".repeat(32));
    expect(getEnv().SHARE_SIGNING_SECRET_PREVIOUS).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    vi.stubEnv("SHARE_SIGNING_SECRET_PREVIOUS", "p".repeat(31));
    resetEnvForTests();
    expect(getEnv().SHARE_SIGNING_SECRET_PREVIOUS).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("p".repeat(31));
    warn.mockRestore();
  });
});
