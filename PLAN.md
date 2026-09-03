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

- Date: 2026-09-03
- Execution status: `P21-P25 complete and verified on Node 24 LTS`
- Platform:
  - Next.js `16.3.4`
  - React `19.2.x`
  - Node `24.20.0 LTS` (`.nvmrc`; deploy compatibility remains `24.x`)
  - ESLint `10.x` with direct Next.js, React, hooks, TypeScript, and JSX accessibility plugins
  - NDJSON streaming over `fetch`
- Architecture:
  - `proxy.ts` enforces rate limits on `/api/analyze` request paths.
  - Node.js route handlers orchestrate eight signals and stream normalized results.
  - IndexedDB stores client-only history, export state, and re-scan sources.
  - The ML ensemble uses a bundled quantized ONNX URL classifier plus lexical heuristics; scans do not call hosted inference.
  - Threat-feed coverage combines URLhaus, cached OpenPhish, ThreatFox, and Spamhaus DBL / SURBL DNSBL lookups.
  - Complete, non-partial results use a 15-minute process-local LRU plus optional shared Redis cache; error, partial-failure, and aborted results are never reused.
  - The home page renders as a scanner-first, single-column product tool in a `44rem` shell: scan form, verdict, Summary/Full signal rows, and local history in one flow. Method and caveat notes live on `/about`.
  - The public site now shares one editorial shell across `/`, `/about`, and `/privacy`, so the trust, methodology, and privacy surfaces stay visually aligned with the scanner.
  - The UI now uses the actual pulled shadcn preset `b1D24VYe` as its baseline language: neutral `radix-mira` tokens, compact controls, and smaller radii adapted onto the branded `components/scrutinix/*` surface.
  - Dark/light theme tokens stay in `app/globals.css`, while `app/scrutinix.css` is now limited to the lighter motion/effects layer needed for live scan states.
  - Body typography defaults to Geist Sans, while mono styling is reserved for telemetry, timings, hashes, and other code-like labels.
  - Favicons and manifest are now served from checked-in assets under `public/` instead of a generated `app/icon.tsx` route.
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
