import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicError } from "@/lib/domain/public-error";
import { exposeClientError, redactForLogs } from "@/lib/server/client-error";
import { SignalSkipError } from "@/lib/server/signal-error";

const LEAK =
  "ONNXRuntime failed: WRONGPASS s3cret-token dialing redis://default:s3cret-token@cache.internal/phish for https://evil.example/login";

describe("redactForLogs", () => {
  it("strips scanned hosts and any scheme-bearing URL", () => {
    const redacted = redactForLogs(LEAK, [
      "https://evil.example/login",
      "evil.example",
    ]);

    expect(redacted).not.toContain("https://evil.example/login");
    expect(redacted).not.toContain("evil.example");
    expect(redacted).not.toContain("redis://");
    expect(redacted).toContain("ONNXRuntime");
    expect(redacted).toContain("WRONGPASS");
  });
});

describe("exposeClientError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps intentional public and skip messages", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const published = exposeClientError(
      new PublicError("invalid_url", "Only HTTP and HTTPS URLs are supported."),
      {
        correlationId: "scan-1",
        summary: "The scan failed unexpectedly.",
        logEvent: "scan.failed",
      },
    );
    const skipped = exposeClientError(
      new SignalSkipError(
        "Registration lookups are not applicable to literal IP targets.",
      ),
      {
        correlationId: "scan-1",
        summary: "This check could not be completed.",
        logEvent: "signal.failed",
      },
    );

    expect(published).toEqual({
      code: "invalid_url",
      message: "Only HTTP and HTTPS URLs are supported.",
      retryable: false,
    });
    expect(skipped.message).toBe(
      "Registration lookups are not applicable to literal IP targets.",
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("hides internal exception text and logs a redacted copy with the reference id", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = exposeClientError(new Error(LEAK), {
      correlationId: "scan-42",
      summary: "The scan failed unexpectedly.",
      code: "scan_failed",
      logEvent: "scan.failed",
      redact: ["https://evil.example/login", "evil.example"],
    });

    expect(view.code).toBe("scan_failed");
    expect(view.retryable).toBe(true);
    expect(view.message).toBe(
      "The scan failed unexpectedly. Reference: scan-42.",
    );
    expect(view.message).not.toContain("s3cret-token");
    expect(view.message).not.toContain("ONNXRuntime");
    expect(view.message).not.toContain("redis://");

    const logged = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(logged).toContain("scan.failed");
    expect(logged).toContain("scan-42");
    expect(logged).toContain("ONNXRuntime");
    expect(logged).toContain("WRONGPASS");
    expect(logged).not.toContain("redis://");
    expect(logged).not.toContain("https://evil.example/login");
    expect(logged).not.toContain("evil.example");
  });

  it("logs the cause of a public error without showing it", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = exposeClientError(
      new PublicError(
        "lookup_failed",
        "The RDAP response could not be parsed.",
        {
          cause: new Error(LEAK),
        },
      ),
      {
        correlationId: "scan-7",
        summary: "This check could not be completed.",
        logEvent: "signal.failed",
        redact: ["https://evil.example/login", "evil.example"],
      },
    );

    expect(view.message).toBe("The RDAP response could not be parsed.");
    const logged = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(logged).toContain("ONNXRuntime");
    expect(logged).not.toContain("redis://");
    expect(logged).not.toContain("evil.example");
  });
});
