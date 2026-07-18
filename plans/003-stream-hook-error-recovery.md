# Plan 003: Recover stream hooks on parse/network errors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> 1. `git status --porcelain` (fail if dirty staged/unstaged/untracked in scope)
> 2. `git diff --stat 76c4698..HEAD -- hooks/use-scan-stream.ts hooks/use-batch-stream.ts lib/client/ndjson.ts`
>    If any in-scope file changed since this plan was written, compare the file changed since this plan was written, compare the
>    "Current state" excerpts against the live code before proceeding; on a
>    mismatch, treat it as a STOP condition.
>
> **Written against:** `76c4698`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (pair with plan 002 if both land; no hard dependency)
- **Category**: bug
- **Planned at**: commit `76c4698`, 2026-07-17
- **Maps to**: Advisory finding 4

## Why this matters

`useScanStream` / `useBatchStream` set `isStreaming: true` then `await readNdjsonStream(...)`. On truncated/corrupt NDJSON or network failure, `JSON.parse` / reader errors are re-thrown after ignoring only `AbortError`. Nothing sets `isStreaming: false` or a user-facing `error`, so the loading UI sticks until a full page remount. Abort/cancel paths already clear the flag; parse/network paths must too.

## Current state

### Single-scan hook rethrows without clearing streaming

```125:134:hooks/use-scan-stream.ts
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }

        throw error;
      }
```

HTTP non-OK paths correctly set `isStreaming: false` (lines 67–78). `scan_error` / `scan_complete` also clear it. The gap is only the outer `catch`.

### Batch hook same pattern

```124:133:hooks/use-batch-stream.ts
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }

        throw error;
      }
```

### NDJSON reader throws on bad JSON

```23:28:lib/client/ndjson.ts
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      onEvent(JSON.parse(line));
    }
```

Do **not** change `readNdjsonStream` to swallow errors unless necessary — hooks should own UI state recovery. Optional hardening of ndjson is out of scope unless the hook fix alone is insufficient.

### Conventions

- Errors shown to users go through `sanitizeApiErrorResponse` / `ApiError` shapes (`lib/domain/runtime-safety.ts`, `lib/domain/types.ts`).
- Match the existing non-OK response handling style in the same hooks.
- Abort must remain silent (no error) with `isStreaming: false` — `cancelScan` / `cancelBatch` already do this; aborted catch should either return (as today) or also ensure `isStreaming: false` if abort races.

## Commands you will need

| Purpose                                   | Command                             | Expected on success |
| ----------------------------------------- | ----------------------------------- | ------------------- |
| Typecheck                                 | `npm run typecheck`                 | exit 0              |
| Lint                                      | `npm run lint`                      | exit 0              |
| Unit                                      | `npm run test:unit -- --run`        | exit 0              |
| E2E smoke (optional if unit covers hooks) | `npm run test:e2e -- --grep @smoke` | exit 0              |

## Suggested executor toolkit

- If the repo has no hook unit tests yet, prefer a small Vitest test with mocked `fetch` + a bad NDJSON body, colocated under `tests/unit/` (e.g. `tests/unit/use-scan-stream.test.ts`) using React Testing Library **only if already installed**. Check `package.json` — at `76c4698` there is **no** `@testing-library/react`. Therefore: either (1) extract a tiny pure helper for the catch recovery and unit-test that, or (2) add an integration-style test that doesn’t need RTL, or (3) manually verify with a focused node test of error→state mapping by exporting a helper.

**Preferred lazy approach:** do not add RTL. In the catch block, set state inline; add a unit test for `readNdjsonStream` throwing + document hook behavior; optionally extract:

```ts
export function streamFailureApiError(error: unknown): ApiError;
```

in the hook file or `lib/client/` and unit-test that + assert hooks call `setState` with `isStreaming: false` via a minimal pattern already used in the repo.

If adding hook tests is too heavy without RTL, STOP is not required — instead verify with typecheck/lint and a short manual checklist in the PR, **and** still implement the catch fix. Prefer at least one automated test that `JSON.parse` failures from `readNdjsonStream` propagate and that a new helper maps them to `ApiError`.

## Scope

**In scope**:

- `hooks/use-scan-stream.ts`
- `hooks/use-batch-stream.ts`
- Optional small helper under `lib/client/` if it keeps hooks thin
- Optional `tests/unit/*` for the helper / ndjson error path
- `plans/README.md` status

**Out of scope**:

- Changing NDJSON server writers
- Plan 002 cache contract (separate)
- Adding `@testing-library/react` as a new dependency (do not add)
- Redesigning batch `results[]` vs `items[].result` duplication (simplify list — skip)

## Git workflow

- Branch: `advisor/003-stream-hook-error-recovery`
- Commit example: `fix: clear streaming state on NDJSON failures`
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Fix `use-scan-stream` catch

Replace the rethrow path with state recovery:

```ts
} catch (error) {
  if (
    controller.signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    setState((previous) => ({
      ...previous,
      isStreaming: false,
    }));
    return;
  }

  const message =
    error instanceof Error && error.message
      ? error.message
      : "The scan stream failed unexpectedly.";

  setState((previous) => ({
    ...previous,
    isStreaming: false,
    error: sanitizeApiErrorResponse(
      null,
      // If sanitizeApiErrorResponse requires a payload object, match existing
      // non-OK usage: pass a synthetic shape or construct ApiError per types.
      message,
    ),
  }));
}
```

**Important:** Open `sanitizeApiErrorResponse` in `lib/domain/runtime-safety.ts` and match its real signature. At call sites today:

```ts
sanitizeApiErrorResponse(
  payload,
  `Scan request failed with status ${response.status}.`,
);
```

Reuse that. If you need a synthetic `ApiError`, use `createApiError` only if it is safe to import on the client — check whether `createApiError` lives in server-only code. Prefer constructing via the sanitizer with `{ error: { code, message, retryable } }` payload if that’s what the sanitizer expects.

Do **not** rethrow after setting state (that can trigger Next.js/React error overlays and still leave confusing UX). Swallow after recording error unless the project has an error boundary that must see it — for this app, recording into hook state is enough.

**Verify**: `npm run typecheck`

### Step 2: Fix `use-batch-stream` the same way

Mirror Step 1 with batch copy (`Batch request stream failed…`). Ensure `isStreaming: false` on both abort and failure.

**Verify**: `npm run typecheck`

### Step 3: Automated check

Minimum:

1. Add or extend a unit test that `readNdjsonStream` rejects/throws when given a Response body with a non-JSON line (if not already covered).
2. If feasible without new deps, test the error-mapping helper.

**Verify**:

```bash
npm run test:unit -- --run
```

### Step 4: Full verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run
```

Update `plans/README.md` 003 → DONE.

## Test plan

- Truncated/invalid NDJSON → hook ends with `isStreaming === false` and non-null `error` (manual or automated).
- Abort/cancel → `isStreaming === false`, no new error (or previous error preserved — match `cancelScan` behavior).
- Successful scan unchanged.
- Structural reference: existing non-OK handling in the same files (lines 67–78 single / 65–76 batch).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test:unit -- --run` exits 0
- [ ] In both hooks, the catch path that is not abort **must not** `throw error` unconditionally
- [ ] Both hooks set `isStreaming: false` on non-abort failures
- [ ] `rg "throw error" hooks/use-scan-stream.ts hooks/use-batch-stream.ts` shows no remaining bare rethrow in that catch (or only after state update if explicitly justified — prefer no throw)
- [ ] No new runtime dependencies
- [ ] `plans/README.md` 003 DONE

## STOP conditions

- `sanitizeApiErrorResponse` cannot express a client-side stream failure without server imports — report and propose a tiny client `ApiError` factory already used elsewhere.
- Drift since `76c4698`.
- Fix appears to require React error-boundary changes outside hooks.
- Verification fails twice.

## Maintenance notes

- Any future stream consumer (e.g. a third hook) must clear streaming flags in `finally` or `catch`.
- Reviewers: confirm abort still does not flash a scary error toast if the UI maps `error` to toasts — if it does, keep abort path error-free.
- Complements plan 002 (cache hits) but does not depend on it.
