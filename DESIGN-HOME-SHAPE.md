# Shape brief — Home `/` + public docs (Daylight Desk)

**Status:** Active — locked by `$impeccable shape /` 2026-07-17.  
**Register:** Product (tool).  
**IA:** Scanner-first **kept** (narrow brand column + wide scan console). Not reopened.  
**Supersedes:** Instrument Casefile (historical text removed; see git history / `DESIGN-REDIRECTION.md`).

**Probes:** `design/probes/probe-daylight-desk.png` (chosen), `probe-ink-margin.png` (rejected — navy-security second-order), `probe-soft-blotter.png` (rejected — stationery costume).

---

## 1. Feature Summary

Scrutinix home is the public URL threat scanner for someone about to forward mail: paste a link (or short batch), watch eight signals stream, read a verdict with confidence and caveats, optionally reopen on-device history. This shape replaces the rejected Casefile costume with **Daylight Desk** — a sharp everyday product tool under bright window light. `/about` and `/privacy` share the same materials (no dossier cosplay).

## 2. Primary User Action

Paste a URL and start a scan — the console is the product; brand and support orbit it.

## 3. Design Direction

- **Color strategy:** Brand chrome **Restrained**; verdict semantics **Full palette** (safe / suspicious / malicious / critical). Accent only on Analyze CTA, live stream, and active verdict.
- **Scene sentence:** Mid-afternoon at a bright ordinary desk under cool window daylight; someone pastes a sketchy link before forwarding mail — anxious, needs calm certainty in seconds. → Dual theme kept (`next-themes`); **default read is light daylight**, dark is evening desk — not SOC vault.
- **Named anchors:** (1) Linear — control density and familiar affordances, (2) Apple Mail compose under window light — calm bright intake, clear primary action, (3) a physical highlighter mark on a white desk blotter — type weight contrast and accent-as-tool-mark, **without** becoming stationery theater.
- **Lane name:** **Daylight Desk**.

### Why this escapes second-order traps

| Reflex | Trap if “avoided badly” | Daylight Desk escape |
| --- | --- | --- |
| Security tool → CRT/cyberpunk | Cool steel lab dials / neon cockpit | Scene is ordinary desk light, not a vault or SOC |
| Security tool → dossier | Editorial “trust brochure” / navy shield SaaS | No folio/stamp/exhibit props; materials from daylight + density, not seriousness metaphors |
| Not cream SaaS | Purple-indigo or parchment | Cool sky-tinted neutrals (OKLCH, chroma toward ~220–235), ink accent — not warm cream, not purple |

Grounding is the **mail-forwarder desk scene**, not a new “security seriousness” costume class.

### Keep

- Scanner-first intro grid (narrow story / wide console)
- Summary ↔ Full labelled `role="switch"`
- Method/caveat notes on `/about` (not a home card grid)
- `globals.css` tokens vs `scrutinix.css` effects seam
- Branded `components/scrutinix/*` (no broad shadcnization)
- Semantic verdict tokens and advisor correctness

### Kill

- CRT / radar / glow / scan-line theater
- Folio / ledger / stamp / dossier / exhibit / instrument-dial costume
- Side-stripe severity edges (keep top rail + surface tint)
- Footer marquee (stay quiet static status)
- Cream/sand body; purple SaaS; WebGL wow

## 4. Scope

- **Fidelity:** Production-ready
- **Breadth:** Home `/`, `/about`, `/privacy`, shared chrome
- **Interactivity:** Shipped components
- **Time intent:** `$impeccable craft /` then polish as needed — not full overdrive unless asked

## 5. Layout Strategy

1. Header: quiet chrome + threat progress when active
2. Hero band: brand wordmark (hero-level) + one line + **dominant intake console**
3. Workspace: verdict reading surface → signal lanes (Summary/Full) → history rail
4. Docs: `/about` + `/privacy` carry method and caveats; home stays scanner-only below the workspace
   Rhythm: calm empty → taut live stream → decisive verdict chip (not rubber stamp)

## 6. Key States

| State | Feel / show |
| --- | --- |
| Idle | Quiet desk tool; empty verdict invites paste |
| Streaming | Solid coverage meter; signal rows resolve; score ring is progress readout, not dial theater |
| Result (any verdict) | Verdict chip + score; accent follows verdict |
| Error / rate limit | Clear inline error; no false malicious |
| Empty history | Teach “scans stay on device” |
| Reduced motion | Instant state; no shimmer/sweep |

## 7. Interaction Model

URL → Analyze (Enter icon) → NDJSON stream fills verdict + signals → Summary/Full density → export/share/rescan → Method/Privacy in chrome. Motion = state only (150–250ms).

## 8. Content Requirements

Product copy density kept; Casefile vocabulary stripped (“casefile”, “exhibit”, “evidence surface” as costume). Tagline grounded in forward-before-you-open. Console method notes live on `/about`. No marketing stats strip in hero.

## 9. Recommended References (impl)

`product.md` (loaded), skill color/contrast rules, `typeset.md` / `layout.md` during craft for type contrast + scanner-first rhythm.

## 10. Token / effects strategy

- Retint `--sx-*` toward **daylight desk**: cool sky neutrals (not cream L/C band, not steel-instrument chrome)
- Verdict semantics remain full-palette; verify contrast on new surfaces
- Effects: quiet labels, panels, coverage meter, score arc (functional), verdict **badge** — no stamp-in, no dial ticks as identity
- Skip `palette.mjs` — deliberate retint of committed `--sx-*` system

## Decisions locked

- Light vs dark: system / `next-themes`; scene favors bright daylight as the primary identity read
- Footer: quiet static status line
- About/privacy: Daylight Desk materials, not Casefile leftovers
- Baseline after this shape commit: Casefile chrome **discarded** so craft does not polish dossier UI
