---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/about/page.tsx","app/privacy/page.tsx","app/opengraph-image.tsx"]
---

# Surface brief: Scrutinix home (`/`)

**Mode:** Operate. The visitor completes one task: decide whether to open or forward a link.
**Audience:** an anxious non-expert holding a suspicious link (primary); power users wanting full evidence (secondary).
**Related surfaces:** `/about`, `/privacy`, shared-snapshot view (`/?shared=`), OG/share images.
**Constraints:** WCAG 2.1 AA, axe at zero, Lighthouse Perf ≥ 0.90 / A11y ≥ 0.95, light and dark designed equally, CSP nonces, offline e2e fixtures.

## Direction contract

THESIS: The verdict is the product, said plainly and big, on a precise minimal tool that feels like it belongs next to Linear and Vercel. It refuses both the category's cyber dashboard and the old version's underpowered grey form, where the biggest text at rest was "History".

OWN-WORLD: The canonical minimal product tool, played straight at full fidelity. A cool, crisp white ground (light) and a deep neutral-cool ground (dark), each designed on its own. Geist Sans for UI and Geist Mono for URLs and data, on a real type scale with confident display steps. Hairline structure, one static blue accent for actions and focus, and verdict hues only where a verdict is stated. Precise 1px borders on controls, tabular numerals, and themed browser surfaces. No costume, no quirk.

STORY: The visitor understands at once what this does ("Check a link before you click"), pastes, and watches eight checks land as eight cells. They then read one sentence they can act on ("Don't open this link."), see who really owns the link, and expand the evidence only if they want it. They leave trusting the answer because it admits what it couldn't check.

FIRST VIEWPORT: Header (the eight-square mark plus the Scrutinix wordmark, then About, Privacy and theme). A visible headline at display size with one supporting line. The Single/Batch tabs, then the URL input with Paste and a ready primary Analyze button, all inside the first viewport on desktop and mobile. After a scan: the verdict band (a column-wide, low-chroma verdict surface with the verdict word at 40–56px, the imperative directly beneath, and the score plus its band only when scored), then the link anatomy line (registered domain emphasised, everything else quiet, a plain look-alike sentence), then the eight-cell strip, then the Summary/Full evidence rows, then actions. On mobile the verdict lands in view when a scan completes.

FORM: The standing exit, the category canon. It was chosen by the user over three dealt directions (Label, Signage, Line) after live drafts. Seed key ccccb7f7. The craft bar is Linear and Vercel.

Signature move: the eight-cell strip. It is the streaming progress, the evidence index, the history and batch glyph, the brand mark, and the share-image motif: one grammar at every scale.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

None pending from the user. The look-alike finding influences verdict wording only; scoring changes are out of scope for this PR.
