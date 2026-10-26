import { beforeEach, describe, expect, it, vi } from "vitest";

import { classifyUrlLocally } from "@/lib/server/ml/local-classifier";
import { runMlEnsembleProvider } from "@/lib/server/providers/ml-ensemble";

vi.mock("@/lib/server/ml/local-classifier", () => ({
  classifyUrlLocally: vi.fn(),
}));

const classifierMock = vi.mocked(classifyUrlLocally);

describe("runMlEnsembleProvider", () => {
  beforeEach(() => {
    classifierMock.mockReset();
  });

  it("combines a phishing transformer call with risky lexical structure", async () => {
    classifierMock.mockResolvedValue({
      label: "malicious",
      score: 0.91,
      reasons: [
        "The local URL model classified this link as phishing with 91% confidence.",
      ],
      model: "urlbert-tiny-v4-phishing-q8",
    });

    const result = await runMlEnsembleProvider(
      "https://xn--secure-account.top/login/verify/update?token=%2Fabc",
    );

    expect(result.transformerModel).toMatchObject({
      label: "malicious",
      model: "urlbert-tiny-v4-phishing-q8",
    });
    expect(result.lexicalModel.label).toBe("risky");
    expect(result.consensusLabel).toBe("malicious");
    expect(classifierMock).toHaveBeenCalledWith(
      "https://xn--secure-account.top/login/verify/update?token=%2Fabc",
    );
  });

  it("keeps benign transformer predictions benign for clean URLs", async () => {
    classifierMock.mockResolvedValue({
      label: "benign",
      score: 0.99,
      reasons: [
        "The local URL model classified this link as benign with 99% confidence.",
      ],
      model: "urlbert-tiny-v4-phishing-q8",
    });

    const result = await runMlEnsembleProvider("https://example.com/");

    expect(result.transformerModel).toMatchObject({ label: "benign" });
    expect(result.consensusLabel).toBe("benign");
    expect(result.warnings).toEqual([]);
  });

  it("reads a lure word in the query, which the link pattern model leaves out", async () => {
    classifierMock.mockResolvedValue({
      label: "benign",
      score: 0.99,
      reasons: ["The link pattern model read this link as normal."],
      model: "urlbert-tiny-v4-phishing-q8",
    });

    const result = await runMlEnsembleProvider(
      "https://shop-example.com/?next=paypal-verify",
    );

    expect(result.lexicalModel.reasons).toContain(
      "The URL contains high-risk terms such as verify.",
    );
    // The same link with no lure in it gets no such term.
    const plain = await runMlEnsembleProvider(
      "https://shop-example.com/?next=home",
    );
    expect(plain.lexicalModel.reasons.join(" ")).not.toMatch(/high-risk/);
  });

  it("elevates IP, non-default HTTPS port, and script path over a benign transformer call", async () => {
    classifierMock.mockResolvedValue({
      label: "benign",
      score: 0.88,
      reasons: [
        "The local URL model classified this link as benign with 88% confidence.",
      ],
      model: "urlbert-tiny-v4-phishing-q8",
    });

    const result = await runMlEnsembleProvider(
      "https://15.58.86.110:38376/bin.sh",
    );

    expect(result.transformerModel).toMatchObject({ label: "benign" });
    expect(result.lexicalModel.label).toBe("malicious");
    expect(result.consensusLabel).toBe("malicious");
    expect(result.lexicalModel.reasons.join(" ")).toMatch(
      /literal IP|\.sh|38376/i,
    );
  });

  it("falls back to lexical heuristics with a warning when the classifier fails", async () => {
    classifierMock.mockRejectedValue(
      new Error("Local URL classifier initialization timed out after 10000ms"),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runMlEnsembleProvider(
      "https://45.151.155.223/x86_64?download=setup",
      "scan-5678",
    );

    // The partial result shows its scan id as the reference: the log must
    // be findable by it.
    const logged = warnSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(logged).toContain('"correlationId":"scan-5678"');
    warnSpy.mockRestore();
    expect(result.transformerModel).toBeNull();
    expect(result.warnings[0]).toMatch(/only the structure checks ran/);
    expect(result.warnings[0]).not.toMatch(/timed out/);
    expect(result.lexicalModel.label).toBe("malicious");
    expect(result.consensusLabel).toBe("malicious");
    expect(result.lexicalModel.reasons.join(" ")).toMatch(
      /literal IP address|executable-style content/i,
    );
  });
});
