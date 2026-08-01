# CLAUDE.md

## Project Overview

**Scrutinix** — a FOSS multi-signal URL threat analyzer, live at
https://www.scrutinix.net. One scan streams 8 independent security signals
(VirusTotal, Google Safe Browsing, threat feeds, ML ensemble, TLS, WHOIS,
DNS, redirect chain) over NDJSON into a light-first product UI ("Daylight
Desk": Geist Sans chrome, Hack mono for data, no motion library).

Operating conventions, provider decisions, and learned gotchas live in
[`AGENTS.md`](./AGENTS.md) — read it before making changes. `SPEC.md` is the
product record; `DESIGN-REDIRECTION.md` is the design constraint of record.

## Commands

```bash
npm run dev                        # Dev server on :3000
npm run build                      # Production build
npm run lint                       # ESLint (no-console + no-floating-promises are errors)
npm run typecheck                  # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run format:check               # Prettier
npm run test:unit -- --run         # Vitest, node
npm run test:integration -- --run  # Vitest, node + MSW
npm run test:dom -- --run          # Vitest, jsdom + fake-indexeddb
npm run test:e2e                   # Playwright (offline; see fixture mode below)
```

## Architecture

```
app/
  page.tsx, about/, privacy/      # Public pages (shared editorial shell)
  api/analyze/{route,batch/route} # NDJSON streaming endpoints (maxDuration 120/300)
proxy.ts                          # Rate limiting + per-request CSP nonces
components/
  scrutinix/                      # Branded UI: analyzer-runtime (context) ->
                                  #   analyzer-workspace, scan-dock, verdict-hero{,-live,-result},
                                  #   signal-card, history-{rail,panel}, batch-panel
  ui/                             # Selective shadcn/ui primitives
  shared/                         # Verdict colors, signal detail-row builders
hooks/                            # use-ndjson-request (shared stream core),
                                  #   use-{scan,batch}-stream, use-scan-history (IndexedDB)
lib/
  domain/                         # schemas.ts (Zod source of truth), verdict.ts,
                                  #   url validation, content-analysis, registrable-domain
  server/                         # analyze.ts orchestrator, providers/, signals/,
                                  #   cache, rate-limit, stream, ml/ (bundled ONNX model)
  client/                         # NDJSON parser, CSV/JSON export
```

## Key Patterns

- **Zod-first schemas**: every payload/event shape is declared once in
  `lib/domain/schemas.ts`. Leaves recover with `.catch(default)`; envelopes
  gate strictly. Any new field MUST be `.optional().catch(undefined)` — that
  is the whole versioning strategy for old IndexedDB/cache/stream data.
- **NDJSON streaming**: server writes signal results as they resolve
  (`lib/server/stream.ts`, with keepalives and cancel-abort plumbing);
  clients consume via `hooks/use-ndjson-request.ts`.
- **Abort plumbing**: routes combine request abort, stream cancel, and a
  60s scan budget with `AbortSignal.any` and thread it into every provider.
- **Local ML**: `lib/server/ml/` bundles a quantized ONNX URL classifier
  (urlbert-tiny-v4, Apache-2.0) run via @huggingface/transformers — no
  hosted inference calls. Lexical heuristics are the second ensemble member.
- **Verdict engine** (`lib/domain/verdict.ts`): single confirmed source can
  convict; unreachable hosts get an honest `"unknown"` verdict; exculpatory
  evidence discounts weak scores but never confirmed hits.
- **E2E fixture mode**: `SCRUTINIX_TEST_FIXTURES=1` (default under
  `npm run test:e2e`) swaps real providers for deterministic per-hostname
  scenarios in `lib/server/test-fixtures.ts` — the suite runs offline.
- **CSS layering**: `app/globals.css` holds semantic theme tokens
  (`--sx-*`, light default); `app/scrutinix.css` holds motion/effects
  utilities (`sx-*`). Do not collapse them.

## Stack

- Next.js 16, React 19, TypeScript 5.9 (strict + noUncheckedIndexedAccess)
- Tailwind CSS v4 (CSS-first config), selective shadcn/ui, next-themes, sonner
- Geist Sans + self-hosted Hack mono, Lucide icons, Zod 4, idb
- Vitest (+ MSW, fake-indexeddb) + Playwright + axe-core + Lighthouse

## Env

All optional keys treat empty strings as unset; the app degrades honestly
without them (see `.env.example` for the full annotated list).

```
VIRUSTOTAL_API_KEY=...
GOOGLE_SAFE_BROWSING_API_KEY=...  # optional
URLHAUS_AUTH_KEY=...              # optional; also authenticates ThreatFox
UPSTASH_REDIS_REST_URL/TOKEN=...  # optional (rate limiting + shared cache)
KV_REST_API_URL/TOKEN=...         # optional Vercel KV aliases
OPENPHISH_FEED_URL=https://openphish.com/feed.txt
NEXT_PUBLIC_APP_URL=https://www.scrutinix.net
```
