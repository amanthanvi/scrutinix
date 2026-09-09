import { spawnSync } from "node:child_process";

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

// Advisories reviewed and accepted. Each entry silences exactly the advisory
// it names -- any other finding at or above THRESHOLD still fails the gate.
// The gate also fails when an entry stops matching a real advisory, so an
// exception cannot outlive the finding it was written for.
const ACCEPTED_ADVISORIES = [
  {
    id: "GHSA-vwc7-r8mq-g2x9",
    package: "adm-zip",
    reviewed: "2026-09-09",
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
const stale = ACCEPTED_ADVISORIES.filter((entry) => !advisories.has(entry.id));

for (const advisory of accepted) {
  const entry = acceptedById.get(advisory.id);
  console.log(
    `accepted  ${advisory.severity.padEnd(8)} ${advisory.id}  ${advisory.package}`,
  );
  console.log(`          reviewed ${entry.reviewed}: ${advisory.title}`);

  if (hasNonBreakingFix(advisory.fixAvailable)) {
    console.log(
      "          note: a non-breaking fix is now available -- this " +
        "exception may be removable.",
    );
  }
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

for (const entry of stale) {
  console.error(
    `STALE     ${entry.id} (${entry.package}) no longer matches any advisory.`,
  );
  console.error(
    "          Remove it from ACCEPTED_ADVISORIES in scripts/audit-gate.mjs.",
  );
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `\nnpm audit reported ${counts.total ?? 0} package entries ` +
    `(${advisories.size} distinct advisories); threshold is ${THRESHOLD}.`,
);

if (unexpected.length > 0 || stale.length > 0) {
  console.error(
    `\nAudit gate failed: ${unexpected.length} unreviewed advisory(ies) at or ` +
      `above ${THRESHOLD}, ${stale.length} stale exception(s).`,
  );
  process.exit(1);
}

console.log(`Audit gate passed with ${accepted.length} reviewed exception(s).`);

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

function hasNonBreakingFix(fixAvailable) {
  if (fixAvailable === true) {
    return true;
  }

  return (
    typeof fixAvailable === "object" &&
    fixAvailable !== null &&
    fixAvailable.isSemVerMajor === false
  );
}

function rank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}
