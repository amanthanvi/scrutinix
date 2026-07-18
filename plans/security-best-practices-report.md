# Security Best Practices Report — Scrutinix

**Repo:** `C:\Users\amant\Documents\GitHub\scrutinix`  
**Commit:** `76c4698` (`76c4698cb72f090fea04a6da2a3ca566efd988e4`)  
**Branch:** `main` (= `origin/main`, clean tree at audit time)  
**Date:** 2026-07-17  
**Stack:** TypeScript 5.9 · Next.js 16 App Router (Node runtime) · React 19 · Vitest/Playwright · Vercel-oriented deploy

**Skills / references:** `/security-best-practices` against  
`javascript-typescript-nextjs-web-server-security.md`,  
`javascript-typescript-react-web-frontend-security.md`,  
`javascript-general-web-frontend-security.md`.

**Companion plans:** see [`README.md`](./README.md). Finding → plan map:  
001←SBP-01/02 · 004←SBP-03/04 · 006←SBP-05/07 · SBP-06 deferred · SBP-08 out of product plans.

---

## Executive summary

Scrutinix has solid baseline controls: security headers (CSP, clickjacking defenses, nosniff), hashed URL logging, active-probe private-network blocking for SSL/redirect, Zod-backed client sanitization of stream/history JSON, and server-only provider secrets. The highest-leverage gaps are a **split private-network policy** (URL validation weaker than probe policy), **DNS signal leakage of private addresses**, **Next 16.2.4** sitting in a vulnerable release range that includes proxy/middleware bypass advisories (rate limit lives in `proxy.ts`), and **spoofable rate-limit identity** via the first `X-Forwarded-For` hop. Secondary hardening: production `script-src 'unsafe-inline'` and an over-broad browser `connect-src`.

**`/review-security` note:** Invoked with `Diff: branch changes` on this HEAD. Outcome: **empty review** — no commits ahead of `origin/main` and a clean working tree. Findings below are whole-repo SBP + correctness audit, not a PR delta review. Re-run `/review-security` after opening a feature branch or with `Diff: uncommitted changes`.

---

## Severity overview

| Severity | IDs                    |
| -------- | ---------------------- |
| High     | SBP-01, SBP-02, SBP-03 |
| Medium   | SBP-04, SBP-05, SBP-06 |
| Low      | SBP-07, SBP-08         |

---

## Positive controls (compliant / risk-accepted)

| Control                                                                                                             | Evidence                                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Security headers (CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, referrer policy)                 | `next.config.ts` lines 9–70                                                                       |
| No `dangerouslySetInnerHTML` / `innerHTML` / `eval` sinks in app code                                               | Repo grep at audit time (React default escaping)                                                  |
| Server logs hash URLs                                                                                               | `lib/server/logger.ts` — `hashUrlForLogs`, `createSafeLogContext`                                 |
| Active probes pin/block private targets after DNS                                                                   | `lib/server/public-network-target.ts` + usage in `lib/server/signals/ssl.ts`, `redirect-chain.ts` |
| Untrusted stream/history JSON sanitized at client boundary                                                          | `lib/domain/runtime-safety.ts`                                                                    |
| Only `NEXT_PUBLIC_APP_URL` public; provider keys server-side                                                        | `lib/config/env.ts`                                                                               |
| No cookie session auth → classic CSRF on cookie mutations largely N/A; analyze routes are same-origin `fetch` POSTs | Architecture / AGENTS.md                                                                          |
| CORS not enabled on API routes (Next default same-origin)                                                           | NEXT-CORS-001 OK                                                                                  |
| Rate limiting present for analyze routes                                                                            | `proxy.ts` + `lib/server/rate-limit.ts` (identity issue tracked as SBP-04)                        |
| In-memory rate-limit degrade when Redis missing                                                                     | Documented fail-open for deployability (by design; see rejected)                                  |

---

## Findings

### SBP-01 — High — NEXT-SSRF-001 — Split private-network policy

**Location:** `lib/domain/url.ts` ~108–155 vs `lib/server/public-network-target.ts` ~24–56, ~101–118

**Impact:** Request validation’s `isPrivateIpv4` / `isPrivateIpv6` cover classic RFC1918/loopback/link-local only. Probe policy uses a broader Node `BlockList` (CGNAT `100.64.0.0/10`, TEST-NET, multicast, documentation IPv6, embedded IPv4-in-IPv6, etc.). Literal reserved hosts can pass `normalizeUrlInput` and still drive VT / GSB / HF / DNS / WHOIS outbound work while SSL/redirect refuse them.

**Current evidence (weaker validator):**

```108:155:lib/domain/url.ts
export function isPrivateHostname(hostname: string) {
  // ...
  // isPrivateIpv4: 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16 only
  // isPrivateIpv6: ::1, fc/fd prefix, fe80: only
}
```

**Current evidence (stronger probe BlockList):**

```24:56:lib/server/public-network-target.ts
for (const [range, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  // ... TEST-NET, CGNAT, multicast, reserved ...
] as const) {
  blockedRanges.addSubnet(range, prefix, "ipv4");
}
```

**Remediation plan:** [`001-unify-target-safety.md`](./001-unify-target-safety.md)

---

### SBP-02 — High — NEXT-SSRF-001 (info disclosure) — DNS returns private addresses

**Location:** `lib/server/signals/dns.ts` ~59–104 (hostname path); literal IP path ~18–40

**Impact:** Resolved private/reserved A/AAAA records (and literal private IP subjects) are returned to clients in NDJSON `DNSData.addresses`, enabling split-horizon / internal network recon via the public analyzer API.

**Current evidence:**

```59:104:lib/server/signals/dns.ts
  const addressList = unique([
    ...(ipv4Addresses.status === "fulfilled" ? ipv4Addresses.value : []),
    ...(ipv6Addresses.status === "fulfilled" ? ipv6Addresses.value : []),
  ]);
  // ...
  return {
    subjectType: "hostname",
    addresses: addressList,
    // no isBlockedNetworkAddress filter
  };
```

**Remediation plan:** [`001-unify-target-safety.md`](./001-unify-target-safety.md)

---

### SBP-03 — High — Dependency / proxy bypass — Next 16.2.4

**Location:** `package.json` `next@16.2.4`; rate-limit matcher `proxy.ts` ~38–40

**Impact:** `npm audit` at audit time reported Next in range `16.0.0–16.2.5` with multiple GHSA entries, including Middleware/Proxy bypass via segment-prefetch (incomplete fix follow-up) and DoS classes. Analyze rate limiting is enforced only in `proxy.ts` for `/api/analyze/:path*`. A proxy bypass may skip that gate.

**Current evidence:**

```51:51:package.json
    "next": "16.2.4",
```

```38:40:proxy.ts
export const config = {
  matcher: ["/api/analyze/:path*"],
};
```

**Remediation plan:** [`004-next-bump-and-rate-limit-identity.md`](./004-next-bump-and-rate-limit-identity.md)

**Note:** Do not paste advisory HTML or exploit PoCs into the repo. Bump to a patched 16.2.x and re-run `npm audit`.

---

### SBP-04 — Medium — Rate-limit identity from first XFF hop

**Location:** `proxy.ts` ~11–12

**Impact:** Client-supplied `X-Forwarded-For` first hop used as limiter ID. If the edge does not overwrite/append trusted hops, attackers can rotate spoofed identities and bypass effective limits.

**Current evidence:**

```10:13:proxy.ts
async function enforceRateLimit(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const identifier = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
  const limit = await applyRateLimit(identifier);
```

**Remediation plan:** [`004-next-bump-and-rate-limit-identity.md`](./004-next-bump-and-rate-limit-identity.md)

---

### SBP-05 — Medium — NEXT-CSP-001 — Production `script-src 'unsafe-inline'`

**Location:** `next.config.ts` ~30–31

**Impact:** XSS containment weaker than nonce/hash-based CSP. Inline script injection (if ever achieved) is more likely to execute.

**Current evidence:**

```30:31:next.config.ts
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
```

**Remediation plan:** [`006-csp-nonce-and-connect-src.md`](./006-csp-nonce-and-connect-src.md) (after plan 004)

---

### SBP-06 — Medium — Error hygiene — raw exception messages to clients

**Location:** `app/api/analyze/route.ts` ~71–80; related signal/provider error strings streamed into history

**Impact:** Ops/provider detail leakage to browser and IndexedDB history via `scan_error` / signal `error` fields.

**Current evidence:**

```71:80:app/api/analyze/route.ts
    } catch (error) {
      writer.send({
        type: "scan_error",
        error: createApiError(
          "scan_failed",
          error instanceof Error
            ? error.message
            : "The scan failed unexpectedly.",
          true,
        ),
      });
    }
```

**Remediation:** Deferred from default plan set (ask to add). Prefer stable public codes + generic messages; log details server-side with hashed URL context only.

---

### SBP-07 — Low — CSP least-privilege — browser `connect-src` third parties

**Location:** `next.config.ts` ~16–22

**Impact:** Browser CSP allows connect to VT/GSB/URLHaus/OpenPhish/HF/RDAP though the client only needs `'self'` (`/api/*`). Unnecessary egress channel if XSS lands.

**Current evidence:**

```16:26:next.config.ts
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
```

**Remediation plan:** [`006-csp-nonce-and-connect-src.md`](./006-csp-nonce-and-connect-src.md)

---

### SBP-08 — Low — Tooling dependency advisories (vite / ws via Lighthouse tree)

**Location:** `npm audit` transitive via `lighthouse` / related dev tooling

**Impact:** Not on the production Next server runtime path for Scrutinix analyze; CI/local tooling risk only.

**Remediation:** Out of default product plans. Revisit when upgrading Lighthouse or pruning the audit tree; do not force-downgrade Lighthouse into breaking majors without a dedicated change.

---

## Rejected / by-design under SBP

| Topic                                       | Rationale                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GSB API key in query string                 | Google Lookup API v4 documents `?key=`; rotate keys + scrub logs; do not “fix” to a header without docs support |
| Redirect probes with relaxed TLS validation | Documented: SSL signal owns certificate truth (PLAN/AGENTS)                                                     |
| In-memory rate-limit when Redis missing     | Documented fail-open for deployability (not fail-closed)                                                        |
| No HSTS recommendation                      | SBP skill override: do not push HSTS without full understanding of HTTPS-only topology                          |
| `/review-security` empty diff               | Not a finding — no branch delta on `main` @ `76c4698`                                                           |

---

## Related correctness items (not formal SBP rule IDs)

Tracked in plans 002–003 and 005; included for traceability:

| Advisory # | Issue                                                          | Plan                                                                           |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 3          | Cache hits skip `signal_result` + lie about `cached`           | [`002-cache-hit-ndjson-contract.md`](./002-cache-hit-ndjson-contract.md)       |
| 4          | Stream hooks leave `isStreaming: true` on parse/network errors | [`003-stream-hook-error-recovery.md`](./003-stream-hook-error-recovery.md)     |
| 8–9        | CI ≠ pyramid; missing DNS/GSB unit tests                       | [`005-ci-pyramid-and-adapter-tests.md`](./005-ci-pyramid-and-adapter-tests.md) |

---

## Verification baseline at audit

Already solid at `76c4698`: `npm run lint` · `typecheck` · `test:unit -- --run` · `test:integration -- --run` · `build`. CI covers that subset in `.github/workflows/ci.yml`. Missing vs README/SPEC: format check, e2e smoke, lighthouse (plan 005).

**Not audited:** live Vercel proxy IP overwrite behavior, runtime CSP effectiveness in a real browser XSS scenario, every UI visual path, live Lighthouse numbers, production secret rotation.

---

## Report hygiene

- This file lives under `plans/` (not repo-root `security_best_practices_report.md`) so `/improve` plan hygiene and the SBP report coexist.
- Never reproduce secret values; env **names** only (`VIRUSTOTAL_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY`, `HUGGINGFACE_API_KEY`, `URLHAUS_AUTH_KEY`, Upstash/KV REST vars).
