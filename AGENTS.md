# AGENTS.md

Project-local operating notes for agents working in this repository. Keep this file aligned with the live codebase and defer to the global `~/.codex/AGENTS.md` for broader working style and safety rules.

## Purpose

- Build and ship Scrutinix, a FOSS public URL threat analyzer with streamed multi-signal results, batch analysis, local history, and production-grade UX.
- Treat `SPEC.md` as the product and architecture source of truth.
- Treat `PLAN.md` as the execution source of truth. Update it whenever scope, order, or status changes.

## Current Architecture

- Framework: Next.js App Router on the Node.js runtime.
- UI: React client/server components with Tailwind CSS v4, selective shadcn/ui primitives, and `next-themes`.
- Home route rendering is intentionally split: the page shell renders on the server, while smaller client islands handle scan orchestration, history hydration, and footer telemetry.
- The public site opens `/` with a one-line headline and supporting sentence above the scanner, plus dedicated `/about` and `/privacy` routes; keep those aligned with actual logging, retention, sharing, and scoring behavior.
- Request boundary: Next.js `proxy.ts` handles rate limiting for `/api/analyze` routes and CSP nonces for documents. Do not reintroduce deprecated `middleware.ts`.
- API surface:
  - `POST /api/analyze` streams NDJSON events for a single scan.
  - `POST /api/analyze/batch` streams NDJSON events for batch scans.
  - `createNdjsonResponse` requires a route-specific `terminalError` (`scan_error` or `batch_error`) for exceptions that escape the handler; it has no default. Clients keep the first terminal event and ignore anything after it.
- Domain model:
  - Eight signals are always present in results: `virusTotal`, `mlEnsemble`, `googleSafeBrowsing`, `threatFeeds`, `ssl`, `whois`, `dns`, `redirectChain`.
  - Only `PublicError` (and `SignalSkipError`) messages are client-visible; every other thrown value is internal and logged with URLs redacted. Terminal failures (`scan_error`, `batch_error`, the stream backstop) go through `exposeClientError`: a generic summary plus `Reference: <id>`, where the id is the route's own scan or batch id. Failures inside one check (signal rows, feed warnings, TLS/redirect fallbacks, a failed batch item) go through `checkFailureMessage`: a plain sentence, logged under the scan id. The result states that reference once (`VerdictDetails`, when the scan failed or was partial), never per row.
  - History is client-side only and stored in IndexedDB.
  - Cache only complete, non-partial, non-error, non-aborted results for 15 minutes. A rerun after degraded coverage must reach providers again.
  - In composite ML/threat-feed payloads, `warnings` mean lost coverage and set `partialFailure`; benign notes belong in `observations`. Redirect terminal errors also mark partial coverage.
  - Page-content credential-post evidence requires form-owned password inputs and includes viable submit-control `formaction` overrides; never combine page-wide password and form counts.
  - Rate limiting is enforced in `proxy.ts` with Upstash when configured and a process-local in-memory fallback otherwise; accept either `UPSTASH_REDIS_REST_*` or Vercel KV `KV_REST_API_*` env names.
  - The ML ensemble runs entirely locally: a quantized ONNX transformer (`lib/server/ml/`, urlbert-tiny-v4, Apache-2.0) via `@huggingface/transformers` plus a lexical heuristic scorer. There is no hosted inference call and no `HUGGINGFACE_*` env var.
  - Threat feeds combine URLhaus (documented `Auth-Key` header), cached OpenPhish community feed data, ThreatFox (reuses the URLhaus key), and Spamhaus DBL / SURBL DNSBL lookups with sentinel-code handling; do not reintroduce the removed PhishTank adapter.
  - The branded UI lives under `components/scrutinix/*`; shared shadcn/ui primitives live under `components/ui/*`.
  - Production responses ship browser-hardening headers from `next.config.ts`. Per-request CSP (nonce `script-src`, narrow `connect-src`) is applied in `proxy.ts` via `lib/server/csp.ts` so document responses get fresh nonces; do not reintroduce a static CSP-only approach in `next.config.ts` without an equivalent nonce path.

## Proven Commands

- Install deps: `npm install`
- Dev server: `npm run dev`
- Lint: `npm run lint`
- Format check: `npm run format:check`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test:unit -- --run`
- Integration tests: `npm run test:integration -- --run`
- DOM tests: `npm run test:dom -- --run`
- E2E (offline, fixture-backed): `npm run test:e2e`
- Build: `npm run build`
- Lighthouse: `npm run lighthouse`
- Security audit: `npm audit`
- Verify the running app: `npm run verify:launch`, then `npm run verify:doctor`, `npm run verify:smoke` or `npm run verify:drive`, then `npm run verify:cleanup`. The skill's own tests: `npm run verify:check`

## Verification

Drive the local scanner with `.agents/skills/verify-scrutinix/SKILL.md` (linked from `.cursor/skills/verify-scrutinix`). `verify:launch` starts `next dev` in tmux with `SCRUTINIX_TEST_FIXTURES=1` and the published e2e share key (as `scripts/run-e2e.mjs` does), so shares are signed in this loop and never with a real key. Evidence stays in `/tmp/scrutinix-verify/evidence` after cleanup. `run.json` records the identity of what launch started (tmux session id and creation time, and each listener's pid, start time, executable, and cwd). Cleanup stops a process or session only when that identity still matches and it serves this checkout; it never stops anything by name or pattern. Diagnostics print only those identity fields, and log excerpts are redacted. `verify:launch` snapshots `next-env.d.ts` (which `next dev` rewrites for `.next/dev`); `verify:cleanup` restores that snapshot only when the file still matches what the run wrote. Otherwise it leaves the file and warns. Leave generated edits out of commits.

The feature map at `.agents/skills/verify-scrutinix/references/features/README.md` is the regression sweep order. Feature pull requests need a Proof section: the exact commands, screenshot or trace paths that survive cleanup, the result of each command, and `INCONCLUSIVE` when a step could not run. Live provider calls are `INCONCLUSIVE` in this loop.

## Conventions

- Prefer small, reviewable diffs. Replace subsystems cleanly rather than layering temporary compatibility code unless `PLAN.md` says otherwise.
- Keep server-side logic in reusable modules under `lib/` so route handlers stay thin and testable.
- Keep external provider adapters behind stable interfaces. No provider-specific response shapes should leak into UI components.
- Sanitize and normalize URLs once, centrally. Never duplicate validation logic in route handlers and UI.
- Never log raw URLs server-side. Log hashes, scan IDs, timings, and result classes only.
- Default to deterministic test fixtures and mocked provider responses. Do not depend on live third-party services in automated tests. The e2e suite runs fully offline: `SCRUTINIX_TEST_FIXTURES=1` (set by `scripts/run-e2e.mjs`) swaps the analyze orchestrator's providers for the per-hostname scenarios in `lib/server/test-fixtures.ts`.

## Patterns To Follow

- Streaming responses use `application/x-ndjson` over `fetch`, not SSE.
- Route handlers should return structured non-stream errors for request validation and rate limiting, then stream scan events for accepted work.
- Keep cache and rate-limit policy explicit in code comments and docs when behavior changes.
- Use metadata routes or checked-in assets for favicon, OG image, robots, and sitemap. Do not reference missing files.
- Keep browser automation stable by binding local debug and audit servers to `127.0.0.1` when a tool depends on a fixed host.
- Vercel preview deployments are protected in this project; use `vercel inspect` for deploy verification when anonymous HTTP requests return `401`.
- Keep `app/globals.css` as the semantic theme-token source and `app/scrutinix.css` as the bespoke visual-effects layer; do not collapse them back together.

## Anti-Patterns To Avoid

- No new broad state-management layer unless a concrete need appears in `PLAN.md`.
- No silent fallback from provider outage to a malicious verdict.
- No stale documentation drift: if a command, env var, endpoint, or signal contract changes, update `PLAN.md`, `SPEC.md`, `CLAUDE.md`, and user-facing docs in the same workstream.
- No `next lint`; use ESLint directly.
- No broad shadcnization of branded components; preserve Scrutinix-specific hero, signal, and motion components unless there is a concrete accessibility or maintainability reason to replace them.

## Coordination

- If you spawn subagents, point them to this file plus `PLAN.md` and `SPEC.md` first.
- Before marking work done, run the narrowest relevant verification step and update `PLAN.md` status.

## Learned User Preferences

- Keep the home layout scanner-first: one centered column (headline → form → verdict band → the link taken apart → Evidence with the numbered strip as its index → actions → history), not the earlier two-column intro grid. Since P29.6 the column is 71rem with the form, history, and batch at 47.5rem. See `DESIGN.md`.
- Visual lane (2026-10-24, P29.6, supersedes 2026-10-06): the owner chose the editorial fact-checker from a 16-draft blind bake-off: P09 as the base, P11's registered-domain serif line under the verdict, P09's link taken apart and numbered citations, the HTTPS question set; headline "Is this link what it says it is?" and no other copy change. Not adopted (don't build): an "already clicked / typed a password" line, plain-words score bands. Light stays a cool, crisp sheet (not warm paper); no newspaper costume. The earlier lane's floor still holds: the verdict owns the moment, the site a link belongs to is legible, the page is not bland.
- Remove redundant marketing and spec microcopy when the same facts already appear next to the scan workflow (for example duplicate signal counts, batch limits, or NDJSON lines in both the hero and the scan-console footer).
- Keep method/caveat reference content on `/about` (compact definition list or grouped notes), not as a support card grid under the home scanner.
- For Summary versus Full signal lanes, use an accessible labelled control (for example a `role="switch"` with visible Summary and Full labels) instead of only icon buttons. Its accessible name must start with the visible labels ("Summary Full signal list"), not a different phrase.
- Prefer non-verbal affordances for common actions when copy would repeat (for example an Enter-style icon on Analyze instead of a separate line saying Press Enter to scan).

## Learned Workspace Facts

- Keep Cursor hook state and local IDE files out of git with `.cursor/*` in `.gitignore`, and keep the `!.cursor/skills/verify-scrutinix` exception so the verification skill symlink stays tracked. If hook state under `.cursor/` was ever tracked, drop it with `git rm -r --cached .cursor` while keeping files on disk.
- `.gitignore` ignores `.cursor/*` except the `verify-scrutinix` skill symlink. Other Cursor hook state and local rules under that tree stay unversioned.

## Self-Correction Log

- 2026-03-09: Next.js App Router no longer accepts `themeColor` in `metadata`; move it to the `viewport` export to avoid build warnings.
- 2026-03-09: Keep IndexedDB history out of the root home-page runtime; the scan shell now renders server-first, and the history rail hydrates as its own client island.
- 2026-03-09: Deferring the history rail behind idle or first-interaction hooks looked promising on paper but regressed the scripted Lighthouse score from `0.99` to `0.92`; keep the current eager history island unless a future chunk-analysis proves a net win.
- 2026-03-09: The SSL signal can be technically correct while the verdict still understates it; keep invalid or untrusted certificates weighted high enough to move the overall verdict into at least the suspicious band.
- 2026-03-09: Clean verdicts can still look overconfident when a primary reputation source times out; cap safe-result confidence whenever VirusTotal, Google Safe Browsing, or threat-feed coverage fails to complete.
- 2026-03-09: Tailwind arbitrary text-color utilities with raw CSS vars can be misleading on critical CTAs; prefer an explicit color utility or inline style when contrast correctness matters.
- 2026-03-22: `npx vercel` may be authenticated even when `~/.vercel/auth.json` is absent; on this machine the token lives at `~/Library/Application Support/com.vercel.cli/auth.json`.
- 2026-03-23: Do not run `git commit` and `git push` in parallel; the push can race the new commit and falsely report `Everything up-to-date`.
- 2026-03-23: Next.js 16 rejects `next/dynamic(..., { ssr: false })` inside Server Components; if a shared shell owns the theme toggle, make that shell component explicitly client-side.
- 2026-03-23: `next-themes` `resolvedTheme` can still trigger hydration mismatches inside a server-rendered header; gate icon/label rendering behind a mount-safe client snapshot before reading it.
- 2026-03-23: Tailwind utility classes lose to repo CSS resets when those resets live outside `@layer base`; keep link/button resets layered or they can silently override CTA colors.
- 2026-10-06: Vercel env vars apply only to deployments built after they change; connecting a store (for example Upstash) does nothing until the next deploy. Shared Redis is easiest to prove behaviourally: `x-ratelimit-remaining` keeps counting across a production and a preview request within one minute.
- 2026-10-06: `@huggingface/transformers` loads `onnxruntime-node` through `createRequire()`, which Next file tracing cannot follow, so `next.config.ts` lists the runtime files by hand. On linux-x64 the onnxruntime postinstall also downloads ~250MB of CUDA providers into the same directory, so name the CPU binaries exactly; `npm run check:trace` guards both failure modes after a build.
- 2026-10-06: rdap.org answers 403 to requests with no or a generic (`node`) User-Agent, and registries only answer for the registered domain (`www.` hosts get 400/404); send `SCRUTINIX_USER_AGENT` and query the PSL registrable domain.
- 2026-10-06: CI Lighthouse performance swings by ±0.06 run to run on shared runners (the same code scored 0.99, 0.93, 0.87), so `scripts/run-lighthouse.mjs` audits `numberOfRuns` times (3, from `lighthouserc.json`) and gates each category on the median; `LIGHTHOUSE_PORT` (default 3000) lets parallel worktrees audit. Simulated mobile LCP is the intro text and is bound by the font/CSS request chain, not JS, so watch font payload before adding faces.
- 2026-10-06: `vercel link` silently pulls the project's env values into a new `.env.local`; delete it afterwards, or use `vercel curl --deployment <url>` without linking to reach protected previews.
- 2026-10-06: `next dev` rewrites `AGENTS.md`/`CLAUDE.md` with a managed agent-rules block on every run when it detects a coding agent; `next.config.ts` sets `agentRules: false` (option read in `next/dist/server/lib/start-server.js`). Keep it off so these hand-curated files stay clean.
- 2026-10-06: Provider strings and the template that wraps them must be designed together. Feed `detail` strings already began with "listed", and the verdict wrapped them as "`${feed}` listed the URL as `${detail}`", shipping "openphish listed the URL as listed in the OpenPhish community feed." `detail` is now a clause that follows the feed's display name, `lib/domain/feed-copy.ts` builds the sentence (and rewrites legacy strings), and `tests/unit/feed-copy.test.ts` asserts every producer literal and every reason reads as one grammatical sentence. Route every count through `countOf`.
- 2026-10-06: `e2e` binds port 3000 by default; set `E2E_PORT` to run several worktrees' suites side by side.
- 2026-10-06: Custom Tailwind v4 font-size tokens (`text-meta`, `text-caption`, …) are read by tailwind-merge as colours and dropped whenever a `text-[var(--sx-…)]` colour follows in `cn()`; `lib/utils.ts` extends the merge theme. Add every new `--text-*` step there.
- 2026-10-06: A server component cannot read plain values exported from a `"use client"` module (they become client references). Keep server-safe atoms (`SignalCell`, `cellNames`, `BrandMark`) in `components/scrutinix/signal-cell.tsx`.
- 2026-10-06: Reading `?shared=` from `window.location` in a `useState` initializer renders null on the server and a snapshot on the client (hydration mismatch). `app/page.tsx` passes the raw payload into `AnalyzerRuntimeProvider`.
- 2026-10-06: The e2e suite starts more scans than one client may per minute; `tests/e2e/helpers.ts` gives each test its own `x-real-ip` (198.51.100.0/24) instead of loosening the shipped limit. og:image URLs are absolute (metadataBase), so fetch their path from the test server.
- 2026-10-06: `prettier --write .` reformats tool-owned `.impeccable/` files; `.prettierignore` excludes them so they stay byte-exact. Keep screenshot scratch in a private temp directory: a shared `/tmp/sx-shots` already held another session's files.
- 2026-10-06: Never keep a second copy of the verdict engine's thresholds in presentation code. The Summary selector chose rows by per-signal severity, whose thresholds (redirect `> 3` hops, whois `< 30` days) disagreed with the scorer, so a Suspicious result built from redirects and domain age showed no rows and "All 8 checks found nothing." The engine now tags each contribution with its signal and stores `threatInfo.scoredSignals`; Summary and the row dot read that. Anything the client needs from the engine must avoid statically importing `lib/domain/verdict.ts` (it pulls the PSL via `registrable-domain`); share thresholds through `lib/domain/reputation.ts`. The engine itself is browser-safe (no `node:net`), so history loads it with a dynamic `import()` only to backfill `scoredSignals` on entries saved before the field existed.
- 2026-10-06: A look-alike detector that accepts any `name.cc` run in a subdomain flags ordinary regional and tenant hosts (`acme.us.auth0.com`, `shop.de.example.com`) and then tells people a legitimate login "isn't really acme.us". Country-code runs count only for a listed brand (`lib/domain/impersonated-brands.ts`, shared with scoring); keep real-world tenant hosts in the negative unit cases.
- 2026-10-06: "Every check errored with no data" is not a legacy fingerprint: a real Error scan looks the same. Legacy history is identified by the sanitizer's own `MISSING_SIGNAL_DATA` message on every check.
- 2026-10-06: Same-lightness hues cannot meet 3:1 against each other and the ground at once; the strip separates flagged / caution / found-nothing by shape (solid / hatch / dash), and the contrast guard checks each mark against the track instead.
- 2026-10-06: `hooks/use-link-anatomy.ts` caches the loaded tldts parser at module level, so a DOM test that must see the pre-parser render has to run before any test in the same file loads it (vitest isolates files, not tests).
- 2026-10-06: Flex children are blockified, so Chromium's accessible name puts spaces between them ("malicious. scrutinix.test /login"). The compact row anatomy keeps one `sr-only` string and hides the visual parts; e2e should find rows by role name, not `getByText`, which now matches both.
- 2026-10-06: Import Zod as `import * as z from "zod"`, never `import { z } from "zod"`. The named `z` is a re-exported namespace object Turbopack cannot prune, so every Zod 4 locale ships in the home page's eager chunk (97 KB vs 37 KB on the wire) and mobile Lighthouse Performance drops below the 0.90 gate.
- 2026-10-06: Satori wraps share-card headlines on its own and justifies the first line ("before you", "click." alone). `lib/og/cards.tsx` breaks the default headline into explicit flex rows; check `/opengraph-image` at 1200x630 after any copy change.
- 2026-10-06: A strip state drawn as a left-anchored partial length reads as progress, because the strip is the streaming indicator. Settled states use shapes whose length cannot read as "stuck at 50%" (the partial answer is a centred block that grows from the centre).
- 2026-10-06: `toBeInViewport()` passes on a one-pixel sliver. A bring-into-view test must start with the target well off-screen after any layout shrink (re-scan from the bottom of a long page) and assert `{ ratio: 1 }`; confirm it fails with the scroll removed.
- 2026-10-06: Never render a client-built payload as Scrutinix's own statement. `?shared=` was base64 the browser wrote, and the page title, OG image, and snapshot band stated it as our verdict, so anyone could mint "Safe: paypal.com — Scrutinix" previews for phishing links. Anything that speaks as Scrutinix (metadata, share cards, verdict bands) needs a server signature over the exact bytes it renders (`lib/server/share-signing.ts`); unverified input gets neutral copy and only what Scrutinix computes itself (the link anatomy). The browser receives a server-resolved `SharedView`, never the raw payload to decode.
- 2026-10-06: A signature proves who said it, not that the headline is safe to show. A signed "Safe" for a fresh look-alike still laundered phishing through chat previews, which often show only the title and image, so the hedge has to be in the headline (`shareHeadline`), not just the description. A signed time must be when the evidence was gathered (`checkedAt`), not when a cache hit was served.
- 2026-10-06: An HMAC key is only as scoped as its environment. Any deployment holding `SHARE_SIGNING_SECRET` can mint links production verifies, and Vercel exposes "all environments" variables to preview builds of unreviewed branches, so the key lives in Production only; putting the environment into the signed message would not help, since a key holder can sign any prefix. On a leaked key: unset it and `SHARE_SIGNING_SECRET_PREVIOUS` (or replace them), redeploy, and purge the `/og/result` CDN cache if the deploy does not; chat platforms' unfurl caches are outside our control. Never ship a signed image as `immutable`. For routine rotation keep the old key in `SHARE_SIGNING_SECRET_PREVIOUS` for at least 72 hours (`SHARE_MAX_AGE`): the browser cannot verify a signature, so it tells the sender a signed link shows the result, and that must stay true for the whole window.
- 2026-10-06: A valid signature is not a timeless one, and a signing server must never run in a mode that invents verdicts. Two holes survived signing: anyone could scan their own link while it was benign (or cloaked), keep the genuine signed Safe, flip the link to phishing, and the preview said "Safe" forever; and test-fixture mode (which scores unknown hosts Safe) with a real key was a signing oracle. Signed snapshots now expire after `SHARE_MAX_AGE` (72h, `capturedAt` is inside the HMAC; judged against an explicit `now`), and `env.ts` makes fixture mode and real keys mutually exclusive (fixtures accept only the published e2e key, which nothing else accepts). Pass the clock in rather than reading it deep inside, so tests stay deterministic; e2e payloads use a check time relative to `Date.now()`.
- 2026-10-24: Anything that dedupes against "what Summary shows" must be revisited whenever Summary changes shape. The Summary questions cite all eight checks, so the band's "because" line and the link anatomy's facts now treat every check as stated, and a disagreement sentence must never restate a fact its own answer states: the feed-hit question first said "listed 6 hours ago" twice, which the e2e `/listed.*listed/` guard caught because Playwright's `getByText` matches a parent whose sibling sentences combine. Keep such guards; they catch repetition across sentences, not just within one.
- 2026-10-24: Missing data is not a negative answer. The band read absent link anatomy as "not a look-alike", and the hook called a failed tldts import "ready", so a held or blocked parser chunk left a look-alike reading "Safe / High confidence". Anything gated on lazily loaded evidence needs three states (`pending | ready | failed`), and "failed" gets its own honest copy. Turbopack already retries a failed chunk once and then forgets it, so an app-level retry still refetches. `next build` typechecks `tests/` too.
- 2026-10-24: Presentation that explains a score must be checked against every scorer branch, not the cases someone remembered. The Summary review found two scored findings never mentioned (a chain that timed out after answering, three visible frames); walking every branch (`getScoredFindings` in `tests/unit/summary-questions.test.ts`) found four more. Related traps from the same round: an aggregate label (the ML consensus) says nothing about each member's own reading; a relative age ("issued 2 hours ago") must count from the same moment as the stored ages beside it (`metadata.checkedAt`), not render time; a placeholder sized by character count wraps differently from the text that replaces it, so draw a representative string as invisible generated content; and Chromium drops a trailing space inside an `sr-only` span when copying a selection, so keep separator spaces outside it.
- 2026-10-24: P29.4 keeps history storage eager but avoids importing its panel for an empty store. Sonner loads on the first notification; wait for its subscription so the first toast is not lost, and contain rejected chunks locally so manual share links remain usable. Match the Batch loading skeleton's actual textarea/hint/button geometry. Keep `--font-display` in `:root`: an unused `@theme inline` token is pruned by Tailwind. `npm run check:bundle` measures fresh-browser script/font requests after a production build; its thresholds are in `package.json`, and Chromium must be installed.
- 2026-10-24: A `Content-Length` check is not a body limit. `request.formData()` reads whatever streams in; count bytes while reading (`readBoundedBody`) and parse only the bounded bytes. A structured share field (`url`) is the link as written: prose heuristics (stop at `'`, trim `!`) changed real links before scanning.
- 2026-10-24: Validate length on the value a function returns, not the one it was given: `normalizeUrlInput` checked 2,048 on the raw input, so a 420-character link of "é" passed `/share` and redirected at 2,420 percent-encoded, which the page refused silently. And server-rendered props are not one-shot: on Back, Next's router restores the cached render, props and all, into a new component, so anything a page does "once on arrival" from its props runs again.
- 2026-10-24: Starting a scan on its own for a share-sheet launch took four review rounds and never got simple. `Sec-Fetch-Site: none` marks any browser-initiated navigation (a link tapped in a chat app too), so it needed a POST-only cookie bound to the link; spending it once needed the proxy; Back needed a browser-side record of spent ids; and that record needed an expiry clock skew couldn't break and one IndexedDB transaction across tabs. The privacy page ended up explaining codes, cookies, and minutes. The owner removed all of it: every way a link arrives (`POST /share`, `?url=`, the bookmarklet, the iOS Shortcut) fills in the field, shows it taken apart, and waits for Analyze. Don't reintroduce a scan that starts without the person's tap.
- 2026-10-24: Turbopack splits a shared chunk once it outgrows its size threshold, and two half-chunks gzip worse than one: P29.6's identity added ~2.4 KB of Tailwind class strings to the header/anatomy/strip chunk (45,296 bytes), which split into 17.8 + 29.9 KB and cost +2.0 KB gzip first-load. Pair `npm run check:bundle -- --measure` script lists against the base branch's (a throwaway `git worktree` with an APFS-cloned `node_modules`, `cp -c`) before trimming anything; moving static component layout into `app/scrutinix.css` (`.sx-*`) put the chunk back under the split.
- 2026-10-24: `app/scrutinix.css` is unlayered, so its rules beat Tailwind utilities on the same element: a `text-[2rem]` on `.sx-band-heading` silently lost. Give a variant its own class (`.sx-band-heading-claim`).
- 2026-10-24: A visible heading wired as `<section aria-labelledby>` creates a region with that heading's name. The result's "The link, taken apart" heading duplicated the pasted link's region name, so landmark lists (and the hand-over e2e) saw two; keep one region per name.
- 2026-10-24: `next/font`'s `variable` must sit on `<html>` for a `:root` custom property (`--font-display`) to resolve it, and the variable already carries the metric-matched fallback and the declared fallbacks; adding your own stack after it only duplicates them.
