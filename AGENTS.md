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
- The public site includes an onboarding/trust panel on `/` plus dedicated `/about` and `/privacy` routes; keep those aligned with actual logging, retention, and scoring behavior.
- Request boundary: Next.js `proxy.ts` handles rate limiting for `/api/analyze` routes. Do not reintroduce deprecated `middleware.ts`.
- API surface:
  - `POST /api/analyze` streams NDJSON events for a single scan.
  - `POST /api/analyze/batch` streams NDJSON events for batch scans.
- Domain model:
  - Eight signals are always present in results: `virusTotal`, `mlEnsemble`, `googleSafeBrowsing`, `threatFeeds`, `ssl`, `whois`, `dns`, `redirectChain`.
  - History is client-side only and stored in IndexedDB.
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

- Keep the home layout scanner-first: since the 2026-08 minimal redesign that means one centered 44rem column (form → verdict → signal rows → history), not the earlier two-column intro grid. See `DESIGN.md`.
- Remove redundant marketing and spec microcopy when the same facts already appear next to the scan workflow (for example duplicate signal counts, batch limits, or NDJSON lines in both the hero and the scan-console footer).
- Keep method/caveat reference content on `/about` (compact definition list or grouped notes), not as a support card grid under the home scanner.
- For Summary versus Full signal lanes, use an accessible labelled control (for example a `role="switch"` with visible Summary and Full labels) instead of only icon buttons.
- Prefer non-verbal affordances for common actions when copy would repeat (for example an Enter-style icon on Analyze instead of a separate line saying Press Enter to scan).

## Learned Workspace Facts

- List `.cursor/` in `.gitignore` so local Cursor hooks, hook state JSON (including continual-learning index files under `.cursor/hooks/state/`), and other IDE-only paths are not committed; if anything under `.cursor/` was ever tracked, drop it with `git rm -r --cached .cursor` while keeping files on disk.
- Ignoring the whole `.cursor/` directory means team-shared Cursor rules under that tree will not be versioned from this repo unless you adopt a narrower ignore pattern later.

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
