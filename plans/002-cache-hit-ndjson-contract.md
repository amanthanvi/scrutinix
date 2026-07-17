# Plan 002: Fix cache-hit NDJSON contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 76c4698..HEAD -- app/api/analyze/route.ts lib/server/analyze.ts hooks/use-scan-stream.ts tests/integration/analyze-routes.test.ts lib/domain/types.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Written against:** `76c4698`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `76c4698`, 2026-07-17
- **Maps to**: Advisory finding 3

## Why this matters

On a cache hit, `runAnalysis` returns `cached: true` and never invokes `onSignal`. The single-scan route always emits `scan_started` with `cached: false`, then jumps to `scan_complete` with zero `signal_result` events. The UI stays in a pending-signal state until completion (or looks broken on slow networks). Repeat scans must advertise the cache hit and either replay per-signal events or otherwise hydrate signals before `scan_complete`.

## Current state

### Orchestrator returns `cached: true` but skips listeners

```58:78:lib/server/analyze.ts
  if (cached) {
    const cachedResult = {
      ...cached,
      id: scanId,
      metadata: {
        ...cached.metadata,
        scanId,
        cacheHit: true,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    } satisfies AnalysisResult;

    return {
      ok: true as const,
      result: cachedResult,
      scanId,
      startedAt,
      cached: true,
      normalizedUrl: normalized.value.normalizedUrl,
    };
  }
```

Note: no `options.onSignal` calls on this path.

### Route hard-codes `cached: false` and only emits signals via `onSignal`

```37:70:app/api/analyze/route.ts
  return createNdjsonResponse(async (writer) => {
    writer.send({
      type: "scan_started",
      scanId,
      url: validation.value.normalizedUrl,
      cached: false,
      startedAt,
    });

    try {
      const outcome = await runAnalysis(url, {
        scanId,
        startedAt,
        onSignal: ({ name, result }) => {
          writer.send({
            type: "signal_result",
            name,
            result,
          });
        },
      });
      // ...
      writer.send({
        type: "scan_complete",
        result: outcome.result,
      });
```

### Client expects progressive `signal_result`

```87:114:hooks/use-scan-stream.ts
          if (event.type === "scan_started") {
            setState((previous) => ({
              ...previous,
              url: event.url,
              scanId: event.scanId,
              startedAt: event.startedAt,
            }));
          }

          if (event.type === "signal_result") {
            setState((previous) => ({
              ...previous,
              signals: {
                ...previous.signals,
                [event.name]: event.result,
              },
            }));
          }

          if (event.type === "scan_complete") {
            setState((previous) => ({
              ...previous,
              result: event.result,
              signals: event.result.signals,
              isStreaming: false,
              error: null,
            }));
```

`scan_complete` already copies `event.result.signals`, so the final UI state recovers — but intermediate UI / pending LEDs stay empty for the whole cache-hit stream, and `cached` on `scan_started` is wrong for any consumer that reads it.

### Event type contract

```213:220:lib/domain/types.ts
export type AnalyzeEvent =
  | {
      type: "scan_started";
      scanId: string;
      url: string;
      cached: boolean;
      startedAt: string;
    }
```

### Integration gap

`tests/integration/analyze-routes.test.ts` has a second-request path that currently expects **eight** `signal_result` events with `cacheHit: false` (partial-failure fixture). There is **no** assertion that a true cache hit sets `scan_started.cached === true` or replays signals. Add a dedicated cache-hit case.

### Conventions

- NDJSON over `fetch`, not SSE (AGENTS.md).
- Routes stay thin; prefer fixing stream emission in the route (and/or having `runAnalysis` invoke `onSignal` for cached results) rather than inventing a new event type.
- Keep `metadata.cacheHit` on `AnalysisResult` consistent with `scan_started.cached`.

## Commands you will need

| Purpose     | Command                             | Expected on success |
| ----------- | ----------------------------------- | ------------------- |
| Integration | `npm run test:integration -- --run` | exit 0              |
| Unit        | `npm run test:unit -- --run`        | exit 0              |
| Typecheck   | `npm run typecheck`                 | exit 0              |
| Lint        | `npm run lint`                      | exit 0              |

## Scope

**In scope**:

- `app/api/analyze/route.ts`
- `lib/server/analyze.ts` (only if needed so cached path can emit per-signal callbacks)
- `tests/integration/analyze-routes.test.ts`
- Optionally `hooks/use-scan-stream.ts` only if you choose to surface `cached` in state (not required if contract fix alone is enough)
- `plans/README.md` status row

**Out of scope**:

- Batch route cache behavior (batch may not use the same analysis cache the same way — do not expand unless you discover an identical bug; if you do, STOP and report)
- Changing cache TTL / `analysisCache` internals beyond what’s needed to test hits
- Plan 003 stream error recovery
- Client history IndexedDB schema

## Git workflow

- Branch: `advisor/002-cache-hit-ndjson-contract`
- Commit message example: `fix: emit truthful cached NDJSON on analysis hits`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Decide emission strategy (pick A; use B only if A is awkward)

**A (preferred):** In `app/api/analyze/route.ts` after `runAnalysis` returns:

1. Set `scan_started.cached` from `outcome.cached` (move `scan_started` to **after** `runAnalysis` **or** buffer/rewrite — see note).
2. On `outcome.ok && outcome.cached`, before `scan_complete`, iterate `signalNames` / `outcome.result.signals` and `writer.send({ type: "signal_result", name, result })` for each signal.

**Ordering constraint:** Today `scan_started` is sent _before_ `runAnalysis`, so `cached` is unknown. Fix by either:

- **A1:** Call `runAnalysis` first (without streaming), then send `scan_started` with correct `cached`, then replay `signal_result`s (from live `onSignal` collection or from final result), then `scan_complete`; **or**
- **A2:** Keep early `scan_started` but only after a cheap cache peek; **or**
- **A3:** Have `runAnalysis` invoke `onSignal` for every signal in the cached result before returning, and change the route to send `scan_started` with `cached: outcome.cached` by restructuring so `scan_started` is emitted once `outcome.cached` is known.

Simplest correct shape for a weak executor:

1. Run analysis with an in-memory collector for `onSignal` events **and** use the returned `outcome.cached`.
2. Emit: `scan_started` (`cached: outcome.cached`) → each collected or replayed `signal_result` → `scan_complete`.

For cache misses, behavior must remain: progressive `signal_result` during work **or** equivalent final set of eight signals before complete. Prefer keeping progressive streaming on miss:

- On miss: send `scan_started` (`cached: false`) first, then live `onSignal` → `signal_result`, then `scan_complete`.
- On hit: send `scan_started` (`cached: true`), replay eight `signal_result` from `outcome.result.signals`, then `scan_complete`.

That implies: peek cache **or** branch after `runAnalysis`. Clean approach:

```text
const outcome = await runAnalysis(...)
if (!outcome.ok) { send scan_error; return }
send scan_started { cached: outcome.cached, ... }
if (outcome.cached) {
  for each signal in outcome.result.signals: send signal_result
} else {
  // PROBLEM: signals already ran; onSignal already fired during runAnalysis
}
```

So for progressive miss streaming you **must** keep `onSignal` during `runAnalysis` and send `scan_started` **before** the run with a provisional flag, **or** peek the cache first.

**Recommended concrete fix:**

1. In the route, compute `cacheKey` the same way as `runAnalysis` (`createCacheKey(validation.value.normalizedUrl)`) and `analysisCache.has/get` **or** export a tiny `peekAnalysisCache(normalizedUrl)` from `lib/server/analyze.ts` / cache module.
2. `const cached = Boolean(analysisCache.get(cacheKey))` (or peek helper).
3. Send `scan_started` with `cached`.
4. Call `runAnalysis` with `onSignal` → `signal_result` as today.
5. **Also** change `runAnalysis` cache-hit path to invoke `onSignal` once per signal in the cached `signals` object before return.

This preserves progressive streaming on miss and fixes hit replay + truthful `cached` flag.

**Verify**: typecheck after edits.

### Step 2: Implement cache-hit `onSignal` replay inside `runAnalysis`

In the `if (cached)` block of `lib/server/analyze.ts`, before `return`, for each entry in `cachedResult.signals` (use `signalNames` from `@/lib/domain/types`):

```ts
options.onSignal?.({ name, result: cachedResult.signals[name] });
```

Preserve order of `signalNames` for deterministic tests.

**Verify**: unit/integration in Step 3.

### Step 3: Truthful `scan_started.cached` in the route

In `app/api/analyze/route.ts`:

- Import `analysisCache` from `@/lib/server/cache` and `createCacheKey` from `@/lib/domain/url` (already have normalize).
- Before sending `scan_started`:

```ts
const cacheKey = createCacheKey(validation.value.normalizedUrl);
const cacheHit = Boolean(analysisCache.get(cacheKey));
```

- Set `cached: cacheHit` on `scan_started`.

Do **not** invent new event types.

**Verify**: proceed to tests.

### Step 4: Integration test for true cache hit

In `tests/integration/analyze-routes.test.ts` (follow existing MSW/handler patterns in that file):

1. First POST a URL that completes successfully and populates the cache (existing happy-path fixtures).
2. Second POST the **same** URL.
3. Assert second stream:
   - first event `type === "scan_started"` and `cached === true`
   - exactly 8 `signal_result` events (or `signalNames.length`)
   - final `scan_complete` with `result.metadata.cacheHit === true`

Do not weaken the existing partial-failure test unless it conflicts; if the partial-failure case was incorrectly assuming no cache, leave it or clear cache between cases (`analysisCache.clear()` already in test setup).

**Verify**:

```bash
npm run test:integration -- --run
```

→ exit 0, including new assertions.

### Step 5: Full verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run
npm run test:integration -- --run
```

Update `plans/README.md` 002 → DONE.

## Test plan

- New integration assertions: second identical scan → `scan_started.cached === true`, 8× `signal_result`, `metadata.cacheHit === true`.
- Existing analyze-route tests remain green.
- Model after existing `parseNdjsonEvents` helpers in `tests/integration/analyze-routes.test.ts`.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test:integration -- --run` exits 0 with new cache-hit assertions
- [ ] Cache-hit path invokes `onSignal` (or equivalent) so clients receive `signal_result` events
- [ ] `scan_started.cached` is `true` on cache hits and `false` on misses
- [ ] `rg "cached: false" app/api/analyze/route.ts` no longer shows an unconditional hard-code (flag must come from cache peek / outcome)
- [ ] No out-of-scope files modified
- [ ] `plans/README.md` 002 status DONE

## STOP conditions

- Drift vs excerpts at `76c4698`.
- Batch route shares the bug and fixing it requires large batch redesign — report separately; do not silently expand scope without operator OK.
- Cache peek and `runAnalysis` disagree on hit/miss (race) — use a single source of truth and report if unavoidable TOCTOU on concurrent requests.
- Verification fails twice.

## Maintenance notes

- Any new analyze event type must update `lib/domain/types.ts` + `runtime-safety` sanitizers together — this plan should not need new types.
- Reviewers: confirm miss path still streams signals progressively (not only at end).
- Deferred: UI badge for “cached” if product wants it later (`use-scan-stream` currently ignores `event.cached`).
