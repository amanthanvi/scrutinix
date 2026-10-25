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

THESIS: The link is the claim under review; the page reports on it like a careful fact-check: a plain question, a rated answer, every source named. It refuses newspaper costume as firmly as the category's cyber dashboard: the editorial character is a sentence set well, not props.

OWN-WORLD: The editorial fact-checker (P29.6, owner-chosen from a 16-draft blind bake-off: P09 with P11's domain line). Serif tells the story (Newsreader, exactly two static cuts: 400 at opsz 16, 600 at opsz 60), the system sans runs the interface, the system mono carries the link and data. A cool, crisp near-white sheet by day; a deep cool ground with warm paper ink by night, each designed on its own. Ink buttons; one editor's blue for links, focus, the caret, and selection only. Verdict hues only where a verdict is stated. Squared, ruled, hairline structure; themed browser surfaces; tabular figures.

STORY: The visitor reads the question they already have ("Is this link what it says it is?"), pastes, and sees the link taken apart before anything is sent. They watch eight checks land, then read the verdict, the site the link really belongs to in the serif beneath it, and one instruction ("Don't open this link."). Every answer below cites the numbered cells it comes from, so the evidence is checkable without jargon. They leave trusting it because it says what it couldn't check.

FIRST VIEWPORT: Header (the folded-strip mark and serif wordmark, About, Privacy, theme). The headline at display size (two lines on desktop) with the serif supporting line, then the Single/Batch tabs, the 56px mono field with Paste, and the ink Analyze button, all in the first viewport on desktop and phone. After a scan the headline steps out of sight and the column opens on the squared band under its heavy rule: the verdict word (60/84px), the registered domain (30/44px serif), the instruction (22/26px serif), the score and its band at the right only when scored, the confidence line on the band's hairline. On phones the field and Analyze share one row so the verdict lands in view.

FORM: Editorial, without costume: a rated answer with named sources. The craft bar is a well-set fact-check page: measure, rhythm, and citation, not decoration.

Signature moves: the link taken apart (hairline brackets naming each part, a heavy bracket on the registered domain, stacking on phones) and citation (the strip's cells numbered 1-8 and cited by every Summary answer). The strip stays one grammar at every scale: progress, evidence index, row marker, history and batch glyph, mark, icons, share images.

AUTHORED MOMENT: The rule draws. When a verdict lands, the band's top rule draws left to right (scaleX, 240ms, exponential ease-out) and the verdict word rises 4px as it fades in; drawn in place under reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with an independent critique, DESIGN.md, the sidecar, and every shipping raster carrying its provenance.

## Unresolved

None pending from the user. Not adopted by the owner (do not build): an "already clicked / typed a password" line, plain-words score bands. Copy beyond the headline is unchanged.
