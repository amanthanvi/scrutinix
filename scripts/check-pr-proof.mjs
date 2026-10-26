#!/usr/bin/env node
// Fails a pull request whose body has no Proof section quoting its current
// head SHA in full. Run by .github/workflows/proof.yml with the pull request
// as the REST API returns it, read fresh so a re-run sees the body as it is
// now, not as the triggering event saw it.
//
//   node scripts/check-pr-proof.mjs <pull.json>
//
// HEAD_SHA is the head the run was triggered for. A run whose head is no
// longer the pull request's head fails: a pass there would prove nothing.
// The body is never printed.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t#]*$/;

function headingOf(line) {
  const match = HEADING.exec(line);
  if (!match) return null;
  return { level: match[1].length, text: match[2] ?? "" };
}

/** Every Proof section in a Markdown body: from its ATX heading to the next heading at the same level or above. Headings inside code fences don't count, and nothing inside an HTML comment does: it doesn't render, and an unclosed one hides the rest of the body. */
export function proofSections(body) {
  const visible = String(body ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const lines = visible.split(/\r?\n/);
  const sections = [];
  let fence = null;
  let open = null;

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
    }

    const heading = fence === null && !fenceMatch ? headingOf(line) : null;
    if (heading) {
      if (open && heading.level <= open.level) {
        sections.push(open.lines.join("\n"));
        open = null;
      }
      if (!open && /^proof\b/i.test(heading.text)) {
        open = { level: heading.level, lines: [] };
        continue;
      }
    }
    if (open) open.lines.push(line);
  }
  if (open) sections.push(open.lines.join("\n"));
  return sections;
}

export function checkPrProof({ body, headSha, liveHeadSha }) {
  if (!FULL_SHA.test(headSha ?? "")) {
    return { ok: false, message: "No head SHA for this run." };
  }
  if (liveHeadSha && liveHeadSha.toLowerCase() !== headSha.toLowerCase()) {
    return {
      ok: false,
      message: `This run is for ${headSha}, but the pull request's head is now ${liveHeadSha}. The run for the new head decides.`,
    };
  }

  const sections = proofSections(body);
  if (sections.length === 0) {
    return {
      ok: false,
      message: `The pull request body has no Proof section. Add a "### Proof" section that quotes the head SHA ${headSha} in full.`,
    };
  }

  const cited = new RegExp(`(?<![0-9a-f])${headSha}(?![0-9a-f])`, "i");
  if (!sections.some((section) => cited.test(section))) {
    return {
      ok: false,
      message: `The Proof section does not quote the current head SHA ${headSha} in full. Replace the proof for this head.`,
    };
  }

  return { ok: true, message: `Proof section quotes head ${headSha}.` };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/check-pr-proof.mjs <pull.json>");
    process.exit(2);
  }
  const pull = JSON.parse(readFileSync(file, "utf8"));
  const result = checkPrProof({
    body: pull.body,
    headSha: process.env.HEAD_SHA || pull.head?.sha,
    liveHeadSha: pull.head?.sha,
  });
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
