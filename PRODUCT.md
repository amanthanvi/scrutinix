# Product

<!-- impeccable:product-schema 1 -->

Scrutinix — a FOSS public URL threat analyzer at https://www.scrutinix.net.
People paste a link, watch eight separate security signals stream in, and
get a verdict they can trust enough to decide whether to open or forward it.

## Platform

web

## Users

- **Primary:** a non-technical person at an ordinary desk or on a phone who
  just received a suspicious link by email or text and is about to open or
  forward it. Anxious; needs calm certainty in seconds and a plain answer to
  "should I open this?" — not a SOC analyst in a vault.
- **Secondary:** developers, security enthusiasts, and IT staff who want the
  full evidence: raw engine results, certificate, registration, DNS, redirect
  hops, batch scans, and exports. (SPEC.md §2.1)

Both use the same tool; a Summary/Full control adapts density without separate
interfaces or accounts.

## Product Purpose

Turn a fragmented workflow — browser warnings, reputation sites, raw
infrastructure lookups — into one streamed, evidence-first verdict with explicit
caveats and privacy-aware defaults. Success: a person can paste any URL, see
first evidence within 10 seconds, understand the verdict and what to do, and
leave without an account.

## Positioning

Honesty is the mechanism a neighboring scanner cannot truthfully copy:

- Eight separate signals (VirusTotal, a local ML classifier, Google Safe
  Browsing, threat feeds, TLS, domain registration, DNS, redirect chain) stream
  as they resolve; nothing waits on the slowest source.
- Confirmed sources can convict; exculpatory evidence never erases a confirmed
  hit.
- An unreachable or uncheckable host returns an honest **Unknown**, never a
  fake "Safe". Lost coverage is stated, and caps confidence.
- History stays on the user's device (IndexedDB). No accounts, no server-side
  URL logging; the ML model runs locally with no hosted inference.

## Operating Context

- Links arrive in mail, texts, chat, and social feeds; the scan happens in the
  moment before clicking or forwarding.
- Results are shared as snapshot links (`?shared=`) in chats and threads, and
  previewed through the OG card. Scrutinix signs each link it issues; only a
  signed link speaks as Scrutinix (verdict, card, "Verified Scrutinix
  result"). Anything else, including links shared before signing, opens as
  "Check this shared link yourself", so a shared link can never launder a
  phishing URL under Scrutinix's name. A signed Safe look-alike previews as
  "Look-alike of <brand>", never "Safe", and a sender whose link can't be
  signed is told so when it is copied.
- Batch mode (up to 10 URLs) serves triage of a suspicious message with several
  links. Exports (JSON/CSV) serve power users and reports.
- Light and dark themes receive equal treatment; system preference is the
  default.

## Capabilities and Constraints

- Verdicts: safe, suspicious, malicious, critical, unknown, error. Score bands:
  0–24 safe, 25–54 suspicious, 55–79 malicious, 80–100 critical.
- NDJSON streaming over `fetch`; per-request CSP nonces; rate limiting in
  `proxy.ts`. Providers degrade honestly when keys are absent.
- WCAG 2.1 AA; axe at zero violations; Lighthouse Performance ≥ 0.90 and
  Accessibility ≥ 0.95 are blocking CI gates.
- Non-goals: accounts, monitoring/alerting, browser extension, CLI/API, native
  app, paid tiers. (SPEC.md §1.4)

## Brand Commitments

- Name: **Scrutinix**. Home headline: "Is this link what it says it is?"
  Tagline in use on the OG card and page title: "Check a link before you
  click."
- Voice: plain, direct, calm; tells the person what to do. No fear-mongering,
  no hype, no security jargon where a plain word exists.
- Out of bounds (user-confirmed across redesigns): casefile / dossier / stamp
  costume, terminal / CRT / radar / glow theater, cream-and-purple SaaS.
- One encoding per fact: a number or severity renders once. No score rings,
  threat gauges, or stacked per-signal badges repeating the same fact.
- Visual lane (owner decision, 2026-10-24, P29.6): the editorial
  fact-checker — the link is the claim under review, reported like a careful
  fact-check (plain question, rated answer, every source named) with no
  newspaper costume. Chosen from a 16-draft bake-off with blind panels: P09
  editorial as the base, P11's registered-domain serif line under the verdict,
  P09's link taken apart and numbered citations. Newsreader (two static cuts)
  tells the story; the system sans runs the interface; the system mono carries
  the link. Light stays a cool, crisp near-white sheet, not warm paper; dark is
  warm paper ink on a cool ground. Buttons are ink; the accent marks links and
  focus only. Supersedes the 2026-10-06 "canonical minimal product tool"
  lane, which remains the record of why the page must not be bland and must
  make the site a link belongs to legible.

## Evidence on Hand

- Real product behavior and deterministic offline fixtures
  (`lib/server/test-fixtures.ts`: malicious, feed-hit, unreachable, benign).
- Method and privacy copy on `/about` and `/privacy`.
- No testimonials, customer logos, usage numbers, or benchmarks exist; do not
  fabricate any. (Inferred from the repository: none are present.)

## Product Principles

1. **Answer first.** The verdict and what to do precede the evidence.
2. **Never fake certainty.** Unknown is a first-class answer; coverage gaps are
   said out loud.
3. **Every fact once.** One encoding per fact; evidence explains, it does not
   repeat.
4. **Private by default.** Nothing about a scan needs to leave the device
   except the scan request itself.
5. **Calm under stakes.** Clear, direct, never alarmist — even when the answer
   is "don't open this".

## Accessibility & Inclusion

WCAG 2.1 AA. The verdict must be announced to assistive technology when a scan
completes; color never carries meaning alone; 44px targets; full keyboard path;
`prefers-reduced-motion` respected.
