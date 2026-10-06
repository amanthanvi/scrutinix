# CLAUDE.md

## Project Overview

**Scrutinix** — a FOSS multi-signal URL threat analyzer, live at
https://www.scrutinix.net. It streams 8 independent security signals
(VirusTotal, ML ensemble, Google Safe Browsing, threat feeds, SSL, WHOIS,
DNS, redirect chain) over NDJSON into a minimal, single-column product UI:
the canonical minimal product tool on a cool crisp white ground, with the
verdict band, the link's real owner, and an eight-cell signal strip as the
one signature. Light and dark themes receive equal treatment.

Operating conventions and learned gotchas live in [`AGENTS.md`](./AGENTS.md).
`SPEC.md` is the product record; `DESIGN.md` is the design constraint of
record (tokens in its frontmatter, extensions in `.impeccable/design.json`,
direction contract in `.impeccable/surfaces/app-page-tsx.md`); `PLAN.md` is
the live execution record.

## Commands

```bash
npm run dev                        # Dev server on :3000
npm run build                      # Production build
npm run lint                       # ESLint
npm run typecheck                  # tsc --noEmit
npm run format:check               # Prettier
npm run test:unit -- --run         # Vitest, node
npm run test:integration -- --run  # Vitest, node + MSW
npm run test:dom -- --run          # Vitest, jsdom + fake-indexeddb
npm run test:e2e                   # Playwright with offline fixtures (E2E_PORT, default 3000)
npm run lighthouse                 # Lighthouse audit (LIGHTHOUSE_PORT, default 3000)
npm run check:contrast             # WCAG token-pair guard, both themes
npm run icons                      # Regenerate favicons/app icons from lib/brand-mark.ts
```

## Architecture

```
app/
  layout.tsx              # Root layout (ThemeProvider + Sonner + Geist Sans/Mono)
  page.tsx                # Single-column home: header, headline, ScanForm, ResultsSection, history; ?shared= metadata
  scrutinix.css           # CSS-only motion/utility layer (sx-* classes)
  globals.css             # Tailwind v4 + semantic --sx-* theme tokens
  api/analyze/            # POST NDJSON stream (single + batch routes)
  opengraph-image.tsx     # Default OG card (lib/og/cards.tsx, bundled Geist)
  og/result/route.tsx     # Per-result share image for ?shared= links (payload-capped)
proxy.ts                  # Rate limiting (scan tier for /api/analyze, image tier for /og/result) + CSP nonces

components/
  ui/                     # Minimal primitives: button, input, textarea, tabs, sonner
  theme-provider.tsx      # next-themes wrapper (system default)
  theme-toggle.tsx        # Mount-safe light/dark toggle in the header
  scrutinix/
    analyzer-runtime.tsx  # Context: inputs, streams, view mode, share/rescan/history queue
    app-header.tsx        # Header: eight-square mark + wordmark, About/Privacy nav, theme toggle
    app-footer.tsx        # One-line footer
    scan-form.tsx         # Single/Batch tabs + inputs (id="scan-console")
    input-panels.tsx      # URL input + Paste + Analyze; batch textarea and exports
    results-section.tsx   # Band → anatomy → strip → Summary/Full rows → details → actions; focus + live region
    verdict-panel.tsx     # VerdictBand (Checking/result/snapshot, one element tree) + VerdictDetails
    link-anatomy.tsx      # Registered domain emphasised, look-alike sentence, segment-keyed facts, full-link toggle
    signal-strip.tsx      # SignalStrip (roving toolbar), SignatureStrip, SignalGlyph
    signal-cell.tsx       # Server-safe atoms: SignalCell, cellNames, BrandMark
    signal-row.tsx        # Typed per-signal disclosure row (<li>, strip cell as marker)
    batch-table.tsx       # Batch result list with mini strips
    result-row.tsx        # Shared history/batch row parts: verdict word (look-alike tone), compact anatomy
    history-section.tsx   # Dynamic-import wrapper; drains completed-result queue
    history-panel.tsx     # Search, clear/undo, export, entry list (draws nothing when empty)
    public-page-shell.tsx # Shared 46rem shell for /about and /privacy
    error-boundary.tsx    # Class-based error boundary
  shared/
    scrutinix-types.ts    # Verdict/severity presentation helpers ("clear" = found nothing)
    signal-utils.ts       # Signal findings, summaries + detail entries
    signal-selection.ts   # Summary selection: verdict drivers + quiet-check line

hooks/
  use-ndjson-request.ts   # Shared stream core
  use-scan-stream.ts      # NDJSON consumer for one scan
  use-batch-stream.ts     # NDJSON consumer for batch scans
  use-scan-history.ts     # IndexedDB history with search
  use-link-anatomy.ts     # Lazy tldts load (preloadLinkParser) + memoized anatomy and ready flag

lib/
  brand-mark.ts           # Mark geometry: header, OG cards, scripts/generate-icons.mjs
  domain/                 # Zod schemas, URL validation, verdict logic
    verdict-guidance.ts   # Imperative line, showScore, announcement, coverage caveat
    feed-copy.ts          # Feed display names, feed-match + Google threat-type wording
    reputation.ts         # Client-safe reputation thresholds + hasConfirmedReputationHit
    signal-severity.ts    # Per-signal severity ("clear" = found nothing; scored => warning)
    signal-signature.ts   # Eight-cell signature, legacy-record check, share snapshot encode/decode
    link-anatomy.ts       # Isomorphic URL anatomy + look-alike detection (tldts passed in)
    impersonated-brands.ts # Shared brand list (look-alike ccTLD runs, structure-risk scoring)
    registrable-domain.ts # Server wrapper over link-anatomy's registrableDomainOf
    copy.ts               # countOf / formatList / capitalize / formatAge for user-facing copy
  og/                     # Share-card renderers (cards.tsx) and bundled-Geist loader (fonts.ts)
  server/                 # Orchestrator, providers, signals, cache, local ONNX ML
    share-metadata.ts     # ?shared= validation → page metadata, server-side anatomy, image cap
    rate-limit.ts         # Upstash/in-memory limiter with "scan" and "image" tiers
  client/                 # NDJSON parser, export utilities
  config/                 # Environment validation

scripts/
  check-contrast.mjs      # WCAG token-pair guard for both themes (also run by the unit suite)
  generate-icons.mjs      # `npm run icons`: favicons/app icons from lib/brand-mark.ts (sharp; embeds provenance)
  run-e2e.mjs             # Build + start + Playwright on E2E_PORT

tests/
  unit/                   # Vitest unit coverage
  integration/            # Route/provider integration coverage
  dom/                    # Client state and IndexedDB coverage
  e2e/                    # Playwright smoke/accessibility coverage
```

## Key Patterns

- **Zod-first schemas**: payload and event shapes live in
  `lib/domain/schemas.ts`; old IndexedDB/cache/stream data is sanitized at
  boundaries.
- **NDJSON streaming**: server routes stream signal results as they resolve;
  `use-ndjson-request.ts` owns client parsing and cancellation.
- **Abort plumbing**: request abort, stream cancel, and scan budget signals
  reach network-bound providers. Local ML and Node DNS use internal timeouts.
- **Local ML**: `lib/server/ml/` runs a bundled quantized ONNX classifier via
  `@huggingface/transformers`; lexical heuristics are the second ensemble
  member. No hosted inference call is required. User-facing copy names the
  two members "link pattern model" and "structure checks" everywhere
  (details rows, consensus notes, verdict reasons).
- **Verdict engine**: confirmed sources can convict; unreachable hosts produce
  an honest `unknown`; exculpatory evidence never erases confirmed hits.
- **One encoding per fact**: threat score renders once; severity renders once
  per signal. Verdict text uses AA-safe `--sx-<verdict>-fg` tokens. A source
  that found nothing is `clear` (gray `--sx-clear`), never green; Unknown has
  its own slate `--sx-unknown` pair.
- **Verdict copy is pure**: `lib/domain/verdict-guidance.ts` (imperative,
  score visibility, live announcement, caveat) and `lib/domain/verdict.ts`
  (summary naming the evidence, reasons) own every verdict string; counts go
  through `countOf`. `threatInfo.scoredSignals` (from `getScoredSignals`) is
  the single source of truth for which rows Summary shows. Feed-match `detail` is a clause that follows the feed's
  display name ("lists this link as phishing"); `describeFeedMatch` adds it.
- **Verdict band**: tinted with `--sx-<verdict>-surface`; the word stays ink
  (one colour encoding). The summary sentence shows only when no Summary
  driver row already states it. It is the only tinted container; once it
  mounts, the home headline steps down to the headline size (CSS `:has`)
  so the verdict owns the one display moment.
- **Eight-cell strip**: severities from `lib/domain/signal-signature.ts` in
  fixed `signalNames` order. Every state has its own shape, so no two differ
  by hue alone: flagged solid, caution hatched, found-nothing a thin dash,
  partial a centred short block, failed an outline, didn't-apply dashed,
  running the empty track. `tests/unit/contrast.test.ts` checks the shapes stay
  distinct and each mark stands 3:1 off the track. One grammar for
  progress, rows, history/batch, mark, icons, and OG images
  (`lib/og/cards.tsx` mirrors the shapes). Entries saved before signals were
  kept (`isLegacySignalRecord`: every check carries the sanitizer's
  `MISSING_SIGNAL_DATA`) draw empty glyph slots and a plain note, never
  eight "failed" cells; a real all-failed scan still draws them.
- **Link anatomy**: `lib/domain/link-anatomy.ts` is isomorphic (tldts passed
  in). Every contiguous run of 2+ subdomain labels is tested; a two-letter
  country-code run counts only for a listed brand (`amazon.de`), so
  regional/tenant hosts (`acme.us.auth0.com`) never read as look-alikes.
  Look-alikes hedge presentation only; scores and the verdict word never
  change. On Safe, `getVerdictGuidance` returns the action-only imperative,
  `tone: "unknown"` (the band and OG card use it, never the raw verdict),
  and a `confidenceNote` in place of "High confidence". The owner fact is
  stated once, by `ownershipSentence` (anatomy, live region, share
  description, OG card). History/batch rows use `LinkAnatomyCompact`
  (`result-row.tsx`): the subdomain truncates from its left so the owner
  never gets cut. Shared
  links get their anatomy from the server (`sharedAnatomy`) so the hedge is
  in the first paint; verdict announcements wait for the parser.
- **UI danger is not a verdict**: form/stream errors and destructive
  confirms use `--sx-danger-fg` / `--sx-danger-border`, never
  `--sx-malicious-*`.
- **Type scale**: custom `text-*` steps live in `@theme`; `lib/utils.ts`
  teaches them to tailwind-merge or `cn()` silently drops them.
- **Contrast guard**: `scripts/check-contrast.mjs` (unit suite) asserts every
  token pair in both themes; extend its `PAIRS` when adding a token.
- **Static accent**: blue `--sx-accent`; verdict colors appear only where a
  verdict is stated.
- **E2E fixtures**: `SCRUTINIX_TEST_FIXTURES=1` provides deterministic offline
  scenarios under `npm run test:e2e`.
- **CSS layering**: `app/globals.css` owns semantic tokens;
  `app/scrutinix.css` owns prefixed motion/effect utilities. Motion is CSS-only,
  under 300ms, and respects `prefers-reduced-motion`.

## Stack

- Node 24 LTS, Next.js 16, React 19, TypeScript 5.9 (strict + noUncheckedIndexedAccess)
- Tailwind CSS v4, Geist Sans/Mono, Radix, Lucide, Zod 4, idb, sonner,
  next-themes, local `@huggingface/transformers`
- ESLint 10 with direct Next.js, React, hooks, TypeScript, and JSX accessibility plugins
- Vitest, MSW, fake-indexeddb, Playwright, axe-core, Lighthouse

## Env

Optional keys treat empty strings as unset; the app degrades honestly without
them. See `.env.example` for the full annotated list.

```
VIRUSTOTAL_API_KEY=...
GOOGLE_SAFE_BROWSING_API_KEY=...  # optional
URLHAUS_AUTH_KEY=...              # optional; also authenticates ThreatFox
SPAMHAUS_DQS_KEY=...              # optional; DBL via DQS (public mirror blocks cloud DNS)
UPSTASH_REDIS_REST_URL/TOKEN=...  # optional (rate limiting + shared cache)
KV_REST_API_URL/TOKEN=...         # optional Vercel KV aliases
OPENPHISH_FEED_URL=https://openphish.com/feed.txt
NEXT_PUBLIC_APP_URL=https://www.scrutinix.net
```
