# PLAN.md

Living execution plan for Scrutinix. This file reflects the implemented ship
state plus the landed analysis-hardening and review-remediation work.

> **Superseded — 2026-08 minimal redesign.** The frontend entries below
> describe the pre-redesign UI and are kept as history. The shipped system is
> now a single-column minimal shell (`max-w-[44rem]`): no two-column
> workspace, no sticky history rail, an accessible Summary/Full signal switch
> over per-row `<details>` disclosure, and no verdict-driven accent. `DESIGN.md`
> is the current source of truth for the visual system; `CLAUDE.md` for the
> component map.

## Status Legend

- `[ ]` not started
- `[-]` in progress
- `[x]` completed
- `[!]` blocked / needs revisit

## Current Snapshot

- Date: 2026-10-06
- Execution status: `P21-P27 complete; P28 canonical redesign implemented, verified locally, and documented (DESIGN.md)`
- Platform:
  - Next.js `16.3.4`
  - React `19.2.x`
  - Node `24.20.0 LTS` (`.nvmrc`; deploy compatibility remains `24.x`)
  - ESLint `10.x` with direct Next.js, React, hooks, TypeScript, and JSX accessibility plugins
  - NDJSON streaming over `fetch`
- Architecture:
  - `proxy.ts` enforces rate limits on `/api/analyze` request paths (scan tier: 10/min, 50/day) and on the per-result share image `/og/result` (its own image tier: 30/min, 600/day, so previews never spend scan quota).
  - Node.js route handlers orchestrate eight signals and stream normalized results.
  - IndexedDB stores client-only history, export state, and re-scan sources.
  - The ML ensemble uses a bundled quantized ONNX URL classifier plus lexical heuristics (shown to people as "link pattern model" and "structure checks"); scans do not call hosted inference.
  - Threat-feed coverage combines URLhaus, cached OpenPhish, ThreatFox, and Spamhaus DBL (via DQS when `SPAMHAUS_DQS_KEY` is set) / SURBL DNSBL lookups. On path-tenanted shared platforms only exact-URL feed evidence scores.
  - Complete, non-partial results use a 15-minute process-local LRU plus optional shared Redis cache; error, partial-failure, and aborted results are never reused. Production uses the Vercel-connected Upstash store (`KV_REST_API_*`) for rate limiting and the shared cache. Cached results are namespaced per environment (and per preview commit).
  - The home page renders as the canonical minimal product tool in a `46rem` column (P28): a display headline, the scan form, then the verdict band, link anatomy, the eight-cell strip, Summary/Full evidence rows, and local history in one flow. Method and caveat notes live on `/about`.
  - The public site shares one column, header, and footer across `/`, `/about`, and `/privacy` (`public-page-shell.tsx`), so the method and privacy pages stay visually aligned with the scanner.
  - The UI is its own token system (P28), not a shadcn preset: `app/globals.css` holds the cool-white light and deep neutral-cool dark tokens, one blue accent, per-verdict graphic/`-fg`/`-surface`/`-edge` tokens, a non-verdict `--sx-danger-*` pair for UI errors, and the eight-cell ramp; `app/scrutinix.css` holds CSS-only motion and the cell shapes. `scripts/check-contrast.mjs` guards every pair in both themes.
  - Geist Sans carries UI and display type on a custom scale; Geist Mono is reserved for links, the registered domain, scores, and other data.
  - Favicons, app icons, and the manifest icons are checked-in assets under `public/`, regenerated from `lib/brand-mark.ts` by `npm run icons` (sharp, pinned devDependency).
  - Production headers include CSP, permissions policy, referrer policy, and anti-sniff/frame protections.
  - Pull requests and `main` pushes run fixture-backed Playwright plus blocking Lighthouse Performance `>= 0.90` and Accessibility `>= 0.95` gates against an explicitly provisioned Chromium executable.
- Intentional baseline decision:
  - `package-lock.json` drift from the platform refresh bootstrap was kept intentionally because the project was fully re-scaffolded onto the new dependency graph.

## Verification Summary

Completed local verification:

- `npm run lint`
- `npm run format -- --check .`
- `npm run typecheck`
- `npm run test:unit -- --run`
- `npm run test:integration -- --run`
- `npm run test:dom -- --run`
- `npm run test:e2e`
- `npm run build`
- `npm audit`
- `npm run lighthouse`

Completed deployment verification:

- `npx vercel env ls --scope aman-thanvis-projects`
- `npx vercel inspect <protected preview deployment> --scope aman-thanvis-projects`
- `HEAD https://www.scrutinix.net`
- `POST https://www.scrutinix.net/api/analyze`

Observed results:

- Unit tests: `31` files passed, `218` tests passed.
- Integration tests: `2` files passed, `30` tests passed, including full-origin authorization, exact-host ThreatFox isolation, batch per-URL failure isolation, disconnect cancellation, warning/redirect-degraded provider recovery (including URLhaus exact and host fallback outages), and incomplete DNSBL coverage propagation.
- DOM tests: `5` files passed, `15` tests passed.
- Playwright: `9` tests passed, covering legacy history migration, single-scan, Summary/Full signals, batch-scan, accessibility, keyboard navigation, history undo, and fixture-backed verdicts.
- Production build: passed with static metadata routes for `/icon`, `/opengraph-image`, `/robots.txt`, and `/sitemap.xml`.
- Security audit: `0` vulnerabilities reported across prod and dev dependencies after the 2026-09-03 dependency refresh.
- Lighthouse:
  - Performance `0.91`
  - Accessibility `1.00`
  - Best Practices `0.96`
  - SEO `1.00`
- Vercel preview deployments: protected and verified via `vercel inspect`
- Vercel production deployment: `Ready` at `https://www.scrutinix.net`
- GitHub repository: `amanthanvi/scrutinix` with updated description, homepage, and public topics
- Vercel project: renamed from `malicious-url-detector` to `scrutinix` and reconnected to `https://github.com/amanthanvi/scrutinix`
- Public production API smoke: `POST /api/analyze` returned NDJSON `200`, streamed all expected events, and produced a safe verdict for `https://example.com/`
- Post-key-sync production smoke: Google Safe Browsing resolved successfully, URLhaus stopped warning once the `Auth-Key` header fix shipped, and the threat-feed source set was simplified to URLhaus plus the OpenPhish community feed.
- Local production smoke: `redirectChain` now returns `success` for `https://example.com/`, and the scan no longer reports a false partial failure from TLS chain validation.
- Fresh local matrix verification on 2026-03-09 confirmed the UI and verdict semantics across `example.com`, `neverssl.com`, `expired.badssl.com`, and a known-malicious IP sample; clean verdict confidence now drops to `moderate` when a primary reputation source times out instead of staying misleadingly high.

## Work Items

### P20 Advisory wave execute (001-006)

- [x] Merged local advisor branches on `advisor/execute-all-merge`: 006 (incl. 004), 001, 002, 003, 005.
- Historical executor plans and their per-plan details remain available in git history.

### P21 Expand local intelligence and verification

- [x] Replace hosted ML inference with a bundled quantized ONNX classifier plus lexical consensus.
- [x] Add ThreatFox and DNSBL coverage inside the existing eight-signal contract.
- [x] Use the Public Suffix List, including private suffixes, for registrable-domain feed and redirect boundaries.
- [x] Preserve the VirusTotal free-tier request budget by limiting each uncached report lookup to the primary URL endpoint.
- [x] Report redirect-limit exhaustion without presenting an unprobed destination as reachable.
- [x] Restrict brand-impersonation exemptions to known official registrable domains, including across private hosting suffixes.
- [x] Resolve form and submit-control destinations against the document's effective base URL and require password inputs to belong to the submitting form before scoring credential posts.
- [x] Resolve relative meta-refresh targets against the same effective document base.
- [x] Accept only the documented JSON media type, with parameters, at scan request boundaries.
- [x] Charge rejected requests one rate-limit token while preserving per-URL weighting for admitted batches.
- [x] Count only high-quality threat-feed matches as high-confidence verdict corroboration.
- [x] Keep terminal HTML capture inside the redirect signal's aggregate deadline.
- [x] Preserve fresh provider recovery by never caching partial, error, or aborted scans.
- [x] Treat composite-signal warnings as partial coverage so warning-degraded scans also bypass the cache.
- [x] Keep redirect exhaustion truthful, cache-ineligible, and distinct from a wholly uninspectable host.
- [x] Include unreachable-host `unknown` verdicts in history filtering.
- [x] Centralize runtime schemas and harden request, stream, history, cache, and provider boundaries.
- [x] Expand unit, integration, DOM, fixture-backed E2E, CI, and dependency-audit coverage.
- [x] Resolve external review findings, run the full verification chain, and land the reviewed PR stack.

### P22 Simplify the scanner interface

- [x] Replace the dashboard/card composition with a minimal single-column scan, verdict, signal, and history flow.
- [x] Keep one static accent and reserve verdict colors for stated verdict/severity facts.
- [x] Preserve the accessible Summary/Full signal control and at least 44px interactive targets.
- [x] Keep batch, history, export, share, re-scan, unknown verdict, and partial-coverage behavior intact.
- [x] Reconcile privacy and architecture copy with server-side scan processing and client-only history.
- [x] Complete the merged validation and external review loop before landing.

### P23 Enforce browser quality gates on every change

- [x] Configure fixture-backed Playwright and Lighthouse in pull-request and `main` CI after fast-fail static/test/build checks.
- [x] Provision one Chromium installation explicitly and pass its executable path to Playwright and `chrome-launcher`.
- [x] Make Lighthouse Performance `>= 0.90` and Accessibility `>= 0.95` blocking thresholds.
- [x] Pass the full CI-equivalent validation locally on Node 22.23.2, including browser smoke and Lighthouse.
- [x] Re-enable repository-level GitHub Actions and validate the final `main` workflow after external review and local CI-equivalent validation.

### P26 Verify production scanning after the Upstash connection

- [x] Redeploy so production picks up the Vercel-connected Upstash env vars; prove shared rate limiting across production and preview deployments.
- [x] Ship the ONNX runtime to the analyze functions (createRequire is untraceable) using only the linux-x64 CPU binaries, and guard the trace in CI (`npm run check:trace`) (#52).
- [x] Restore WHOIS: send a User-Agent to rdap.org and query the PSL registrable domain; withhold the age discount from deeper subdomains (#52, #54).
- [x] Stop a single ThreatFox URL IOC convicting a whole shared host; off-path URL IOCs only corroborate (#53).
- [x] Query Spamhaus DBL through DQS so scans are no longer partial and results become cacheable (#56).
- [x] Exempt known path-tenanted platforms from host-level feed scoring while exact-URL listings still convict (#56).
- [x] Namespace shared-cache keys by Vercel environment and preview commit so previews cannot serve production results.

### P27 Verdict trust fixes (2026-10-06, PR A of the redesign stack)

Correctness, copy, and accessibility fixes in the current visual language; the
visual redesign stacks on top and consumes the new pure modules.

- [x] Feed reasons read as one sentence with proper feed names: `detail` is a clause after the feed's display name (`lib/domain/feed-copy.ts`), legacy strings are rewritten, and a contract test guards every provider literal.
- [x] Every user-facing count agrees with its noun (`countOf`); verdict summaries name the evidence ("7 VirusTotal engines and URLhaus flagged this link.") instead of category jargon; Safe and Unknown each say their meaning once.
- [x] `lib/domain/verdict-guidance.ts`: one imperative line per verdict (hedged for provisional Safe), no score for Unknown/Error, live-region announcement, and a coverage caveat that names limited checks and disappears when nothing was limited.
- [x] Per-signal "safe" became neutral-gray "clear"; Unknown has its own slate token pair.
- [x] Summary shows only the signals that drove the verdict plus one quiet-checks line that opens Full (`components/shared/signal-selection.ts`).
- [x] "ML Ensemble" became "Link Pattern Model"; jargon removed from verdict copy and `/about` (which gained `#scoring` and a 31rem prose measure).
- [x] Accessibility: imperative under a focusable verdict heading, score band + "How scoring works", verdict announcement on completion and focus on history/batch open, row names carry the finding, rows are list items, label-in-name for the Summary/Full switch, history heading and filter naming.
- [x] Result actions moved after the evidence with scope-specific export labels; Analyze stays enabled (inline empty error) and drops to outline while a result is shown.
- [x] History keeps one entry per normalized URL (upsert on save, older duplicates hidden on load). Investigation: no double-add bug; one entry per scan was the prior design.
- [x] `scrollbar-gutter: stable`; `agentRules: false`; `E2E_PORT` for parallel e2e runs.
- [x] Adversarial review round applied: Summary drivers come from the verdict engine (`threatInfo.scoredSignals`), "known threat" only on a confirmed reputation hit, neighbour-only feed listings never read as listing this link, Google threat types in plain words, provisional Safe covers minor warning signs, confidence reasons name shortfalls without "other"/count drift, Unknown states its cause once, a clean Safe no longer repeats "nothing flagged", reasons moved into Details, plain findings for checks that couldn't run (`formatAge`), re-announcement and focus fixes for opened results and the quiet-checks line, and the shared-snapshot imperative. Cached results re-derive their verdict on read so older entries gain current copy and `scoredSignals`.
- [x] Verified: lint, typecheck, format, unit, integration, DOM, fixture-backed e2e, and production build.
- [x] Second review round (G1-G6): history saved before `scoredSignals` re-derives its drivers on load (engine loaded lazily; `registrable-domain` dropped `node:net`), the coverage caveat names a stale VirusTotal analysis aged at scan time, a VirusTotal domain-only flag reads as a warning sign about the domain instead of "flagged this link", an opened saved verdict outranks scan progress in the live region, and "Show all checks" focuses the first newly revealed expandable check. Scores and thresholds unchanged.
- [x] One source of truth for limited coverage (`lib/domain/coverage.ts` `getLimitedChecks`): the Safe summary says "some checks were limited" only when the caveat names them, now including an unverified TLS certificate, an unreachable redirect chain, and an unavailable registration lookup. Scores and verdicts unchanged.

### P28 Canonical minimal redesign (2026-10-06, PR B of the redesign stack)

After a critique ("bland and underwhelming") and a live round of three
committed alternate worlds (label, signage, line), the user re-chose the
canonical minimal product tool at Linear/Vercel craft level, made sharper,
on a cool crisp white ground. Direction contract:
`.impeccable/surfaces/app-page-tsx.md`.

- [x] Visual system: rebuilt `app/globals.css` tokens (cool white / deep neutral-cool dark, near-black ink, one blue accent, verdict graphic + `-fg` + low-chroma `-surface`/`-edge` per verdict, an eight-cell ramp), a real type scale (`text-caption` … `text-verdict`, taught to `tailwind-merge` in `lib/utils.ts`), themed selection/caret/scrollbars/focus/tabular numerals. Motion stays CSS-only in `app/scrutinix.css`; the one authored moment is cells filling and the verdict band arriving.
- [x] First viewport: eight-square mark + wordmark, visible display headline and one supporting line, Single/Batch tabs (Batch carries an "up to 10 links" hint outside its accessible name), input with Paste (only where `navigator.clipboard.readText` exists) and a ready primary Analyze. Empty-state noise removed (gap-fill round: the empty History heading and its device note no longer draw; the `Scan history` region stays as an empty landmark, and its gap collapses).
- [x] S1 verdict band (`components/scrutinix/verdict-panel.tsx`): tinted band, ink verdict word at 40/52px, imperative beneath, score and band only when scored. The summary sentence becomes the band's "because" line only when Summary shows no driver row (`shouldShowVerdictSummary(result, driverRows)`), so a fact is never stated twice. Cancel lives inside the "Checking" band so nothing reflows when the verdict lands.
- [x] S2 link anatomy: one isomorphic splitter (`lib/domain/link-anatomy.ts`, tldts passed in; server `registrable-domain.ts` delegates to it, the browser loads tldts lazily via `hooks/use-link-anatomy.ts`). Every contiguous run of two or more subdomain labels that is exactly a recognised domain is tested for impersonation; a look-alike Safe hedges its instruction ("Don't sign in or enter details here.") and band tone, and the anatomy states the owner once ("This link belongs to secure-login.xyz, not paypal.com."). Presentation only: scores unchanged.
- [x] S3 eight-cell strip (`components/scrutinix/signal-strip.tsx`, atoms in `signal-cell.tsx`, data in `lib/domain/signal-signature.ts`): streaming progress, evidence index (roving-tabindex toolbar; a cell reveals, opens, and focuses its row), row marker, history/batch glyph (legacy entries draw empty slots), brand mark, icons, and share images.
- [x] Share/OG: default card and a per-result image route (`app/og/result/route.tsx`) drawn with bundled Geist; `generateMetadata` on `/` validates `?shared=` and points og/twitter images at it. Snapshots gained an optional `signature`; old links still parse. The server passes the payload into the runtime so SSR and hydration agree.
- [x] Re-scan keeps focus on the band heading (same node from "Checking" to the verdict); a landed scan whose answer is off-screen scrolls into view (reduced-motion aware).
- [x] Icons regenerated from `lib/brand-mark.ts` by `npm run icons` (`scripts/generate-icons.mjs`, authored geometry only, rasterised with sharp, provenance embedded in each PNG).
- [x] Contrast guard: `scripts/check-contrast.mjs` (`npm run check:contrast`) asserts 4.5:1 text and 3:1 graphics/control pairs in both themes; `tests/unit/contrast.test.ts` runs it in the unit suite.
- [x] Link Pattern Model notes no longer say "transformer" or "lexical heuristics".
- [x] Verified: lint, typecheck, format, unit, integration, DOM, fixture-backed e2e (axe zero in light and dark), build, and one batched screenshot round plus a confirm round (`.impeccable/review/`, ignored). Re-verified after the gap-fill round: unit 39 files / 416 tests, integration 3 / 33, DOM 7 / 43, e2e 21 passed, build green, and a full screenshot refresh (64 page captures plus three share cards).
- [ ] Follow-up (scoring, out of scope here): `lib/domain/url-structure-risk.ts` scores a brand in the subdomain only for its listed `IMPERSONATED_BRANDS`. A generic domain spelled in the subdomain (`<anything>.com.<owner>`) is surfaced by the link anatomy but adds no score, so such links can still read Safe. Consider a scored brand-agnostic signal.
- [x] Gap-fill round (completeness critique F1-F16):
  - Look-alike detection: a two-letter country-code run counts only for a listed brand (`impersonated-brands.ts`, shared with scoring), so `acme.us.auth0.com`, `api.us.example.com`, `shop.de.example.com`, `docs.ai.example.com`, `bank.ca.example.com`, and `news.uk.example.com` no longer claim a false owner; `amazon.de.<owner>` still does.
  - Strip states differ by shape, not hue alone: caution is hatched and found-nothing is a thin dash (flagged stays solid); the contrast guard adds mark-on-track pairs and a shape-distinctness test; OG cards mirror the shapes.
  - Shared "Run a fresh scan" parks focus on the band like Re-scan; Cancel hands focus to the link field.
  - The mobile bring-into-view e2e now re-scans from the bottom of a long page and asserts the verdict is fully in view (fails with the scroll removed), with a reduced-motion variant.
  - Link anatomy facts are keyed by the segment they describe (`https://`, the registered domain) and a long path has a "Show full link" toggle.
  - Shared links render with server-side anatomy (no hedge flicker); verdict announcements wait for the parser; history and batch results preload it.
  - UI errors use a non-verdict `--sx-danger-*` pair; `/about` and `/privacy` prose sits at 30rem (63-73 characters per rendered line).
  - Entries saved before per-check results show a plain note instead of eight "failed" cells; a real all-failed (Error) scan is no longer mistaken for one.
  - One name per ML member ("link pattern model", "structure checks"); sharp pinned as a devDependency; `/og/result` rate-limited on its own tier and capped at 6,000 payload characters (oversize or invalid redirects to the default card).
  - New fixtures `critical.scrutinix.test` and `error.scrutinix.test`; review captures added for Critical, Error, stream error, form error, and the error boundary in both themes.
- [x] Lighthouse on the P28 build (`LIGHTHOUSE_PORT=3332 npm run lighthouse`, two runs, identical): Performance `0.90` (gate `0.90`), Accessibility `1.00`, Best Practices `0.96`, SEO `1.00`. `scripts/run-lighthouse.mjs` now honours `LIGHTHOUSE_PORT` like `E2E_PORT`.
- [x] Performance margin: after the finish round the mobile run fell to `0.89` (simulated LCP 3.8 s on the headline's supporting line; observed FCP = LCP = 41 ms, so the gap is Lantern charging every script requested before LCP). The home page's eager chunk was 408 KB raw / 97 KB on the wire because `import { z } from "zod"` keeps Zod 4's whole `z` namespace, every locale included. `import * as z from "zod"` lets Turbopack tree-shake it to 126 KB / 37 KB: simulated LCP 3.5 s, Performance `0.91`.
- [x] Finish round (M1-M5, m1-m7):
  - A look-alike Safe keeps its word, score, and band text, but the band (and OG card) takes the neutral Unknown tone and "No check flagged it, but the name is misleading." replaces "High confidence" (`getVerdictGuidance().tone` / `confidenceNote`). Its imperative is action-only ("Don't sign in or enter details here."); Unknown keeps its own.
  - The owner fact is said once, by `ownershipSentence`: anatomy line, OG card, share description, and the live region (which has no anatomy line). A DOM test asserts "paypal.com" sits in one visible sentence.
  - History and batch rows use `LinkAnatomyCompact`: the subdomain truncates from its left, the registered domain never truncates, and the path gives way first, so a phone shows "secure-login.xyz" for a look-alike. Look-alike Safe rows use the neutral tone.
  - The partial-answer cell is a centred short block (not a half-length fill that reads as progress).
  - Default share card breaks the headline into explicit lines; the hero steps down to the headline size once the verdict band mounts (CSS `:has`, before the verdict lands); score numeral in Geist Sans (no slashed zero); anatomy block on the column edge; an unreachable https link says "Couldn't check the certificate"; an Error verdict states no confidence; the rate-limit message names the wait from the window that denied ("Too many scans from this connection. Try again in about a minute.") and Retry-After uses the same seconds; placeholder "Paste a link".
  - Verified: lint, typecheck, format, unit 39 files / 429 tests, integration 3 / 33, DOM 8 / 49, e2e 23 passed (`E2E_PORT=3351`, axe zero light and dark), build green; full review recapture with full-page mobile captures.
- [x] Document phase: `DESIGN.md` rewritten from the built world (token frontmatter in OKLCH for both themes, type scale, verdict/strip/danger colour roles, the verdict band, link anatomy, the strip at every scale, evidence rows, history/batch, share images, motion, the accessibility contract tests depend on, the ban list, and provenance: canon chosen over three dealt drafts, seed `ccccb7f7`), plus the `.impeccable/design.json` sidecar (colour metadata and ramps, motion, breakpoints, nine rendered component snippets, narrative). `scripts/generate-icons.mjs` now writes each PNG's origin into an `impeccable:prompt` tEXt chunk; regenerating left every icon's pixels, `favicon.ico`, and `icon.svg` byte-identical, and `impeccable embed-prompt --scan public` reports 0 missing.
- [x] Final gate (`E2E_PORT=3361`): lint, typecheck, format clean; unit 39 files / 429 tests, integration 3 / 33, DOM 8 / 49, e2e 23 passed, build green, `npm audit --omit=dev` 0 vulnerabilities. Lighthouse on a production server: mobile Performance `0.91`, Accessibility `1.00`, Best Practices `0.96` (a pre-existing CSP entry in the Issues panel), SEO `1.00`; desktop `1.00` / `1.00` / `0.96` / `1.00`.
- [x] Signed share links (security review): the `?shared=` payload was built by the browser and never authenticated, yet the page title/description, the per-result OG image, and the in-page snapshot stated it as Scrutinix's verdict, so anyone could mint a "Safe: paypal.com — Scrutinix" preview for a phishing link. The server now builds and signs the canonical payload for every streamed result (`lib/server/share-signing.ts`, HMAC-SHA256 with `SHARE_SIGNING_SECRET`, optional `SHARE_SIGNING_SECRET_PREVIOUS` for rotation; `result.share` survives the stream, cache hits, batch, and history); Share links carry `&sig=`. `app/page.tsx` and `/og/result` verify it: verified links keep the per-result title, card, and band plus "Verified Scrutinix result · checked <date>"; unverified links (unsigned, tampered, secret unset) keep the site defaults and open a neutral "Check this shared link yourself" band with Scrutinix's own link anatomy and "Run a fresh scan". Behaviour change: links shared before this change open the neutral view. Production needs `SHARE_SIGNING_SECRET` set (and a redeploy) before shared links verify. Verified (`E2E_PORT=3381`): lint, typecheck, format clean; unit 41 files / 455 tests, integration 3 / 36, DOM 8 / 52, e2e 28 passed (axe zero on verified and unverified shared views, light and dark), build green.
- [x] Signed-share review fixes: a signed Safe look-alike previews as "Look-alike of <brand>: <domain> — Scrutinix" and its card word is "Look-alike", never "Safe" (`shareHeadline`); the signed check time is `metadata.checkedAt`, which a cache hit keeps from the original scan (so a cached result's payload and signature are byte-identical to the first); a space in `?shared=` is restored to "+" before verifying (`normalizeSharedPayload`); `/og/result` is cached `public, max-age=3600, s-maxage=3600`, no longer `immutable`, so forged images age out after a revocation; Share without a `sig` copies the link with "Link copied, but it isn't verified" (and "Scan again" only for results saved before the server issued shares); the unverified band says "We can't confirm the result in this link came from Scrutinix. It may be old or edited, so we're not showing it." with "Scan this link"; `share-signing.ts` and `env.ts` import `server-only` (pinned `0.0.1`, aliased in the vitest configs); the committed e2e key is ignored outside `SCRUTINIX_E2E=1`. Docs: the keys go in the Vercel Production environment only, plus a revocation runbook (SPEC, AGENTS, CLAUDE). Not adopted: putting the deployment environment into the signed message (a key holder can sign any prefix, so it does not stop an unreviewed preview holding the key; environment scoping does), and a freshness cap on verified Safe/Unknown previews (left as a product decision). Still open: `.env.example` entries for both keys (agent permissions block `.env*` edits). Verified (`E2E_PORT=3384`): lint, typecheck, format clean; unit 41 files / 460 tests, integration 3 / 37, DOM 9 / 55, e2e 28 passed, build green, `npm audit --omit=dev` 0 vulnerabilities.
- [ ] Follow-up (drift found while documenting, not canonized in DESIGN.md): `components/ui/sonner.tsx` keeps `richColors`, whose unlayered `[data-rich-colors][data-type=success]` rules beat the token classes, so success toasts ("Downloaded scan.json", "Link copied to clipboard") paint green outside a Safe verdict; its toast class also pairs a border with `shadow-lg`, the system's only shadow. The share card's didn't-apply cell (`lib/og/cards.tsx`, `#8f9297`) is one step off `--sx-cell-na` (`#898c91`).

### P24 Resolve September dependency maintenance

- [x] Merge the green minor-and-patch dependency group, including the Next.js `16.3.3` security update.
- [x] Keep ESLint on major `9` until the Next.js plugin stack supports ESLint `10` without lint crashes.
- [x] Keep `@types/node` aligned with the supported runtime until the Node 24 migration in P25.
- [x] Refresh the lockfile to `@humanfs/node` `0.16.8` after its moderate advisory entered the audit database.
- [x] Confirm no pull requests remain open and the final `main` verification run passes.

### P25 Close toolchain and PSL residual risks

- [x] Replace the ESLint 9-only `eslint-config-next` dependency graph with a peer-clean ESLint 10 flat configuration.
- [x] Move the production contract to Vercel-supported Node 24 LTS and align local, CI, engine, and type versions.
- [x] Explicitly allow the native ONNX runtime installer required by the bundled classifier on Vercel.
- [x] Add a unit guard that fails when the executing Node major, `.nvmrc`, `engines.node`, or `@types/node` diverge.
- [x] Cover every private Public Suffix List rule changed by `tldts` 7.4.11, including tenant-isolation and brand-impersonation cases.
- [x] Keep fixture-backed E2E runs offline even when local Redis credentials are configured.
- [x] Pass the complete Node 24 CI-equivalent chain and verify the Vercel deployment runtime.

### P01 Reset the baseline and living docs

- [x] Create `PLAN.md` and keep it current.
- [x] Replace stale project-local `AGENTS.md`.
- [x] Update `SPEC.md` with audit-resolved implementation notes and feasibility corrections.
- [x] Keep the regenerated `package-lock.json` as part of the intentional restart scaffold.

### P02 Re-scaffold the platform and scripts

- [x] Upgrade to the current stable Next/React stack and pin the production Node major explicitly.
- [x] Reduce direct dependencies to the set used by the rebuilt app.
- [x] Replace `next lint` with ESLint CLI.
- [x] Add `typecheck`, `format`, and fresh metadata/static asset plumbing.

### P03 Add the harness first

- [x] Add Vitest for unit and integration coverage.
- [x] Add MSW for network-backed integration tests.
- [x] Add Playwright for E2E smoke and UI regressions.
- [x] Add Lighthouse CI for performance/accessibility gatekeeping.

### P04 Define the core domain and config contracts

- [x] Centralize env validation and runtime config.
- [x] Define normalized URL parsing and private-network rejection.
- [x] Define result, signal, event, and verdict types.
- [x] Define cache keys, log redaction, and API error contracts.

### P05 Implement fast local enrichment signals

- [x] DNS enrichment.
- [x] TLS/certificate enrichment.
- [x] Redirect chain enrichment.
- [x] Bound active-probe hostname resolution by the scan signal and each signal's aggregate time budget.
- [x] RDAP-backed registration enrichment behind the public `whois` signal name.

### P06 Implement external threat intel and classifier adapters

- [x] VirusTotal adapter.
- [x] Keep VirusTotal URL-report lookups to one request per uncached report path; omit optional domain enrichment that would double free-tier consumption.
- [x] Google Safe Browsing adapter.
- [x] URLhaus adapter.
- [x] OpenPhish cached feed ingestion.
- [x] Remove the deprecated PhishTank path and standardize on the OpenPhish community feed.
- [x] Bundled quantized ONNX classifier plus local lexical scorer fallback; no hosted inference dependency.

### P07 Build orchestration and streaming APIs

- [x] Shared orchestration service for all eight signals.
- [x] `POST /api/analyze` NDJSON stream.
- [x] `POST /api/analyze/batch` NDJSON stream with concurrency cap of `3`.
- [x] Stop dispatching queued batch items when the client disconnects.
- [x] Cache-aware short-circuit path with fresh scan IDs on cached hits.
- [x] Final verdict logic that never fabricates threat info on total failure.

### P08 Add rate limiting, cache policy, and observability

- [x] Proxy-based IP rate limiting with Upstash when configured.
- [x] In-memory fallback when shared Redis is unavailable.
- [x] Structured safe logging and timing metadata.
- [x] Documented cache behavior in code and living docs.

### P09 Build the design system and app shell

- [x] Distinct visual direction and theme tokens.
- [x] Responsive app shell and navigation.
- [x] Metadata, icon, OG image, robots, and sitemap routes.
- [x] Accessible primitives and loading/error skeletons.
- [x] Onboarding/value framing plus trust/privacy disclosure routes.

### P10 Ship the single-scan experience

- [x] Streamed single-scan UI.
- [x] Summary / Full Report toggle.
- [x] Per-signal loading states plus clear full-scan recovery controls.
- [x] Clear differentiation between provider failure and malicious verdicts.

### P11 Ship batch, history, export, and share

- [x] Batch streaming UI and drill-down details.
- [x] Batch per-URL failure isolation so one broken URL does not kill the rest of the stream.
- [x] IndexedDB history with search, filter, and re-scan.
- [x] Undo path after clearing local history.
- [x] CSV/JSON export for batch and history.
- [x] Optional client-only share links.

### P12 Finish security, accessibility, and content hardening

- [x] Remove dependency vulnerabilities.
- [x] Add CSP-safe rendering and security headers.
- [x] Refresh educational content into the side-panel guidance copy.
- [x] Run automated accessibility checks plus keyboard smoke tests.
- [x] Resolve the Claude UI audit findings that still applied to the live branch and remove the now-stale audit artifact.

### P13 Final integration and ship gate

- [x] Run the full local CI-equivalent chain.
- [x] Reconcile `PLAN.md`, `SPEC.md`, `AGENTS.md`, and user docs.
- [x] Validate actual preview and production deployments on Vercel.

### P14 Rename repository and public metadata to Scrutinix

- [x] Rename package and repository metadata to `scrutinix`.
- [x] Update docs and public links to the `Scrutinix` name and GitHub slug.
- [x] Migrate IndexedDB history from `malicious-url-detector-v2` to `scrutinix-v2`.
- [x] Refresh local Git/Vercel wiring to the current repository and project names.
- [x] Refresh the README and add public contributor/security policy docs for the open-source repository.

### P15 Overhaul the public-site design system

- [x] Rework theme tokens and branded CSS toward an editorial security-lab direction with calmer light/dark surfaces.
- [x] Replace the boxed home intro with a full-bleed poster hero and inline scanner dock that still fits inside the first viewport.
- [x] Restyle the operational workspace, verdict surface, signal cards, batch console, and sticky history rail without changing scan behavior or contracts.
- [x] Convert `/about` and `/privacy` to the shared editorial shell and align their copy with actual logging, history, and share-link behavior.
- [x] Re-run lint, typecheck, unit, build, Playwright smoke, and Lighthouse after the UI overhaul.

### P16 Align the public site to the actual shadcn preset baseline

- [x] Pull and inspect the generated `b1D24VYe` preset output instead of relying on an interpreted direction.
- [x] Port the preset's neutral token scale, compact `radix-mira` control language, and smaller radii into the shared primitives and public shell.
- [x] Remove the leftover pill, blur, and terminal chrome that was still masking the preset baseline across `/`, `/about`, and `/privacy`.
- [x] Re-run lint, typecheck, build, Playwright smoke, and Lighthouse against the corrected preset-aligned UI.

### P17 Make the home route dashboard-first and swap in the shipped favicon bundle

- [x] Replace the generated icon route with the provided favicon asset set and a normalized `site.webmanifest`.
- [x] Reduce the home hero to minimal scanner-adjacent framing so the scan dock is dominant on desktop and mobile.
- [x] Move method/privacy explanation into a clearly secondary support section below the operational workspace.
- [x] Tighten short-height and mobile viewport behavior so the scan dock, input, and primary action stay inside the first viewport.
- [x] Update smoke assertions to target stable functional affordances instead of removed marketing copy.
- [x] Re-run lint, typecheck, build, favicon endpoint checks, and Playwright smoke after the cleanup pass.

### P18 Refresh dependency advisories

- [x] Update Next/eslint-config-next, PostCSS, Vitest/Vite, Playwright, Lighthouse, and MSW patch/minor lanes for Node 22 compatibility.
- [x] Add npm overrides for vulnerable transitive leaf packages where upstream parents still pin stale versions.
- [x] Re-run npm install, audit, typecheck, lint, unit tests, integration tests, and production build after the refresh.

### P19 Parallel audit remediation pass

- [x] Fix Redis REST env resolution so both Upstash and Vercel KV aliases construct a client explicitly.
- [x] Prevent incomplete partial-failure scan results from being cached as reusable successful results.
- [x] Harden active TLS and redirect probes against private, local, reserved, rebinding, IPv4-mapped, and private NAT64 targets.
- [x] Move runtime result and stream-event boundaries to Zod schemas while preserving the existing sanitizer APIs.
- [x] Split the analyzer client island into smaller runtime, chrome, workspace, history, and footer modules.
- [x] Add a minimal GitHub Actions CI workflow for install, audit, lint, typecheck, unit/integration tests, and build.
- [x] Run focused checks on each branch, external PR review loops, Vercel previews, and a final merged verification pass.

## Notes / Discoveries

- 2026-03-06: Next.js `16.1.6` deprecates the `middleware.ts` convention in favor of `proxy.ts`; the rebuilt app follows the new convention while preserving the same request-gating role.
- 2026-03-06: Rate limiting must not import the full analysis orchestrator, or the request proxy bundle will inherit Node-only signal modules and fail build-time edge checks.
- 2026-03-06: A fail-closed production proxy made the first live deploy unusable without Upstash credentials; the shipped behavior now degrades to process-local rate limiting and logs a warning instead.
- 2026-10-01: Production `/api/analyze` returned plain HTTP 500 (~4.4s) for every method when Upstash Redis REST calls failed (`fetch failed` after default retries). Missing credentials already degraded, but thrown Upstash errors did not; `applyRateLimit` now catches Redis/ratelimit failures, resets the limiter singleton, fails fast with fewer retries, and falls back to process-local limiting.
- 2026-10-01: Parallel minute+day Upstash checks via `Promise.all` discarded a settled deny when the sibling window threw, and the catch path could admit via in-memory; switched to `Promise.allSettled` and preserve any Redis deny before degrading.
- 2026-10-01: CI Audit failed on three `brace-expansion` advisories (`GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, `GHSA-6j4f-fj2g-mc7p`) because the `minimatch@^10` override still pinned `5.0.9`; raised that override to `5.0.12` and refreshed the lockfile.
- 2026-03-06: Metadata routes must be owned by the app (`/icon`, `/opengraph-image`, `/robots.txt`, `/sitemap.xml`) or build/runtime drift resurfaces quickly.
- 2026-03-06: Hugging Face retired `api-inference.huggingface.co`; the hosted classifier now uses `router.huggingface.co/hf-inference/models/...` with `DunnBC22/codebert-base-Malicious_URLs`.
- 2026-03-06: Lighthouse on this repo required the same explicit host-bound production start command that succeeded manually: `npm run start -- --hostname 127.0.0.1 --port 3000`.
- 2026-03-06: `@lhci/cli` carried the only remaining open advisories (`lodash` and `tmp` via old `inquirer`); replacing it with a direct `lighthouse` + `chrome-launcher` script brought `npm audit` back to zero.
- 2026-03-06: Vercel preview deployments in this project return `401` to anonymous HTTP requests; `vercel inspect` is the reliable verification path for preview readiness.
- 2026-03-06: Vercel KV exposes Upstash-compatible REST credentials as `KV_REST_API_URL` and `KV_REST_API_TOKEN`; the deployed rate-limit config now honors those aliases in addition to `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- 2026-03-06: URLhaus authorization is strict about the documented header spelling: `Auth-Key` works and `AuthKey` returns `401 Unauthorized`.
- 2026-03-06: OpenPhish's free community TXT feed is sufficient for the shipped threat-feed role here, so the PhishTank integration was removed instead of carrying a flaky Cloudflare-challenged path.
- 2026-03-06: Redirect tracing should not depend on fetch-level certificate trust, because SSL trust errors are already captured separately by the SSL signal; the shipped tracer now inspects headers through Node HTTP(S) requests with relaxed certificate validation.
- 2026-03-06: Vercel's Node version setting is major-line based; `package.json` now pins `engines.node` to `22.x` so deploys stay on Node 22 without silently floating to a future major.
- 2026-03-09: The shipped UI moved from ad-hoc control styling to selective shadcn/ui primitives (`Button`, `Input`, `Textarea`, `Tabs`, `Card`, `Badge`, `ScrollArea`, `sonner`) without discarding the custom Scrutinix hero, motion, or signal rendering.
- 2026-03-09: Tailwind v4 theme tokens now live in `app/globals.css`, while `app/scrutinix.css` is reserved for the branded atmosphere, radar, marquee, and animation layer.
- 2026-03-09: Next.js `themeColor` metadata must move to the `viewport` export on App Router pages, or builds emit warnings.
- 2026-03-09: Moving the home route to a server-rendered shell plus smaller client islands pushed the scripted local Lighthouse score back to `0.99` after the Scrutinix redesign had regressed it.
- 2026-03-09: The public production host now resolves through the custom domain `https://www.scrutinix.net`, with the apex `https://scrutinix.net` redirecting there.
- 2026-03-09: TLS signal collection was already correctly identifying expired certificates, but the verdict engine initially underweighted that evidence; invalid or untrusted certificates now land in the suspicious band unless stronger evidence moves the result further.
- 2026-03-09: A safe verdict can still be overconfident if a primary reputation source fails; the shipped confidence model now caps clean-result confidence when VirusTotal, Google Safe Browsing, or threat-feed coverage is missing.
- 2026-03-09: The saved Scrutinix UI audit included several findings that were already obsolete on the current branch; treat old audit artifacts as input to reconcile, not as a literal current-state description.
- 2026-03-21: GitHub had already been renamed to `amanthanvi/scrutinix`; local remotes and docs were still relying on redirects and stale `malicious-url-detector` metadata.
- 2026-03-21: Renaming the IndexedDB database required a one-time browser migration so existing local scan history survives the Scrutinix rename.
- 2026-03-22: The Vercel project rename can be patched through the Vercel projects API, then the local checkout should run `vercel git connect` so the linked GitHub repo metadata follows the new slug.
- 2026-03-23: Public repo polish still mattered after the rename; the README needed to lead with product value, and the repo needed explicit `CONTRIBUTING.md` plus `SECURITY.md` entry points for external users.
- 2026-03-23: The public-site redesign is easiest to keep coherent when the hero, scanner dock, workspace, and trust pages all share one token system and shell language; partial restyles drift quickly.
- 2026-03-23: When a redesign is supposed to follow a shadcn preset, pull the generated preset first; matching the real token scale and control density matters more than loosely matching the mood.
- 2026-03-23: The home route works better as a scanner-first dashboard than as a text-heavy hero; method and caveat notes moved to `/about` so the home workspace stays scanner-focused.
- 2026-07-17: Removed the home support card grid; `/about` now carries a compact “Using the console” definition list (lanes, batch, history, feed matching) and keeps weighted scoring / confidence in the existing method sections.
- 2026-03-24: IndexedDB history and streamed NDJSON events need runtime normalization at the client boundary; stale stored entries and malformed upstream payloads can still bypass TypeScript and crash direct `.metadata`, `.signals`, `.length`, `.map`, or string-method reads.
- 2026-05-01: Next `16.2.4` resolves the direct Next advisories but still pins vulnerable `postcss`; keep the npm `overrides` block until upstream package pins move past the audited vulnerable leaves.
- 2026-05-01: Active network probes must validate every resolved address and pin outbound sockets to the validated public address; checking only the hostname or first DNS answer leaves room for private-address redirects and rebinding.
- 2026-05-01: Cache only complete non-error analysis results; a clean verdict with provider partial failures can otherwise mask upstream outages for the full cache TTL.
- 2026-08-02: Registrable-domain comparisons must include private Public Suffix List entries so unrelated platform tenants such as `safe.github.io` never collapse to `github.io`.
- 2026-08-10: Resolved the seven-PR queue by merging the six current implementation/dependency PRs and closing the conflicted, superseded spec-reconciliation draft; the final aggregate passed the full local CI-equivalent chain on Node 22.23.2.
- 2026-08-10: Re-enabled repository-level GitHub Actions after clearing the open PR queue; the final `main` CI workflow passed install, audit, format, lint, typecheck, unit/integration/DOM tests, build, fixture-backed Playwright, and Lighthouse.
- 2026-05-01: Keeping parallel PRs out of `PLAN.md` avoided artificial merge conflicts; use one consolidated plan update after the code branches land.
