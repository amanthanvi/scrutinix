# CLAUDE.md

## Project Overview

**Scrutinix** — a FOSS multi-signal URL threat analyzer, live at
https://www.scrutinix.net. It streams 8 separate security signals
(VirusTotal, ML ensemble, Google Safe Browsing, threat feeds, SSL, WHOIS,
DNS, redirect chain) over NDJSON into a single-column product UI in the
editorial fact-checker identity (P29.6): the link is the claim under
review, answered with a squared verdict band, the site it really belongs
to in the serif, the link taken apart, and an eight-cell strip whose
numbered cells every Summary answer cites. Light and dark themes receive
equal treatment.

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
npm run verify:launch              # Fixture dev server under a supervisor
npm run verify:doctor              # Read-only health check
npm run verify:smoke               # One safe scan in Playwright
npm run verify:drive               # Feature-map sweep
npm run verify:cleanup             # Ask the supervisor to stop only what it started
npm run verify:check               # The verify skill's own tests
```

## Architecture

```
app/
  layout.tsx              # Root layout (ThemeProvider + lazy Sonner + Newsreader via next/font/local)
  page.tsx                # Single-column home: header, headline, ScanForm, ResultsSection, history; ?shared= metadata;
                          #   ?url= prefill (waits for Analyze); a shared link opens recipient-first
  scrutinix.css           # CSS-only motion/effects + static sx-* component layout (band, anatomy, strip, questions, public tables)
  globals.css             # Tailwind v4 + semantic --sx-* theme tokens
  api/analyze/            # POST NDJSON stream (single + batch routes)
  opengraph-image.tsx     # Default OG card (lib/og/cards.tsx, Newsreader + Geist from disk)
  og/result/route.tsx     # Per-result share image for ?shared= links (payload-capped)
  share/route.ts          # Web Share Target (POST /share): first link -> /?url= (prefill only; no cookie)
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
    signal-strip.tsx      # SignalStrip (numbered roving toolbar), SignatureStrip, SignalGlyph, cellNumber
    signal-cell.tsx       # Server-safe atoms: SignalCell, cellNames, BrandMark
    signal-row.tsx        # Typed per-signal disclosure row (<li>, strip cell as marker)
    summary-questions.tsx # Summary: the five questions (h4 each), placeholder while pending, QuestionSources
    batch-table.tsx       # Batch result list with mini strips
    result-row.tsx        # Shared history/batch row parts: verdict word (look-alike tone), compact anatomy
    history-section.tsx   # Dynamic-import wrapper; drains completed-result queue
    history-panel.tsx     # Search, clear/undo, export, entry list (draws nothing when empty)
    public-page-shell.tsx # Shared 71rem shell for /about and /privacy (prose measures, TableFrame, .sx-public tables)
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
    share-launch.ts       # Share-target link extraction (extractSharedLink) and ?url= prefill (resolvePrefill)
    methodology.ts        # /about's scoring tables, rules, bands, confidence caps (engine-checked by tests/unit/methodology.test.ts)
  og/                     # Share-card renderers (cards.tsx) and font loader (fonts.ts: Newsreader TTF + Geist)
  server/                 # Orchestrator, providers, signals, cache, local ONNX ML
    share-metadata.ts     # ?shared= verify + validate → SharedView, page metadata, image cap
    share-signing.ts      # HMAC sign/verify for share links; attaches result.share to streamed results
    rate-limit.ts         # Upstash/in-memory limiter with "scan" and "image" tiers
  client/                 # NDJSON parser, export utilities
  config/                 # Environment validation

scripts/
  build-display-fonts.sh  # Rebuild fonts/newsreader/ from the pinned Fontsource tarball (needs fontTools)
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
- **Verdict band**: squared, tinted with `--sx-<verdict>-surface` under a
  heavy top rule in `--sx-<verdict>`; the word stays ink (one colour
  encoding) and secondary text uses `--sx-<verdict>-ink`. When a verdict
  lands a keyed `.sx-band-rule` draws over the neutral track (240ms,
  `--sx-ease-expo`) and the word rises 4px; both are drawn in place under
  reduced motion. The registered domain sits in the serif under the verdict
  word (`registeredDomain`, with `holdDomain` keeping its height while the
  parser loads); it only names the site, and the anatomy's
  `ownershipSentence` stays the one place the owner sentence is said. A
  scan's band (`holdsRoom`: Checking, the address check, the verdict) is
  one height whatever lands: `BandRoom` draws the band's own layout twice
  more, invisibly (generated stand-ins, a subgrid over the band), filled
  with the tallest band with a score and the tallest without one
  (`BAND_SAYS` in `verdict-guidance.ts`, which a unit test checks against
  every branch); the last row is the only flexible one, so unused room
  opens above the hairline. Nothing moves when a verdict lands
  (`tests/e2e/landing.fixture.spec.ts`).
  An Error band's last line is "Try again". The
  summary sentence ("because" line) yields whenever the questions or rows
  state the evidence (`evidenceShown`), so in practice only a legacy record
  shows it. It is the only tinted container; once it mounts, the home
  headline steps out of sight (still the h1) and the supporting line goes
  (CSS `:has`), so the verdict owns the one display moment.
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
  text wraps anywhere (long hosts break, never truncate). The sources line
  has two parts: an `sr-only` plain list ("Sources: VirusTotal, Safe
  Browsing"), which is what assistive technology hears and what a copy
  gives, and the numbered "From 1 VirusTotal · 3 Safe Browsing" line,
  which is `aria-hidden` and `select-none`. The
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
  by hue alone: flagged solid, caution hatched, found-nothing a short centred dash,
  partial a centred short block, failed an outline, didn't-apply dashed,
  running the empty track. `tests/unit/contrast.test.ts` checks the shapes stay
  distinct and each mark stands 3:1 off the track. One grammar for
  progress, rows, history/batch, mark, icons, and OG images
  (`lib/og/cards.tsx` mirrors the shapes). Entries saved before signals were
  kept (`isLegacySignalRecord`: every check carries the sanitizer's
  `MISSING_SIGNAL_DATA`) draw empty glyph slots and a plain note, never
  eight "failed" cells; a real all-failed scan still draws them. The live
  strip heads Evidence as its index: cells numbered 1-8 (`cellNumber`, in
  `signalNames` order, `aria-hidden` tags), and each question's "From" line
  (`QuestionSources`) cites the same numbers while assistive technology
  hears "Sources: <names>". Phones get two columns of four 44px rows, so
  the roving keys follow the layout (`stripColumns`): Left/Right always step
  in order; Up/Down step in order on phones and move a row from 40rem.
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

- **Links from outside**: nothing starts a scan on its own. `/?url=`
  fills in the Single field (normalized on the server by
  `resolvePrefill`), the anatomy on paste takes the link apart, and
  Analyze takes focus (not the field, so a phone's keyboard doesn't cover
  the link); it scans only when the person taps Analyze. An invalid or
  unscannable value prefills nothing, silently. The installed app's
  share target (`share_target` in `public/site.webmanifest` →
  `POST /share`) takes the first http(s) link from `url` (whole), `text`,
  then `title` (`extractSharedLink`; only a link inside prose is trimmed)
  and redirects (303, relative, `no-store`) to `/?url=`, so it behaves
  exactly like the bookmarklet and the iOS Shortcut; the body is counted
  as it streams (`readBoundedBody`, 16 KiB), and it sets no cookie for
  any poster. `normalizeUrlInput` holds the 2,048 limit on the normalized
  link, so every boundary agrees on a link that grows when
  percent-encoded. `?shared=` outranks `?url=`. No service worker (not
  needed to install), and the site never mentions installing; the README
  documents Android, the iOS Shortcut steps, and the bookmarklet.
- **Recipient-first shared view**: when the page opens on a shared link
  (verified, unverified, or expired), `app/page.tsx` renders the results
  section first (band, anatomy, strip when verified) and the form under
  "Check another link", with an `sr-only` h1; the order holds for the
  visit, so a fresh scan replaces the band in place. Once any result
  replaces what the page opened on, `clearLaunchParams` drops `shared`,
  `sig`, and `url` from the address. `resolveSharedView` returns null for
  a link `normalizeUrlInput` rejects (private/local hosts), signed or not.
- **UI danger is not a verdict**: form/stream errors and destructive
  confirms use `--sx-danger-fg` / `--sx-danger-border`, never
  `--sx-malicious-*`.
- **Display face**: Newsreader, exactly two static latin cuts (400/opsz 16,
  600/opsz 60, 46,864 bytes) in `fonts/newsreader/` (OFL), loaded by
  `next/font/local` on `<html>`; `--font-display` reads its variable and
  Tailwind's `font-serif` points at it. It sets the headline, verdict word,
  registered domain, score, imperative, owner sentence, Summary questions
  and answers, section titles, wordmark, and public titles; the interface is
  the system sans and the link/data the system mono. `bundleBudget.fontBytes`
  is 48,000: a third cut or face trips it. Share cards read the same cuts as
  TTF.
- **Type scale**: custom `text-*` steps live in `@theme`; `lib/utils.ts`
  teaches them to tailwind-merge or `cn()` silently drops them.
- **Open methodology**: `/about` prints every weight and rule from
  `lib/domain/methodology.ts`. Point rows are copy:
  `tests/unit/methodology.test.ts` runs each through
  `buildThreatAssessment` (both sides of each threshold), checks every
  number a row prints, and checks which rows are weak signs
  (`scoredFindings`), so change a weight and its row together. Confidence
  prints the engine's own `CONFIDENCE_POLICY`; provider thresholds the
  page names are exported (`THREATFOX_HIGH_CONFIDENCE`,
  `MANY_ADDRESS_RECORDS`).
- **Contrast guard**: `scripts/check-contrast.mjs` (unit suite) asserts every
  token pair in both themes; extend its `PAIRS` when adding a token.
- **Ink buttons, static accent**: filled controls use `--sx-button*` (ink);
  the blue `--sx-accent` marks only links, focus, the caret, and selection.
  Verdict colors appear only where a verdict is stated.
- **E2E fixtures**: `SCRUTINIX_TEST_FIXTURES=1` provides deterministic offline
  scenarios under `npm run test:e2e`. Fixtures score unknown hosts Safe, so
  fixture mode signs shares only with the published e2e key, and that key
  signs nothing outside fixture mode (`shareSecretProblem` in `env.ts`).
- **CSS layering**: `app/globals.css` owns semantic tokens;
  `app/scrutinix.css` owns prefixed motion/effect utilities and the static
  layout of the identity's components (`.sx-band-*`, `.sx-anat*`,
  `.sx-strip*`, `.sx-question*`, `.sx-public` tables): as Tailwind strings
  they pushed the shared first-load chunk past Turbopack's split point. Its
  rules are unlayered, so they beat Tailwind utilities on the same element:
  give a variant its own class rather than a utility. Motion is CSS-only,
  under 300ms, and respects `prefers-reduced-motion`.

## Stack

- Node 24 LTS, Next.js 16, React 19, TypeScript 5.9 (strict + noUncheckedIndexedAccess)
- Tailwind CSS v4, Newsreader (self-hosted display serif) + system sans/mono (bundled Geist only for server OG cards), Radix, Lucide, Zod 4, idb, sonner,
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

When P29.4 landed the page requested no web fonts and `--font-display` defaulted to `--font-sans`; P29.6 since fills that hook with Newsreader (two cuts, 46,864 B, budget 48,000), the only web font the page loads. Batch input and results load on demand; history storage hydrates eagerly, but its panel loads only for entries or Undo. Sonner mounts on the first notification and waits for its subscription before publishing. `npm run check:bundle` audits actual first-load browser requests after build; budgets live in `package.json`. CI runs it with provisioned Chromium.
