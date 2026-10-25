# CLAUDE.md

## Project Overview

**Scrutinix** — a FOSS multi-signal URL threat analyzer, live at
https://www.scrutinix.net. It streams 8 separate security signals
(VirusTotal, ML ensemble, Google Safe Browsing, threat feeds, SSL, WHOIS,
DNS, redirect chain) over NDJSON into a minimal, single-column product UI:
the canonical minimal product tool on a cool crisp white ground, with the
verdict band, the site the link really belongs to, and an eight-cell signal strip as the
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
  layout.tsx              # Root layout (ThemeProvider + lazy Sonner; system sans/mono, no page web fonts)
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
    input-panels.tsx      # URL input + Paste + Analyze
    batch-input.tsx       # Batch textarea, Start batch, and exports (loaded on demand)
    input-anatomy.tsx     # The typed link taken apart before a scan (captions) + "Expecting a particular site?"
    results-section.tsx   # Band → anatomy → strip → Summary questions / Full rows → details → actions; focus + live region
    verdict-panel.tsx     # VerdictBand (Checking/result/snapshot, one element tree) + VerdictDetails
    link-anatomy.tsx      # Registered domain emphasised, look-alike sentence, segment-keyed facts, full-link toggle
    signal-strip.tsx      # SignalStrip (roving toolbar), SignatureStrip, SignalGlyph
    signal-cell.tsx       # Server-safe atoms: SignalCell, cellNames, BrandMark
    signal-row.tsx        # Typed per-signal disclosure row (<li>, strip cell as marker)
    summary-questions.tsx # Summary: the five questions (h4 each), placeholder while pending, QuestionSources
    batch-table.tsx       # Batch result list with mini strips
    result-row.tsx        # Shared history/batch row parts: verdict word (look-alike tone), compact anatomy
    history-section.tsx   # Dynamic-import wrapper; drains completed-result queue
    history-panel.tsx     # Search, clear/undo, export, entry list (draws nothing when empty)
    public-page-shell.tsx # Shared 46rem shell for /about and /privacy
    error-boundary.tsx    # Class-based error boundary
    retryable-chunk.tsx   # next/dynamic loader: a failed optional chunk (Batch) says so in place, with Try again
  shared/
    scrutinix-types.ts    # Verdict/severity presentation helpers ("clear" = found nothing)
    signal-utils.ts       # Signal findings, summaries + detail entries

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
    summary-questions.ts  # Summary's five questions: fixed mapping, answers, why clauses, disagreements
    feed-copy.ts          # Feed display names, feed-match + Google threat-type wording
    reputation.ts         # Client-safe reputation thresholds + hasConfirmedReputationHit
    signal-severity.ts    # Per-signal severity ("clear" = found nothing; scored => warning)
    signal-signature.ts   # Eight-cell signature, legacy-record check, share snapshot encode/decode
    link-anatomy.ts       # Isomorphic URL anatomy + look-alike detection (tldts passed in)
    expected-site.ts      # "Were you expecting…?": compare an expected domain (or IP) with the link's registered domain (names never confirmed or denied)
    impersonated-brands.ts # Shared brand list (look-alike ccTLD runs, structure-risk scoring)
    registrable-domain.ts # Server wrapper over link-anatomy's registrableDomainOf
    copy.ts               # countOf / formatList / capitalize / formatAge for user-facing copy
  og/                     # Share-card renderers (cards.tsx) and bundled-Geist loader (fonts.ts)
  server/                 # Orchestrator, providers, signals, cache, local ONNX ML
    share-metadata.ts     # ?shared= verify + validate → SharedView, page metadata, image cap
    share-signing.ts      # HMAC sign/verify for share links; attaches result.share to streamed results
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
- **Client errors**: only `PublicError` messages are shown as written;
  other exception text is logged with URL redaction and never forwarded
  (`lib/server/client-error.ts`). The reference is the scan's own id:
  terminal errors say "… Reference: <scanId>." (`exposeClientError`),
  failed checks keep a plain sentence (`checkFailureMessage`, logged under
  the scan id), and `VerdictDetails` states the reference once for a failed
  or partial result. The stream backstop names its route ("scan"/"batch").
- **One encoding per fact**: threat score renders once; severity renders once
  per signal. Verdict text uses AA-safe `--sx-<verdict>-fg` tokens. A source
  that found nothing is `clear` (gray `--sx-clear`), never green; Unknown has
  its own slate `--sx-unknown` pair.
- **Verdict copy is pure**: `lib/domain/verdict-guidance.ts` (imperative,
  score visibility, live announcement, caveat) and `lib/domain/verdict.ts`
  (summary naming the evidence, reasons) own every verdict string; counts go
  through `countOf`. `threatInfo.scoredSignals` (from `getScoredSignals`) is
  the single source of truth for which checks drove the verdict (the strip
  and Full rows never draw them as "found nothing"). Feed-match `detail` is a clause that follows the feed's
  display name ("lists this link as phishing"); `describeFeedMatch` adds it.
- **Verdict band**: tinted with `--sx-<verdict>-surface`; the word stays ink
  (one colour encoding). The summary sentence ("because" line) yields
  whenever the questions or rows state the evidence (`evidenceShown`), so in
  practice only a legacy record shows it. It is the only tinted container; once it
  mounts, the home headline steps down to the headline size (CSS `:has`)
  so the verdict owns the one display moment.
- **Summary questions**: Summary answers five plain questions
  (`lib/domain/summary-questions.ts`, which holds every Summary string), in
  fixed order with a fixed mapping so each check is cited by exactly one:
  "Has it been reported?" (VirusTotal, Safe Browsing, threat feeds), "Where
  would it take me?" (redirects and the final page), "What else raises
  concern?" (link pattern model, registration), "Does HTTPS make it safe?"
  (certificate), "What did the other checks find?" (DNS, hosting network).
  Each has a short answer, one "why it matters" clause, its sources (strip
  cell names, `QuestionSources`), and an optional disagreement sentence
  when checks conflict in a way a reader would notice (lists clean on a
  brand-new domain, a list hit VirusTotal hasn't caught, the pattern model
  flagging what every list passed, naming whichever member flagged it, a
  VirusTotal conviction no list shares).
  The HTTPS answer always starts "No." (a valid certificate is encryption,
  not trust) and dates the leaf certificate it read ("This certificate was
  issued 2 hours ago"), never "first". Hosting is "network AS… , registered
  in NL", never "located/hosted in". Listing dates, certificate age, and
  hosting add no score contribution (the one existing certificate-age rule,
  a days-old certificate on a brand-new domain, predates them, and the
  HTTPS why names it unless a certificate error takes the why); nothing
  here changes a verdict or score, and the
  questions read signals only (not `scoredSignals`), so a weak scored hit
  under Safe never reads as a "threat report". Every scored finding is
  named by its question: `tests/unit/summary-questions.test.ts` walks
  every scorer branch via `getScoredFindings`, and the thresholds it names
  are shared from `signal-severity.ts`. The link pattern model and
  structure checks are each described from their own label (agreement
  only when the labels match; the combined reading is its own sentence).
  A redirect chain that stopped partway keeps the hops it saw and leaves
  the destination unconfirmed; "couldn't reach" means nothing answered.
  Unscored page findings (one hard-to-read sign, under three frames) are
  not raised. Ages of what was seen, in Summary and Full rows alike, count
  from the result's check time (`evidenceTimeOf`: `checkedAt`, else
  `completedAt`; the stream's start while scanning), never from when it is
  reopened; certificate expiry counts from now. A plain
  HTTP link that moves to HTTPS says so and still gives the certificate. A
  name with no public address says so ("We found no address", or "only
  private or reserved addresses"), never "points nowhere". A question is pending
  until every check it cites lands; its placeholder holds room shaped like
  a typical clean answer (`PLACEHOLDER_SHAPE`, invisible generated content,
  never text), so later headings hold still in the common case (findings
  and long hosts still grow a question; "couldn't check" answers shrink). Question
  text wraps anywhere (long hosts break, never truncate), and the sources
  dot is drawn (`.sx-source::before`), so a copy reads "VirusTotal, Safe
  Browsing". The
  owner and look-alike are stated by the anatomy, never by a question; the
  anatomy's own facts (certificate, young domain, "Ends at") step aside
  once the evidence below states them. Legacy records, Error results (all
  eight rows in Summary), and shared snapshots get no questions. Full keeps
  the eight rows. A strip cell focuses its question in Summary and opens
  its row in Full. The PSL lookup is passed in (`registeredDomainOf`);
  without it a different host is named but never called "a different
  site".
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
  Look-alikes change presentation only; the stored verdict and score never
  change. A Safe look-alike is shown as "Look-alike" (`verdictWord`) on the
  band, history/batch rows, the live region, and the share card; its band
  shows no score, and the details state the checks' own verdict and score
  (`getUnderlyingVerdictNote`). `getVerdictGuidance` returns the
  action-only imperative, `tone: "unknown"` (the band, rows, and OG card
  use it, never the raw verdict), and a `confidenceNote` in place of "High
  confidence". The owner fact is
  stated once, by `ownershipSentence` (anatomy, live region, share
  description, OG card). History/batch rows use `LinkAnatomyCompact`
  (`result-row.tsx`): the subdomain truncates from its left so the owner
  never gets cut. Shared
  links get their anatomy from the server (`SharedView.anatomy`) so the
  hedge is in the first paint. Elsewhere absent anatomy never means "not a
  look-alike": `useLinkAnatomy` reports a `status` of `"pending"`,
  `"ready"`, or `"failed"` (a failed import retries once after 1s, and
  stays "failed" until a later load succeeds). While pending, a Safe band
  holds in its Checking state ("Checking the link's address", no word,
  tint, score, or confidence), rows hold "—", and its announcement waits;
  other verdicts show and are announced at once. If it failed, a Safe
  result reads "Unconfirmed" (`addressUnchecked`): neutral tone, no score,
  "Check the link's address before you open it.", and a note that we
  couldn't check the address, on
  the band, rows, live region, and history search (which re-runs on each
  status change, `useLinkParserStatus`). CSV export waits for the parser
  (`loadLinkParser`) and says "Not checked" only if it still can't load.
- **Signed shares**: a `?shared=` payload is plain base64 anyone can write,
  so Scrutinix states a shared verdict only when `&sig=` is its own HMAC
  (`lib/server/share-signing.ts`, `SHARE_SIGNING_SECRET`). The server builds
  and signs the payload for every streamed result (`result.share`, kept in
  history); `app/page.tsx` and `/og/result` verify it. Unverified links
  (unsigned, tampered, secret unset, or shared before signing) keep the
  site's default title, description, and card, and open a neutral "Check
  this shared link yourself" band with Scrutinix's own link anatomy and
  "Scan this link": no verdict, tint, score, summary, or strip from the
  payload. The browser never decodes the payload; it receives a
  `SharedView` whose `snapshot` is null unless verified. A signed Safe
  look-alike's preview leads with "Look-alike of <brand>", never "Safe"
  (`shareHeadline`). The signed check time is `metadata.checkedAt`, which a
  cache hit keeps from the original scan. Spaces in `?shared=` are restored
  to "+" before verifying (`normalizeSharedPayload`). Share with no `sig`
  copies the link with a distinct "isn't verified" toast. A signed result
  expires: past `SHARE_MAX_AGE` (72h, `lib/domain/signal-signature.ts`)
  after `capturedAt`, or more than 5 minutes in the future, it is treated
  exactly like an unverified link (neutral band saying it is more than 3
  days old, default metadata, `/og/result` redirect). `resolveSharedView`,
  `describeSharedSnapshot`, and `getSharedMetadata` take `now` explicitly;
  tests pass fixed times. The share toast tells the sender the 3-day
  window, and sharing an expired history entry says so with "Scan again".
  `share-signing.ts` and `env.ts` import `server-only` (vitest aliases it).
- **Evidence is not a score**: `dns.hosting` (Team Cymru IP-to-ASN over
  DNS, `lib/server/providers/team-cymru.ts`) and feed `listedAt` are
  evidence only; no scoring path reads them. Hosting looks up the first
  public address (IPv4 preferred; IPv6 only inside global unicast
  2000::/3), never a private one, with a 2 s abort-aware resolver; only
  the IP leaves the server. NXDOMAIN is recorded as `asn: null` ("no
  network routes this address"); a timeout or malformed answer leaves
  `hosting` unset and never fails the DNS signal, and a stored record with
  a missing or invalid ASN is dropped, never read as `null`. The country
  is the AS record's registration ("registered in NL", never "located
  in"); the origin prefix's country is never a stand-in. Full-view rows come from `getSignalDetailEntries` (one
  fact per row, explicit `now`); TXT values are counted and named by
  kind, never dumped.
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
  scenarios under `npm run test:e2e`. Fixtures score unknown hosts Safe, so
  fixture mode signs shares only with the published e2e key, and that key
  signs nothing outside fixture mode (`shareSecretProblem` in `env.ts`).
- **CSS layering**: `app/globals.css` owns semantic tokens;
  `app/scrutinix.css` owns prefixed motion/effect utilities. Motion is CSS-only,
  under 300ms, and respects `prefers-reduced-motion`.

## Stack

- Node 24 LTS, Next.js 16, React 19, TypeScript 5.9 (strict + noUncheckedIndexedAccess)
- Tailwind CSS v4, system sans/mono (bundled Geist only for server OG cards), Radix, Lucide, Zod 4, idb, sonner,
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
SHARE_SIGNING_SECRET=...          # optional; >= 32 chars (openssl rand -base64 48); unset = shared links open neutral
SHARE_SIGNING_SECRET_PREVIOUS=... # optional; verifies (never signs) during key rotation
```

Set both share-signing keys in the Vercel **Production** environment only.
Preview and Development leave them unset (shared links open neutral) or
use a separate key that is never valid in production: any deployment
holding the production key, including an unreviewed preview branch, can
mint links production accepts as "Verified Scrutinix result". Never reuse
the committed e2e key (`scripts/run-e2e.mjs`; `env.ts` ignores it unless
`SCRUTINIX_TEST_FIXTURES=1`, and ignores every other key when fixtures are
on). Rotate the production key if it was ever set for Preview/Development
or pulled with `vercel env pull`.

### P29.4 speed

The page requests no web fonts; `--font-display` defaults to `--font-sans`. Batch input and results load on demand; history storage hydrates eagerly, but its panel loads only for entries or Undo. Sonner mounts on the first notification and waits for its subscription before publishing. `npm run check:bundle` audits actual first-load browser requests after build; budgets live in `package.json`. CI runs it with provisioned Chromium.
