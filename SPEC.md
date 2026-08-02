# SPEC.md — Scrutinix

## Current Implementation Notes

- Status update: the current implementation is live, verified locally, and deployed to Vercel preview and production.
- Rationale: the audit confirmed meaningful drift between docs and code, including missing batch API support, no test harness, vulnerable production dependencies, missing metadata assets, and misleading error-to-threat behavior.
- Toolchain decision: the current implementation targets `next@16.2.12`, `react@19.2.4`, and Node `22.x` for engines and CI so Vercel stays on the Node 22 major line without auto-upgrading to a future major.
- Linting decision: use ESLint directly from npm scripts; do not use `next lint`.
- Streaming decision: API responses stream `application/x-ndjson` over `fetch`, not SSE.
- Framework decision: Next.js 16 deprecates `middleware.ts`, so request gating is implemented in `proxy.ts`.
- Provider decision:
  - Keep the public `whois` signal name, but back it with RDAP-style domain registration data where raw WHOIS is unreliable.
  - Treat OpenPhish as a cached community feed, not a per-request live lookup.
  - Run the ML classifier locally: a quantized ONNX transformer bundled under `lib/server/ml/` (urlbert-tiny-v4, Apache-2.0) via `@huggingface/transformers`, paired with the lexical heuristic scorer. The earlier hosted Hugging Face inference path was removed after the router endpoint proved unreliable in production.
  - Prefer Upstash-backed rate limiting when configured, but degrade to process-local in-memory limits rather than fail closed when Redis credentials are absent.
  - Accept either `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or Vercel KV `KV_REST_API_URL` / `KV_REST_API_TOKEN` for shared Redis configuration.
  - URLhaus authorization must use the documented `Auth-Key` header.
  - Use the free OpenPhish community TXT feed for phishing-feed coverage instead of the removed PhishTank path.
  - Extend feed coverage with ThreatFox (reusing the URLhaus `Auth-Key`) and Spamhaus DBL / SURBL DNSBL lookups over plain DNS, treating sentinel/blocked-resolver responses as unavailable rather than clean.
- Runtime decision:
  - Redirect tracing should not fail on invalid certificate chains that are already reported by the SSL signal; trace redirects through header-only Node HTTP(S) requests with relaxed certificate validation.
  - Resolve registrable domains with the Public Suffix List and private suffixes enabled so reputation, feed, DNSBL, and redirect comparisons preserve tenant boundaries on shared hosting platforms.
- Testing decision: harness-first is required; Vitest, MSW, Playwright, and Lighthouse land before large feature clusters.
- Tooling decision:
  - Replace `@lhci/cli` with a direct `lighthouse` + `chrome-launcher` script so the verification path does not carry stale vulnerable transitive dependencies.
- UI decision:
  - Preserve the custom Scrutinix visual identity, but standardize reusable controls on selective shadcn/ui primitives with Tailwind v4 CSS variables, `next-themes`, and `sonner`.
  - Treat the pulled shadcn preset `b1D24VYe` as the actual public-site baseline: neutral `radix-mira` tokens, compact controls, and small radii adapted into Scrutinix-specific layouts instead of a loose visual interpretation.
  - Restore dark/light theme support through the shared semantic token layer in `app/globals.css` while keeping `app/scrutinix.css` for the branded motion/effects layer.
  - When a theme toggle sits inside a server-rendered header, gate any `resolvedTheme`-dependent icon or label behind a mount-safe client snapshot to avoid hydration mismatches.
  - Keep the top header metrics truthful in idle state: the threat meter stays visually inert and the coverage badge reads as idle until a scan actually runs.
  - The public site now uses a dashboard-first home route: a compact scanner-first top band on `/`, a calmer two-column operational workspace with a sticky history rail, and method/caveat detail on `/about` and `/privacy`, all expressed through the preset-aligned neutral system.
  - Sans-serif typography is the default reading mode; mono is reserved for telemetry, timings, hashes, and other code-like labels.
  - Favicons and manifest are served from checked-in `public/` assets with explicit metadata links instead of a generated icon route.
- Verdict decision:
  - Clean verdict confidence must be capped when a primary reputation source such as VirusTotal, Google Safe Browsing, or threat feeds does not complete, even if the remaining signals stay clean.
- Security decision: generate per-request nonce CSP in `proxy.ts` via `lib/server/csp.ts`; keep the remaining browser-hardening headers in `next.config.ts`.
- Verification note: the shipped baseline passed lint, format, typecheck, unit, integration, E2E smoke, production build, audit, and Lighthouse; current P21 revalidation and review status are tracked in `PLAN.md`.
- Documentation decision: `PLAN.md` is the live execution source of truth; keep it aligned with `SPEC.md`, `CLAUDE.md`, and `AGENTS.md` whenever architecture or delivery status changes.

## 0) Metadata

- **Title:** Scrutinix
- **Owner (DRI):** Aman Thanvi (@amanthanvi)
- **Stakeholders:** Aman Thanvi
- **Status:** Deployed on Vercel preview and production
- **Last updated:** 2026-08-02
- **Shipping model:** Continuous delivery
- **Links:** [GitHub](https://github.com/amanthanvi/scrutinix)

## 1) Executive Summary

### 1.1 What we're building

A modern web-based URL threat analyzer that evaluates URLs against multiple security signals — VirusTotal engines, ML model ensemble, threat intelligence feeds, SSL/WHOIS/DNS enrichment, redirect chain analysis, and Google Safe Browsing — and presents results in a polished, progressive-detail interface.

### 1.2 Problem statement / why now

Users routinely get dropped between disconnected reputation checks, browser
warnings, and raw infrastructure lookups when they need to judge a suspicious
link quickly. Scrutinix exists to turn that fragmented workflow into one
streamed, evidence-first analysis surface with clear verdicts, explicit caveats,
and privacy-aware defaults.

### 1.3 Success metrics (measurable)

- **Primary KPIs:**
  - Time to first streamed evidence stays under 10 seconds for standard scans
  - GitHub stars > 50 within 6 months of launch
  - Clean Lighthouse score (Performance > 90, Accessibility > 95)
- **Guardrails:**
  - API quota usage stays within free-tier limits under normal usage
  - Zero known security vulnerabilities in dependencies on the default branch
  - Full test pyramid passing in CI
- **"Done means":**
  - A user can paste any URL, see a streaming multi-signal threat report within
    10 seconds for first evidence, toggle between summary and full report
    views, run batch scans concurrently, and export history without needing an
    account

### 1.4 Non-goals / out of scope

- **No accounts/auth** — anonymous, stateless on the server
- **No real-time monitoring** — point-in-time analysis only, no alerting or continuous scanning
- **No browser extension** — web app only
- **No CLI tool** — no standalone CLI or third-party API access
- **No mobile app** — responsive web, not native
- **No paid tiers** — fully free, open-source

## 2) Users & UX

### 2.1 Personas / segments

| Persona         | Description                                                        | Needs                                                                      |
| --------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **Casual user** | Non-technical person who received a suspicious link via email/text | Quick, clear verdict: "Is this safe?" with plain-language explanation      |
| **Power user**  | Developer, security enthusiast, or IT professional                 | Full signal breakdown, raw engine results, batch scanning, exportable data |

Both personas use the same tool. A **view mode toggle** (Summary / Full Report) adapts information density without requiring separate interfaces or authentication.

### 2.2 Primary flows

**Flow 1: Single URL Scan**

1. User lands on a scanner-first home route with the dock in the first viewport and only minimal supporting context above the fold
2. Pastes URL, client-side validation, submits
3. Streaming results appear: verdict first, then enrichment signals populate as they resolve
4. Default: Summary view (verdict + top 3 signals). Toggle to Full Report for all data
5. Option to share result or scan another URL

**Flow 2: Batch Scan**

1. User switches to Batch tab with textarea for multiple URLs (newline-separated, max 10)
2. Submits: all URLs process concurrently (with concurrency limit)
3. Results stream in as each URL completes with summary grid showing status per URL, and one failed URL does not abort the rest of the batch
4. Click any URL to expand its full result
5. Export all results as CSV

**Flow 3: History & Export**

1. Previous scans stored in IndexedDB (client-side)
2. History panel shows recent scans with status badges
3. Click to view cached result, re-scan button for fresh analysis
4. Export history as CSV or JSON, or undo a local clear immediately from the history rail

### 2.3 UX states checklist

- **Loading/streaming:** Skeleton cards per enrichment source. Each card populates independently as its API resolves. Progress indicator shows which sources are still pending
- **Empty:** Dashboard-first landing state with the scanner dock, brief product framing, and chrome links to privacy/methodology; deeper explanation lives on `/about` and `/privacy`
- **Error (partial):** Failed or non-applicable sources show "failed", "caveat", or "n/a" state with the reason surfaced inline. Verdict is computed from available data, safe-result confidence is capped when primary reputation coverage is missing, and the user can rerun the full scan from the primary controls
- **Error (total):** All sources failed — show error message with "Retry All" button and suggestion to check network
- **Offline/degraded:** N/A (server-side tool, requires network). Client-side history remains accessible offline via IndexedDB
- **Accessibility:** WCAG 2.1 AA compliance. Semantic HTML, ARIA labels on interactive elements, skip-to-content navigation, 44x44 touch targets, sufficient color contrast, stable focus indicators, and screen reader friendly status announcements

### 2.4 View modes

| Mode            | Content                                                                                                                                                                      | Target                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Summary**     | Overall verdict (Safe/Suspicious/Malicious/Critical) with confidence indicator, top 3 most relevant signals as compact cards, one-line recommendation                        | Casual users, quick checks |
| **Full Report** | All enrichment signals in structured sections, raw engine results, confidence breakdowns per model, WHOIS/SSL/DNS details, redirect chain visualization, threat feed matches | Power users, investigation |

## 3) Functional Requirements

### Core Analysis

- **FR-1** MUST accept a single URL input, validate it, and return a multi-signal threat analysis
- **FR-2** MUST query VirusTotal API and return engine-level detection results
- **FR-3** MUST run URL through multiple ML classification models and aggregate predictions
- **FR-4** MUST check URL against threat intelligence feeds (URLhaus, OpenPhish, ThreatFox, and DNSBL sources)
- **FR-5** MUST check URL against Google Safe Browsing API
- **FR-6** MUST perform SSL certificate analysis (issuer, validity, expiry, chain trust)
- **FR-7** MUST perform WHOIS lookup (domain age, registrar, registration date)
- **FR-8** MUST perform DNS analysis (record types, anomalies, MX/A/CNAME)
- **FR-9** MUST trace HTTP redirect chain (hops, final destination, status codes)
- **FR-10** MUST compute an overall threat verdict from all available signals

### UX & Presentation

- **FR-11** MUST display results in a streaming fashion — each signal populates as it resolves
- **FR-12** MUST provide Summary / Full Report view toggle
- **FR-13** MUST show partial results when some sources fail, with clear signal-level status messaging and a full-scan rerun path
- **FR-14** MUST support batch URL analysis (up to 10 URLs, concurrent processing)
- **FR-15** MUST show batch results as a grid with per-URL drill-down and per-URL error isolation

### History & Export

- **FR-16** SHOULD persist scan history in IndexedDB with search/filter
- **FR-17** SHOULD support CSV/JSON export for individual and batch results
- **FR-18** SHOULD support history export and a short undo window after clearing local history

### Polish

- **FR-19** MUST support dark and light themes
- **FR-20** MUST be responsive (mobile-friendly)
- **FR-21** SHOULD include educational content about URL threats
- **FR-22** SHOULD surface lightweight trust/privacy/methodology context on the public site
- **FR-23** MAY include shareable result links (URL-encoded state, no server persistence)

## 4) System Design

### 4.1 Architecture (components + boundaries)

```
┌──────────────────────────────────────────────────────┐
│                 Next.js Request Proxy               │
│  proxy.ts                                           │
│  - IP-based rate limiting                           │
│  - fast rejection for abusive API traffic           │
└──────────────────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────┐
│              Next.js App Router (Node)              │
│  - RSC pages and metadata routes                    │
│  - POST /api/analyze                                │
│  - POST /api/analyze/batch                          │
└──────────────────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────┐
│            Analysis Orchestration Layer             │
│  - URL normalization and private-network rejection  │
│  - parallel signal execution                        │
│  - cache short-circuiting                           │
│  - verdict aggregation and safe logging             │
└──────────────────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────┐
│                    Signal Sources                   │
│  VT | GSB | Threat feeds | ML | TLS | DNS | RDAP | │
│  Redirect chain                                     │
└──────────────────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────┐
│                  Client Experience                  │
│  - onboarding/value layer + trust routes            │
│  - server-rendered shell + smaller client islands   │
│  - streamed result hero and signal cards            │
│  - batch result table                               │
│  - IndexedDB history, export, re-scan, and undo     │
│  - theme toggle, share links, educational guidance  │
└──────────────────────────────────────────────────────┘
```

### 4.2 Data model (schemas + invariants)

**AnalysisResult** (core response object):

```typescript
interface AnalysisResult {
  id: string; // unique scan ID (nanoid)
  url: string; // normalized input URL
  timestamp: string; // ISO 8601
  verdict: Verdict; // computed overall verdict
  signals: SignalResults; // per-source results
  threatInfo: ThreatInfo | null; // only populated when verdict != 'safe'
  metadata: ScanMetadata; // timing, cache hit, etc.
}

type Verdict = "safe" | "suspicious" | "malicious" | "critical" | "error";

interface SignalResults {
  virusTotal: SignalResult<VirusTotalData>;
  mlEnsemble: SignalResult<MLEnsembleData>;
  googleSafeBrowsing: SignalResult<GSBData>;
  threatFeeds: SignalResult<ThreatFeedData>;
  ssl: SignalResult<SSLData>;
  whois: SignalResult<WHOISData>;
  dns: SignalResult<DNSData>;
  redirectChain: SignalResult<RedirectData>;
}

type SignalStatus = "pending" | "success" | "error" | "skipped";

interface SignalResult<T> {
  status: SignalStatus;
  data: T | null;
  error: string | null;
  durationMs: number;
}
```

**Invariants:**

- `id` is unique per scan (not per URL — rescanning generates new ID)
- `verdict` is always computed from available signals, never null
- `signals` always contains all 8 keys, even if `status: 'error'`
- `timestamp` is server-generated, never client-provided

### 4.3 Interfaces / API contracts

**POST /api/analyze**

```
Request:  { url: string }
Response: ReadableStream<SignalUpdate | FinalResult>

SignalUpdate: { type: 'signal', name: string, result: SignalResult<T> }
FinalResult: { type: 'complete', result: AnalysisResult }
```

Implementation note: wire format is newline-delimited JSON (`application/x-ndjson`) with discrete event envelopes such as `scan_started`, `signal_result`, `scan_complete`, and `scan_error`.

**POST /api/analyze/batch**

```
Request:  { urls: string[] }  // max 10
Response: ReadableStream<BatchUpdate>

BatchUpdate: { type: 'url_complete', url: string, result: AnalysisResult }
           | { type: 'batch_complete', results: AnalysisResult[] }
```

Implementation note: batch streams also emit `batch_started`, `url_started`, and `batch_error`, with a concurrency limit of 3 URLs in flight.

- **Error model:** `{ error: { code: string, message: string, retryable: boolean } }`
- **Idempotency:** Cache-keyed by normalized URL. Same URL within TTL returns cached result (but new scan ID)
- **Rate limits:** 10 req/min per IP, 50 req/day per IP (enforced in `proxy.ts` before analysis work starts)

### 4.4 State, caching, concurrency

- **Source of truth:** Each scan is ephemeral server-side (computed, cached briefly, not persisted). Client-side IndexedDB is the only persistence layer
- **Server cache:** LRU cache (200 items, 15-min TTL) keyed by normalized URL. Cache hit returns immediately, cache miss triggers full pipeline
- **Concurrency:** Enrichment pipeline runs all 8 sources via `Promise.allSettled()`. Batch mode uses a concurrency limiter (max 3 URLs in-flight simultaneously to stay within API quotas)
- **Hazards:** VT rate limit (4 req/min on free tier) — queue VT calls with backoff. Bound bundled-model initialization to 10 seconds and each local inference to 2 seconds so cold starts cannot consume the full scan budget

### 4.5 Performance targets

- **First signal:** < 3 seconds (SSL, DNS, redirect chain are fast self-computed signals)
- **Full result:** < 30 seconds (VT polling is the bottleneck; other signals stream in earlier)
- **Cached result:** < 500ms
- **Batch (10 URLs):** < 2 minutes total (concurrent with rate limit awareness)
- **Payload limits:** Max URL length 2048 chars. Max batch size 10 URLs. Response streamed, no payload size concern

### 4.6 Dependencies / integrations

| Dependency                   | Type              | Free Tier              | Failure Behavior                                                   |
| ---------------------------- | ----------------- | ---------------------- | ------------------------------------------------------------------ |
| VirusTotal API v3            | External          | 4 req/min, 500 req/day | Signal marked unavailable; verdict computed without it             |
| Bundled URL classifier       | Self-computed     | N/A                    | Signal degrades to the lexical model on init/inference failure     |
| Google Safe Browsing API v4  | External          | 10k req/day            | Signal marked unavailable; verdict remains partial                 |
| URLhaus API                  | External          | Unlimited              | Signal marked unavailable; verdict remains partial                 |
| OpenPhish feed               | External          | Public feed            | Signal marked unavailable; verdict remains partial                 |
| ThreatFox API                | External          | abuse.ch account key   | Source warning recorded; other threat feeds still contribute       |
| Spamhaus DBL / SURBL DNSBL   | External DNS      | Public DNS             | Blocked/wildcard resolvers are treated as unavailable, not clean   |
| DNS resolution               | Self-computed     | N/A                    | Prefer success-with-observation over hard failure where possible   |
| SSL cert inspection          | Self-computed     | N/A                    | Prefer success-with-validation-state over hard failure             |
| WHOIS lookup                 | Self-computed/API | Varies                 | Prefer success-with-observation or skipped where applicable        |
| Redirect chain               | Self-computed     | N/A                    | Prefer success-with-observation over hard failure where possible   |
| Public Suffix List (`tldts`) | Bundled data      | N/A                    | Fall back to the normalized host when no registrable domain exists |

## 5) Security, Privacy, Compliance

- **Authn/authz:** None. Anonymous usage. No user accounts
- **PII:** No PII collected or stored server-side. URLs submitted are cached temporarily (15 min) then discarded. Client-side history is user-controlled
- **Public disclosure:** `/privacy` explains local history, hashed server logging, and client-only share links; `/about` explains the scoring and signal model
- **Abuse cases + mitigations:**

| Abuse case                                       | Mitigation                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| API quota exhaustion via flood                   | IP-based rate limiting (10/min, 50/day)                               |
| Scanning internal/private URLs                   | URL validation rejects private IP ranges (10.x, 192.168.x, localhost) |
| Using tool to enumerate which URLs are malicious | Rate limiting + no bulk API access                                    |
| XSS via crafted URL display                      | Sanitize all URL rendering, never inject raw HTML                     |

- **Audit/logging policy:** Log scan requests (URL hash only, not full URL) + response status + timing. Never log full URLs server-side (could contain PII in query params)

## 6) Reliability & Failure Modes

### 6.1 Failure modes table

| Failure                   | Detection                 | User Impact                   | System Behavior                                                        | Recovery                    | Blast Radius      |
| ------------------------- | ------------------------- | ----------------------------- | ---------------------------------------------------------------------- | --------------------------- | ----------------- |
| VT API down/timeout       | HTTP error / 30s timeout  | Missing VT signal             | Signal card shows "unavailable"                                        | Full scan rerun             | Single signal     |
| VT rate limit exceeded    | 429 response              | Delayed/missing VT signal     | Surface partial coverage and keep verdict provisional                  | Retry after cooldown window | VT signal only    |
| HF model cold start       | > 30s response            | Delayed ML signal             | Lexical scorer still returns a partial ML result                       | Full scan rerun             | ML signal only    |
| HF model unavailable      | HTTP error                | Missing ML signal             | Hosted model warning; lexical scorer still contributes                 | Full scan rerun             | ML signal         |
| Google Safe Browsing down | HTTP error                | Missing GSB signal            | Signal card shows "unavailable"                                        | Full scan rerun             | Single signal     |
| DNS resolution failure    | Lookup error              | Reduced DNS coverage          | Prefer a caveat or unavailable state over a threat-colored failure     | None needed                 | DNS signal        |
| SSL handshake failure     | Connection error          | Reduced TLS coverage          | Prefer validation-state or unavailable state without inventing malware | None needed                 | SSL signal        |
| WHOIS lookup failure      | API error / timeout       | Reduced registration coverage | Show caveat / unavailable / skipped as appropriate                     | Full scan rerun             | WHOIS signal      |
| All sources fail          | All signals error         | No useful analysis            | Show error state with a full rerun path                                | Full retry                  | Complete          |
| Vercel function timeout   | 10s edge / 60s serverless | Partial results               | Stream whatever completed before timeout                               | Retry                       | Depends on timing |

### 6.2 Retries/timeouts/circuit breakers

- **Per-source timeout:** 30s for external APIs, 10s for self-computed signals
- **Auto-retry:** None in the current UI contract; failures surface directly so users understand coverage gaps immediately
- **Manual retry:** Re-run the full scan from the primary controls when coverage gaps matter
- **No circuit breaker needed** — external APIs are independent, no cascading failure risk

### 6.3 Data integrity + rollback

- No persistent server data — nothing to corrupt or roll back
- Client-side IndexedDB: if corrupt, clear and rebuild (history is not critical data)

## 7) Observability & Ops

- **Logging:** Vercel function logs. Log: scan request count, per-source latency, error rates, rate limit hits. Do NOT log: full URLs, IP addresses, or raw query strings
- **Metrics:** Vercel Analytics for web vitals + page views. Custom: scans/day, cache hit rate, per-source success rate, average scan latency
- **Alerts:** Vercel deployment notifications. Monitor VT quota usage via API dashboard
- **Debugging:** Structured JSON logs with scan ID for request tracing. Each signal includes `durationMs` for latency debugging

## 8) Rollout, Migration, Compatibility

- **Strategy:** Continuous delivery from `main` with protected previews and a
  production deployment on Vercel
- **Feature flags:** None currently required
- **Rollback plan:** Git revert plus Vercel rollback to the previous deployment
- **Migration:** Server-side state remains stateless; client-side scan history
  migrates from `malicious-url-detector-v2` to `scrutinix-v2`
- **Backwards compatibility:** Current public endpoints remain stable; no
  versioned third-party API guarantee is advertised
- **Domain/DNS:** `https://www.scrutinix.net` is the canonical production host

## 9) Testing & Acceptance Criteria

### 9.1 Acceptance criteria (Given/When/Then)

**AC-1: Single URL scan**
Given a user on the home page
When they paste a valid URL and submit
Then they see streaming results with each signal populating independently, and a final verdict within 30 seconds

**AC-2: View mode toggle**
Given a completed scan result
When the user toggles between Summary and Full Report
Then Summary shows verdict + top 3 signals, Full Report shows all 8 signal sections with detailed data

**AC-3: Partial failure handling**
Given a scan where VirusTotal times out but other sources succeed
When results are displayed
Then the VT card shows "unavailable", the verdict is computed from remaining signals, and the full-scan rerun control remains available

**AC-4: Batch scan**
Given the user switches to Batch tab and enters 5 URLs
When they submit
Then all 5 process concurrently, results stream in as each completes, and a summary grid shows final statuses

**AC-5: Rate limiting**
Given a client makes 11 requests within 1 minute
When the 11th request arrives
Then it receives a 429 response with retry-after header

**AC-6: History persistence**
Given a user has completed 3 scans
When they refresh the page
Then all 3 scans appear in the history panel (sourced from IndexedDB)

**AC-7: Export**
Given completed batch results
When the user clicks Export CSV
Then a CSV file downloads with URL, verdict, timestamp, and signal summary for each URL

**AC-8: Theme support**
Given the app is loaded
When the user toggles dark/light mode
Then the entire UI switches themes with persisted preference

**AC-9: Responsive design**
Given the app is accessed on a 375px-wide viewport
When viewing scan results
Then all content is readable and interactive without horizontal scrolling

### 9.2 Test plan

- **Unit tests** (Vitest):
  - URL validation + normalization
  - Threat verdict computation logic (given signal inputs, expected verdict)
  - Each enrichment signal parser (given raw API response, expected structured data)
  - Rate limit logic
  - Cache behavior (hit/miss/expiry)

- **Integration tests** (Vitest + MSW for API mocking):
  - Full analyze endpoint with mocked external APIs
  - Streaming response parsing
  - Partial failure scenarios (1-N sources fail)
  - Batch endpoint with concurrent URL processing
  - Rate limit proxy enforcement

- **E2E tests** (Playwright):
  - Single URL scan happy path
  - Batch scan with multiple URLs
  - Accessibility audit with axe-core
  - Keyboard navigation smoke coverage
  - History persistence across page reload
  - Error/degraded states where providers are unavailable

- **Performance:**
  - Lighthouse CI (Performance > 90, Accessibility > 95)
  - Bundle size monitoring (< 200kb JS initial load)

- **Security:**
  - No XSS via URL display (test with crafted URLs containing script tags)
  - Private IP rejection (10.x, 192.168.x, 127.x, ::1)
  - Rate limit bypass attempts
  - Dependency audit (npm audit)

- **Accessibility:**
  - axe-core automated checks in E2E tests
  - Keyboard navigation for all interactive elements
  - Screen reader announcements for scan status changes

## 10) Decision Log

| Date       | Decision                                                                                  | Alternatives                              | Rationale                                                                                                      | Consequences                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 2026-03-04 | Complete greenfield rewrite                                                               | Incremental upgrade                       | Starting fresh reduced risk versus carrying forward broken assumptions and stale dependencies                  | Lose git history of old code                                                    |
| 2026-03-04 | Next.js + Vercel (web-first)                                                              | SPA + separate API; Astro; Remix          | Web-first product, Vercel free tier fits budget, familiar ecosystem                                            | API not independently consumable                                                |
| 2026-03-04 | Multi-model ML ensemble + threat feeds                                                    | Single model; drop ML; train own          | Multiple signals = higher confidence. Feeds catch known-bad URLs                                               | Higher aggregation complexity                                                   |
| 2026-03-04 | Free APIs + self-computed enrichment                                                      | Premium threat intel APIs                 | Keeps the default deployment public, low-cost, and easy to self-host                                           | Less reliable data sources                                                      |
| 2026-03-04 | IP-based rate limiting                                                                    | Token bucket + fingerprint; auth-based    | Simple, effective, no auth needed                                                                              | Shared IP could hit limits unfairly                                             |
| 2026-03-04 | IndexedDB for history                                                                     | localStorage; server-side DB              | Richer than localStorage, no server cost, privacy-friendly                                                     | More complex, but idb library helps                                             |
| 2026-03-04 | Streaming results                                                                         | Wait for all; polling                     | Best UX — data within seconds vs 30s+ wait                                                                     | More complex client/server impl                                                 |
| 2026-03-04 | Single-release initial launch                                                             | Phased; MVP + fast follow                 | Reduced coordination overhead while the public product surface was still being finalized                       | Longer time to first deploy                                                     |
| 2026-03-04 | Modern bold aesthetic                                                                     | Dark hacker; clinical; brutalist          | Stands out, avoids AI-slop, signals quality                                                                    | Need custom design investment                                                   |
| 2026-03-04 | Full test pyramid                                                                         | E2E only; unit + integration; minimal     | Security tool demands confidence                                                                               | More upfront test writing                                                       |
| 2026-03-06 | Upgrade to the latest stable Next/React baseline                                          | Stay on Next 14.1                         | Existing baseline was already stale and carried known vulnerabilities plus removed tooling assumptions         | Re-scaffold was required                                                        |
| 2026-03-06 | Use NDJSON over fetch for streaming contracts                                             | SSE; wait-for-all JSON                    | Works cleanly with App Router route handlers and shared client parsers                                         | Client needs a stream reader                                                    |
| 2026-03-06 | Keep public `whois` signal name but implement via RDAP-style registration data            | Raw WHOIS only; rename the signal         | Preserves the user-facing contract while avoiding brittle raw WHOIS assumptions                                | UI copy should mention registration lookup rather than raw WHOIS where needed   |
| 2026-03-06 | Add Upstash-backed `proxy.ts` rate limiting with an in-memory degraded fallback           | Dev/prod in-memory only                   | Shared state is preferred for deployed abuse controls, but the app should remain usable when Redis is absent   | Multi-instance deployments lose shared rate-limit state until Upstash is set    |
| 2026-03-06 | Add production security headers in `next.config.ts`                                       | no CSP; reverse-proxy-only hardening      | The app renders untrusted URL text and should ship browser-enforced guardrails alongside safe React rendering  | CSP must allow Next runtime scripts and local dev websocket connections         |
| 2026-03-06 | Switch hosted classifier to Hugging Face router + `DunnBC22/codebert-base-Malicious_URLs` | Keep retired endpoint/model; lexical only | The old Hugging Face inference host was retired and the previous model was not served on the supported router  | Hosted ML depends on a currently routed third-party model                       |
| 2026-08-01 | Replace hosted inference with a bundled quantized ONNX URL classifier                     | Keep router dependency; lexical only      | Hosted inference was unreliable and made scan coverage depend on a third-party runtime                         | Larger deployment artifact; deterministic local inference with bounded fallback |
| 2026-03-09 | Add onboarding/trust surfaces on `/`, `/about`, and `/privacy`                            | Tool-only landing page                    | The UI audit showed that first-time visitors lacked value framing, methodology context, and privacy disclosure | Slightly larger static surface area that must stay aligned with implementation  |

## 11) Assumptions, Open Questions, Risks

### Assumptions

- VirusTotal free tier (4 req/min, 500 req/day) is sufficient for initial public traffic
- Google Safe Browsing API free tier (10k req/day) is more than adequate
- URLhaus, OpenPhish, ThreatFox, and DNSBL sources remain accessible enough for best-effort feed coverage
- Vercel Hobby plan ($0) or Pro plan ($20/mo) covers compute needs
- Self-computed signals (DNS, SSL, redirect) can execute within Vercel serverless function limits (60s timeout)

### Open Questions

- No blocking implementation questions remain for the current public state.
- Optional next action: add real Upstash credentials if shared cross-instance rate limiting becomes necessary.
- Optional next action: add another free or self-hosted feed if broader phishing-feed diversity becomes necessary.

### Risks

| Risk                                  | Likelihood | Impact | Mitigation                                                                       |
| ------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------- |
| VT free tier quota exhausted          | Medium     | High   | Rate limiting + caching + partial-failure-safe verdicts                          |
| Bundled model init/artifact drift     | Low        | Medium | Verify the checked-in model offline and retain lexical-only degradation          |
| RDAP source instability               | Medium     | Medium | Treat registration data as one signal, not a hard requirement for completion     |
| Upstash credentials missing in deploy | Medium     | Medium | Process-local fallback keeps the app usable, but shared rate-limit state is lost |
| Real preview environment drift        | Low        | Medium | Preview and production deployments were both validated on Vercel                 |
