# CLAUDE.md

## Project Overview

**Scrutinix** — a multi-signal URL threat analyzer. Streams 8 independent security signals (VirusTotal, Google Safe Browsing, threat feeds, ML ensemble, TLS, WHOIS, DNS, redirect chain) via NDJSON and renders them in a minimal, single-column product UI. System-default theme; light and dark are designed to equal quality.

## Commands

```bash
npm run dev          # Dev server on :3000
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run test:unit -- --run
npm run test:integration -- --run
npm run test:e2e     # Builds then runs Playwright
npm run lighthouse   # Lighthouse audit
```

## Architecture

```
app/
  layout.tsx              # Root layout (ThemeProvider + Sonner + Geist Sans/Mono)
  page.tsx                # Single-column home: header, intro line, ScanForm, ResultsSection, HistorySection, footer
  scrutinix.css           # Small CSS-only motion/utility layer (sx-* classes)
  globals.css             # Tailwind v4 + semantic --sx-* theme tokens (OKLCH, both themes)
  api/analyze/            # POST NDJSON stream (single + batch routes)
  opengraph-image.tsx     # OG card

components/
  ui/                     # Minimal primitives: button, input, textarea, tabs (Radix), sonner
  scrutinix/
    analyzer-runtime.tsx  # Context provider: tabs, inputs, scan/batch streams, share/rescan/history
    app-header.tsx        # h-14 header: wordmark, About/Privacy nav, theme toggle
    app-footer.tsx        # One-line footer
    scan-form.tsx         # Single/Batch tabs + inputs (id="scan-console")
    input-panels.tsx      # SingleInput/BatchInput: inputs + cancel (batch exports only; single-scan actions live in results-section)
    results-section.tsx   # VerdictPanel or BatchTable + 8 SignalRows
    verdict-panel.tsx     # Typographic verdict block: verdict word, score meter, confidence, reasons, Details disclosure
    signal-row.tsx        # Per-signal <details> row (hairline table) with severity dot + mono detail dl
    batch-table.tsx       # Plain batch result list
    history-section.tsx   # Dynamic-import wrapper (keeps idb off critical path)
    history-panel.tsx     # Search, confirm-clear + undo, export, entry list
    public-page-shell.tsx # Shared 44rem shell for /about and /privacy
    error-boundary.tsx    # Class-based error boundary
  shared/
    scrutinix-types.ts    # verdictFg, severityColor, getSignalSeverity
    signal-utils.ts       # Signal summaries + detail entries (all signal copy)

hooks/
  use-scan-stream.ts      # NDJSON consumer for single scan
  use-batch-stream.ts     # NDJSON consumer for batch scan
  use-scan-history.ts     # IndexedDB-backed history with search (matches URL, verdict, summary)

lib/
  domain/                 # Types, URL validation, verdict logic
  server/                 # Analyze orchestrator, providers, signals
  client/                 # NDJSON parser, export utils
  config/                 # Environment validation (Zod)

tests/
  unit/                   # Vitest (cache, url, verdict, env, ml, redirect, rate-limit)
  integration/            # Vitest (analyze routes, threat feeds)
  e2e/                    # Playwright (smoke, accessibility — axe zero violations)
```

## Key Patterns

- **NDJSON streaming**: API routes stream signal results as they resolve. Client hooks consume via `ReadableStream`.
- **8 security signals**: virusTotal, mlEnsemble, googleSafeBrowsing, threatFeeds, ssl, whois, dns, redirectChain. Rows render in fixed order and fill in place.
- **One encoding per fact**: the threat score renders once (meter in VerdictPanel); severity renders once per signal (a single dot). Verdict text colors use the AA-safe `--sx-<verdict>-fg` tokens; graphic dots/bars use `--sx-<verdict>`.
- **Static accent**: one blue `--sx-accent`; verdict colors appear only where a verdict is stated.
- **CSS prefix**: theme vars use `--sx-*`, utility classes use `sx-*`.
- **Motion**: CSS-only, <300ms, transform/opacity, custom ease-out (`--sx-ease`), `@starting-style` entries, `prefers-reduced-motion` honored. One infinite animation (live dot).
- **Fonts**: Geist Sans (UI) + Geist Mono (URLs, scores, durations, detail data) — both from the `geist` package.

## Stack

- Next.js 16, React 19, TypeScript 5.9 (strict + noUncheckedIndexedAccess)
- Tailwind CSS v4 (CSS-first config via @tailwindcss/postcss)
- Geist (Sans + Mono), Radix (slot, tabs), Lucide React, clsx, Zod, idb, sonner, next-themes
- Vitest + Playwright + Lighthouse + axe-core

## Env

```
VIRUSTOTAL_API_KEY=...
GOOGLE_SAFE_BROWSING_API_KEY=...  # optional
HUGGINGFACE_API_KEY=...
HUGGINGFACE_URL_MODEL=DunnBC22/codebert-base-Malicious_URLs
URLHAUS_AUTH_KEY=...              # optional
UPSTASH_REDIS_REST_URL=...        # optional (rate limiting)
UPSTASH_REDIS_REST_TOKEN=...      # optional
KV_REST_API_URL=...               # optional Vercel KV alias
KV_REST_API_TOKEN=...             # optional Vercel KV alias
OPENPHISH_FEED_URL=https://openphish.com/feed.txt
NEXT_PUBLIC_APP_URL=https://www.scrutinix.net
```
