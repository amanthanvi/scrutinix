# SPEC.md — Scrutinix

## Current Implementation Notes

- Status update: the current implementation is live, verified locally, and deployed to Vercel preview and production.
- Rationale: the audit confirmed meaningful drift between docs and code, including missing batch API support, no test harness, vulnerable production dependencies, missing metadata assets, and misleading error-to-threat behavior.
- Toolchain decision: the current implementation targets `next@16.4.2`, `react@19.3.1`, and Node `24.x` for local development, CI, and Vercel deployment; `@types/node` stays on the same major and a unit guard enforces the contract.
- Native-runtime decision: `onnxruntime-node` is the only explicitly approved install script because the bundled local classifier requires its platform binary.
- Linting decision: use ESLint 10 directly with peer-compatible Next.js, React, hooks, TypeScript, and JSX accessibility plugins; do not use `next lint` or the ESLint 9-only `eslint-config-next` dependency graph.
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
  - Extend feed coverage with ThreatFox (reusing the URLhaus `Auth-Key`) and Spamhaus DBL / SURBL DNSBL lookups over plain DNS, treating sentinel/blocked-resolver responses as unavailable rather than clean. With `SPAMHAUS_DQS_KEY` set, query DBL through the Spamhaus Data Query Service (`<domain>.<key>.dbl.dq.spamhaus.net`); every 127.255.255.0/24 answer, including disabled-key codes, is unavailable, never a listing.
- Runtime decision:
  - Redirect tracing should not fail on invalid certificate chains that are already reported by the SSL signal; trace redirects through header-only Node HTTP(S) requests with relaxed certificate validation.
  - The TLS check reads an https:// link's own host and port. For an http:// link it shares the scan's one redirect-chain run and reads the certificate at the first HTTPS address the chain reaches (http://github.com → github.com:443), the one a visitor's browser checks. A chain that answers and never reaches HTTPS still has the link's own host on 443 in a visitor's path when the link names no port: browsers that try HTTPS first (Chrome's HTTPS-Upgrades, on by default since Chrome 115) ask there and fall back to HTTP when that fails, within 3 seconds. So the check asks too, within the same 3 seconds: a certificate a browser accepts (trusted, or one whose chain couldn't be fully verified) is stated with a note that the link itself stays on HTTP, and the HTTPS question says the site also answers over HTTPS (not that a browser will use it: a site whose HTTPS sends visitors back to HTTP, like http.badssl.com, makes Chrome fall back). Anything else (refused, no TLS, a certificate error, no answer in time), or a link that names its port, has no certificate in its path: the check reports `noHttps` ("This link never moves to HTTPS, so there's no certificate to check."), draws its cell as didn't apply, counts as a check that didn't apply in confidence, and is not lost coverage, so the result stays complete and cacheable. A certificate error there is not scored: the browser falls back to plain HTTP and never meets it. A chain that answered on HTTP and then stopped short reads nothing (it never showed where a visitor ends up); only a chain that never answered falls back to the link's own host on its named port, else 443. A certificate read on another registered domain carries `otherSite` (and a note naming it, never a limitation), its problem and the HTTPS answer name it ("The certificate at landing.example has expired."), and its age is never paired with the link's domain age for the fresh-setup rule. Port 80 is never probed for TLS; a host that answers a TLS hello in plain HTTP (`ERR_SSL_WRONG_VERSION_NUMBER`) is a finding ("The host answered on port N without TLS."), not a probe failure.
  - Resolve registrable domains with the Public Suffix List and private suffixes enabled so reputation, DNSBL, and redirect comparisons preserve tenant boundaries on shared hosting platforms; keep ThreatFox IOC scoring bound to the exact scanned hostname so sibling tenants cannot contaminate one another, and let a ThreatFox URL IOC convict only that exact URL - elsewhere on the host it corroborates at host-level weight, so path tenants on shared hosts (github.com) cannot contaminate one another either. On known path-tenanted platforms (`lib/domain/shared-platforms.ts`) host-level listings from any feed are recorded as observations and only exact-URL evidence scores; such hosts also get no registration-age discount and no clean-feed confidence credit. Transient DNSBL self-test failures are retried after a minute rather than cached for six hours.
  - Treat Public Suffix List updates as security-sensitive data changes: every private rule changed by the adopted `tldts` release must have an explicit registrable-domain regression case.
- Testing decision: harness-first is required; Vitest, MSW, Playwright, and Lighthouse land before large feature clusters.
- Tooling decision:
  - Replace `@lhci/cli` with a direct `lighthouse` + `chrome-launcher` script so the verification path does not carry stale vulnerable transitive dependencies.
- UI decision:
  - Preserve the custom Scrutinix visual identity, but standardize reusable controls on selective shadcn/ui primitives with Tailwind v4 CSS variables, `next-themes`, and `sonner`.
  - Treat the pulled shadcn preset `b1D24VYe` as the actual public-site baseline: neutral `radix-mira` tokens, compact controls, and small radii adapted into Scrutinix-specific layouts instead of a loose visual interpretation.
  - Restore dark/light theme support through the shared semantic token layer in `app/globals.css` while keeping `app/scrutinix.css` for the branded motion/effects layer.
  - When a theme toggle sits inside a server-rendered header, gate any `resolvedTheme`-dependent icon or label behind a mount-safe client snapshot to avoid hydration mismatches.
  - Keep the top header metrics truthful in idle state: the threat meter stays visually inert and the coverage badge reads as idle until a scan actually runs.
  - The public site uses a scanner-first, single-column `71rem` flow on `/` (the form, history, and batch at `47.5rem`): the headline "Is this link what it says it is?", the scan form, then the verdict band (verdict word, the registered domain in the serif, imperative, score only when scored), the link taken apart (each part captioned, registered domain bracketed, look-alike stated plainly), the Evidence section (the eight-cell strip as its numbered index, then Summary's five questions on a rail citing cell numbers, or Full's eight rows), and in-flow history. Method/caveat detail lives on `/about` and `/privacy`.
  - Visual lane (2026-10-24, P29.6): the editorial fact-checker, chosen by the owner from a blind bake-off (P09 with P11's domain line). Newsreader (two static self-hosted cuts) for the story, system sans for the interface, system mono for the link and data. A cool crisp sheet (light) and a deep cool ground with warm paper ink (dark). Ink buttons; one blue accent for links and focus only; verdict hues only where a verdict is stated. A squared verdict band under a heavy rule that draws when the verdict lands. The strip stays one grammar for progress, evidence index, history/batch glyph, brand mark, icons, and share images.
  - Shared result links (`/?shared=…&sig=…`) carry an optional eight-severity signature and preview through a per-result image (`/og/result`), rendered from the link's own payload and never stored. The server builds the payload for every streamed result and signs it (HMAC-SHA256 over `"scrutinix-share-v1\n" + payload` with `SHARE_SIGNING_SECRET`, base64url); the page, its metadata, and the image state a verdict only for a payload that verifies. Unsigned, tampered, or unverifiable links (including links shared before signing, which change behaviour and now open neutral) keep the site's default title, description, and card, and open a neutral "Check this shared link yourself" view with Scrutinix's own link anatomy and "Scan this link". A signed Safe look-alike previews as "Look-alike of <brand>: <domain> — Scrutinix", never "Safe". The payload also signs the verdict's `basis` (`lib/domain/verdict-basis.ts`: the confidence label, whether the engine scored nothing, partial coverage, and a confirmed reputation hit), the facts the instruction is worded from, never the wording itself, so the shared band, the page description, and the card state the instruction the sender's band showed ("Looks safe to open.", "Don't open this link — it's a known threat."); a payload signed before the basis existed, or with a malformed one, keeps the hedged instruction ("Probably safe — still check who sent it.", a plain "Don't open this link."), and so does a history entry saved before it and shared again, whose stored payload has no basis. One deliberate difference: when the sender's browser couldn't load its look-alike check ("Unconfirmed", "Check the link's address before you open it."), the recipient gets Scrutinix's own server-side check of the address instead. The shared band leaves out a summary that only repeats its instruction ("No check flagged this link." under "Looks safe to open."), as the sender's band does. The basis adds about 170 characters to a link. A signed result is shown for 72 hours after its check (`SHARE_MAX_AGE`); older ones open the same neutral view, saying the shared result is more than 3 days old. The image route has its own rate-limit tier (30/min, 600/day per IP) and renders payloads up to 6,000 characters; larger, invalid, or unverified payloads redirect to the default card.
  - Strip states are distinguished by shape as well as colour (flagged solid, caution hatched, found-nothing a thin dash, partial half, failed outline, didn't-apply dashed, running empty). Empty history draws nothing; the `Scan history` region stays as an empty landmark.
  - Anatomy on paste: as soon as the Single field holds a valid web link that isn't already on screen, the form shows it taken apart (each part captioned: "A label anyone can add", "Registered domain", "A page on that domain"; a look-alike stated once) before any scan, plus a quiet "Expecting a particular site?" field that compares a typed domain or link with the registered domain in the browser (an IP link's typed address is compared with its address directly) ("Matches paypal.com." / "This link belongs to secure-login.xyz, not paypal.com."; on a look-alike, whose anatomy already states the owner, the typed domain it spells out gets "No. The link only spells out paypal.com." and any other "No. This link doesn't belong to google.com.", so the owner is stated once); a brand name, in any script ("Сбербанк"), is never confirmed or denied (we don't know which domains a brand owns: live.com is Microsoft's), only answered with whose site it is and a request for the address; nothing is sent. Screen readers hear each part after its caption ("Registered domain: secure-login.xyz"), and a typed fragment ("#/login") shows in the page part though it is never scanned. Once that link's scan or result is on screen, the result's own anatomy takes over.
  - A shared result opens recipient-first: the shared band, its link anatomy, and (when verified) the strip come first, then the scan form under a "Check another link" heading (an `sr-only` h1 "A link shared with you" replaces the hero headline). The order is fixed for the visit, so a fresh scan replaces the band in place above the form. Once a result (a fresh scan, or one opened from history or a batch) replaces what the page opened on, `history.replaceState` drops `shared`, `sig`, and `url` from the address (other parameters stay), so a reload never reopens the stale share. A `?shared=` link whose URL fails `normalizeUrlInput` (private, local, or otherwise unscannable host) opens nothing, signed or not.
  - **`?url=` contract:** `/?url=<link>` fills the Single field with the link as `normalizeUrlInput` normalizes it (on the server) and focuses Analyze (not the field, so a phone keyboard never covers the link taken apart below it); it never starts a scan. A missing, invalid, or unscannable value prefills nothing and shows no message. A `?shared=` link outranks it. This is what bookmarklets, the iOS Shortcut, and the share target's redirect use, so every way a link reaches Scrutinix behaves the same: filled in, focused, taken apart (anatomy on paste), and checked only when the visitor taps Analyze.
  - **Share-target contract:** `public/site.webmanifest` declares `share_target` → `POST /share`, `application/x-www-form-urlencoded`, params `title`, `text`, `url`. `app/share/route.ts` reads at most 16 KiB, counted as the body streams (a declared `Content-Length` over the limit is refused unread, a missing one is fine, and a body that runs past the limit is cancelled and dropped whole whatever its header claimed), parsing urlencoded or multipart from those bounded bytes only. It takes the first http(s) link: the whole `url` field (normalized as written, punctuation included), then `text`, then `title` (Android usually leaves `url` empty and puts the link in `text`); a `text`/`title` that is one link and nothing else is taken whole, and only a link inside prose is extracted (`'` allowed inside it) with trailing sentence punctuation and unpaired closers trimmed (in one linear pass: each kind's spare closers are counted once, so a 16 KiB run of `)` costs microseconds, not a rescan per closer). The link is normalized centrally (the 2,048-character limit holds for the normalized link, so a link of non-ASCII characters that grows past it when percent-encoded is refused here, not dropped later by the page) (a first link that can't be checked yields none), and answers `303` to `/?url=<link>` (or `/` when there is no link). It keeps nothing else from the shared text and logs nothing. It sets no cookie and starts nothing, whoever posts: the share sheet's own POST (`Sec-Fetch-Site: none`), a form another site posts, and a request without the header all get the same redirect, which only prefills (the `?url=` contract). Every `/share` response is `Cache-Control: no-store`. `/share` has no rate-limit tier: it reads at most 16 KiB, makes no outbound call, and stores nothing; the scan a visitor then starts is metered by the scan tier. No service worker: Chrome has not required one for installing from the menu since 108 on Android and 112 on desktop.
  - Look-alike detection tests every contiguous run of two or more subdomain labels; a two-letter country-code run counts only for a listed brand, so regional and tenant hosts (`acme.us.auth0.com`) are not called impersonations. Presentation only: the stored verdict and score are unchanged, but a Safe look-alike is shown as "Look-alike" on the band, history and batch rows, announcements, and share cards, with its own verdict and score stated in the verdict details. Detection runs in the browser on a lazily loaded Public Suffix List parser (the server's anatomy for shared links). Until it loads, a Safe result is not stated: the band holds in its Checking state, rows show "—", and the announcement waits; other verdicts show at once. If it fails to load (after one retry), a Safe result reads "Unconfirmed" everywhere the word appears, with no score, "Check the link's address before you open it.", and a note that the address couldn't be checked.
  - Sans-serif typography is the default reading mode; mono is reserved for telemetry, timings, hashes, and other code-like labels.
  - Favicons and manifest are served from checked-in `public/` assets with explicit metadata links instead of a generated icon route; they are regenerated from `lib/brand-mark.ts` with `npm run icons`.
- Verdict decision:
  - Clean verdict confidence must be capped when a primary reputation source such as VirusTotal, Google Safe Browsing, or threat feeds does not complete, even if the remaining signals stay clean.
- Provider decision: an uncached VirusTotal report lookup uses the primary URL report endpoint only; domain enrichment is not fetched (it would spend two of the free tier's four requests per minute), and its never-filled schema field and scoring path were removed. Per-engine evidence lists engines that flagged the link first (malicious, then suspicious); engines that found nothing are dropped from both report and fresh-analysis results.
- Evidence decision (P29.2a): the Full view surfaces data the checks already collect (DNS CNAME targets, nameservers, a TXT count naming recognised kinds, certificate expiry/TLS version/self-signed/shortened SHA-256, iframes and password-receiving hosts, feed listing times, a VirusTotal engine breakdown). Two cheap facts are kept that providers used to drop: the hosting network (Team Cymru IP-to-ASN over DNS, `dns.hosting`) and feed listing dates (`threatFeeds.matches[].listedAt`). Both are evidence only: no scoring path reads them.
- Redirect decision: once the five-response redirect budget is exhausted, retain the last probed URL as the final URL and report the unprobed next location only as hop metadata.
- Security decision: generate per-request nonce CSP in `proxy.ts` via `lib/server/csp.ts`; keep the remaining browser-hardening headers in `next.config.ts`.
- Verification note: the shipped baseline passed lint, format, typecheck, unit, integration, E2E smoke, production build, audit, and Lighthouse; current P21 revalidation and review status are tracked in `PLAN.md`.
- Documentation decision: `PLAN.md` is the live execution source of truth; keep it aligned with `SPEC.md`, `CLAUDE.md`, and `AGENTS.md` whenever architecture or delivery status changes.

## 0) Metadata

- **Title:** Scrutinix
- **Owner (DRI):** Aman Thanvi (@amanthanvi)
- **Stakeholders:** Aman Thanvi
- **Status:** Deployed on Vercel preview and production
- **Last updated:** 2026-10-06
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
- **No native mobile app** — a responsive, installable web app. The phone share sheet is in scope: the installed app is a Web Share Target on Android (and ChromeOS), and on iOS a Shortcut anyone can build from the README's steps opens `/?url=` (the site itself never mentions installing)
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
4. Default: Summary view (verdict, a one-line instruction, and five plain questions about the link, each answered with why it matters and the checks it rests on). Toggle to Full Report for all data
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
4. Export the visible history results as CSV or JSON, or undo a local clear immediately from the in-flow history list

### 2.3 UX states checklist

- **Loading/streaming:** Pending signal rows update independently as each source resolves. From "Checking" on, the band holds the room the tallest verdict that can still land takes, and the strip's key is drawn whole, so the verdict lands in place and nothing on the page moves (no layout shift at any width or text size; `tests/e2e/landing.fixture.spec.ts`; the site's line holds the link's whole host while the link parser loads, and an Error result holds its missing switch's place), except that a coverage caveat, when a result has one, adds its lines to the band, and a failed scan trades its questions for its eight rows below the strip. A transform-only progress line shows aggregate completion; the polite live region reports "N of 8 checks finished." and, on completion, the host, verdict, score, and instruction ("Result for evil.example: Malicious, 73 out of 100. Don't open this link."); reopening a stored result re-announces it
- **Verdict:** every verdict shows one imperative line under the verdict word (Malicious/Critical "Don't open this link.", Suspicious "Don't sign in or enter payment details here.", Critical adds "— it's a known threat" only when a reputation source confirmed it, Safe "Looks safe to open." or, when confidence is below high, coverage was partial, or minor warning signs turned up, "Probably safe — still check who sent it.", Unknown "We couldn't check this link — treat it as unsafe.", Error "The scan failed — try again."). Unknown and Error show no score. The summary sentence names the evidence in plain words; it never repeats the instruction, and the band shows it only when no evidence is shown beneath (the Summary questions and the Full rows already state it), so in practice only a record saved before checks were kept shows it. It stays in the data for shares, exports, and history search. Reasons live under Details ("What we found"); Caveats lists only real limitations, and "Why {level} confidence" names shortfalls by check rather than restating the check count. Unknown says its cause once: "The site didn't respond, so we couldn't look at the page itself."
- **Empty:** Scanner-first landing state in the centered product shell, with brief framing and links to privacy/methodology; deeper explanation lives on `/about` and `/privacy`. Analyze stays enabled; an empty submit shows "Paste a link to check." inline
- **Error (partial):** Failed or non-applicable sources show their reason as the row's finding. Verdict is computed from available data, safe-result confidence is capped when primary reputation coverage is missing, one caveat line names the checks that limited coverage ("VirusTotal didn't finish."; absent when every check ran in full), and the user can rerun the full scan from the primary controls
- **Error (total):** All sources failed — the band reads "Error" with "The scan failed — try again.", and the score's place (where Cancel scan stood while it ran) is a "Try again" button that scans the link again; the eight rows say which checks failed and the details give the scan's reference
- **Offline/degraded:** N/A (server-side tool, requires network). Client-side history remains accessible offline via IndexedDB
- **Accessibility:** WCAG 2.1 AA compliance. Semantic HTML, ARIA labels on interactive elements, skip-to-content navigation, 44x44 touch targets, sufficient color contrast, stable focus indicators, and screen reader friendly status announcements

### 2.4 View modes

| Mode            | Content                                                                                                                                                                                                                                                                                                                                                                                                     | Target                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Summary**     | Overall verdict with a one-line instruction and confidence, plus five plain questions in fixed order (see §2.5), each with a short answer, one clause on why it matters, its sources (strip cell names), and, when checks conflict, one sentence on why. Error results show the eight rows instead, with no Summary/Full switch (they have one view); legacy records and shared snapshots show no questions | Casual users, quick checks |
| **Full Report** | All eight signals in fixed-order disclosure rows, with engine results, classifier details, WHOIS/SSL/DNS evidence, redirect hops, and threat-feed matches                                                                                                                                                                                                                                                   | Power users, investigation |

### 2.5 Summary questions

`lib/domain/summary-questions.ts` builds every Summary string. Fixed order and a fixed mapping, so each check is cited by exactly one question:

| Question                        | Checks cited                                   | Answers with                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has it been reported?           | VirusTotal, Google Safe Browsing, Threat Feeds | Who lists it and how many engines ("7 of 70 VirusTotal engines…"), feed wording via `feed-copy.ts`, listing age when known; "Not on any list we checked." only when all three answered cleanly; names any list that didn't answer; a host listing set aside on a shared host is said, never read as clean                                                 |
| Where would it take me?         | Redirect Chain (including the final page)      | The final site when its registered domain differs and the redirect count, sites passed through, plain-HTTP legs, password forms that send elsewhere, hidden frames and hard-to-read code, three or more frames; "couldn't reach" only when nothing answered, and a chain that stopped partway keeps the hops it saw with the destination left unconfirmed |
| What else raises concern?       | Link Pattern Model, Domain Registration        | The link pattern model's and structure checks' readings, each from its own label (agreement only when they match), their combined reading when it differs, and the registration age                                                                                                                                                                       |
| Does HTTPS make it safe?        | TLS Certificate                                | Always "No." first, then the certificate state and the leaf certificate's age ("This certificate was issued 2 hours ago", never "first"); plain HTTP or no TLS said plainly                                                                                                                                                                               |
| What did the other checks find? | DNS Profile                                    | Unusual records, and the hosting network ("network AS64500 EXAMPLE-NET, registered in NL", never "located in")                                                                                                                                                                                                                                            |

- A question is pending until every check it cites lands; for a link that starts on plain HTTP, the HTTPS question also waits for the redirect chain, so it never changes from "isn't encrypted" to "moves to HTTPS". Its placeholder holds room shaped like a typical clean answer (`PLACEHOLDER_SHAPE`, drawn as invisible generated content under "Checking…"), so in the common case (a clean link) no later heading moves as answers fill in. Findings, disagreements, and long hostnames still grow a question (measured at 390px: up to 72px for a flagged reported answer), and short "couldn't check" answers shrink one (up to 40px for an unreachable host).
- Disagreement sentences appear once, under the question where the conflict shows, only once every check involved has answered: clean lists on a domain under 7 days old ("Blocklists usually lag new sites by a day or two; this one is 3 days old."), a list hit while VirusTotal shows fewer than 5 engines (unless every dated listing is over 7 days old), the link pattern model or structure checks flagging a link every list passed (naming whichever flagged it), and a VirusTotal conviction no list shares.
- Listing age, certificate age, and the hosting network add no score contribution: they appear in answers and disagreement sentences only. The certificate's age was already scored before them by one existing rule, a certificate under 7 days old on a domain under 30 days old (+12, "a brand-new certificate on a brand-new domain"); the HTTPS question's why names that pairing when it applies, unless a certificate error (also scored) takes the why. A plain-HTTP link that moves to HTTPS states the certificate read where it does; one that passes through HTTPS and ends on HTTP says so and states that certificate; one that stays on HTTP says it isn't encrypted, or, when its site presents a certificate a browser accepts on 443, that it stays on plain HTTP though its site also answers over HTTPS, and states it; one whose chain never answered still states a certificate the host's own TLS port presented. The questions read the signals only, never `threatInfo.scoredSignals`, so a weak scored hit under a Safe verdict is never called a threat report.
- Every finding the engine scores is named by the question citing its check, and a page finding the engine doesn't count (one sign of hard-to-read script, fewer than three visible frames) isn't raised; `tests/unit/summary-questions.test.ts` walks every scorer branch (`getScoredFindings`) and fails on an unnamed finding or a scorer with no Summary wording. The thresholds the questions name are shared with the engine (`lib/domain/signal-severity.ts`).
- Relative ages of what was seen ("issued 2 hours ago", "listed 6 hours ago"), in Summary and in Full's rows alike, count from the result's check time (`metadata.checkedAt`, else `completedAt`), the same moment as the stored domain age, so reopening it later reads the same; a streaming scan counts from its server start time. Certificate expiry still counts from now. Whether a VirusTotal analysis is still current (30 days) is judged at the same check time everywhere: by the verdict engine (a cache hit re-derives its verdict as of the original check), the coverage caveat, the band's "known threat", and Summary's "Has it been reported?" and DNS answers.
- Question text wraps anywhere, so a long hostname breaks rather than widening a phone screen, and is never truncated. A sources line copies and reads as "Sources: VirusTotal, Safe Browsing, Threat feeds" (an `sr-only` plain list); the numbered "From" line beside it is for the eye only (`aria-hidden`, not selectable).
- The link anatomy states the owner and any look-alike; no question repeats them, and the anatomy draws none of its own facts where the evidence below states them, while a scan runs or after (so nothing under the band collapses when the verdict lands).
- Unknown results get questions with honest "couldn't reach" answers. A strip cell moves focus to the question citing its check (Summary) or opens its row (Full).

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
- **FR-9** MUST trace HTTP redirect chain (hops, final destination, status codes) and associate password inputs with their submitting form and viable `formaction` overrides before scoring cross-origin credential posts
- **FR-10** MUST compute an overall threat verdict from all available signals

### UX & Presentation

- **FR-11** MUST display results in a streaming fashion — each signal populates as it resolves
- **FR-12** MUST provide Summary / Full Report view toggle
- **FR-13** MUST show partial results when some sources fail, with clear signal-level status messaging and a full-scan rerun path
- **FR-14** MUST support batch URL analysis (up to 10 URLs, concurrent processing)
- **FR-15** MUST show batch results as a grid with per-URL drill-down and per-URL error isolation

### History & Export

- **FR-16** SHOULD persist scan history in IndexedDB with search/filter across every verdict, including unreachable-host `unknown` results, keeping one entry (the latest scan) per normalized URL
- **FR-17** SHOULD support CSV/JSON export for individual and batch results
- **FR-18** SHOULD support history export and a short undo window after clearing local history

### Polish

- **FR-19** MUST support dark and light themes
- **FR-20** MUST be responsive (mobile-friendly)
- **FR-21** SHOULD include educational content about URL threats
- **FR-22** SHOULD surface lightweight trust/privacy/methodology context on the public site
- **FR-23** MAY include shareable result links (URL-encoded state, no server persistence). A shared link MUST state a verdict only when it carries the server's signature of its payload, and SHOULD open recipient-first (the shared result, then "Check another link")
- **FR-24** SHOULD accept links from outside the page: `/?url=` and the installed app's share target fill in the Single field and wait. A scan MUST NOT start without the visitor's own tap (Analyze, or a re-scan button); nothing scans on arrival

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
│  VT | ML ensemble | GSB | Threat feeds | SSL |      │
│  WHOIS/RDAP | DNS | Redirect chain                  │
└──────────────────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────┐
│                  Client Experience                  │
│  - single-column server-rendered shell               │
│  - streamed verdict + Summary/Full signal rows       │
│  - batch result list                                 │
│  - in-flow IndexedDB history, export, re-scan, undo │
│  - theme toggle, share links, trust routes           │
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

type Verdict =
  "safe" | "suspicious" | "malicious" | "critical" | "unknown" | "error";

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

**Evidence-only fields** (optional, `.optional().catch(undefined)`, so cached results, history, and shared payloads saved earlier still load; never scored):

```typescript
interface DNSData {
  // ...addresses, cnames, mx, txt, nameservers, reverseHostnames, anomalies, observations
  hosting?: {
    ip: string; // first public IPv4 resolved, else the first global unicast (2000::/3) IPv6; mapped/NAT64 forms never queried
    asn: number | null; // integer 1–4294967295; null = Team Cymru answered NXDOMAIN: no network routes the address. A missing or invalid asn drops `hosting`
    asName: string | null; // "EXAMPLE-NET" (country suffix dropped)
    prefix: string | null; // most specific announced prefix
    registeredCountry: string | null; // the AS record's registry country only (null if that lookup failed; the prefix's country, which can differ, is never substituted); worded "registered in", never "located in"
  };
}

interface ThreatFeedMatch {
  // ...feed, matchedUrl, detail, confidence, matchType, listedElsewhereOnHost
  listedAt?: string; // ISO; URLhaus date_added (exact URL) or ThreatFox first_seen; unset for OpenPhish and DNSBLs
}
```

`hosting` is unset when there is no public address, the lookup timed out or failed, or the answer was malformed; that never fails the DNS signal or marks the scan partial. Private, reserved, and documentation addresses are never queried.

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

Implementation note: every stream ends with one terminal event (`scan_complete`/`scan_error`, `batch_complete`/`batch_error`). If a handler throws after it already sent one, the stream backstop appends a second error event; clients keep the first terminal event and ignore the rest.

- **Error model:** `{ error: { code: string, message: string, retryable: boolean } }`. Unexpected terminal failures return a generic summary plus `Reference: <id>`, where the id is the scan id (the batch id for a whole-batch failure). A failed check (signal row, feed warning, probe fallback, failed batch item) shows a plain sentence instead; the result states its scan id once in the verdict details when the scan failed or was partial. The exception text is logged server-side, under that id and with URL redaction, and is not sent to the client. Intentional copy — invalid URL, batch size, rate limit, and other messages thrown as `PublicError` — keeps its specific text.
- **Idempotency:** Same normalized URL returns a cached result with a new scan ID only when a complete, non-partial result remains inside the 15-minute TTL (shared-cache keys carry a result-format version, bumped whenever older cached results must not be replayed; an unexpected TLS probe failure counts as partial; a plain-HTTP link with no HTTPS in its path does not)
- **Rate limits:** 10 tokens/min per IP, 50 tokens/day per IP. An admitted batch costs one token per URL; rejected requests cost one token (enforced in `proxy.ts` before analysis work starts). The per-result share image route is metered separately (30/min, 600/day per IP) so link previews never spend scan quota

### 4.4 State, caching, concurrency

- **Source of truth:** Each scan is ephemeral server-side (computed, cached briefly, not persisted). Client-side IndexedDB is the only persistence layer
- **Server cache:** LRU cache (200 items, 15-min TTL) keyed by normalized URL, with optional shared Redis. Shared Redis keys are hashed and namespaced by `VERCEL_ENV` (each preview commit separately; `local` off Vercel), so previews never answer production scans; rate-limit state stays shared. Only complete, non-partial results are eligible; error, warning-degraded composite, incomplete redirect, partial-failure, and aborted scans always trigger fresh work. Composite `warnings` and redirect terminal errors represent lost coverage; informational feed notes use `observations`
- **Concurrency:** Enrichment pipeline runs all 8 sources via `Promise.allSettled()`. Batch mode uses a concurrency limiter (max 3 URLs in-flight simultaneously to stay within API quotas)
- **Hazards:** VT rate limit (4 req/min on free tier) — queue VT calls with backoff. Bound bundled-model initialization to 10 seconds and each local inference to 2 seconds so cold starts cannot consume the full scan budget

### 4.5 Performance targets

- **Initial page budget:** `npm run check:bundle` audits a fresh browser against the production `/` build through network idle (including hydration imports). `package.json#bundleBudget` gates the sum of per-script gzip bytes at 234,000 bytes and requested font bytes at 48,000 (P29.6: the two Newsreader cuts measure 46,864). The <200 KB gzip goal remains; P29.4 measured 223,410 bytes after trimming (234,674 before). Raw JS and each requested script are reported separately. Run after build with Playwright Chromium installed; CI also accepts `CHROME_PATH`.
- **Typography:** Newsreader (SIL OFL 1.1) is the one page web font: two static latin cuts (400 at opsz 16, 600 at opsz 60; 46,864 bytes) built from `@fontsource-variable/newsreader` 5.3.0 by `scripts/build-display-fonts.sh`, vendored in `fonts/newsreader/` with `OFL.txt`, loaded by `next/font/local` (preloaded CSS, no runtime script) as `--font-display`. System sans for the interface, system monospace for the link and data. Share cards read the same cuts as TTF, with bundled Geist for interface text.

- **First signal:** < 3 seconds (SSL, DNS, redirect chain are fast self-computed signals)
- **Full result:** < 30 seconds (VT polling is the bottleneck; other signals stream in earlier)
- **Cached result:** < 500ms
- **Batch (10 URLs):** < 2 minutes total (concurrent with rate limit awareness)
- **Payload limits:** Max URL length 2048 chars, measured on the normalized URL (`normalizeUrlInput`; input longer than that as typed is refused before parsing). Max batch size 10 URLs. Response streamed, no payload size concern

### 4.6 Dependencies / integrations

| Dependency                   | Type              | Free Tier              | Failure Behavior                                                              |
| ---------------------------- | ----------------- | ---------------------- | ----------------------------------------------------------------------------- |
| VirusTotal API v3            | External          | 4 req/min, 500 req/day | One primary report request per uncached lookup; signal unavailable on failure |
| Bundled URL classifier       | Self-computed     | N/A                    | Signal degrades to the lexical model on init/inference failure                |
| Google Safe Browsing API v4  | External          | 10k req/day            | Signal marked unavailable; verdict remains partial                            |
| URLhaus API                  | External          | Unlimited              | Signal marked unavailable; verdict remains partial                            |
| OpenPhish feed               | External          | Public feed            | Signal marked unavailable; verdict remains partial                            |
| ThreatFox API                | External          | abuse.ch account key   | Source warning recorded; other threat feeds still contribute                  |
| Spamhaus DBL / SURBL DNSBL   | External DNS      | Public DNS             | Blocked/wildcard resolvers are treated as unavailable, not clean              |
| DNS resolution               | Self-computed     | N/A                    | Prefer success-with-observation over hard failure where possible              |
| Team Cymru IP-to-ASN (DNS)   | External DNS      | Free, no key           | 2 s per query, abort-aware; failure leaves `dns.hosting` unset, never partial |
| SSL cert inspection          | Self-computed     | N/A                    | Prefer success-with-validation-state over hard failure                        |
| WHOIS lookup                 | Self-computed/API | Varies                 | Prefer success-with-observation or skipped where applicable                   |
| Redirect chain               | Self-computed     | N/A                    | Prefer success-with-observation over hard failure where possible              |
| Public Suffix List (`tldts`) | Bundled data      | N/A                    | Fall back to the normalized host when no registrable domain exists            |

## 5) Security, Privacy, Compliance

- **Authn/authz:** None. Anonymous usage. No user accounts
- **PII:** No accounts and no per-user records. Two server-side stores can still hold personal data, both disclosed on `/privacy`: complete results (not partial, error, or aborted), including the scanned URL, which may itself carry personal data, are cached for 15 minutes (the in-memory copy can outlive that unserved; see the privacy contract), and rate limiting stores the client IP address with each count. Logs carry a URL hash, never the URL. Client-side history is user-controlled
- **Public disclosure:** `/privacy` explains local history, hashed server logging, signed, server-less share links, and what sharing a link to Scrutinix sends (the first link only, nothing logged or stored; the page opens with it filled in and checks it only when you tap Analyze, like any link that opens Scrutinix with a link filled in), without mentioning installing; `/about` publishes the scoring method in full (every finding's points, the bands, what convicts on its own, what can't erase a hit, Unknown, Look-alike, confidence cut-offs and caps) from `lib/domain/methodology.ts`: point rows are checked against the verdict engine by a unit test (every printed number, both sides of each threshold), and the confidence figures are the engine's own `CONFIDENCE_POLICY`; it also says how to pronounce the name
- **Privacy contract (`/privacy` must stay true to the code):**
  - Recipients: the full link goes to VirusTotal, Google Safe Browsing, and URLhaus (which also gets a hostname lookup); only the hostname to ThreatFox (`search_ioc`); the registrable domain to Spamhaus DBL, SURBL, and rdap.org (`whois.ts` queries `https://rdap.org/domain/…`, which forwards to the domain's registry); only the IP address of the link's server to Team Cymru (as a DNS query name); nothing to OpenPhish, whose list is downloaded and matched on our server.
  - Checking a link visits it (redirect chain GET, TLS handshake), which can use up a one-time link. A link VirusTotal has never seen is submitted for analysis (`virustotal.ts` POSTs `/urls` on a 404 report), which can make it visible to VirusTotal's users.
  - Only complete results are cached, for 15 minutes; error, partial (`partialFailure`), and aborted scans never are (`lib/server/analyze.ts`). Upstash deletes its copy at the TTL; an in-memory copy is never served after 15 minutes but stays until it is read again, crowded out of the 200-entry LRU, or the process ends (`lib/server/cache.ts`).
  - Rate limiting counts requests by IP address. With Upstash, `@upstash/ratelimit` 2.2.0's sliding window sets `PEXPIRE window × 2 + 1 s` on each key (`dist/index.js`), so per-minute keys expire after 121 s and per-day keys after 48 h + 1 s. Without Upstash the counts stay in process memory.
  - Opening a shared link sends it to our server to verify its signature; the link inside is not scanned until the visitor chooses to scan it.
- **Shared links:** a `?shared=` payload is attacker-writable, so it is never rendered as Scrutinix's statement unless `sig` verifies (`lib/server/share-signing.ts`: HMAC-SHA256, domain-separated, `timingSafeEqual`, canonical 43-character base64url only, never throws, never logs the secret, payload, or URL). `SHARE_SIGNING_SECRET` must be at least 32 characters (shorter values are ignored with one warning that omits the value); `SHARE_SIGNING_SECRET_PREVIOUS` verifies, never signs, during rotation. With no secret configured, shares are unsigned and every shared link opens neutral. A signed result is a statement about one moment: the view and card show when the evidence was gathered (`metadata.checkedAt`, kept from the original scan on a cache hit, dated with its year in UTC), and still offer a fresh scan. It also expires: a genuine signature over a Safe captured while a link was benign (or cloaked) would otherwise keep previewing "Safe" after the link turns, so a verified snapshot whose `capturedAt` (inside the HMAC) is older than `SHARE_MAX_AGE` (72 hours) or more than 5 minutes in the future is treated exactly like an unverified one: neutral band ("This shared result is more than 3 days old, so we're not showing it."), default metadata, and `/og/result` redirecting to the default card. Test-fixture mode (`SCRUTINIX_TEST_FIXTURES=1`) scores unknown hosts Safe, so it and real signing are mutually exclusive: with fixtures on, only the published e2e key signs (any other key is ignored with one value-free warning), and with fixtures off the published e2e key is always ignored. The signing keys belong in the Vercel Production environment only; any deployment holding the key (an unreviewed preview branch included) can mint links production verifies, so Preview/Development leave them unset or use a separate key, and the committed e2e key is ignored outside fixture mode. Share images are cached `public, max-age=3600, s-maxage=3600` (never `immutable`) so forged images age out after a revocation. **Routine rotation:** set the new key as `SHARE_SIGNING_SECRET` and the old one as `SHARE_SIGNING_SECRET_PREVIOUS`, and keep the previous key for at least `SHARE_MAX_AGE` (72 hours), so no link still inside its window stops verifying while its sender was told it shows the result; then remove it. **Revocation runbook:** on a leaked `SHARE_SIGNING_SECRET`, unset it and `SHARE_SIGNING_SECRET_PREVIOUS` (or replace them), redeploy, and purge the `/og/result` CDN cache if the deploy does not. Chat platforms' own unfurl caches are outside our control and may keep showing already-fetched previews
- **Abuse cases + mitigations:**

| Abuse case                                       | Mitigation                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| API quota exhaustion via flood                   | IP-based rate limiting (10/min, 50/day)                                                                    |
| Scanning internal/private URLs                   | URL validation rejects private IP ranges (10.x, 192.168.x, localhost)                                      |
| Using tool to enumerate which URLs are malicious | Rate limiting + no bulk API access                                                                         |
| XSS via crafted URL display                      | Sanitize all URL rendering, never inject raw HTML                                                          |
| Forged share link ("Safe: paypal.com") in a chat | Verdicts render only for server-signed payloads; others open neutral                                       |
| A page or app making a visitor's browser scan    | Nothing scans on arrival: `?url=` and `POST /share` only fill in the field; a scan needs the visitor's tap |

- **Audit/logging policy:** Log scan requests (URL hash only, not full URL) + response status + timing. Never log full URLs server-side (could contain PII in query params). The hosting platform's own request logs are outside this policy and can record page addresses, so a link carried in a page address (`/?url=`, including the `/share` redirect, and `?shared=` results) can appear there; `/privacy` says so.

## 6) Reliability & Failure Modes

### 6.1 Failure modes table

| Failure                   | Detection                      | User Impact                   | System Behavior                                                        | Recovery                    | Blast Radius      |
| ------------------------- | ------------------------------ | ----------------------------- | ---------------------------------------------------------------------- | --------------------------- | ----------------- |
| VT API down/timeout       | HTTP error / 30s timeout       | Missing VT signal             | Signal row shows "unavailable"                                         | Full scan rerun             | Single signal     |
| VT rate limit exceeded    | 429 response                   | Delayed/missing VT signal     | Surface partial coverage and keep verdict provisional                  | Retry after cooldown window | VT signal only    |
| Local model load slow     | Classifier budget exhausted    | Delayed/partial ML signal     | Lexical scorer still returns a partial ML result                       | Full scan rerun             | ML signal only    |
| Local model unavailable   | Init or inference error        | Reduced ML coverage           | Local-model warning; lexical scorer still contributes                  | Full scan rerun             | ML signal         |
| Google Safe Browsing down | HTTP error                     | Missing GSB signal            | Signal row shows "unavailable"                                         | Full scan rerun             | Single signal     |
| DNS resolution failure    | Lookup error / bounded timeout | Reduced DNS coverage          | Prefer a caveat or unavailable state over a threat-colored failure     | None needed                 | DNS signal        |
| SSL handshake failure     | Connection error               | Reduced TLS coverage          | Prefer validation-state or unavailable state without inventing malware | None needed                 | SSL signal        |
| WHOIS lookup failure      | API error / timeout            | Reduced registration coverage | Show caveat / unavailable / skipped as appropriate                     | Full scan rerun             | WHOIS signal      |
| All sources fail          | All signals error              | No useful analysis            | Show error state with a full rerun path                                | Full retry                  | Complete          |
| Vercel function timeout   | 10s edge / 60s serverless      | Partial results               | Stream whatever completed before timeout                               | Retry                       | Depends on timing |

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
Then Summary shows the verdict and the five questions (§2.5), Full Report shows all 8 signal sections with detailed data; an Error result shows its 8 rows and no toggle, and the chosen mode carries to the next result

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

- **E2E tests** (Playwright, offline fixtures; Chromium gates merges, and the same suite runs in Firefox and WebKit as separate CI jobs):
  - Single URL scan happy path
  - Batch scan with multiple URLs
  - Accessibility audit with axe-core
  - Keyboard navigation smoke coverage
  - No sideways scrolling at a larger default text size (Chromium and Firefox; Safari has no such setting) and at page zoom (every engine)
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
| 2026-10-25 | Read the bundled classifier on host and path, IDs out, past a set bar                     | Raw 50% label; require member agreement   | Read raw it flagged a third of sites, 91% of short links, half of sign-in links                                | Flags 1% of held-out sites, 16% of account links; 36% of OpenPhish (was 80%)    |
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
