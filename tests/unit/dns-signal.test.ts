import {
  resolve4,
  resolve6,
  resolveCname,
  resolveMx,
  resolveNs,
  resolveTxt,
  reverse,
} from "node:dns/promises";

import { describe, expect, it, vi } from "vitest";

import { runDnsSignal } from "@/lib/server/signals/dns";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  resolveCname: vi.fn(),
  resolveMx: vi.fn(),
  resolveNs: vi.fn(),
  resolveTxt: vi.fn(),
  reverse: vi.fn(),
}));

const resolve4Mock = vi.mocked(resolve4);
const resolve6Mock = vi.mocked(resolve6);
const resolveCnameMock = vi.mocked(resolveCname);
const resolveMxMock = vi.mocked(resolveMx);
const resolveNsMock = vi.mocked(resolveNs);
const resolveTxtMock = vi.mocked(resolveTxt);
const reverseMock = vi.mocked(reverse);

describe("dns signal address redaction", () => {
  it("omits private resolved addresses without echoing them", async () => {
    resolve4Mock.mockResolvedValueOnce(["192.168.1.20", "93.184.216.34"]);
    resolve6Mock.mockRejectedValueOnce(new Error("ENODATA"));
    resolveCnameMock.mockRejectedValueOnce(new Error("ENODATA"));
    resolveMxMock.mockRejectedValueOnce(new Error("ENODATA"));
    resolveNsMock.mockRejectedValueOnce(new Error("ENODATA"));
    resolveTxtMock.mockRejectedValueOnce(new Error("ENODATA"));

    const result = await runDnsSignal("https://example.test/");
    const payload = JSON.stringify(result);

    expect(result.addresses).toEqual(["93.184.216.34"]);
    expect(result.observations).toContain(
      "Private or reserved addresses were omitted from the DNS result.",
    );
    expect(payload).not.toContain("192.168.1.20");
  });

  it("redacts literal private IP subjects", async () => {
    reverseMock.mockResolvedValueOnce([]);

    const result = await runDnsSignal("http://10.0.0.5/");
    const payload = JSON.stringify(result);

    expect(result.subjectType).toBe("ip");
    expect(result.addresses).toEqual([]);
    expect(result.observations).toContain(
      "Private or reserved addresses were omitted from the DNS result.",
    );
    expect(payload).not.toContain("10.0.0.5");
  });
});
