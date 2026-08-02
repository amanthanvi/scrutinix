import { describe, expect, it } from "vitest";

import { analyzePageContent } from "@/lib/domain/content-analysis";

const FINAL_URL = "https://landing.example/login";

describe("analyzePageContent", () => {
  it("extracts the title and collapses whitespace", () => {
    const findings = analyzePageContent(
      "<html><head><title>\n  Secure   Login\n</title></head></html>",
      FINAL_URL,
    );

    expect(findings.title).toBe("Secure Login");
  });

  it("flags forms posting to a different registrable domain", () => {
    const html = `
      <form action="https://collector.evil/steal" method="post"></form>
      <form action="/local-login" method="post"></form>
      <form action="https://sub.landing.example/ok"></form>
      <form method="post"></form>
    `;

    const findings = analyzePageContent(html, FINAL_URL);

    expect(findings.crossOriginFormHosts).toEqual(["collector.evil"]);
  });

  it("resolves relative form actions against a cross-origin document base", () => {
    const findings = analyzePageContent(
      `<base href=https://evil.example/><form action=/collect><input type=password>`,
      FINAL_URL,
    );

    expect(findings.crossOriginFormHosts).toEqual(["evil.example"]);
    expect(findings.passwordInputCount).toBe(1);
  });

  it("keeps relative form actions local with a same-origin document base", () => {
    const findings = analyzePageContent(
      `<base href="/account/"><form action="collect"></form>`,
      FINAL_URL,
    );

    expect(findings.crossOriginFormHosts).toEqual([]);
  });

  it("uses only the first base with an href, falling back when it is invalid", () => {
    const firstBaseWins = analyzePageContent(
      `<base target="_blank"><base href="/account/"><base href="https://evil.example/"><form action="collect"></form>`,
      FINAL_URL,
    );
    expect(firstBaseWins.crossOriginFormHosts).toEqual([]);

    const invalidFirstBase = analyzePageContent(
      `<base href="http://["><base href="https://evil.example/"><form action="/collect"></form>`,
      FINAL_URL,
    );
    expect(invalidFirstBase.crossOriginFormHosts).toEqual([]);

    const blockedFirstBase = analyzePageContent(
      `<base href="javascript:void(0)"><base href="https://evil.example/"><form action="/collect"></form>`,
      FINAL_URL,
    );
    expect(blockedFirstBase.crossOriginFormHosts).toEqual([]);
  });

  it("counts password inputs and iframes, including hidden ones", () => {
    const html = `
      <input type="password" name="pw">
      <input type='password'>
      <input type=text>
      <iframe src="https://a.example"></iframe>
      <iframe src="https://b.example" style="display:none"></iframe>
      <iframe width="0" height="0" src="https://c.example"></iframe>
    `;

    const findings = analyzePageContent(html, FINAL_URL);

    expect(findings.passwordInputCount).toBe(2);
    expect(findings.iframeCount).toBe(3);
    expect(findings.hiddenIframeCount).toBe(2);
  });

  it("collects obfuscation hints without duplicates", () => {
    const blob = "A".repeat(600);
    const html = `
      <script>
        eval(unescape("%61"));
        var payload = atob("${blob}");
        document.write(unescape(x));
      </script>
    `;

    const findings = analyzePageContent(html, FINAL_URL);

    expect(findings.obfuscationHints).toContain("eval() call");
    expect(findings.obfuscationHints).toContain("unescape() call");
    expect(findings.obfuscationHints).toContain("atob() base64 decoding");
    expect(findings.obfuscationHints).toContain("very long base64-like blob");
  });

  it("resolves meta-refresh targets and rejects non-web schemes", () => {
    const redirecting = analyzePageContent(
      `<meta http-equiv="refresh" content="0; url=https://next.example/page">`,
      FINAL_URL,
    );
    expect(redirecting.metaRefreshTarget).toBe("https://next.example/page");

    const relative = analyzePageContent(
      `<meta http-equiv=refresh content="2;url=/next">`,
      FINAL_URL,
    );
    expect(relative.metaRefreshTarget).toBe("https://landing.example/next");

    const dataScheme = analyzePageContent(
      `<meta http-equiv="refresh" content="0; url=data:text/html,x">`,
      FINAL_URL,
    );
    expect(dataScheme.metaRefreshTarget).toBeNull();
  });

  it("returns empty findings for benign minimal pages", () => {
    const findings = analyzePageContent(
      "<html><body><p>hello</p></body></html>",
      FINAL_URL,
    );

    expect(findings).toEqual({
      title: null,
      crossOriginFormHosts: [],
      passwordInputCount: 0,
      iframeCount: 0,
      hiddenIframeCount: 0,
      obfuscationHints: [],
      metaRefreshTarget: null,
    });
  });
});
