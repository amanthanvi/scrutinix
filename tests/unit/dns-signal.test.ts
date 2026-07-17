import {
  resolve4,
  resolve6,
  resolveCname,
  resolveMx,
  resolveNs,
  resolveTxt,
} from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDnsSignal } from "@/lib/server/signals/dns";

vi.mock("node:dns/promises", () => ({
  reverse: vi.fn(),
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  resolveCname: vi.fn(),
  resolveMx: vi.fn(),
  resolveNs: vi.fn(),
  resolveTxt: vi.fn(),
}));

const resolve4Mock = vi.mocked(resolve4);
const resolve6Mock = vi.mocked(resolve6);
const resolveCnameMock = vi.mocked(resolveCname);
const resolveMxMock = vi.mocked(resolveMx);
const resolveNsMock = vi.mocked(resolveNs);
const resolveTxtMock = vi.mocked(resolveTxt);

function mockEmptyLookups() {
  resolve4Mock.mockRejectedValue(
    Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
  );
  resolve6Mock.mockRejectedValue(
    Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
  );
  resolveCnameMock.mockRejectedValue(
    Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
  );
  resolveMxMock.mockRejectedValue(
    Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
  );
  resolveNsMock.mockRejectedValue(
    Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
  );
  resolveTxtMock.mockRejectedValue(
    Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
  );
}

describe("runDnsSignal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns public A and AAAA addresses for a hostname", async () => {
    mockEmptyLookups();
    resolve4Mock.mockResolvedValue(["93.184.216.34"]);
    resolve6Mock.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);
    resolveMxMock.mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 },
    ]);
    resolveNsMock.mockResolvedValue(["ns1.example.com"]);
    resolveTxtMock.mockResolvedValue([["v=spf1 -all"]]);

    const result = await runDnsSignal("https://example.com/path");

    expect(result.subjectType).toBe("hostname");
    expect(result.addresses).toEqual([
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    expect(result.mx).toEqual(["mail.example.com"]);
    expect(result.nameservers).toEqual(["ns1.example.com"]);
    expect(result.txt).toEqual(["v=spf1 -all"]);
    expect(result.anomalies).toEqual([]);
    expect(result.observations).toEqual([]);
  });

  it("observes when no A, AAAA, or CNAME records are returned", async () => {
    mockEmptyLookups();

    const result = await runDnsSignal("https://missing.example/");

    expect(result.addresses).toEqual([]);
    expect(result.cnames).toEqual([]);
    expect(result.observations).toContain(
      "No A, AAAA, or CNAME records were returned for the hostname.",
    );
  });

  it("flags punycode hostnames as anomalies", async () => {
    mockEmptyLookups();
    resolve4Mock.mockResolvedValue(["93.184.216.34"]);

    const result = await runDnsSignal("https://xn--e1aybc.example/");

    expect(result.anomalies).toContain("The hostname uses punycode encoding.");
    expect(result.addresses).toEqual(["93.184.216.34"]);
  });

  // plan 001 will tighten private-IP redaction; assert current behavior honestly until then.
  it("currently includes private addresses returned by DNS lookups", async () => {
    mockEmptyLookups();
    resolve4Mock.mockResolvedValue(["10.0.0.5"]);

    const result = await runDnsSignal("https://internal.example/");

    expect(result.addresses).toEqual(["10.0.0.5"]);
  });
});
