import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { appendFileSync, writeFileSync } from "node:fs";

import semver from "semver";

// `npm audit --audit-level=moderate` cannot express "everything at moderate
// except this one reviewed advisory", so it forces a choice between a
// permanently red gate and raising the threshold and losing moderate coverage
// entirely. This gate keeps the moderate threshold and narrows the exception
// to specific advisory IDs instead.
const THRESHOLD = "moderate";
const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

// How long before `expires` the gate starts warning. The warning window plus
// the weekly scheduled run means an expiry is surfaced repeatedly, in an
// issue, well before it can turn main red.
const EXPIRY_WARNING_DAYS = 30;

// An exception may be renewed indefinitely, but never granted for longer than
// this at a stretch. Without a ceiling the review requirement is bypassed by
// typing a distant date once.
const MAX_EXCEPTION_DAYS = 180;

const REGISTRY_TIMEOUT_MS = 10_000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

// Every exception must carry all of these. `main` runs before any `const`
// declared further down initializes, so this has to live above it.
const REQUIRED_FIELDS = ["id", "package", "reviewed", "expires", "reason"];

// Advisories reviewed and accepted. Each entry silences exactly the advisory
// it names -- any other finding at or above THRESHOLD still fails the gate.
//
// An exception cannot rot, because three separate conditions retire it:
//   1. It stops matching a real advisory      -> STALE
//   2. A fixed version is published           -> FIXABLE
//   3. `expires` passes without a re-review   -> EXPIRED
const ACCEPTED_ADVISORIES = [
  {
    id: "GHSA-vwc7-r8mq-g2x9",
    package: "adm-zip",
    reviewed: "2026-09-09",
    expires: "2026-12-08",
    reason:
      "Reached only through onnxruntime-node, which uses adm-zip to unpack " +
      "its own native binaries at install time. No attacker-controlled " +
      "archive reaches adm-zip on the request path, so the symlink " +
      "traversal is not exposed by the scan pipeline. There is no patched " +
      "release to move to (0.6.0 is the latest publish and sits inside the " +
      "affected range), and @huggingface/transformers pins onnxruntime-node " +
      "exactly, so npm's only offered fix is a breaking downgrade to " +
      "@huggingface/transformers 3.8.1 -- which would trade a working ONNX " +
      "classifier for an install-time issue.",
  },
];

await main();

async function main() {
  // A malformed exception must never fail open. An unparsable or absent
  // `expires` would otherwise read as "no expiry" and silently switch off the
  // review requirement -- the exact rot this mechanism exists to prevent.
  const today = startOfUtcDay(new Date());
  const configProblems = validateExceptions(today);

  if (configProblems.length > 0) {
    for (const problem of configProblems) {
      console.error(`CONFIG    ${problem}`);
    }
    console.error(
      "\nAudit gate failed: ACCEPTED_ADVISORIES in scripts/audit-gate.mjs " +
        "is malformed.",
    );
    process.exit(1);
  }

  const report = runAudit();
  const advisories = collectAdvisories(report);

  const acceptedById = new Map(
    ACCEPTED_ADVISORIES.map((entry) => [entry.id, entry]),
  );

  const blocking = [...advisories.values()].filter(
    (advisory) => rank(advisory.severity) >= rank(THRESHOLD),
  );

  const unexpected = blocking.filter(
    (advisory) => !acceptedById.has(advisory.id),
  );
  const accepted = blocking.filter((advisory) => acceptedById.has(advisory.id));

  // An accepted entry that no longer matches anything means the advisory was
  // withdrawn, downgraded, or fixed. Fail so the exception gets deleted.
  const stale = ACCEPTED_ADVISORIES.filter(
    (entry) => !advisories.has(entry.id),
  );

  const expired = [];
  const expiringSoon = [];

  for (const entry of ACCEPTED_ADVISORIES) {
    const daysLeft = daysUntil(entry.expires, today);

    if (daysLeft === null) {
      continue;
    }
    if (daysLeft < 0) {
      expired.push({ entry, daysLeft });
    } else if (daysLeft <= EXPIRY_WARNING_DAYS) {
      expiringSoon.push({ entry, daysLeft });
    }
  }

  // npm computes `fixAvailable` against this project's own constraints, so an
  // exact `overrides` pin makes npm report "no fix" forever even after a
  // patched version ships. Ask the registry directly instead, and compare
  // published versions against the advisory's own vulnerable range.
  const fixable = [];
  const registrySkips = [];

  for (const advisory of accepted) {
    const outcome = await findPublishedFix(advisory);

    if (outcome.skipped) {
      registrySkips.push({ advisory, reason: outcome.reason });
    } else if (outcome.version) {
      fixable.push({ advisory, version: outcome.version });
    }
  }

  const failed =
    unexpected.length > 0 ||
    stale.length > 0 ||
    expired.length > 0 ||
    fixable.length > 0;

  render({
    accepted,
    acceptedById,
    unexpected,
    stale,
    expired,
    expiringSoon,
    fixable,
    registrySkips,
    advisories,
    report,
    failed,
  });

  process.exit(failed ? 1 : 0);
}

function render(state) {
  const {
    accepted,
    acceptedById,
    unexpected,
    stale,
    expired,
    expiringSoon,
    fixable,
    registrySkips,
    advisories,
    report,
    failed,
  } = state;

  const fixableById = new Map(
    fixable.map((item) => [item.advisory.id, item.version]),
  );

  for (const advisory of accepted) {
    const entry = acceptedById.get(advisory.id);
    const daysLeft = daysUntil(entry.expires, startOfUtcDay(new Date()));

    console.log(
      `accepted  ${advisory.severity.padEnd(8)} ${advisory.id}  ${advisory.package}`,
    );
    console.log(`          reviewed ${entry.reviewed}: ${advisory.title}`);
    console.log(
      `          expires ${entry.expires ?? "(never)"}` +
        (daysLeft === null ? "" : ` (${daysLeft} day(s) left)`),
    );
  }

  for (const advisory of unexpected) {
    console.error(
      `BLOCKING  ${advisory.severity.padEnd(8)} ${advisory.id}  ${advisory.package}`,
    );
    console.error(`          ${advisory.title}`);
    if (advisory.range) {
      console.error(`          affected range: ${advisory.range}`);
    }
    if (advisory.url) {
      console.error(`          ${advisory.url}`);
    }
  }

  for (const { advisory, version } of fixable) {
    console.error(
      `FIXABLE   ${advisory.id} (${advisory.package}) has a published fix: ${version}.`,
    );
    console.error(
      `          ${advisory.package}@${version} is outside the vulnerable ` +
        `range ${advisory.range || "(unreported)"}.`,
    );
    console.error(
      "          Take the fix, then delete the exception from " +
        "ACCEPTED_ADVISORIES in scripts/audit-gate.mjs.",
    );
    console.error(
      `          If an "overrides" entry pins ${advisory.package}, raise it ` +
        "-- an exact pin blocks the upgrade and hides it from npm audit.",
    );
  }

  for (const entry of stale) {
    console.error(
      `STALE     ${entry.id} (${entry.package}) no longer matches any advisory.`,
    );
    console.error(
      "          Remove it from ACCEPTED_ADVISORIES in scripts/audit-gate.mjs.",
    );
  }

  for (const { entry, daysLeft } of expired) {
    console.error(
      `EXPIRED   ${entry.id} (${entry.package}) lapsed on ${entry.expires} ` +
        `(${Math.abs(daysLeft)} day(s) ago).`,
    );
    console.error(
      "          Re-read the rationale. If it still holds, set a new " +
        "`reviewed` and `expires` date in scripts/audit-gate.mjs. " +
        "If it does not, remove the exception and fix the dependency.",
    );
  }

  for (const { entry, daysLeft } of expiringSoon) {
    console.log(
      `EXPIRING  ${entry.id} (${entry.package}) is due for re-review by ` +
        `${entry.expires} (${daysLeft} day(s) left).`,
    );
  }

  for (const { advisory, reason } of registrySkips) {
    // Not fatal: the audit itself already ran and passed its own fail-closed
    // check. This lookup only ever *adds* failures, so being unable to reach
    // the registry cannot weaken the gate -- it just cannot strengthen it.
    console.log(
      `NOTICE    could not check the registry for a ${advisory.package} fix ` +
        `(${reason}).`,
    );
  }

  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(
    `\nnpm audit reported ${counts.total ?? 0} package entries ` +
      `(${advisories.size} distinct advisories); threshold is ${THRESHOLD}.`,
  );

  if (failed) {
    console.error(
      `\nAudit gate failed: ${unexpected.length} unreviewed, ` +
        `${fixable.length} fixable, ${stale.length} stale, ` +
        `${expired.length} expired.`,
    );
  } else {
    console.log(
      `Audit gate passed with ${accepted.length} reviewed exception(s).`,
    );
  }

  publishReport({
    accepted,
    acceptedById,
    unexpected,
    stale,
    expired,
    expiringSoon,
    fixable,
    fixableById,
    failed,
  });
}

// Findings only reach a human if they leave the log. Write a run summary to
// the Actions UI, and -- when anything needs attention -- a report file the
// scheduled workflow turns into a tracking issue.
function publishReport(state) {
  const {
    accepted,
    acceptedById,
    unexpected,
    stale,
    expired,
    expiringSoon,
    fixable,
    failed,
  } = state;

  const needsAttention =
    failed || expiringSoon.length > 0 || unexpected.length > 0;

  const lines = [];

  if (failed) {
    lines.push("## Audit gate failed");
  } else if (needsAttention) {
    lines.push("## Audit gate passed — action needed soon");
  } else {
    lines.push("## Audit gate passed");
  }
  lines.push("");

  for (const advisory of unexpected) {
    lines.push(
      `- **Unreviewed** \`${advisory.id}\` (${advisory.package}, ` +
        `${advisory.severity}) — ${advisory.title}`,
    );
  }

  for (const { advisory, version } of fixable) {
    lines.push(
      `- **Fix published** \`${advisory.id}\` — ${advisory.package}@${version} ` +
        "is outside the vulnerable range. Take the fix and delete the " +
        "exception. If an `overrides` entry pins this package, raise it too.",
    );
  }

  for (const entry of stale) {
    lines.push(
      `- **Stale exception** \`${entry.id}\` (${entry.package}) matches no ` +
        "advisory. Remove it.",
    );
  }

  for (const { entry, daysLeft } of expired) {
    lines.push(
      `- **Expired** \`${entry.id}\` (${entry.package}) lapsed on ` +
        `${entry.expires}, ${Math.abs(daysLeft)} day(s) ago. Re-review, then ` +
        "either renew the dates or remove the exception.",
    );
  }

  for (const { entry, daysLeft } of expiringSoon) {
    lines.push(
      `- **Due for re-review** \`${entry.id}\` (${entry.package}) by ` +
        `${entry.expires} (${daysLeft} day(s) left).`,
    );
  }

  if (accepted.length > 0) {
    lines.push("");
    lines.push("<details><summary>Accepted advisories</summary>");
    lines.push("");
    for (const advisory of accepted) {
      const entry = acceptedById.get(advisory.id);
      lines.push(`**\`${advisory.id}\`** — ${advisory.package}`);
      lines.push("");
      lines.push(
        `Reviewed ${entry.reviewed}, expires ${entry.expires ?? "(never)"}.`,
      );
      lines.push("");
      lines.push(entry.reason);
      lines.push("");
    }
    lines.push("</details>");
  }

  const body = `${lines.join("\n")}\n`;

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  }

  if (process.env.AUDIT_GATE_REPORT && needsAttention) {
    writeFileSync(process.env.AUDIT_GATE_REPORT, body);
  }
}

// npm reports one entry per affected package, so a single advisory shows up
// several times down a dependency chain. Only object entries in `via` are
// real advisories; string entries just name the package that pulled it in.
function collectAdvisories(auditReport) {
  const found = new Map();

  for (const vulnerability of Object.values(auditReport.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === "string") {
        continue;
      }

      const id = advisoryId(via);
      if (!found.has(id)) {
        found.set(id, {
          id,
          package: via.name ?? via.dependency ?? vulnerability.name,
          severity: via.severity ?? vulnerability.severity ?? "info",
          title: via.title ?? "(no title reported)",
          url: typeof via.url === "string" ? via.url : "",
          range: typeof via.range === "string" ? via.range : "",
          fixAvailable: vulnerability.fixAvailable,
        });
      }
    }
  }

  return found;
}

// Returns the lowest published version that escapes the advisory's vulnerable
// range, or a `skipped` marker when the registry cannot be consulted.
async function findPublishedFix(advisory) {
  if (process.env.AUDIT_GATE_SKIP_REGISTRY === "1") {
    return { skipped: true, reason: "AUDIT_GATE_SKIP_REGISTRY=1" };
  }

  if (!advisory.range || !semver.validRange(advisory.range)) {
    return { skipped: true, reason: "advisory reported no usable range" };
  }

  const installed = installedVersion(advisory.package);
  let document;

  try {
    const registry = (
      process.env.npm_config_registry ?? DEFAULT_REGISTRY
    ).replace(/\/+$/, "");
    const response = await fetch(
      `${registry}/${advisory.package.split("/").map(encodeURIComponent).join("/")}`,
      {
        headers: {
          // Abbreviated metadata: far smaller, and still carries `deprecated`.
          accept: "application/vnd.npm.install-v1+json",
        },
        signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      return { skipped: true, reason: `registry returned ${response.status}` };
    }

    document = await response.json();
  } catch (error) {
    return { skipped: true, reason: error.message };
  }

  if (typeof document?.versions !== "object" || document.versions === null) {
    return { skipped: true, reason: "registry document had no versions map" };
  }

  const candidates = Object.entries(document.versions)
    .filter(([version, meta]) => {
      if (!semver.valid(version) || semver.prerelease(version)) {
        return false;
      }
      // A deprecated publish is not a fix worth moving to.
      if (meta?.deprecated) {
        return false;
      }
      // Still inside the vulnerable range: not a fix.
      if (semver.satisfies(version, advisory.range)) {
        return false;
      }
      // Older than what is installed: a downgrade, which npm already offers
      // and which this gate exists to avoid recommending blindly.
      return installed === null || semver.gt(version, installed);
    })
    .map(([version]) => version);

  if (candidates.length === 0) {
    return { version: null };
  }

  return { version: candidates.sort(semver.compare)[0] };
}

function installedVersion(packageName) {
  try {
    const require = createRequire(import.meta.url);
    return require(`${packageName}/package.json`).version ?? null;
  } catch {
    return null;
  }
}

function runAudit() {
  // Prefer the npm that invoked this script so the gate does not depend on
  // `npm` being on PATH or on the platform's shim naming.
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : "npm";
  const args = npmExecPath
    ? [npmExecPath, "audit", "--json"]
    : ["audit", "--json"];

  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: auditEnv(),
  });

  if (result.error) {
    console.error(`Could not run npm audit: ${result.error.message}`);
    process.exit(1);
  }

  // npm audit exits non-zero whenever it finds anything, so the exit status
  // says nothing about whether the run succeeded. Valid JSON on stdout does.
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    console.error("npm audit did not return parsable JSON.");
    if (result.stderr.trim()) {
      console.error(result.stderr.trim());
    }
    process.exit(1);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !parsed.vulnerabilities
  ) {
    console.error(
      "npm audit JSON is missing a `vulnerabilities` map; refusing to pass.",
    );
    process.exit(1);
  }

  return parsed;
}

// npm exports its resolved config to child processes as npm_config_* vars.
// This project declares `allowScripts` in package.json, which surfaces as
// npm_config_allow_scripts and makes a nested npm reject the run outright
// with EALLOWSCRIPTS. Drop it so the audit child starts from clean config.
function auditEnv() {
  const env = { ...process.env };

  for (const key of Object.keys(env)) {
    if (/^npm_config_allow[-_]scripts$/i.test(key)) {
      delete env[key];
    }
  }

  return env;
}

function advisoryId(via) {
  const url = typeof via.url === "string" ? via.url : "";
  const slug = url.split("/").filter(Boolean).pop();

  if (slug && /^GHSA-/i.test(slug)) {
    return slug;
  }

  return via.source != null
    ? `npm:${via.source}`
    : `unknown:${via.name ?? "?"}`;
}

function rank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

function validateExceptions(todayUtcMs) {
  const problems = [];
  const seen = new Set();

  for (const [index, entry] of ACCEPTED_ADVISORIES.entries()) {
    const where = entry?.id ?? `entry #${index + 1}`;

    for (const field of REQUIRED_FIELDS) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        problems.push(`${where}: \`${field}\` is missing or empty.`);
      }
    }

    if (seen.has(entry?.id)) {
      problems.push(`${where}: duplicate entry.`);
    }
    seen.add(entry?.id);

    for (const field of ["reviewed", "expires"]) {
      const value = entry?.[field];
      // Absence is already reported above; do not say it twice.
      if (
        typeof value === "string" &&
        value.trim() !== "" &&
        !parseIsoDate(value)
      ) {
        problems.push(
          `${where}: \`${field}\` must be a real YYYY-MM-DD date, got ` +
            `"${entry[field]}".`,
        );
      }
    }

    const expiresMs = parseIsoDate(entry?.expires);
    if (expiresMs !== null) {
      const days = Math.round((expiresMs - todayUtcMs) / 86_400_000);
      if (days > MAX_EXCEPTION_DAYS) {
        problems.push(
          `${where}: \`expires\` is ${days} days out; the maximum is ` +
            `${MAX_EXCEPTION_DAYS}. Renew the exception on a shorter cycle ` +
            "rather than extending it once.",
        );
      }
    }
  }

  return problems;
}

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Strict on purpose: `Date.parse` is lenient enough to accept shapes that a
// typo can slip through, and a date this gate misreads is a review that
// silently never happens.
function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return null;
  }

  // Rejects rolled-over dates such as 2026-02-30.
  if (new Date(parsed).toISOString().slice(0, 10) !== value) {
    return null;
  }

  return parsed;
}

function daysUntil(isoDate, todayUtcMs) {
  const parsed = parseIsoDate(isoDate);

  if (parsed === null) {
    return null;
  }

  return Math.round((parsed - todayUtcMs) / 86_400_000);
}
