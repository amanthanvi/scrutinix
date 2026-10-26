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

- Date: 2026-10-24 (release 4.0.0)
- Execution status: `P21-P28 complete; P29 distinctiveness stack (layers 0-7: public errors, honesty, evidence and Summary questions, anatomy on paste, speed, sharing, editorial identity, open methodology) merged and released as 4.0.0, with the verification skill (#64)`
- Platform:
  - Next.js `16.4.2`
  - React `19.3.x`
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
  - The home page renders as the canonical minimal product tool in a `46rem` column (P28): a display headline, the scan form, then the verdict band, link anatomy, the eight-cell strip, the evidence (Summary's five questions, P29.2b, or Full's eight rows), and local history in one flow. Method and caveat notes live on `/about`.
  - The public site shares one column, header, and footer across `/`, `/about`, and `/privacy` (`public-page-shell.tsx`), so the method and privacy pages stay visually aligned with the scanner.
  - The UI is its own token system (P28), not a shadcn preset: `app/globals.css` holds the cool-white light and deep neutral-cool dark tokens, one blue accent, per-verdict graphic/`-fg`/`-surface`/`-edge` tokens, a non-verdict `--sx-danger-*` pair for UI errors, and the eight-cell ramp; `app/scrutinix.css` holds CSS-only motion and the cell shapes. `scripts/check-contrast.mjs` guards every pair in both themes.
  - The system sans carries UI and display type on a custom scale (no page web fonts; bundled Geist draws only the server-rendered share cards); the system mono is reserved for links, the registered domain, scores, and other data.
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
- [x] Signed-share review fixes: a signed Safe look-alike previews as "Look-alike of <brand>: <domain> — Scrutinix" and its card word is "Look-alike", never "Safe" (`shareHeadline`); the signed check time is `metadata.checkedAt`, which a cache hit keeps from the original scan (so a cached result's payload and signature are byte-identical to the first); a space in `?shared=` is restored to "+" before verifying (`normalizeSharedPayload`); `/og/result` is cached `public, max-age=3600, s-maxage=3600`, no longer `immutable`, so forged images age out after a revocation; Share without a `sig` copies the link with "Link copied, but it isn't verified" (and "Scan again" only for results saved before the server issued shares); the unverified band says "We can't confirm the result in this link came from Scrutinix. It may be old or edited, so we're not showing it." with "Scan this link"; `share-signing.ts` and `env.ts` import `server-only` (pinned `0.0.1`, aliased in the vitest configs); the committed e2e key is ignored outside `SCRUTINIX_E2E=1`. Docs: the keys go in the Vercel Production environment only, plus a revocation runbook (SPEC, AGENTS, CLAUDE). Not adopted: putting the deployment environment into the signed message (a key holder can sign any prefix, so it does not stop an unreviewed preview holding the key; environment scoping does), and a freshness cap on verified Safe/Unknown previews (left as a product decision). Verified (`E2E_PORT=3384`): lint, typecheck, format clean; unit 41 files / 460 tests, integration 3 / 37, DOM 9 / 55, e2e 28 passed, build green, `npm audit --omit=dev` 0 vulnerabilities.
- [x] Signed-share expiry and fixture-mode signing (second security review): a genuine signed Safe captured while a link was benign (or cloaked) previewed "Safe" forever after the link turned, so a verified snapshot whose `capturedAt` (inside the HMAC) is older than `SHARE_MAX_AGE` (72h, `lib/domain/signal-signature.ts`) or more than 5 minutes in the future is now treated exactly like an unverified one: neutral band "This shared result is more than 3 days old, so we're not showing it." (label "Shared result, expired"), default metadata, `/og/result` redirect to the default card. `resolveSharedView` / `describeSharedSnapshot` / `getSharedMetadata` take an explicit `now`; the shown check date carries its year (UTC). The share toast states the 3-day window; sharing an expired history entry says it has expired and offers "Scan again"; /privacy says the same. Fixture mode (which scores unknown hosts Safe) with a real key was a signing oracle: `env.ts` now accepts only the published e2e key when `SCRUTINIX_TEST_FIXTURES=1` and always refuses it otherwise; `SCRUTINIX_E2E` is gone, and `run-e2e.mjs` uses a throwaway per-run key when fixtures are off. Verified (`E2E_PORT=3395`, e2e and build from an APFS clone): lint, typecheck, format clean; unit 41 files / 469 tests, integration 3 / 37, DOM 9 / 60, e2e 29 passed, build green.
- [x] Share-signing env docs (2026-10-11): `.env.example` now carries an annotated `SHARE_SIGNING_SECRET` / `SHARE_SIGNING_SECRET_PREVIOUS` block (32+ characters, `openssl rand -base64 48` or a Node `randomBytes` one-liner, Production-only scoping, rotation steps with the 72-hour overlap), and the README Environment section lists both keys. Both stay empty in the example file so a copied `.env.example` degrades to unsigned sharing. Setting `SHARE_SIGNING_SECRET` in the Vercel Production environment (then redeploying) is an operator step, not part of this branch.
- [x] Main sync (2026-10-11): `main` (next `16.3.8` and sharp `0.35.5` from #60, the minor-and-patch group, msw `3.0.1`) was merged into `t3/verdict-trust-fixes`, then that branch into this one. Both merges were textually clean; `package.json` and `package-lock.json` take main's versions (so the branch's own sharp override bump is subsumed by #60), plus this branch's `server-only`, `sharp` devDependency pin, and `check:contrast`/`icons` scripts. Verified: lint, typecheck, format clean; unit 41 files / 470 tests, integration 3 / 37, DOM 9 / 61, e2e 29 passed, build and `check:trace` green, `npm audit --omit=dev` 0 vulnerabilities.
- [ ] Follow-up (drift found while documenting, not canonized in DESIGN.md): `components/ui/sonner.tsx` keeps `richColors`, whose unlayered `[data-rich-colors][data-type=success]` rules beat the token classes, so success toasts ("Downloaded scan.json", "Link copied to clipboard") paint green outside a Safe verdict; its toast class also pairs a border with `shadow-lg`, the system's only shadow. The share card's didn't-apply cell (`lib/og/cards.tsx`, `#8f9297`) is one step off `--sx-cell-na` (`#898c91`).

### P29 Distinctiveness stack: layer 0, public errors (ported from #63)

Raw exception text (hostnames, Redis DSNs, runtime internals) still reached
the stream and the UI at the head of the redesign stack. PR #63 (by the
Cursor agent, written against `main`) fixed it; this layer rebuilds its
design on #59's code with the independent review's fixes.

- [x] `PublicError` (`lib/domain/public-error.ts`) is the only error whose message a client sees; copy we write (validation, rate limit, provider status, timeouts, `SignalSkipError`) is thrown as one. Everything else is internal: logged through `lib/server/client-error.ts` with the scanned URL, hostname, and any scheme-bearing URL redacted.
- [x] Leak paths closed: single and batch routes, signal error rows, threat-feed warnings, TLS and redirect probe fallbacks, WHOIS parse errors, the client stream-error path, and the error boundary (keeps #59's copy and classes; drops only the raw message).
- [x] Stream backstop: an exception that escapes a route handler becomes a schema-valid `scan_error`/`batch_error` line instead of `controller.error()`; the client keeps the first terminal event.
- [x] Review fixes over #63: one reference per scan (the scan id, or the batch id for a whole-batch failure; no random UUID per failure); failed rows, feed warnings, probe fallbacks, and failed batch items keep a plain sentence (`checkFailureMessage`) and log under the scan id, and `VerdictDetails` states `Reference: <scanId>` once for a failed or partial result; #59's `describeRateLimitWait` tiers kept (#63's fixed rate-limit text dropped); `withResultShare` kept in both routes; the backstop names its route ("The scan failed unexpectedly." / "The batch failed unexpectedly.").
- [x] Verified (`E2E_PORT=3107`): format, lint, typecheck clean; unit 42 files / 484 tests, integration 3 / 42, DOM 10 / 69, e2e 29 passed, build green.
- [x] Review round: shared-cache keys carry a version (`v2`) so results cached before public errors (possibly holding raw TLS text) are never replayed after deploy; an unexpected TLS probe failure marks `ssl.probeFailed`, so the result is partial (shows its reference, never cached); local-classifier fallback logs carry the scan id.

### P29.1 Honesty fixes (2026-10-24, layer 1 of the distinctiveness stack)

The distinctiveness programme (bake-off of 16 identity drafts, blind panels,
polish round; decisions recorded in the session) ships as a stack on top of
the redesign (#59): layer 0 ports #63's public errors, then seven layers in
order: honesty fixes, evidence, anatomy on paste, speed, sharing, identity,
open methodology.

- [x] VirusTotal evidence lists engines that flagged the link first (malicious, then suspicious; `rankVirusTotalResults`), so the five shown can no longer hide every flagging engine; results saved earlier sort too.
- [x] Fresh VirusTotal analyses drop engines that found nothing, as report lookups already did, so ~90 empty engine rows no longer ride in streams, cache entries, and history.
- [x] Removed the never-filled VirusTotal `domain` field, its detail rows, and its scoring path (production never fetched `/domains`; fetching it would halve free-tier capacity).
- [x] Tightened two claims everywhere they appear: "eight separate checks" (not "independent": the sources don't vote independently) and "which site it really belongs to" (we know the registered domain, not the organisation behind it).
- [x] A Safe look-alike is shown as "Look-alike" (`verdictWord`) on the band, history and batch rows, the live announcement, and share cards; its band shows no score, and the details state the checks' own verdict and score (`getUnderlyingVerdictNote`). The stored verdict and score are unchanged.
- [x] Review round: "No check flagged it" only when the engine scored nothing (a Safe can carry minor findings); history/batch rows hold a Safe word until the link parser loads; history filtering matches the shown word; CSV exports gain "Look-alike of". Second round (P1, a delayed or failed parser let a look-alike read "Safe"): `useLinkAnatomy` reports `pending | ready | failed` (one retry after 1s; a failed import is never ready); a Safe band holds in its Checking state while pending, and reads "Unconfirmed" (neutral, no score, "Check the link's address before you open it.") if the parser failed, as do rows, the announcement, and history search; CSV says "Not checked" without the parser. DOM and e2e cover a held and an aborted parser chunk. Third round: only a Safe announcement waits for the parser (a Malicious result is spoken while it loads), and history search re-runs when the parser loads or fails (`useLinkParserStatus`), not only when the query changes.

### P29.2a Evidence data (layer 2, part A)

Scrutinix collected far more than it showed. Part A surfaces the collected
data in the Full view, keeps two cheap facts the providers used to drop,
and brings `/privacy` up to date (folding in #61's still-missing
disclosures, corrected, and #62's review note). Part B (Summary as five
plain questions) builds on it. No score or verdict changes: every new fact
is evidence only.

- [x] Hosting network: the DNS signal looks up the first public address (IPv4 preferred; private, reserved, and documentation addresses never queried) with Team Cymru IP-to-ASN over DNS (`lib/server/providers/team-cymru.ts`): `origin`/`origin6` TXT, then `AS<n>` for the name. Dedicated 2 s resolver, cancelled on scan abort; AS names cached per ASN (256 entries, 24 h); runs as soon as A/AAAA answer, overlapping the other lookups. NXDOMAIN is stored as `asn: null`; a timeout or malformed answer leaves `dns.hosting` unset, adds no warning, and never fails the signal. Logs carry the stage and DNS error code only.
- [x] Feed listing dates: `matches[].listedAt` (ISO) from URLhaus `date_added` (exact URL) and ThreatFox `first_seen` (`lib/server/providers/abuse-ch.ts`); OpenPhish and DNSBLs have none. `detail` unchanged.
- [x] Full-view rows (`getSignalDetailEntries`, explicit `now`): DNS network ("AS64500 EXAMPLE-NET, registered in NL"), CNAME, nameservers, TXT count with recognised kinds (no raw values); certificate expiry in days (from `validTo`), TLS version, self-signed only when true, shortened SHA-256; iframes/hidden iframes and password-receiving hosts only when present; "Listed … ago" after each dated feed match (`formatElapsed`); one VirusTotal engine breakdown row.
- [x] Schemas back-compatible (`hosting` and `listedAt` are `.optional().catch(undefined)`); fixtures carry documentation ASNs (AS64496 FIXTURE-HOSTING US for clean hosts, AS64500 EXAMPLE-NET NL for flagged scenarios) and a 6-hours-ago URLhaus listing.
- [x] `/privacy`: Team Cymru gets only the server's IP; ThreatFox gets the hostname; OpenPhish is matched on our server; checking a link visits it (one-time links); a link new to VirusTotal is submitted and can become visible to its users; in-memory cache entries outlive 15 minutes until read or crowded out; rate limiting stores the IP (Upstash keys expire after about 2 minutes and 48 hours, verified in `@upstash/ratelimit` 2.2.0); opening a shared link sends it to our server to verify, never to scan.
- [x] Verified (`E2E_PORT=3108`): format, lint, typecheck clean; unit 44 files / 527 tests, integration 3 / 44, DOM 11 / 73, e2e 29 passed, build green. Full view checked by eye in both themes on the `feed-hit` fixture.
- [x] Review round (independent review, 7 findings): a certificate that lapsed under 12 hours ago is "Expired" (decided before rounding; durations floored); IPv6 hosting lookups only inside global unicast 2000::/3 (IANA special-purpose registry checked; IPv4-mapped, -compatible, and NAT64 forms rejected, not unwrapped); a stored `hosting` with a missing or invalid ASN (outside 1–4294967295) is dropped instead of reading as unrouted; `registeredCountry` comes only from the AS record (the prefix's registration, AS15133 EU vs US, is never a stand-in); impossible abuse.ch dates (Feb 30/31, non-leap Feb 29) are rejected; the AS query never starts after an abort; `/privacy` says only complete results are cached and SPEC's recipient and PII lines match the code. Verified (`E2E_PORT=3116`): format, lint, typecheck clean; unit 44 files / 533 tests, integration 3 / 44, DOM 11 / 73, e2e 29 passed, build green.
- [x] Second review round: `/privacy` no longer promises a retry "asks every service afresh" (the OpenPhish list is reused for up to 15 minutes, network names for up to a day); an IPv6 literal is read without its URL brackets (`bareHostname`), so DNS takes the literal-IP path and looks up its hosting network, registration is skipped, and TLS sends no bracketed server name. Logged error text no longer carries IP literals (layer 0, `redactForLogs`).

### P29.2b Summary questions (layer 2, part B)

Summary answers five plain questions instead of listing driver rows; Full
keeps the eight per-check rows unchanged. Owner decisions (bake-off P04):
the HTTPS question set, a "why it matters" clause per finding, one-sentence
disagreement explanations, evidence-only new facts, leaf-certificate age
with careful wording, and "registered in" for the hosting network. Not
built: the "already clicked / typed a password" line and a plain-words
score band. No score or verdict changes.

- [x] `lib/domain/summary-questions.ts` (pure, client-safe; no verdict engine or tldts, the registered-domain lookup is passed in): five questions in fixed order with a fixed mapping (each check cited once: reported → VirusTotal, Safe Browsing, threat feeds; destination → redirects and page; concern → link pattern model, registration; HTTPS → certificate; other → DNS). Each has state (pending until every cited check lands), answer, why clause, sources in strip order, and an optional disagreement. Every Summary string lives there.
- [x] Disagreement sentences, shown once and only when every check involved answered: clean lists on a domain under 7 days ("Blocklists usually lag new sites by a day or two; this one is 3 days old."), a list hit VirusTotal shows fewer than 5 engines for (not when every dated listing is over 7 days old), the pattern model or structure checks flagging what every list passed (naming whichever flagged it; suppressed when the lists-lag sentence already says it), and a VirusTotal conviction no list shares. The listing age is stated once, in the answer.
- [x] Review round (independent reviewer): rebased onto the seven Part A review fixes; "These findings don't cancel the threat reports" only after a confirmed reputation hit (a single suspicious engine under Safe no longer triggers it), so the module no longer reads `scoredSignals`; the pattern disagreement names the member that flagged; a name with no public address reads "We found no address" or "only private or reserved addresses" (`PRIVATE_ADDRESSES_OMITTED` now shared from `lib/domain/blocked-address.ts`); a plain-HTTP link that redirects to HTTPS says so and still gives the certificate; no "different site" why without the parser; "code written to be hard to read" instead of claiming intent.
- [x] Second review round (independent reviewer, eight confirmed findings): each link pattern member is described from its own label, agreement only when the labels match, the combined reading its own sentence (a 0.52 "malicious" model reading plus benign structure checks combines to benign, and Summary had said neither flagged it); a redirect chain that answered and then timed out keeps its hops, plain-HTTP legs, and count with the destination unconfirmed ("couldn't reach" now means nothing answered); three or more visible frames are named. Walking every scorer branch (`getScoredFindings`, new in `verdict.ts`; the long-chain, many-frames, and fresh-certificate thresholds now shared from `signal-severity.ts`, behaviour-identical) found four more unnamed scored findings, now named: a long chain ending on another site, the fresh-certificate-on-new-domain rule (the HTTPS why), a punycode name with no address, a young shared-platform registration. Ages of what was seen count from the result's check time (`evidenceTimeOf`: `checkedAt`, else `completedAt`; the stream's server start while scanning), in Summary and, so the two views agree, Full's rows (`getSignalDetailEntries` takes an evidence time; certificate expiry still counts from now). Pending questions hold room shaped like a typical clean answer (`PLACEHOLDER_SHAPE`, invisible generated content); question text wraps anywhere; the sources dot is drawn (`.sx-source::before`), so a copy reads "VirusTotal, Safe Browsing". `/about` and SPEC corrected (Summary's two views; the existing certificate-age rule). An independent adversarial review of these fixes (no score/verdict change, no bundle leak, ML copy true for every real `classifyConsensus` output) added: Full rows on the same clock as Summary; the reverse walk (an unscored page finding, such as one hard-to-read sign, isn't raised; `OBFUSCATION_HINTS` shared); a plain-HTTP link to a TLS port states its certificate; the e2e loop waits for each check to land; docs say a placeholder can shrink too. Kept by judgement: the "reads the link itself" sentence still shows when only one pattern member flags under a benign combined reading (the first review objected to its suppression). New tests, each seen failing first: the scorer walk (8 unexplained findings before), the member-reading cases, unfinished chain, visible frames, long on-site chain, a reopen-30-days-later DOM test, and `tests/e2e/summary.fixture.spec.ts` (heading offsets held across every check at 390px and 1280px with a held stream; 504px → 390px scroll width for a 63-letter host via the new `long-hop` fixture; copied sources text). Heading shift from pending to settled, measured: 0 for the clean and look-alike fixtures at both widths; a flagged reported answer with its disagreement still grows 72px at 390px (48px at 1280px), a named long host 52px, and unreachable answers shrink up to 40px.
- [x] First-load JS for `/` after the second round (base `b801036`): 782,645 → 785,333 B uncompressed (+2,688, +0.3%); 236,955 → 237,936 B gzip (+981, +0.4%). No verdict engine or PSL strings in the eager chunks.
- [x] Verified (`E2E_PORT=3119`): format, lint, typecheck clean; unit 44 files / 572 tests, integration 3 / 44, DOM 11 / 75, e2e 33 passed (4 new in `summary.fixture.spec.ts`, repeated clean), build green. Fixture Summaries checked by eye at 390px and 1280px in light and dark (clean, flagged, feed-hit, look-alike, unreachable, long-hop); no page overflow.
- [x] `components/scrutinix/summary-questions.tsx`: a "Questions" list, an `h4` per question, a held placeholder while pending, one `QuestionSources` component (cell names; layer 6 numbers them). No severity colour.
- [x] Strip cells focus the citing question in Summary and open the row in Full (hint text follows the view). The band's "because" line yields whenever evidence is shown (`shouldShowVerdictSummary(result, evidenceShown)`). The anatomy's facts step aside once the evidence states them; the owner and look-alike stay anatomy-only.
- [x] Error results keep their eight rows in Summary; legacy records and shared snapshots render as before (no questions). Unknown gets honest "couldn't reach" answers.
- [x] Retired `components/shared/signal-selection.ts` and its tests (the engine invariants for `getScoredSignals`/`withScoredSignals` moved to `tests/unit/verdict.test.ts`); the runtime keeps only the scored set for the strip and rows. `NEW_DOMAIN_DAYS` (30) is now shared by the engine, the registration dot, and the questions (behaviour-identical).
- [x] First-load JS for `/` (`.next/diagnostics/route-bundle-stats.json`, base `sx/2-evidence` 33d66b8 vs this branch): 769,884 → 782,645 B uncompressed (+12,761, +1.7%); 233,306 → 237,405 B gzip (+4,099, +1.8%), all question copy (no verdict engine or tldts in the eager chunks). Lazy-loading it after scan start is an option for layer 4's budget.
- [x] Verified (`E2E_PORT=3112`): format, lint, typecheck clean; unit 44 files / 563 tests, integration 3 / 44, DOM 11 / 74, e2e 29 passed (axe clean on Summary and Full in both themes), build green. Summary checked by eye on the flagged, clean, look-alike, and unreachable fixtures at 1280px and 390px in light and dark.

### P29.3 Anatomy on paste (2026-10-24, layer 3 of the distinctiveness stack)

- [x] The typed link is taken apart under the form before any scan (`components/scrutinix/input-anatomy.tsx`): each part captioned (P09 copy), a look-alike stated once, and the breakdown steps aside once that link's scan or result is on screen.
- [x] "Expecting a particular site?" (`lib/domain/expected-site.ts`): one optional field compares a domain, link, or brand name with the registered domain, in the browser; a match never says "safe", an unrecognised name admits it. Security review: brand names are never confirmed (no hyphen/digit stripping, no TLD-agnostic match), and a domain's name is read from the anatomy's own private-suffix-aware registered domain.
- [x] Review round: a name is never confirmed or denied ("not Microsoft" on live.com was false); typing the domain a look-alike spells out answers "No. The link only spells out paypal.com." so the owner is said once; screen readers hear each captioned part with its caption; a fragment route ("#/login") shows in the page part (display only; scans and cache keys never see it).
- [x] Verified: unit (expected-site), DOM (paste flow, focus on open), e2e (paste → scan hand-over) and axe on the pasted state in both themes.

### P29.5 Sharing (2026-10-24, layer 5 of the distinctiveness stack)

- [x] Web Share Target: `share_target` in `public/site.webmanifest` posts `title`/`text`/`url` (urlencoded) to `POST /share` (`app/share/route.ts`), which takes the first http(s) link (`url`, then `text`, then `title`; Android puts it in `text`), normalizes it centrally, and answers `303` to a relative `/?url=<link>`. No service worker: Chrome stopped requiring one for installing from the menu in 108 (Android) and 112 (desktop).
- [x] `/?url=` prefills the Single field (server-normalized), focuses Analyze (not the field, so a phone keyboard never covers the link taken apart below it), and never scans; invalid or unscannable values prefill nothing, silently. The share target's redirect, the bookmarklet, and the iOS Shortcut all arrive this way.
- [x] Recipient-first shared view: band, anatomy, and (verified) strip first, then "Check another link" over the form; `sr-only` h1; order fixed for the visit, so a fresh scan replaces the band in place.
- [x] From #62's review: `resolveSharedView` rejects links `normalizeUrlInput` refuses (private/local hosts), signed or not; once a result replaces what the page opened on, `shared`, `sig`, and `url` leave the address (`history.replaceState`).
- [x] README "Check links from your phone" (Android install + Share, iOS Shortcut steps anyone can follow, bookmarklet); SPEC non-goals, `?url=` and share-target contracts, FR-24, abuse case; privacy "Sharing to Scrutinix"; CLAUDE.md, DESIGN.md, AGENTS.md self-correction entry. The site never mentions installing.
- [x] Verified, first version (`E2E_PORT=3111`): format, lint, typecheck clean; unit 44 files / 506 tests, integration 4 / 48, DOM 13 / 79, e2e 37 passed (axe on the reordered shared view in both themes), build green.
- [x] Review rounds 1–4 and the whole-stack review (independent reviews; each new test shown failing without its fix, restored from a backup copy). Still in force: the structured `url` field is taken whole and a `text`/`title` that is one link is taken as written, so only a link inside prose is extracted (`'` allowed) and trimmed (`/a'b` and `/important!` reach the scan intact); trailing-closer trimming is one linear pass (20,000 `)`: 1,575 ms before, under 50 ms asserted); `readBoundedBody` counts the share body as it streams and cancels past 16 KiB (a body declaring 10 bytes was read to 131 KB), and urlencoded or multipart parse only the bounded bytes; `/share` is `Cache-Control: no-store` with no rate-limit tier; `normalizeUrlInput` holds 2,048 on the normalized link, so 400 × "é" is refused at the form, `/share`, `?url=`, and the API alike and 338 × "é" passes all four; privacy describes sharing without install language (an e2e test reads `/`, `/about`, `/privacy`) and says a link in a page address can reach the host's request logs; `/og/result` caps `max-age`/`s-maxage` at the snapshot's remaining validity (`sharedSnapshotRemainingMs`, `no-store` under a second). The rest of those rounds hardened an automatic scan for share-sheet launches: a cookie bound to the link, set only for `POST` + `Sec-Fetch-Site: none` (verified in Chromium 153: a browser-initiated POST is `none`, a cross-site form or link `cross-site`), spent by `proxy.ts`, then claimed once per id in the browser with a one-minute expiry and an IndexedDB record shared by tabs. Each round found another way it could scan twice or late; the simplification below removed it.
- [x] Simplification (owner decision, 2026-10-24): nothing starts a scan on its own. Share → Scrutinix (`POST /share`), `/?url=`, the bookmarklet, and the iOS Shortcut all fill in the Single field, show the link taken apart, focus Analyze, and wait for it (focusing the field raised the iOS keyboard over the link, so Analyze takes focus instead). Removed: the server module that issued and read the cookie, the browser's claim store, the proxy hand-over (`proxy.ts` is back to layer 4's shape), the cookie, header, window, and grant exports and the `Sec-Fetch-Site` gate in `lib/domain/share-launch.ts`, `renderedAt`, `headers()` in `app/page.tsx`, and the runtime's pending-launch refs and the wrappers that cancelled one; the runtime takes `prefill: string | null`. `POST /share` sets no cookie for any poster. Deleted tests: those three modules' unit and DOM tests, and the gate's cases in `tests/unit/share-launch.test.ts`; `tests/dom/launch.test.tsx`, `tests/integration/share-route.test.ts`, and `tests/e2e/sharing.smoke.spec.ts` rewritten to the new contract, adding `?shared=` outranking `?url=` (e2e). New assertions: a share-sheet `POST /share` (`Sec-Fetch-Site: none`) sets no cookie and redirects with `url` alone; on arrival the field holds the normalized link and shows its anatomy, and Analyze (not the field) is focused, and no `/api/analyze` request is made until Analyze is clicked (then exactly one). Shown failing under a reintroduced auto-scan, then reverted: scanning every prefill on arrival fails 2 DOM and 5 e2e tests at the no-scan check; a share-sheet-only cookie that the page scans on fails 3 integration and 3 e2e tests (the cookie check, which also shows the simulated launch carries `none`, and the no-scan check). Privacy "Sharing to Scrutinix" is three sentences; the README's Shortcut steps no longer end in publishing an iCloud link. Verified (`E2E_PORT=3141`): format, lint, typecheck clean; unit 47 files / 601, integration 4 / 55, DOM 18 / 97, e2e 47 passed and 3 failed (the axe `label-content-name-mismatch` on signal-row `<summary>` names in "result view accessibility" and "zero axe violations on a result", light and dark; the same 3 fail on 8f68211, untouched by this layer); `check:bundle` 231,994 gzip bytes of JS (232,624 on 8f68211; budget 234,000).
- [ ] Owner: confirm Share → Scrutinix on a real Android device after deploy.

### P29.6 Identity (2026-10-24, layer 6 of the distinctiveness stack)

- [x] Owner decisions (bake-off, blind panels): base P09 editorial, P11's registered-domain serif line under the verdict, P09's link taken apart and numbered citations, layer 2B's HTTPS question set; headline "Is this link what it says it is?"; no other copy change. Not built (not adopted): the "already clicked / typed a password" line, plain-words score bands.
- [x] Type: Newsreader (OFL) as the one display face, two static latin cuts instanced from `@fontsource-variable/newsreader` 5.3.0 (integrity-pinned) by `scripts/build-display-fonts.sh`: 400/opsz 16 (22,708 B) and 600/opsz 60 (24,156 B), loaded by `next/font/local` on `<html>` as `--font-display` (no runtime script). `fonts/newsreader/` holds the WOFF2, the share-image TTFs, `OFL.txt`, and a provenance README. `bundleBudget.fontBytes` 0 → 48,000 (46,864 measured + 2.4%).
- [x] Colour: P09's OKLCH ground/surface/ink/muted/hairline/accent and Malicious rule/surface/edge/band-ink mapped onto `--sx-*`; `--sx-button*` (ink) replaces `--sx-accent-solid*`; a `--sx-<verdict>-ink` per verdict for secondary text on the band. Contrast guard: 172 pairs, both themes.
- [x] Built: squared band under a heavy rule that draws (240ms, expo ease-out, drawn in place under reduced motion); the registered domain in the serif under the verdict word (the anatomy keeps the owner sentence); the link taken apart (hairline brackets, heavy on the domain, stacked on phones or when a middle part is too short); the strip as Evidence's numbered index (1–8, cited by every question's "From" line; spoken as source names); phones two columns of four 44px rows; questions and Full rows on a 19rem rail from 64rem; home, form, tabs, batch, history, toasts, error boundary, public shell (`.sx-public` tables/disclosures, `TableFrame`), OG cards (Newsreader, squared band). Icons unchanged (mark colours unchanged).
- [x] First-load JS: 230,286 B gzip / 754,423 raw, 11 scripts (trial/sx-5: 229,597 / 752,631, 11): +689 B gzip for the domain line, numbering, citations, legend, and layout-aware strip keys. As Tailwind strings the identity split the shared header/anatomy/strip chunk (+2.0 KB gzip); its static layout moved to `app/scrutinix.css`.
- [x] Lighthouse medians of 3 (mobile, `LIGHTHOUSE_PORT=3131` before / `3134` after): Performance 0.97 → 0.95, Accessibility 1.00 → 1.00, Best Practices 0.96 → 0.96, SEO 1.00 → 1.00. Simulated LCP 2.6 s → 2.9 s (the LCP element moved from the supporting line to the serif headline, which waits on the preloaded 600 cut); FCP 0.8 s, TBT 0, CLS 0 both.
- [x] Independent critique (GPT-6.1 Sol, read-only, against the brief and drafts): fixed the band's score/verdict collision at 640px (row layout from 48rem), bring-into-view measuring the domain line instead of the instruction (new e2e, shown failing on the old code and restored from a backup copy), captions widening short parts, the phone strip's "Registration" wrap, and evidence values breaking mid-word. Declined: re-colouring flagged cells (P09's and the existing strip ramp).
- [x] Verified: format, lint, typecheck clean; unit 49 files / 601, integration 4 / 55, DOM 15 / 93, e2e 46 passed (`E2E_PORT=3133`, axe in both themes), production build, `check:bundle`, `check:contrast` (172), Lighthouse above. Every surface looked at in light and dark at 1440 and 375 (plus 640/768/1024/1280 for the band and anatomy): home empty, pasted, streaming, Safe, Look-alike, Malicious, Critical, feed hit, Unknown, Error, Full, cell focus, shared verified/unverified/expired, batch, history, /about, /privacy, OG cards. Public prose measured at 64–75 characters per line.
- [ ] Owner: decide whether flagged strip cells keep the Malicious red (P09, the existing ramp) or go ink (P11; one panel judge and the critique preferred it).

### P29.7 Open methodology (2026-10-24, layer 7 of the distinctiveness stack)

- [x] `/about` prints the scoring method in full: every finding's points (lists, checks of the link itself, discounts), the bands, what convicts on its own (a single finding worth 55+), what can't erase a hit (both discounts off at any single finding worth 45+; the domain-age discount off on any list hit), Unknown, Look-alike, and the confidence cut-offs and caps.
- [x] The copy and numbers live in `lib/domain/methodology.ts`; `tests/unit/methodology.test.ts` runs every row through `buildThreatAssessment`, so a changed weight fails until the page states it (checked by mutating a feed weight).
- [x] Pronunciation on /about: "Scrutinix (SCROO-tih-nix), from scrutiny: looking closely before you trust something."
- [x] Review round: stated the shared-platform exception, the VirusTotal discount's no-date case, the model arithmetic, the meta-refresh and downloaded-HTML limits, "at least Malicious", and what Look-alike recognises; confidence now prints `CONFIDENCE_POLICY` (cut-offs, caps, bounds, full arithmetic in a disclosure). The test pins every printed number and both sides of each threshold (nine page/engine/provider mutations each fail it).
- [x] Second review round: confidence copy states that a partial threat-feed answer is thin only when it found nothing and that a set-aside shared-platform listing earns no clean-feed credit; the rules text moved into `methodology.ts` and prints the engine's thresholds; thresholds are digits and each row's numbers are checked in order; each confidence step is checked against its own policy field. The reviewer's four escaping mutations now fail the test.
- [x] Two engine fixes the review found: a multi-code Spamhaus answer reads as its strongest listing (phishing over spam), and a relative redirect on a plain-HTTP hop counts as staying on HTTP (10), like an absolute one.
- [x] Whole-stack review: the HTTP-redirect sign counts only a redirect status (301, 302, 303, 307, 308), so a 200 that carries a Location (absolute or relative) never scores; the predicate (`lib/domain/redirects.ts`) is shared with the Summary, which now explains a relative redirect that stays on plain HTTP (the scorer-coverage walk covers both).

### P30 Proof before merge (2026-10-26, cleanup step 3 of 3)

- [x] Read the lessons from `docs/agents/feedback-census.md` (#82) and `docs/agents/dependabot-proof-audit.md` (#83): Dependabot merges landed with no Proof citing the head SHA and a passing Verify job.
- [x] Auto-merge: repo auto-merge is off and no workflow merges, so no auto-merge path exists or was added; `fleet-merge-gate` (Audit, Verify, strict, squash only) is the merge gate.
- [x] `Proof` workflow (`.github/workflows/proof.yml`, `scripts/check-pr-proof.mjs`, `tests/unit/check-pr-proof.test.ts`) fails a pull request until its body has a Proof section quoting the current head SHA in full; it re-runs on body edits without cancelling CI. Dependabot is not exempt; the merging agent appends the Proof.
- [x] The verify skill's "How to report" states the Proof contract: head SHA, Audit and Verify job URLs, Greptile status, evidence or `INCONCLUSIVE`, posted before merge.
- [ ] Owner: add `Proof` to `fleet-merge-gate`'s required checks once it has run green on a few pull requests.
- [x] `CODEOWNERS` now covers the Proof guard: `@amanthanvi` owns `.github/workflows/proof.yml`, `scripts/check-pr-proof.mjs`, `tests/unit/check-pr-proof.test.ts`, and `.github/CODEOWNERS`. Under `pull_request` a PR runs its own copy of the guard, so it could edit the guard to pass itself.
- [ ] Code-owner review is being turned on in the `fleet-merge-gate` ruleset (done separately by Aman's steward, not in this PR). Every fleet PR is authored as amanthanvi and GitHub ignores an author's own approval, so with code-owner review required, a PR touching the guard files needs Aman to merge it through his admin bypass. That's intended.

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
- 2026-10-10: Unexpected analyze failures no longer forward `error.message`. `PublicError` is the allowlist for intentional copy (validation, rate limit, authored provider status). Full exception text is logged with URL redaction. The stream backstop writes a route-specific terminal error (required argument, no default) and the client keeps the first terminal event.
- 2026-10-24: Porting #63 onto the redesign stack, a random reference per failed check made one scan show several unrelated ids. The scan id is now the only reference, stated once per result; rows stay plain.

### P29.4 Speed (2026-10-24, layer 4)

- [x] Replace page Geist fonts with system sans/mono; keep a `--font-display` hook and unchanged server OG fonts.
- [x] Measure production `/` in a fresh Chromium context: baseline 13 scripts, 774,841 raw / 234,674 gzip JS bytes, 141,020 font bytes. Final: 11 scripts, 734,970 raw / 223,410 gzip JS bytes, zero font bytes.
- [x] Defer Batch input and Sonner until requested; load the history panel only for saved entries/Undo while retaining eager IndexedDB hydration. Batch table was already conditional and dynamic.
- [x] Add actual-browser first-load budget and regression self-check; CI gates 234,000 gzip JS bytes and zero page-font bytes. The 200 KB target remains unmet; retained boundary validation and result accessibility take priority over a broader rewrite.
- [x] Investigate first evidence using actual POST/NDJSON with offline fixtures and sanitized timing logs: warm-module first `signal_result` 0.0971 ms before / 0.0993 ms repeat; first request 4.990 / 4.950 ms. No server change or speedup claimed: checks already start concurrently. Cold real local ML took 85–110 ms while other evidence arrived in 3.8–9.4 ms. A controlled 200 ms cache miss delayed first evidence to 201.3–202.0 ms; changing the 1 s cache timeout needs live latency evidence. Measurements exclude HTTP/proxy/browser time and use no live providers.
- [x] Full verification: format, lint, typecheck, unit 495, integration 43, DOM 78, E2E 35, production build, bundle guard, contrast/strip tests. Lighthouse medians (3): Performance 0.97, Accessibility 1.00, Best Practices 0.96, SEO 1.00. Own ports: E2E 3109, Lighthouse 3110, visual fixture server 3112. Desktop/phone, light/dark home/result screenshots checked; score uses an unslashed system-sans zero with equal tabular digit widths.
- [x] Review findings addressed: optional Sonner chunk rejection gets a local accessible fallback that retains manual-share copy/action; Batch loading skeleton matches resolved responsive geometry (deliberately delayed chunk tests at 1440/375 px).
- [x] Independent adversarial review: two concrete issues fixed and second review clean. Delivered as a local conventional commit on `sx/4-speed`; no push or PR work.

<details>
<summary>P29.4 measured production script inventory</summary>

The budget sums gzip-compressed response bodies individually; sizes are bytes, not HTTP header overhead. Fresh desktop Chromium, no stored history, measured through network idle; server-only OG font files are excluded.

**Before** (`/_next/static/chunks/`):

- `turbopack-2zsgxh2sm2lot.js`: 10,913 raw / 4,289 gzip
- `1-_0vpsgswkva.js`: 27,475 raw / 8,380 gzip
- `3fntmmi971322.js`: 14,377 raw / 3,661 gzip
- `3660pm-83radu.js`: 933 raw / 487 gzip
- `1ujcamtjp9ase.js`: 549 raw / 278 gzip
- `2jv0t-ejozmiv.js`: 38,597 raw / 10,751 gzip
- `3gjea__ygfi8s.js`: 40,635 raw / 14,599 gzip
- `2pq9gd7xedcr4.js`: 172,661 raw / 46,243 gzip
- `1996_jmxw62tn.js`: 4,909 raw / 1,979 gzip
- `28vdvdtf35i73.js`: 34,806 raw / 11,323 gzip
- `43ku-rydh5fpt.js`: 73,470 raw / 24,033 gzip
- `1rj7ns8rte9vc.js`: 229,156 raw / 71,628 gzip
- `392ieu_e0lkn5.js`: 126,360 raw / 37,023 gzip

**After** (`/_next/static/chunks/`):

- `1-_0vpsgswkva.js`: 27,475 raw / 8,380 gzip
- `turbopack-2zsgxh2sm2lot.js`: 10,913 raw / 4,289 gzip
- `13xxm950nv56_.js`: 650 raw / 299 gzip
- `3fntmmi971322.js`: 14,377 raw / 3,661 gzip
- `1290606knvs8c.js`: 5,124 raw / 2,262 gzip
- `2pq9gd7xedcr4.js`: 172,661 raw / 46,243 gzip
- `06ci8w3gzkksr.js`: 34,087 raw / 10,936 gzip
- `0l2o1fo87bf8h.js`: 41,990 raw / 14,931 gzip
- `1be5gszzcyh2x.js`: 72,177 raw / 23,758 gzip
- `1rj7ns8rte9vc.js`: 229,156 raw / 71,628 gzip
- `392ieu_e0lkn5.js`: 126,360 raw / 37,023 gzip

</details>
