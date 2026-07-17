# PLAN.md

Living execution plan for Scrutinix. This file reflects the implemented ship
state plus the 2026-03-23 public-repo polish follow-up after the rename
cleanup.

## Status Legend

- `[ ]` not started
- `[-]` in progress
- `[x]` completed
- `[!]` blocked / needs revisit

## Current Snapshot

- Date: 2026-05-01
- Execution status: `P18 completed and verified`
- Platform:
  - Next.js `16.2.4`
  - React `19.2.x`
  - Node `22 LTS`
  - NDJSON streaming over `fetch`
- Architecture:
  - `proxy.ts` enforces rate limits on `/api/analyze` request paths.
  - Node.js route handlers orchestrate eight signals and stream normalized results.
  - IndexedDB stores client-only history, export state, and re-scan sources.
  - The home page now renders scanner-first: a compact top band with the scan dock and minimal product framing, a calmer two-column operational workspace, a sticky history rail, and a clearly separate support/method section below the functional surface.
  - The public site now shares one editorial shell across `/`, `/about`, and `/privacy`, so the trust, methodology, and privacy surfaces stay visually aligned with the scanner.
  - The UI now uses the actual pulled shadcn preset `b1D24VYe` as its baseline language: neutral `radix-mira` tokens, compact controls, and smaller radii adapted onto the branded `components/scrutinix/*` surface.
  - Dark/light theme tokens stay in `app/globals.css`, while `app/scrutinix.css` is now limited to the lighter motion/effects layer needed for live scan states.
  - Body typography defaults to Geist Sans, while mono styling is reserved for telemetry, timings, hashes, and other code-like labels.
  - Favicons and manifest are now served from checked-in assets under `public/` instead of a generated `app/icon.tsx` route.
  - Production headers include CSP, permissions policy, referrer policy, and anti-sniff/frame protections.
- Intentional baseline decision:
  - `package-lock.json` drift from the platform refresh bootstrap was kept intentionally because the project was fully re-scaffolded onto the new dependency graph.

## Verification Summary

Completed local verification:

- `npm run lint`
- `npm run format -- --check .`
- `npm run typecheck`
- `npm run test:unit -- --run`
- `npm run test:integration -- --run`
- `npm run test:e2e -- --grep @smoke`
- `npm run build`
- `npm audit`
- `npm run lighthouse`

Completed deployment verification:

- `npx vercel env ls --scope aman-thanvis-projects`
- `npx vercel inspect <protected preview deployment> --scope aman-thanvis-projects`
- `HEAD https://www.scrutinix.net`
- `POST https://www.scrutinix.net/api/analyze`

Observed results:

- Unit tests: `8` files passed, `27` tests passed.
- Integration tests: `2` files passed, `6` tests passed, including batch per-URL failure isolation.
- Playwright smoke: `6` tests passed, covering legacy history migration, single-scan, batch-scan, accessibility, keyboard navigation, and history clear undo.
- Production build: passed with static metadata routes for `/icon`, `/opengraph-image`, `/robots.txt`, and `/sitemap.xml`.
- Security audit: `0` vulnerabilities reported across prod and dev dependencies after the 2026-05-01 dependency refresh.
- Lighthouse:
  - Performance `0.91`
  - Accessibility `1.00`
  - Best Practices `1.00`
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

- [x] Merged local advisor branches on dvisor/execute-all-merge: 006 (incl. 004), 001, 002, 003, 005.
- See plans/README.md for DONE status and per-plan detail.


### P01 Reset the baseline and living docs

- [x] Create `PLAN.md` and keep it current.
- [x] Replace stale project-local `AGENTS.md`.
- [x] Update `SPEC.md` with audit-resolved implementation notes and feasibility corrections.
- [x] Keep the regenerated `package-lock.json` as part of the intentional restart scaffold.

### P02 Re-scaffold the platform and scripts

- [x] Upgrade to current stable Next/React stack and pin Node 22 engines.
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
- [x] RDAP-backed registration enrichment behind the public `whois` signal name.

### P06 Implement external threat intel and classifier adapters

- [x] VirusTotal adapter.
- [x] Google Safe Browsing adapter.
- [x] URLhaus adapter.
- [x] OpenPhish cached feed ingestion.
- [x] Remove the deprecated PhishTank path and standardize on the OpenPhish community feed.
- [x] Hosted Hugging Face classifier plus local lexical scorer ensemble.

### P07 Build orchestration and streaming APIs

- [x] Shared orchestration service for all eight signals.
- [x] `POST /api/analyze` NDJSON stream.
- [x] `POST /api/analyze/batch` NDJSON stream with concurrency cap of `3`.
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
- 2026-03-23: The home route works better as a scanner-first dashboard than as a text-heavy hero; keeping the support/method layer below the workspace preserves readability on short laptop windows and mobile screens.
- 2026-03-24: IndexedDB history and streamed NDJSON events need runtime normalization at the client boundary; stale stored entries and malformed upstream payloads can still bypass TypeScript and crash direct `.metadata`, `.signals`, `.length`, `.map`, or string-method reads.
- 2026-05-01: Next `16.2.4` resolves the direct Next advisories but still pins vulnerable `postcss`; keep the npm `overrides` block until upstream package pins move past the audited vulnerable leaves.
- 2026-05-01: Active network probes must validate every resolved address and pin outbound sockets to the validated public address; checking only the hostname or first DNS answer leaves room for private-address redirects and rebinding.
- 2026-05-01: Cache only complete non-error analysis results; a clean verdict with provider partial failures can otherwise mask upstream outages for the full cache TTL.
- 2026-05-01: Keeping parallel PRs out of `PLAN.md` avoided artificial merge conflicts; use one consolidated plan update after the code branches land.
