# CLAUDE.md

## Project Overview

**Scrutinix** — a multi-signal URL threat analyzer. Streams 8 independent security signals (VirusTotal, Google Safe Browsing, threat feeds, ML ensemble, TLS, WHOIS, DNS, redirect chain) via NDJSON and renders a real-time threat dashboard. Dark-first terminal aesthetic with a supported light theme.

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
  layout.tsx              # Root layout (ThemeProvider + Sonner + Geist Mono/Sans + Hack)
  page.tsx                # Renders AnalyzerApp from components/scrutinix/
  scrutinix.css           # Scrutinix motion/effects/utilities
  globals.css             # Tailwind v4 + semantic theme tokens
  api/analyze/            # POST NDJSON stream (single + batch routes)
  icon.tsx                # Favicon (dark/green)
  opengraph-image.tsx     # OG card

components/
  ui/                     # Selective shadcn/ui primitives
  scrutinix/
    analyzer-app.tsx      # Main orchestrator (~330 LOC)
    app-header.tsx        # SCRUTINIX branding + threat elevation bar + theme toggle
    app-footer.tsx        # Marquee ticker footer
    verdict-hero.tsx      # Radar SVG, score ring, result display
    signal-card.tsx       # Per-signal card with LED + edge severity
    input-panels.tsx      # shadcn-backed input/textarea/button controls
    history-panel.tsx     # search, verdict filters, export, history drill-down
    batch-panel.tsx       # Batch results data table
    intro-panel.tsx       # Scanner-first hero (brand + dock)
    loading-skeleton.tsx  # Initial page load skeleton
    error-boundary.tsx    # Class-based error boundary
  shared/
    scrutinix-types.ts    # Verdict colors, severity helpers, dynamic accent
    signal-utils.ts       # Signal labels, summaries, detail entries

hooks/
  use-scan-stream.ts      # NDJSON consumer for single scan
  use-batch-stream.ts     # NDJSON consumer for batch scan
  use-scan-history.ts     # IndexedDB-backed history with search/filter

lib/
  domain/                 # Types, URL validation, verdict logic
  server/                 # Analyze orchestrator, providers, signals
  client/                 # NDJSON parser, export utils
  config/                 # Environment validation (Zod)

tests/
  unit/                   # Vitest (cache, url, verdict, env, ml, redirect, rate-limit)
  integration/            # Vitest (analyze routes, threat feeds)
  e2e/                    # Playwright (smoke, accessibility)
```

## Key Patterns

- **NDJSON streaming**: API routes stream signal results as they resolve. Client hooks consume via `ReadableStream`.
- **8 security signals**: virusTotal, mlEnsemble, googleSafeBrowsing, threatFeeds, ssl, whois, dns, redirectChain.
- **Dynamic accent color**: `--sx-active-accent` CSS var shifts based on active verdict (green → amber → red → magenta).
- **Hybrid UI**: keep branded Scrutinix components, but use selective shadcn/ui primitives for reusable controls and accessibility-heavy widgets.
- **CSS prefix**: All theme vars use `--sx-*`, all utility classes use `sx-*`.
- **Font hierarchy**: Geist Mono (primary mono), Geist Sans (UI chrome/buttons/prose), Hack (data-dense details).

## Stack

- Next.js 16, React 19, TypeScript 5.9 (strict + noUncheckedIndexedAccess)
- Tailwind CSS v4 (CSS-first config via @tailwindcss/postcss)
- Geist (Sans + Mono), Hack (self-hosted), Framer Motion, Lucide React, clsx, Zod, idb
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
