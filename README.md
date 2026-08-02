# Scrutinix

Scrutinix is a FOSS multi-signal URL threat analyzer. Paste a suspicious link
and get a streamed, evidence-first report that combines browser-protection
lists, threat feeds, redirect tracing, DNS and TLS context, registration data,
and ML scoring in one place.

- Live app: `https://www.scrutinix.net`
- About: `https://www.scrutinix.net/about`
- Privacy: `https://www.scrutinix.net/privacy`
- Spec: [`SPEC.md`](./SPEC.md)
- Contributing: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Security: [`SECURITY.md`](./SECURITY.md)

## Why Scrutinix

- Streamed analysis over NDJSON instead of spinner-then-dump results.
- Eight normalized signals on every scan result.
- Batch triage for up to 10 URLs with per-item failure isolation.
- Client-side history with re-scan, search, filters, and CSV/JSON export.
- Privacy-aware defaults: history stays in IndexedDB, and server logs avoid raw
  URL strings.
- Public-facing trust surfaces that explain methodology, caveats, and data
  handling.

## Signals

- `virusTotal`: multi-engine URL reputation with analysis-freshness context
- `googleSafeBrowsing`: browser-protection verdicts
- `threatFeeds`: URLhaus, cached OpenPhish, ThreatFox, and Spamhaus DBL /
  SURBL DNSBL coverage
- `mlEnsemble`: bundled local transformer classifier (quantized ONNX) plus
  lexical scoring
- `ssl`: certificate validity, trust, and certificate-age signals
- `whois`: RDAP-backed registration and age context
- `dns`: record-level infrastructure context
- `redirectChain`: hop-by-hop redirect tracing with lightweight terminal-page
  content analysis

## Product Surface

- Single-URL scans stream `scan_started`, `signal_result`, `scan_complete`, and
  `scan_error` events.
- Batch scans stream per-URL progress and keep one broken URL from aborting the
  rest of the run.
- Summary and Full Report modes present the same scan at different levels of
  density.
- Share links are client-generated snapshots; they do not create a server-side
  share database.
- `/about` and `/privacy` explain how verdicts are formed and what data stays in
  the browser.

## Stack

- Next.js `16`
- React `19`
- TypeScript `5.9`
- Tailwind CSS `4`
- selective shadcn/ui primitives + `next-themes`
- Vitest + MSW
- Playwright + axe-core
- Lighthouse

## Run Locally

1. Install dependencies.

```bash
npm install
```

2. Copy the example env file and add any provider keys you want to enable.

```bash
cp .env.example .env.local
```

3. Start the app.

```bash
npm run dev
```

For browser automation and local audits, bind the host explicitly:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

## Environment

Core provider and deployment variables:

```env
VIRUSTOTAL_API_KEY=
GOOGLE_SAFE_BROWSING_API_KEY=
URLHAUS_AUTH_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
KV_REST_API_URL=
KV_REST_API_TOKEN=
OPENPHISH_FEED_URL=https://openphish.com/feed.txt
NEXT_PUBLIC_APP_URL=https://www.scrutinix.net
```

The `URLHAUS_AUTH_KEY` also authenticates ThreatFox (both are abuse.ch
services). Empty values are treated as unset. The ML classifier is bundled
with the app and needs no key. Scrutinix still runs in a degraded mode without
third-party keys: local enrichment signals remain available, provider failures
are surfaced explicitly, and safe-result confidence is capped when primary
reputation coverage is missing.

## Quality Bar

Primary local checks:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:unit -- --run
npm run test:integration -- --run
npm run test:dom -- --run
npm run test:e2e
npm run build
npm run lighthouse
```

Pull requests and pushes to `main` run the full CI chain, including fixture-backed
Playwright checks and Lighthouse with blocking Performance `>= 0.90` and
Accessibility `>= 0.95` thresholds. CI installs Chromium explicitly and shares
its executable path with both browser tools.

Additional repo maintenance checks:

```bash
npm audit
npm run lighthouse
```

## Architecture

- `app/api/analyze/route.ts`: single-scan NDJSON endpoint
- `app/api/analyze/batch/route.ts`: batch NDJSON endpoint
- `proxy.ts`: request gating and rate limiting for `/api/analyze`
- `lib/server/`: orchestration, provider adapters, caching, logging, and stream
  helpers
- Complete, non-partial results may be cached for 15 minutes; partial, error,
  and aborted scans are never reused.
- `components/scrutinix/`: branded analyzer UI and client runtime islands
- `hooks/`: NDJSON stream readers and IndexedDB-backed history
- `tests/`: unit, integration, accessibility, keyboard, and E2E smoke coverage

## Repository Guide

- [`SPEC.md`](./SPEC.md): product and architecture source of truth
- [`PLAN.md`](./PLAN.md): live execution plan and delivery status
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): local setup and contribution rules
- [`SECURITY.md`](./SECURITY.md): private vulnerability reporting guidance
- [`LICENSE`](./LICENSE): MIT

## Deployment

Scrutinix is deployed on Vercel at `https://www.scrutinix.net`. Preview
deployments are protection-gated in this project; use `vercel inspect` when
anonymous preview requests return `401`.
