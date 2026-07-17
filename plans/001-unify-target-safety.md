# Plan 001: Unify TargetSafety across URL validation, probes, and DNS

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
> 2. `git diff --stat 76c4698..HEAD -- lib/domain/url.ts lib/server/public-network-target.ts lib/server/signals/dns.ts lib/server/signals/ssl.ts lib/server/signals/redirect-chain.ts tests/unit/url.test.ts tests/unit/public-network-target.test.ts`
>    If any in-scope file changed since this plan was written, compare the file changed since this plan was written, compare the
>    "Current state" excerpts against the live code before proceeding; on a
>    mismatch, treat it as a STOP condition.
>
> **Written against:** `76c4698`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `76c4698`, 2026-07-17
- **Maps to**: Advisory findings 1–2; SBP-01 (NEXT-SSRF-001); SBP-02 (NEXT-SSRF-001 info disclosure); architecture deepen “TargetSafety”

## Why this matters

Request validation (`normalizeUrlInput`) uses a narrow private-IP blocklist. Active probes (`assertPublicNetworkTarget`) use a broader Node `BlockList` (CGNAT, TEST-NET, multicast, reserved IPv6, embedded IPv4-in-IPv6, etc.). Literal reserved hosts such as `100.64.0.1` or `192.0.2.1` can pass URL validation and still drive VirusTotal / GSB / Hugging Face / DNS outbound work while SSL and redirect refuse them. Separately, the DNS signal returns resolved private/reserved addresses to clients — split-horizon / internal recon via NDJSON. One shared TargetSafety module closes both gaps with a single blocked-address implementation.

## Current state

### Files and roles

- `lib/domain/url.ts` — client/server URL normalize + weak literal private check (`isPrivateHostname` / `isPrivateIpv4` / `isPrivateIpv6`)
- `lib/server/public-network-target.ts` — post-DNS probe guard used by SSL + redirect; broader `BlockList`; exports `isBlockedNetworkAddress`, `assertPublicNetworkTarget`, dead `selectPublicProbeAddress`
- `lib/server/signals/dns.ts` — DNS enrichment; returns raw A/AAAA (and literal IP) addresses with **no** block filter
- `lib/server/signals/ssl.ts` / `redirect-chain.ts` — call `assertPublicNetworkTarget` before connecting
- `tests/unit/url.test.ts` — private/localhost reject cases (incomplete vs BlockList)
- `tests/unit/public-network-target.test.ts` — BlockList / embedded-IPv6 coverage (keep as exemplar)

### Weaker URL validation (SBP-01)

```108:155:lib/domain/url.ts
export function isPrivateHostname(hostname: string) {
  if (PRIVATE_HOSTS.has(hostname) || hostname.endsWith(".local")) {
    return true;
  }

  const ipVersion = getIpVersion(hostname);

  if (ipVersion === 4) {
    return isPrivateIpv4(hostname);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(hostname);
  }

  return false;
}

function isPrivateIpv4(hostname: string) {
  // ... only 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16
}

function isPrivateIpv6(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}
```

### Stronger probe policy (keep as source of truth for ranges)

```22:56:lib/server/public-network-target.ts
const blockedRanges = new BlockList();

for (const [range, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  // ... TEST-NET, CGNAT, multicast, reserved ...
] as const) {
  blockedRanges.addSubnet(range, prefix, "ipv4");
}

for (const [range, prefix] of [
  ["::", 128],
  ["::1", 128],
  // ... ULA, link-local, multicast, documentation ...
] as const) {
  blockedRanges.addSubnet(range, prefix, "ipv6");
}
```

```101:118:lib/server/public-network-target.ts
export function isBlockedNetworkAddress(address: string) {
  const normalized = normalizeHostname(address);
  const ipVersion = isIP(normalized);
  // checks BlockList + embedded IPv4-in-IPv6
  // ...
}
```

### DNS leak (SBP-02)

```59:104:lib/server/signals/dns.ts
  const addressList = unique([
    ...(ipv4Addresses.status === "fulfilled" ? ipv4Addresses.value : []),
    ...(ipv6Addresses.status === "fulfilled" ? ipv6Addresses.value : []),
  ]);
  // ...
  return {
    subjectType: "hostname",
    addresses: addressList,
    // ... no isBlockedNetworkAddress filter
  };
```

Literal-IP path also returns `addresses: [hostname]` unchecked (lines 18–40).

### Conventions to match

- Result-style `{ ok: true | false, error?: string }` already used by `normalizeUrlInput` and `assertPublicNetworkTarget` — keep that shape.
- Never log raw URLs server-side (`lib/server/logger.ts` `hashUrlForLogs` / `createSafeLogContext`).
- Do not reintroduce `middleware.ts`; keep `proxy.ts` untouched in this plan.
- AGENTS.md: “Sanitize and normalize URLs once, centrally. Never duplicate validation logic.”
- Prefer deleting duplicate range lists over keeping two sources of truth.
- Dead export `selectPublicProbeAddress` (lines 162–166 in `public-network-target.ts`, zero callers) — safe to delete as part of this unify (also listed in advisory simplify fix-now).

### Gap examples (must reject after this plan)

Literal hosts that **currently pass** `normalizeUrlInput` but **fail** `assertPublicNetworkTarget`:

| Input                  | Why blocked by probe policy |
| ---------------------- | --------------------------- |
| `http://100.64.0.1`    | CGNAT 100.64.0.0/10         |
| `http://192.0.2.1`     | TEST-NET-1 192.0.2.0/24     |
| `http://198.51.100.1`  | TEST-NET-2                  |
| `http://203.0.113.1`   | TEST-NET-3                  |
| `http://224.0.0.1`     | multicast 224.0.0.0/4       |
| `http://[2001:db8::1]` | documentation IPv6          |

## Commands you will need

| Purpose                                                                                                           | Command                                                                                      | Expected on success |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------- |
| Drift                                                                                                             | `git status --porcelain                                                                      |
| git diff --stat 76c4698..HEAD -- lib/domain/url.ts lib/server/public-network-target.ts lib/server/signals/dns.ts` | empty or reviewed                                                                            |
| Unit (URL + probe + new DNS)                                                                                      | `npm run test:unit -- --run tests/unit/url.test.ts tests/unit/public-network-target.test.ts` | exit 0              |
| Unit all                                                                                                          | `npm run test:unit -- --run`                                                                 | exit 0              |
| Integration                                                                                                       | `npm run test:integration -- --run`                                                          | exit 0              |
| Typecheck                                                                                                         | `npm run typecheck`                                                                          | exit 0              |
| Lint                                                                                                              | `npm run lint`                                                                               | exit 0              |

## Suggested executor toolkit

- Prefer Node `net.BlockList` + `isIP` (already used) over hand-rolled octet checks.
- Model new DNS unit tests after `tests/unit/public-network-target.test.ts` (mock `node:dns/promises`).

## Scope

**In scope** (the only files you should modify / create):

- `lib/domain/url.ts` — delegate literal IP/hostname checks to shared blocked-address helper
- `lib/server/public-network-target.ts` — become (or export from) the single BlockList owner; delete dead `selectPublicProbeAddress` if still unused
- Optionally create `lib/server/target-safety.ts` **or** `lib/domain/target-safety.ts` if a clean shared module is clearer than circular imports — pick one module; do not leave two BlockLists
- `lib/server/signals/dns.ts` — filter / redact blocked addresses before returning `DNSData`
- `tests/unit/url.test.ts` — add reserved/CGNAT/TEST-NET cases
- `tests/unit/public-network-target.test.ts` — keep green; adjust imports if module moves
- `tests/unit/dns-signal.test.ts` (create) — private address redaction
- `plans/README.md` — status row only

**Out of scope**:

- Shared DNS resolve cache across dns/ssl/redirect (finding 12)
- SignalRegistry deepen
- Rate-limit / Next bump (plan 004)
- CSP (plan 006)
- Changing `DNSData` public field names (keep `addresses`; may be empty or redacted — document via `observations`/`anomalies`)
- Client UI components
- Error-message sanitization for `scan_error` (finding 7)

## Git workflow

- Branch: `advisor/001-unify-target-safety`
- Commit style (from recent history): short imperative / conventional, e.g. `security: unify target safety for URL and DNS`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Choose module home and single BlockList

Pick one of these shapes (prefer A if import graph stays clean):

- **A (preferred):** Keep BlockList in `lib/server/public-network-target.ts`. Export `isBlockedNetworkAddress` (already exported). From `lib/domain/url.ts`, call a thin shared helper that does **not** pull Node DNS — either move pure address checks to `lib/domain/blocked-address.ts` (no DNS) and import that from both `url.ts` and `public-network-target.ts`, or duplicate only the pure check module once.
- **B:** New `lib/domain/target-safety.ts` owning pure `isBlockedNetworkAddress` + hostname specials (localhost, `.local`); `public-network-target.ts` imports it for probe assert; `url.ts` imports it for `normalizeUrlInput`.

**Hard requirement:** exactly one BlockList / range table. `isPrivateIpv4` / `isPrivateIpv6` hand rolls must be deleted or reduced to wrappers that call the shared checker.

Also keep hostname specials currently in URL validation:

- `localhost`, `0.0.0.0`, `::1`
- `*.local`

**Verify**: `npm run typecheck` → exit 0 after the module compiles (even before call-site switch if you add the file first).

### Step 2: Wire `normalizeUrlInput` to shared checker

In `lib/domain/url.ts`, replace `isPrivateHostname` body so literal IPs use `isBlockedNetworkAddress` (or domain equivalent). Keep user-facing error string:

`"Private, localhost, and internal network URLs are not allowed."`

Do not change the `UrlValidationResult` type.

**Verify**:

```bash
npm run test:unit -- --run tests/unit/url.test.ts
```

→ existing tests pass. Then add cases (Step 4).

### Step 3: Redact blocked addresses in DNS signal

In `lib/server/signals/dns.ts`:

1. Import `isBlockedNetworkAddress` from the unified module.
2. After building `addressList` (hostname path) and for literal IP path:
   - Split into `publicAddresses` vs `blockedAddresses` using `isBlockedNetworkAddress`.
   - Set `addresses` to **public only**.
   - If any blocked addresses were filtered, push an observation or anomaly that states private/reserved addresses were omitted (do **not** include the raw private IP values in the client payload).
3. For literal IP subject where the IP itself is blocked: still return a structured DNS result (subjectType `"ip"`), but with `addresses: []` (or omit the blocked literal) and an observation that the address was redacted — do not invent a malicious verdict from redaction alone.

**Verify**: create `tests/unit/dns-signal.test.ts` (Step 4) and run it.

### Step 4: Expand unit tests

**`tests/unit/url.test.ts`** — add expectations that these are rejected (`ok === false`):

- `http://100.64.0.1`
- `http://192.0.2.1`
- `http://198.51.100.1`
- `http://203.0.113.1`
- `http://224.0.0.1`
- `http://[2001:db8::1]` (or without brackets per URL parser — use whatever `normalizeUrlInput` accepts)

Keep existing 127.0.0.1 / 192.168 / localhost cases.

**`tests/unit/dns-signal.test.ts`** (new) — model after `public-network-target.test.ts`:

- Mock `resolve4`/`resolve6` (and related) from `node:dns/promises`.
- When resolution returns `192.168.1.20` + a public IP, assert `addresses` contains only the public IP and that observations/anomalies mention redaction without echoing `192.168.1.20`.
- Literal private IP URL path: assert no private address string appears in returned `addresses`.

**`tests/unit/public-network-target.test.ts`** — must still pass; update import path if module split.

**Verify**:

```bash
npm run test:unit -- --run tests/unit/url.test.ts tests/unit/public-network-target.test.ts tests/unit/dns-signal.test.ts
```

→ exit 0

### Step 5: Delete dead `selectPublicProbeAddress` if still unused

```bash
# PowerShell
rg "selectPublicProbeAddress" --glob "*.{ts,tsx}"
```

If only the definition remains, delete the export. Keep `selectPublicProbeAddresses` if still used by ssl/redirect.

**Verify**: `npm run typecheck` → exit 0

### Step 6: Full verification

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run
npm run test:integration -- --run
```

All exit 0.

Update `plans/README.md` status for 001 → DONE.

## Test plan

| Case                                                        | File                                       | Assert                             |
| ----------------------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| CGNAT / TEST-NET / multicast literals rejected at normalize | `tests/unit/url.test.ts`                   | `ok === false`                     |
| Existing private/localhost still rejected                   | same                                       | unchanged                          |
| Probe BlockList behavior unchanged                          | `tests/unit/public-network-target.test.ts` | all pass                           |
| DNS hostname resolution with private A record               | `tests/unit/dns-signal.test.ts`            | private IP absent from `addresses` |
| DNS literal private IP                                      | same                                       | no private IP in payload           |
| No regression on analyze routes                             | `npm run test:integration -- --run`        | all pass                           |

Structural pattern: `tests/unit/public-network-target.test.ts` for DNS mocks; `tests/unit/url.test.ts` for normalize cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test:unit -- --run` exits 0 including new DNS tests and expanded URL tests
- [ ] `npm run test:integration -- --run` exits 0
- [ ] `rg "function isPrivateIpv4" lib/` returns no matches (hand-rolled IPv4 private checker gone or only re-exports shared)
- [ ] `rg "selectPublicProbeAddress" --glob "*.{ts,tsx}"` returns no matches (or only if still used — then leave it)
- [ ] `normalizeUrlInput("http://100.64.0.1").ok === false` covered by unit test
- [ ] DNS unit test proves blocked addresses are not present in `addresses`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 001 updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- Current-state excerpts no longer match (drift since `76c4698`).
- Domain ↔ server import creates a circular dependency that cannot be broken without touching out-of-scope packages — report and propose the pure `lib/domain/blocked-address.ts` split.
- UI or verdict logic appears to require private addresses for correctness — report; do not silently re-expose private IPs.
- A step’s verification fails twice after a reasonable fix attempt.
- Fix appears to require changing NDJSON event shapes beyond DNS payload contents.

## Maintenance notes

- Any new reserved range must be added **once** in the BlockList owner module; URL validation and probes inherit automatically.
- Reviewers should scrutinize: (1) no private IPs in client-bound DNS payloads, (2) user-facing reject message quality, (3) no accidental block of public NAT64 embeddings that today’s tests allow (`64:ff9b::808:808`).
- Deferred: DNS resolve caching (finding 12); SignalRegistry deepen.
- Follow-up for architecture: TargetSafety is the seam for `assertScannableUrl` (sync) + `assertProbeTarget` (async) naming if a later rename clarifies intent — optional, not required here.
