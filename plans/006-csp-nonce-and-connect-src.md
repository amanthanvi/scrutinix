# Plan 006: CSP nonce migration and narrow connect-src

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 76c4698..HEAD -- next.config.ts proxy.ts app/layout.tsx package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Written against:** `76c4698`
>
> **Depends on plan 004**: bump Next first so CSP-nonce-related framework advisories in `16.0.0–16.2.5` are patched before leaning on nonce APIs.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/004-next-bump-and-rate-limit-identity.md`
- **Category**: security
- **Planned at**: commit `76c4698`, 2026-07-17
- **Maps to**: Advisory findings 13–14; SBP-05 (NEXT-CSP-001); SBP-07 (connect-src least privilege)

## Why this matters

Production CSP allows `script-src 'self' 'unsafe-inline'`, which weakens XSS containment versus a nonce/hash-based CSP (NEXT-CSP-001). Separately, `connect-src` allowlists VirusTotal, GSB, URLHaus, OpenPhish, Hugging Face, and RDAP in the **browser** CSP even though the client only talks to same-origin `/api/*` — unnecessary egress if XSS ever lands. Narrowing `connect-src` is a small win; nonce migration is the larger framework-aligned hardening.

## Current state

```9:33:next.config.ts
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  [
    "connect-src 'self'",
    "https://www.virustotal.com",
    "https://safebrowsing.googleapis.com",
    "https://urlhaus-api.abuse.ch",
    "https://openphish.com",
    "https://router.huggingface.co",
    "https://rdap.org",
    isDevelopment
      ? "http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
      : "",
  ]
    .filter(Boolean)
    .join(" "),
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
].join("; ");
```

Headers applied globally via `next.config.ts` `headers()`.

Positive controls already present: `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, referrer policy.

### Conventions

- Security headers stay in `next.config.ts` and/or Next-recommended middleware/proxy header injection — AGENTS.md notes production CSP from `next.config.ts`.
- Client must not call third-party threat APIs directly (server adapters only).
- Do not reintroduce `middleware.ts` if the project standardized on `proxy.ts` — but Next nonce CSP often needs per-request header generation. Prefer the **current Next 16 documented approach** for nonces (read Next docs for the installed version after plan 004). If docs require `middleware` filename, STOP and report conflict with AGENTS anti-pattern before renaming — operator must approve any `middleware.ts` reintroduction.
- `style-src 'unsafe-inline'` may remain initially (Next/Tailwind often needs it); this plan’s hard goal is **script-src** nonce + **connect-src** narrow. Do not expand scope to strict style nonces unless easy.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Dev smoke | `npm run dev` | app loads; console CSP errors absent for normal scan |
| Build | `npm run build` | exit 0 |
| Typecheck / lint | `npm run typecheck` / `npm run lint` | exit 0 |
| Unit / integration | `npm run test:unit -- --run` / `test:integration -- --run` | exit 0 |
| E2E smoke | `npm run test:e2e -- --grep @smoke` | exit 0 |

## Suggested executor toolkit

- Read Next.js 16 docs for “Content Security Policy” / `nonce` for the **exact** version pinned after 004.
- Browser DevTools CSP console while loading `/` and completing a mocked scan.

## Scope

**In scope**:

- `next.config.ts` — narrow `connect-src`; adjust static CSP for scripts if still static after nonce move
- Per-request CSP wiring per Next 16 guidance (may touch `proxy.ts`, root `app/layout.tsx`, and/or a small header helper under `lib/server/`)
- `plans/README.md` status
- Short comment documenting why third-party hosts were removed from `connect-src`

**Out of scope**:

- Strict `style-src` without `'unsafe-inline'` (follow-up)
- Adding HSTS
- Changing server-side provider URLs
- Finding 7 error sanitization
- Re-allowing browser-side VT/GSB calls

## Git workflow

- Branch: `advisor/006-csp-nonce-and-connect-src`
- Commit example: `security: nonce CSP scripts and narrow connect-src`
- Do NOT push/PR unless instructed

## Steps

### Step 1: Narrow `connect-src` (SBP-07 / finding 14) — do this first (small, independent)

In `next.config.ts`, change production `connect-src` to `'self'` only (keep dev localhost/ws allowances):

```ts
[
  "connect-src 'self'",
  isDevelopment
    ? "http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
    : "",
]
```

Remove VT/GSB/URLHaus/OpenPhish/HF/RDAP from browser CSP.

**Verify**:

```bash
npm run build
npm run dev
```

Manually: home page loads; start a scan against local API — no CSP `connect-src` violations in console for `/api/analyze`. Server-side provider calls are unaffected (Node `fetch` ignores browser CSP).

### Step 2: Research Next 16 nonce CSP for this repo

After confirming plan 004’s Next version:

1. Read the version’s docs for CSP nonces with App Router.
2. Note whether static `headers()` in `next.config.ts` **cannot** supply per-request nonces (usually true).
3. Plan the injection point: often `proxy.ts` / middleware sets `Content-Security-Policy` with `'nonce-…'` and passes nonce to the root layout via headers/`headers()` from `next/headers`.

**STOP** if the only supported path requires deprecated `middleware.ts` and AGENTS forbids it — report options to the operator before coding.

### Step 3: Implement script-src nonce (SBP-05 / finding 13)

Target production directive shape:

```text
script-src 'self' 'nonce-<per-request>'
```

Remove `'unsafe-inline'` from **production** `script-src`. Keep `'unsafe-eval'` **only** in development if Next/Turbopack still needs it.

Ensure Next-managed inline bootstraps receive the nonce (framework-supported attribute plumbing). Do not add `dangerouslySetInnerHTML` sinks.

If a static CSP remains in `next.config.ts` for non-HTML assets, ensure it does not override HTML document CSP incorrectly — follow Next guidance for single source of truth.

**Verify**:

```bash
npm run build
npm run start
```

Load `/` and confirm:

- Response header `Content-Security-Policy` includes a nonce
- Page renders (no blank app from blocked Next scripts)
- DevTools console has no CSP script blocks on happy path

### Step 4: Regression suite

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run
npm run test:integration -- --run
npm run test:e2e -- --grep @smoke
```

Update `plans/README.md` 006 → DONE.

## Test plan

| Check | How |
|-------|-----|
| Browser cannot `fetch` VT directly under CSP | Optional DevTools snippet expectation / document manual check |
| App + analyze still work | e2e `@smoke` + manual scan |
| Production script-src lacks unsafe-inline | Assert header in a small node script fetching `next start`, or document `curl -I` check |

Example manual header check:

```bash
# after npm run build && npm run start
curl -sI http://127.0.0.1:3000/ | findstr /i Content-Security-Policy
```

Expect `script-src` with `nonce-` and without `'unsafe-inline'` in production.

## Done criteria

- [ ] Production `connect-src` does not list VT/GSB/URLHaus/OpenPhish/HF/RDAP hostnames
- [ ] Production `script-src` does not include `'unsafe-inline'`
- [ ] Production `script-src` includes a per-request nonce **or** an equally Next-recommended strict alternative (hashes) documented in the PR
- [ ] `npm run build` exits 0
- [ ] `npm run test:e2e -- --grep @smoke` exits 0 (or CI equivalent)
- [ ] Plan 004 already completed (Next patched)
- [ ] `plans/README.md` 006 DONE

## STOP conditions

- Nonce support requires `middleware.ts` contrary to AGENTS — stop for operator decision.
- Enabling nonces breaks Sonner / next-themes / Framer Motion scripts with no documented nonce pass-through — report before adding `'unsafe-inline'` back.
- CSP breaks Playwright smoke in ways that need `'unsafe-inline'` restored — do not silently revert; report.
- Drift / verification fails twice.

## Maintenance notes

- Any new browser-side analytics/CDN script needs an explicit CSP update (prefer avoiding third-party browser scripts).
- Server provider allowlists are **not** CSP; do not re-add them to `connect-src` “for documentation.”
- Reviewers: check HTML responses for matching `nonce` on Next script tags.
- Follow-up: tighten `style-src` later if Tailwind/inline styles allow.
