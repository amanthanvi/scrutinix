import { beforeEach, describe, expect, it } from "vitest";

import {
  classifyUrlLocally,
  resetLocalClassifierForTests,
} from "@/lib/server/ml/local-classifier";

/**
 * Exercises the REAL bundled model (no mocks, no network): this is the
 * regression gate proving the in-repo ONNX artifacts load and classify.
 */
describe("classifyUrlLocally (bundled model)", () => {
  beforeEach(() => {
    resetLocalClassifierForTests();
  });

  it("classifies an obvious credential-phish URL as malicious", async () => {
    const finding = await classifyUrlLocally(
      "http://secure-paypa1-login.com/verify/account.php",
    );

    expect(finding.label).toBe("malicious");
    expect(finding.score).toBeGreaterThan(0.9);
    expect(finding.model).toBe("urlbert-tiny-v4-phishing-q8");
    expect(finding.reasons[0]).toContain("phishing");
  });

  it("classifies a mainstream URL as benign", async () => {
    const finding = await classifyUrlLocally("https://www.wikipedia.org/");

    expect(finding.label).toBe("benign");
    expect(finding.score).toBeGreaterThan(0.5);
  });

  it("reuses the initialized pipeline across calls", async () => {
    await classifyUrlLocally("https://example.org/");
    const started = performance.now();
    await classifyUrlLocally("https://example.net/");

    // Warm inference is single-digit milliseconds; anything near init time
    // means the singleton was rebuilt.
    expect(performance.now() - started).toBeLessThan(500);
  });
});
