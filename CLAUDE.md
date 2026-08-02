# CLAUDE.md

## Project Overview

**Scrutinix** — a FOSS multi-signal URL threat analyzer, live at
https://www.scrutinix.net. It streams 8 independent security signals
(VirusTotal, Google Safe Browsing, threat feeds, ML ensemble, TLS, WHOIS,
DNS, redirect chain) over NDJSON into a minimal, single-column product UI.
Light and dark themes receive equal treatment.

Operating conventions and learned gotchas live in [`AGENTS.md`](./AGENTS.md).
`SPEC.md` is the product record; `DESIGN.md` is the design constraint of
record; `PLAN.md` is the live execution record.

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
npm run test:e2e                   # Playwright with offline fixtures
npm run lighthouse                 # Lighthouse audit
```

## Architecture

```
app/
  layout.tsx              # Root layout (ThemeProvider + Sonner + Geist Sans/Mono)
  page.tsx                # Single-column home: header, ScanForm, ResultsSection, history, footer
  scrutinix.css           # CSS-only motion/utility layer (sx-* classes)
  globals.css             # Tailwind v4 + semantic --sx-* theme tokens
  api/analyze/            # POST NDJSON stream (single + batch routes)
  opengraph-image.tsx     # OG card
proxy.ts                  # Rate limiting + per-request CSP nonces

components/
  ui/                     # Minimal primitives: button, input, textarea, tabs, sonner
  scrutinix/
    analyzer-runtime.tsx  # Context: inputs, streams, view mode, share/rescan/history queue
    app-header.tsx        # Header: wordmark, About/Privacy nav, theme toggle
    app-footer.tsx        # One-line footer
    scan-form.tsx         # Single/Batch tabs + inputs (id="scan-console")
    input-panels.tsx      # Input, cancel, and batch-export controls
    results-section.tsx   # Verdict/BatchTable, result actions, Summary/Full signal rows
    verdict-panel.tsx     # Verdict, score meter, confidence, reasons, details
    signal-row.tsx        # Typed per-signal disclosure row
    batch-table.tsx       # Plain batch result list
    history-section.tsx   # Dynamic-import wrapper; drains completed-result queue
    history-panel.tsx     # Search, clear/undo, export, entry list
    public-page-shell.tsx # Shared 44rem shell for /about and /privacy
    error-boundary.tsx    # Class-based error boundary
  shared/
    scrutinix-types.ts    # Verdict/severity presentation helpers
    signal-utils.ts       # Signal summaries + detail entries

hooks/
  use-ndjson-request.ts   # Shared stream core
  use-scan-stream.ts      # NDJSON consumer for one scan
  use-batch-stream.ts     # NDJSON consumer for batch scans
  use-scan-history.ts     # IndexedDB history with search

lib/
  domain/                 # Zod schemas, URL validation, verdict logic
  server/                 # Orchestrator, providers, signals, cache, local ONNX ML
  client/                 # NDJSON parser, export utilities
  config/                 # Environment validation

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
  member. No hosted inference call is required.
- **Verdict engine**: confirmed sources can convict; unreachable hosts produce
  an honest `unknown`; exculpatory evidence never erases confirmed hits.
- **One encoding per fact**: threat score renders once; severity renders once
  per signal. Verdict text uses AA-safe `--sx-<verdict>-fg` tokens.
- **Static accent**: blue `--sx-accent`; verdict colors appear only where a
  verdict is stated.
- **E2E fixtures**: `SCRUTINIX_TEST_FIXTURES=1` provides deterministic offline
  scenarios under `npm run test:e2e`.
- **CSS layering**: `app/globals.css` owns semantic tokens;
  `app/scrutinix.css` owns prefixed motion/effect utilities. Motion is CSS-only,
  under 300ms, and respects `prefers-reduced-motion`.

## Stack

- Next.js 16, React 19, TypeScript 5.9 (strict + noUncheckedIndexedAccess)
- Tailwind CSS v4, Geist Sans/Mono, Radix, Lucide, Zod 4, idb, sonner,
  next-themes, local `@huggingface/transformers`
- Vitest, MSW, fake-indexeddb, Playwright, axe-core, Lighthouse

## Env

Optional keys treat empty strings as unset; the app degrades honestly without
them. See `.env.example` for the full annotated list.

```
VIRUSTOTAL_API_KEY=...
GOOGLE_SAFE_BROWSING_API_KEY=...  # optional
URLHAUS_AUTH_KEY=...              # optional; also authenticates ThreatFox
UPSTASH_REDIS_REST_URL/TOKEN=...  # optional (rate limiting + shared cache)
KV_REST_API_URL/TOKEN=...         # optional Vercel KV aliases
OPENPHISH_FEED_URL=https://openphish.com/feed.txt
NEXT_PUBLIC_APP_URL=https://www.scrutinix.net
```
