# Plan 004: Bump Next and harden rate-limit identity

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> 1. `git status --porcelain` (fail if dirty staged/unstaged/untracked in scope)
> 2. `git diff --stat 76c4698..HEAD -- package.json package-lock.json proxy.ts lib/server/rate-limit.ts tests/unit/rate-limit.test.ts`
> If any in-scope file changed since this plan was written, compare the file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Written against:** `76c4698`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none (plan 006 should land after this)
- **Category**: security
- **Planned at**: commit `76c4698`, 2026-07-17
- **Maps to**: Advisory findings 5–6 + 11; SBP-03 (Next DoS + Middleware/Proxy bypass); SBP-04 (rate-limit identity); simplify Redis/Ratelimit singleton

## Why this matters

`next@16.2.4` sits in the audited vulnerable range `16.0.0–16.2.5` (multiple GHSA entries including Middleware/Proxy bypass via segment-prefetch incomplete fix, DoS, etc.). Rate limiting lives only in `proxy.ts` matching `/api/analyze/:path*`, so a proxy bypass can skip the limiter. Separately, the limiter identity is the **first** `X-Forwarded-For` hop, which clients can spoof if the edge does not overwrite the header. Finally, Redis + two `Ratelimit` instances are constructed on every `applyRateLimit` call in production — needless hot-path alloc (finding 11).

## Current state

### Pinned Next

```51:51:package.json
    "next": "16.2.4",
```

Also `eslint-config-next`: `16.2.4` (keep in lockstep).

At plan writing time, `npm view next version` reported `16.2.10` as latest on the registry. Prefer the newest **16.2.x** patch that clears `npm audit` for the Next family without jumping majors.

### Spoofable identifier (SBP-04)

```10:13:proxy.ts
async function enforceRateLimit(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const identifier = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
  const limit = await applyRateLimit(identifier);
```

Matcher:

```38:40:proxy.ts
export const config = {
  matcher: ["/api/analyze/:path*"],
};
```

AGENTS.md: keep `proxy.ts`; do **not** reintroduce `middleware.ts`.

### Per-request Redis/Ratelimit (finding 11)

```56:74:lib/server/rate-limit.ts
  const redis = new Redis({
    url: redisUrl,
    token: redisToken,
  });
  const minuteLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(MINUTE_LIMIT, "1 m"),
    prefix: "mud:minute",
  });
  const dayLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(DAY_LIMIT, "1 d"),
    prefix: "mud:day",
  });

  const [minute, day] = await Promise.all([
    minuteLimiter.limit(identifier),
    dayLimiter.limit(identifier),
  ]);
```

In-memory path already uses `globalThis.__devRateLimitStore` — mirror that singleton pattern for Redis limiters.

### Conventions

- Accept either `UPSTASH_REDIS_REST_*` or Vercel `KV_REST_API_*` (`getRedisRestConfig`).
- Documented fail-open to in-memory when Redis missing — **do not** change to fail-closed in this plan.
- Never commit secret values; env var **names** only.
- Commit style example: `security: bump next and fix rate-limit client identity`

## Commands you will need

| Purpose              | Command                             | Expected on success                                       |
| -------------------- | ----------------------------------- | --------------------------------------------------------- |
| Audit (Next-related) | `npm audit`                         | no Next high/critical in prod path (or document residual) |
| Lint                 | `npm run lint`                      | exit 0                                                    |
| Typecheck            | `npm run typecheck`                 | exit 0                                                    |
| Unit                 | `npm run test:unit -- --run`        | exit 0                                                    |
| Integration          | `npm run test:integration -- --run` | exit 0                                                    |
| Build                | `npm run build`                     | exit 0                                                    |

## Scope

**In scope**:

- `package.json` / `package-lock.json` — bump `next` and `eslint-config-next` to a patched 16.2.x
- `proxy.ts` — trusted client IP / rate-limit identity
- `lib/server/rate-limit.ts` — singleton Redis + Ratelimit
- `tests/unit/rate-limit.test.ts` — adjust if needed; add identity tests if you extract a pure helper
- Optional tiny pure helper e.g. `getRateLimitIdentifier(headers)` in `lib/server/` for unit testing
- `plans/README.md` status
- Brief comment in `proxy.ts` documenting identity trust assumptions (AGENTS: keep rate-limit policy explicit in comments)

**Out of scope**:

- Changing minute/day numeric limits
- Fail-closed rate limiting when Redis is down
- CSP nonce work (plan 006)
- Tooling-only vite/ws audit noise (SBP-08)
- Vercel dashboard configuration (document only)

## Git workflow

- Branch: `advisor/004-next-bump-and-rate-limit-identity`
- Commit(s): dependency bump can be its own commit; identity + singleton another — or one commit if small
- Do NOT push/PR unless instructed

## Steps

### Step 1: Bump Next (+ eslint-config-next)

1. Check latest patched release:

```bash
npm view next version
npm view next@16 version
```

2. Install matching versions (example — replace with the actual newest safe 16.2.x you confirmed):

```bash
npm install next@16.2.10 eslint-config-next@16.2.10
```

3. Confirm audit improvement:

```bash
npm audit
```

Expect Next GHSA entries for `16.0.0–16.2.5` to clear. If a newer 16.2.x is required, use that instead of hard-coding 16.2.10.

**STOP** if the bump requires Next 17+ or React major changes.

**Verify**:

```bash
npm run typecheck
npm run build
```

→ exit 0

### Step 2: Fix rate-limit identity (SBP-04)

Replace first-hop `X-Forwarded-For` as sole identity.

**Target behavior on Vercel / typical reverse proxies:**

- Prefer platform-provided client IP when available. On Vercel, `request.headers.get("x-real-ip")` or the **last** untrusted vs **rightmost** trusted hop patterns vary — verify against current NextRequest / Vercel docs at execution time.
- Practical approach used by many Next apps on Vercel:
  1. Use `request.ip` if present on `NextRequest` in this Next version (check types — may be undefined).
  2. Else use `x-vercel-forwarded-for` or `x-real-ip` if set by the platform.
  3. Else parse `x-forwarded-for` and take the **rightmost** hop (added by the trusted proxy) **or** the leftmost **only if** you document that Vercel overwrites the header (Vercel typically appends/overwrites — confirm).

**Minimum acceptable fix** if platform headers are unclear:

- Prefer `x-real-ip` when present.
- Else use the **last** non-empty hop of `x-forwarded-for` (proxy-appended), not the first (client-supplied).
- Fallback `"unknown"` (current) — accepting that all unknown share a bucket.

Extract pure function for tests:

```ts
export function getClientRateLimitId(headers: Headers): string;
```

Add unit tests:

- `x-forwarded-for: "1.1.1.1, 2.2.2.2"` → identity is `2.2.2.2` (if last-hop strategy) **or** documented platform header wins
- Spoof-only first hop without platform header does not become the identity when a later hop exists

Add a short comment above the helper citing: client-supplied first XFF hop is untrusted.

**Do not** log IP addresses in production info logs as part of this change.

**Verify**:

```bash
npm run test:unit -- --run tests/unit/rate-limit.test.ts
```

### Step 3: Singleton Redis + Ratelimit

In `lib/server/rate-limit.ts`:

```ts
declare global {
  var __scrutinixRateLimiters:
    | { minute: Ratelimit; day: Ratelimit }
    | undefined;
}

function getUpstashLimiters(redisUrl: string, redisToken: string) {
  if (!globalThis.__scrutinixRateLimiters) {
    const redis = new Redis({ url: redisUrl, token: redisToken });
    globalThis.__scrutinixRateLimiters = {
      minute: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(MINUTE_LIMIT, "1 m"),
        prefix: "mud:minute",
      }),
      day: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(DAY_LIMIT, "1 d"),
        prefix: "mud:day",
      }),
    };
  }
  return globalThis.__scrutinixRateLimiters;
}
```

Use in the production branch instead of `new Redis` / `new Ratelimit` per call.

Keep prefixes `mud:minute` / `mud:day` unchanged (existing Redis keys).

**Verify**: existing rate-limit unit tests still pass; add a test that calling `applyRateLimit` twice does not throw (singleton smoke) if easy to mock.

### Step 4: Full verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run
npm run test:integration -- --run
npm run build
npm audit
```

Update `plans/README.md` 004 → DONE. Note residual audit issues that are tooling-only (SBP-08) in the PR description — do not “fix” them here.

## Test plan

| Case                                      | Where                                       |
| ----------------------------------------- | ------------------------------------------- |
| Next builds after bump                    | `npm run build`                             |
| Rate-limit identity prefers trusted hop   | `tests/unit/rate-limit.test.ts` (new cases) |
| In-memory limiter still works in test/dev | existing rate-limit tests                   |
| Singleton does not break limit math       | existing tests + optional smoke             |

## Done criteria

- [ ] `package.json` `next` and `eslint-config-next` are ≥ the first patched release that clears Next `16.0.0–16.2.5` advisories (verify with `npm audit` / advisory range)
- [ ] `npm run build` exits 0
- [ ] `npm run typecheck` / `lint` / unit / integration exit 0
- [ ] `proxy.ts` no longer uses **only** `forwardedFor?.split(",")[0]` as identity without a documented trust rationale
- [ ] Redis/Ratelimit are not constructed on every call (singleton / module cache)
- [ ] No secrets in diff
- [ ] `plans/README.md` 004 DONE

## STOP conditions

- Next bump forces React/Next major or broken App Router APIs.
- Vercel preview auth / proxy behavior cannot be reasoned about from docs — implement last-hop XFF + comment and report residual risk rather than inventing header forgery “crypto.”
- Changing identity breaks integration tests that depend on `"unknown"` — update tests deliberately.
- Verification fails twice.

## Maintenance notes

- Re-run `npm audit` on each Next patch; keep `eslint-config-next` aligned.
- After this lands, plan **006** (CSP nonce) is unblocked from a framework-advisory perspective.
- Reviewers: confirm matcher still `/api/analyze/:path*` only; do not broaden unless product asks.
- Residual risk: if deploy is not behind a header-overwriting edge, rate limits remain soft — document in comment.
