import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEnv,
  isProviderConfigured,
  resetEnvForTests,
} from "@/lib/config/env";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

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

  it("never signs with the published e2e key outside fixture mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const published = "e2e-only-share-signing-key-not-a-real-secret-0001";
    vi.stubEnv("SHARE_SIGNING_SECRET", published);
    vi.stubEnv("SCRUTINIX_TEST_FIXTURES", "");
    resetEnvForTests();
    expect(getEnv().SHARE_SIGNING_SECRET).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("published e2e test key");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(published);

    // The flag that used to unlock it outside fixture mode is gone.
    vi.stubEnv("SCRUTINIX_E2E", "1");
    resetEnvForTests();
    expect(getEnv().SHARE_SIGNING_SECRET).toBeUndefined();
    warn.mockRestore();
  });

  it("signs only with the published e2e key in fixture mode", () => {
    // Fixtures score any unknown host Safe: a real key there would sign a
    // "Safe" for whatever link anyone asks about.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const published = "e2e-only-share-signing-key-not-a-real-secret-0001";
    const real = "a-real-production-share-key-0123456789abcdef";
    const previous = "a-real-previous-share-key-0123456789abcdef";
    vi.stubEnv("SCRUTINIX_TEST_FIXTURES", "1");
    vi.stubEnv("SHARE_SIGNING_SECRET", real);
    vi.stubEnv("SHARE_SIGNING_SECRET_PREVIOUS", previous);
    resetEnvForTests();
    expect(getEnv().SHARE_SIGNING_SECRET).toBeUndefined();
    expect(getEnv().SHARE_SIGNING_SECRET_PREVIOUS).toBeUndefined();
    // One warning for both keys, naming them but never their values.
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain("SHARE_SIGNING_SECRET");
    expect(logged).toContain("SHARE_SIGNING_SECRET_PREVIOUS");
    expect(logged).toContain("test fixtures are on");
    expect(logged).not.toContain(real);
    expect(logged).not.toContain(previous);

    warn.mockClear();
    vi.stubEnv("SHARE_SIGNING_SECRET", published);
    vi.stubEnv("SHARE_SIGNING_SECRET_PREVIOUS", "");
    resetEnvForTests();
    expect(getEnv().SHARE_SIGNING_SECRET).toBe(published);
    expect(warn).not.toHaveBeenCalled();
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
