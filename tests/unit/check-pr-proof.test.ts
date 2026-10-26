import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain .mjs script without type declarations.
import { checkPrProof, proofSections } from "@/scripts/check-pr-proof.mjs";

const HEAD = "0b52fb887754fc29fd59c4ffbbdf6c554e77de64";
const OLDER = "1a23cf0fd22a14f99a56002e055ce259dc79a0de";

function check(body: string, headSha = HEAD, liveHeadSha?: string) {
  return checkPrProof({ body, headSha, liveHeadSha }) as {
    ok: boolean;
    message: string;
  };
}

describe("PR Proof guard", () => {
  it("passes a Proof section that quotes the head in full", () => {
    const body = `## Summary\n\nChanges.\n\n### Proof\n\n- Head: \`${HEAD}\`\n- Verify: https://github.com/o/r/actions/runs/1/job/2\n`;
    expect(check(body).ok).toBe(true);
  });

  it("accepts any heading level, case, and a suffix after the word", () => {
    expect(check(`# PROOF for head\n${HEAD}`).ok).toBe(true);
    expect(check(`###### Proof\n${HEAD.toUpperCase()}`).ok).toBe(true);
  });

  it("fails a body with no Proof section", () => {
    const result = check(`## Summary\n\nHead ${HEAD}.`);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no Proof section");
  });

  it("fails a Proof that names an earlier head or only a short prefix", () => {
    expect(check(`### Proof\n\nHead ${OLDER}.`).ok).toBe(false);
    expect(check(`### Proof\n\nHead ${HEAD.slice(0, 12)}.`).ok).toBe(false);
  });

  it("does not count the SHA inside a longer hex string", () => {
    expect(check(`### Proof\n\n${HEAD}ab`).ok).toBe(false);
    expect(check(`### Proof\n\nab${HEAD}`).ok).toBe(false);
  });

  it("does not count the head SHA outside the Proof section", () => {
    const body = `### Proof\n\nHead ${OLDER}.\n\n### Notes\n\nNow at ${HEAD}.`;
    expect(check(body).ok).toBe(false);
  });

  it("keeps subheadings inside the Proof section", () => {
    const body = `## Proof\n\n### CI\n\n- Head ${HEAD}\n\n## Next`;
    expect(check(body).ok).toBe(true);
  });

  it("ignores a Proof heading inside a code fence", () => {
    const body = `## Template\n\n\`\`\`markdown\n### Proof\n${HEAD}\n\`\`\`\n`;
    expect(proofSections(body)).toEqual([]);
    expect(check(body).ok).toBe(false);
  });

  it("does not end the Proof section at a heading inside a fence", () => {
    const body = `### Proof\n\n~~~\n# not a heading\n~~~\n\nHead ${HEAD}\n`;
    expect(check(body).ok).toBe(true);
  });

  it("ignores a Proof or SHA hidden in an HTML comment", () => {
    expect(check(`<!--\n### Proof\n${HEAD}\n-->\n`).ok).toBe(false);
    expect(check(`### Proof\n\n<!-- ${HEAD} -->\nPending.`).ok).toBe(false);
    expect(check(`### Proof\n\nPending.\n<!-- unclosed\n${HEAD}`).ok).toBe(
      false,
    );
    expect(check(`### Proof\n<!-- note -->\nHead ${HEAD}`).ok).toBe(true);
  });

  it("passes when any of several Proof sections quotes the head", () => {
    const body = `### Proof\n${OLDER}\n\n### Proof (rebased)\n${HEAD}\n`;
    expect(check(body).ok).toBe(true);
  });

  it("fails a run whose head is no longer the pull request's head", () => {
    const result = check(`### Proof\n${HEAD}`, HEAD, OLDER);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("head is now");
  });

  it("fails without a full head SHA for the run", () => {
    expect(check(`### Proof\n${HEAD}`, "").ok).toBe(false);
    expect(check(`### Proof\n${HEAD}`, HEAD.slice(0, 7)).ok).toBe(false);
  });

  it("handles an empty or missing body", () => {
    expect(checkPrProof({ body: null, headSha: HEAD }).ok).toBe(false);
    expect(check("").ok).toBe(false);
  });
});
