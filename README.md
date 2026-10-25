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
- Share links carry a server-signed snapshot; they do not create a
  server-side share database. Whoever opens one sees the result first, then
  "Check another link".
- `/about` and `/privacy` explain how verdicts are formed and what data stays in
  the browser.

## Check links from your phone

**Android (Chrome):** open `https://www.scrutinix.net`, then use Chrome's menu
→ **Install app** (or **Add to Home screen** → **Install**). Scrutinix then
appears in the system share sheet: in a chat, email, or browser, **Share →
Scrutinix** opens the app with the first link in what you shared filled in
and taken apart; tap **Analyze** to check it. Desktop browsers can install it
too, but the share-sheet entry is an Android (and ChromeOS) feature; elsewhere
use the bookmarklet below.

**iPhone and iPad (Shortcuts):** iOS has no web share target, so a Shortcut
you build once opens Scrutinix with the link filled in; tap **Analyze** to
check it.

1. Open **Shortcuts**, tap **+**, and name the shortcut **Check with
   Scrutinix**.
2. Tap the **ⓘ** (Details) button, turn on **Show in Share Sheet**, and set
   the share-sheet types to **URLs**, **Safari web pages**, and **Text**.
   Under **If there's no input**, choose **Get Clipboard**.
3. Add **Get URLs from Input** (input: **Shortcut Input**). It finds links
   inside shared text too.
4. Add **Get Item from List** → **First Item**.
5. Add **URL Encode** → **Encode** the **Item from List**.
6. Add **URL** and type `https://www.scrutinix.net/?url=`, then insert the
   **URL Encoded Text** variable right after the `=`.
7. Add **Open URLs** (input: **URL**).

**Bookmarklet (any desktop browser):** save this as a bookmark's URL to open
the page you're on in Scrutinix, ready to check:

```text
javascript:location.href='https://www.scrutinix.net/?url='+encodeURIComponent(location.href)
```

Every way of sending a link (Share → Scrutinix, the Shortcut, the bookmarklet,
or any `https://www.scrutinix.net/?url=<encoded link>` link) fills it in and
waits for you to tap **Analyze**, so no other site or app can start a scan in
your browser.

## Stack

- Node.js `24` LTS
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
SPAMHAUS_DQS_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
KV_REST_API_URL=
KV_REST_API_TOKEN=
OPENPHISH_FEED_URL=https://openphish.com/feed.txt
NEXT_PUBLIC_APP_URL=https://www.scrutinix.net
SHARE_SIGNING_SECRET=
SHARE_SIGNING_SECRET_PREVIOUS=
```

`SHARE_SIGNING_SECRET` is the HMAC key that signs Share links, so a link is
shown as a Scrutinix result only when its signature verifies; unsigned,
tampered, and expired links (older than 72 hours) open a neutral "Check this
shared link yourself" view. It must be at least 32 characters (shorter values
are ignored with a warning). Generate one with `openssl rand -base64 48`, and
set it in the Vercel **Production** environment only, then redeploy: any
deployment holding the key can mint links production accepts as verified.
Leave it unset locally and in Preview; shared links then open neutral.
`SHARE_SIGNING_SECRET_PREVIOUS` verifies, but never signs, during key
rotation; keep the retired key there for at least 72 hours. See
`.env.example` for the annotated block.

The `URLHAUS_AUTH_KEY` also authenticates ThreatFox (both are abuse.ch
services). `SPAMHAUS_DQS_KEY` is a free Spamhaus Data Query Service key;
without it, Spamhaus DBL is reported unavailable on most cloud hosts, whose
resolvers the public mirror refuses. Empty values are treated as unset. The ML classifier is bundled
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
its executable path with both browser tools. `npm run test:e2e` runs the
Playwright suite in Chromium; `npm run test:e2e:engines` runs it in Chromium,
Firefox, and WebKit, and CI runs the Firefox and WebKit legs as their own jobs.

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
- `components/scrutinix/`: the analyzer UI: verdict band, link anatomy, the
  eight-cell signal strip, evidence rows, history, and client runtime islands
- `app/og/result/`: per-result share images for `?shared=` links
- `app/share/route.ts`: the installed app's Web Share Target (`POST /share`)
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
