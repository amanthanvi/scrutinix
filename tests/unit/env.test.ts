import { describe, expect, it } from "vitest";

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
});
