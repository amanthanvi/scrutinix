import { afterEach, beforeEach, vi } from "vitest";

import { resetEnvForTests } from "@/lib/config/env";
import { analysisCache } from "@/lib/server/cache";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
  resetEnvForTests();
  analysisCache.clear();
  globalThis.__devRateLimitStore?.clear();
  globalThis.__openPhishFeedCache = undefined;
  globalThis.__openPhishFeedInflight = undefined;
  globalThis.__dnsblZoneHealth = undefined;
  globalThis.__vtDomainReputationCache = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  analysisCache.clear();
  globalThis.__devRateLimitStore?.clear();
});
