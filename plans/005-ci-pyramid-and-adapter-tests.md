# Plan 005: Close CI pyramid and add DNS/GSB adapter tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 76c4698..HEAD -- .github/workflows/ci.yml package.json tests/unit lib/server/signals/dns.ts lib/server/providers/google-safe-browsing.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Written against:** `76c4698`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (can parallelize with 001–004; if 001 adds `dns-signal.test.ts`, reuse/extend it rather than duplicating)
- **Category**: tests
- **Planned at**: commit `76c4698`, 2026-07-17
- **Maps to**: Advisory findings 8–9; DX format gate from README/SPEC quality bar

## Why this matters

README and SPEC describe a full quality bar (format check, unit, integration, E2E smoke, build, lighthouse). CI at HEAD only runs audit, lint, typecheck, unit, integration, build — so format drift and broken Playwright smoke can merge. Separately, there are no unit tests for the DNS signal or Google Safe Browsing adapter, so reputation/enrichment regressions stay silent.

## Current state

### CI workflow (incomplete vs README)

```33:48:.github/workflows/ci.yml
      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Unit tests
        run: npm run test:unit -- --run

      - name: Integration tests
        run: npm run test:integration -- --run

      - name: Build
        run: npm run build
```

Missing vs README Quality Bar:

```115:122:README.md
npm run lint
npm run format -- --check .
npm run typecheck
npm run test:unit -- --run
npm run test:integration -- --run
npm run test:e2e -- --grep @smoke
npm run build
```

### Scripts

```27:37:package.json
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier",
    "test:unit": "vitest --config vitest.unit.config.ts",
    "test:integration": "vitest --config vitest.integration.config.ts",
    "test:e2e": "npm run build && node ./scripts/run-e2e.mjs",
    "lighthouse": "node ./scripts/run-lighthouse.mjs"
```

### Existing unit coverage (no DNS / GSB)

Present under `tests/unit/`: `url`, `public-network-target`, `virustotal-provider`, `ml-ensemble`, `whois`, `ssl-signal`, `redirect-chain`, etc.

Absent: `*dns*`, `*google-safe-browsing*`.

### GSB provider (query-key is by design — do not “fix”)

```23:25:lib/server/providers/google-safe-browsing.ts
  const response = await fetchWithTimeout(
    `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
```

Tests must mock `fetch` / `fetchWithTimeout` and **never** print real API keys. Use `resetEnvForTests` + `vi.stubEnv` like `tests/unit/virustotal-provider.test.ts`.

### E2E smoke tags already exist

`tests/e2e/app.smoke.spec.ts` and `tests/e2e/accessibility.smoke.spec.ts` use `@smoke` in titles. CI should run:

```bash
npm run test:e2e -- --grep @smoke
```

Note: `test:e2e` already runs `build` first — CI already builds; accept double-build or adjust script later. Prefer calling the existing npm script for consistency unless CI time is intolerable — if so, STOP and propose invoking Playwright without rebuild only after confirming `scripts/run-e2e.mjs` supports it.

### Conventions

- Deterministic fixtures; mock providers; no live third-party calls (AGENTS.md).
- Model provider tests after `tests/unit/virustotal-provider.test.ts`.
- Model DNS tests after `tests/unit/public-network-target.test.ts` / `ssl-signal.test.ts`.
- Do not use `next lint`; ESLint via `npm run lint`.
- Lighthouse: **scheduled or workflow_dispatch only** in this plan — not required on every PR (SPEC lists it; advisory says scheduled). Optional second workflow file is OK.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Format | `npm run format -- --check .` | exit 0 |
| Unit | `npm run test:unit -- --run` | exit 0 |
| Integration | `npm run test:integration -- --run` | exit 0 |
| E2E smoke | `npm run test:e2e -- --grep @smoke` | exit 0 |
| Lint / typecheck / build | `npm run lint` / `typecheck` / `build` | exit 0 |

## Scope

**In scope**:

- `.github/workflows/ci.yml` — add format check + e2e smoke
- Optional `.github/workflows/lighthouse.yml` (schedule / workflow_dispatch) — not on every PR
- `tests/unit/dns-signal.test.ts` (create, or extend if plan 001 already created it)
- `tests/unit/google-safe-browsing-provider.test.ts` (create)
- `plans/README.md` status

**Out of scope**:

- Fixing unrelated Prettier drift across the whole repo beyond what format check requires (if format check fails massively, run `npm run format -- --write .` in a dedicated commit — still in scope as “make CI green”)
- SBP-08 vite/ws bumps
- Changing Playwright browser install strategy beyond what `scripts/run-e2e.mjs` already does
- Expanding e2e beyond `@smoke`

## Git workflow

- Branch: `advisor/005-ci-pyramid-and-adapter-tests`
- Commit example: `ci: add format and e2e smoke; test DNS and GSB adapters`
- Do NOT push/PR unless instructed

## Steps

### Step 1: Add format gate to CI

In `.github/workflows/ci.yml`, after Install (or after Lint), add:

```yaml
      - name: Format
        run: npm run format -- --check .
```

Locally ensure it passes:

```bash
npm run format -- --check .
```

If it fails, run `npm run format -- --write .` and include formatting fixes in this plan’s commits (formatting-only churn is acceptable here).

**Verify**: format check exit 0.

### Step 2: Add E2E smoke to CI

Add a job step after Build **or** a separate job that needs the build artifact. Simplest:

```yaml
      - name: E2E smoke
        run: npm run test:e2e -- --grep @smoke
```

Ensure Playwright browsers are installed — read `scripts/run-e2e.mjs` and existing docs; if CI needs:

```yaml
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
```

place it before e2e (only if the script doesn’t install them). Inspect the script first; do not guess.

Bind hosts to `127.0.0.1` if the script already does (AGENTS.md). Do not change that without cause.

**Verify** locally if feasible:

```bash
npm run test:e2e -- --grep @smoke
```

→ exit 0. If local browsers missing, install once; if environment cannot run browsers, still add the CI step and note local skip in the report — CI is the gate.

### Step 3: Optional Lighthouse workflow

Create `.github/workflows/lighthouse.yml` with `workflow_dispatch` + `schedule` (e.g. weekly). Do **not** block PRs on Lighthouse in this plan.

**Verify**: workflow YAML is valid enough to open (no need to run Lighthouse in executor env if Chrome missing).

### Step 4: DNS adapter unit tests

Create/extend `tests/unit/dns-signal.test.ts`:

- Mock `node:dns/promises` resolve helpers.
- Happy path: public A/AAAA → appear in `addresses`.
- Empty records → observation about no A/AAAA/CNAME.
- Punycode hostname → anomaly.
- If plan 001 redaction exists, assert private IPs omitted; if not yet, still test current behavior honestly and add a comment that 001 will tighten assertions.

**Verify**:

```bash
npm run test:unit -- --run tests/unit/dns-signal.test.ts
```

### Step 5: Google Safe Browsing adapter unit tests

Create `tests/unit/google-safe-browsing-provider.test.ts` modeled on VirusTotal tests:

1. Missing `GOOGLE_SAFE_BROWSING_API_KEY` → throws configured/skip-style error (match actual provider behavior).
2. Mock fetch returning `{ matches: [...] }` → parsed threat types.
3. Mock fetch returning `{}` / no matches → empty matches list / clean data shape per provider return type.
4. Non-OK HTTP → throws with status.

Use fake key `gsb-test-key` via `vi.stubEnv`. Assert the request URL contains `threatMatches:find` but **do not** snapshot full URLs with keys into logs carelessly — asserting `u.includes("key=")` is enough without printing.

**Verify**:

```bash
npm run test:unit -- --run tests/unit/google-safe-browsing-provider.test.ts
```

### Step 6: Full verification

```bash
npm run lint
npm run format -- --check .
npm run typecheck
npm run test:unit -- --run
npm run test:integration -- --run
npm run build
```

Run e2e smoke if the environment allows.

Update `plans/README.md` 005 → DONE.

## Test plan

| Gap | Test |
|-----|------|
| Format drift | CI `format -- --check .` |
| Smoke regressions | CI `test:e2e -- --grep @smoke` |
| DNS enrichment | `tests/unit/dns-signal.test.ts` |
| GSB parsing / errors | `tests/unit/google-safe-browsing-provider.test.ts` |

## Done criteria

- [ ] `.github/workflows/ci.yml` runs `npm run format -- --check .`
- [ ] `.github/workflows/ci.yml` runs e2e `@smoke` (with Playwright install if required)
- [ ] `tests/unit/google-safe-browsing-provider.test.ts` exists and passes
- [ ] `tests/unit/dns-signal.test.ts` exists and passes (shared with 001 OK)
- [ ] `npm run test:unit -- --run` exits 0
- [ ] `npm run format -- --check .` exits 0
- [ ] No live network calls in new unit tests
- [ ] `plans/README.md` 005 DONE

## STOP conditions

- E2E cannot run on GitHub-hosted runners without undocumented secrets — report; prefer fixing `run-e2e.mjs` binding/`127.0.0.1` rather than deleting the gate.
- Format check requires reformatting thousands of generated files — exclude generated paths via Prettier config rather than disabling the gate; STOP if unclear which paths are generated.
- Plan 001 concurrently owns DNS tests with conflicting assertions — rebase and merge assertions rather than duplicating files.
- Verification fails twice.

## Maintenance notes

- Keep CI aligned with README Quality Bar when scripts change.
- Lighthouse stays scheduled to avoid flaky PR blockers.
- Reviewers: watch CI time (double `next build` from e2e script); optimize later if needed.
- Do not reintroduce PhishTank tests.
