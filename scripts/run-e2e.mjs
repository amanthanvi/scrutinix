import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const HOST = "127.0.0.1";
// E2E_PORT lets parallel worktrees run the suite side by side.
const PORT = process.env.E2E_PORT || "3000";
const BASE_URL = `http://${HOST}:${PORT}/`;
const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const playwrightCli = require.resolve("@playwright/test/cli");

// The e2e suite runs offline against deterministic fixtures by default
// (lib/server/test-fixtures.ts). Export SCRUTINIX_TEST_FIXTURES=0 to run
// the specs against the real providers instead.
const fixtures = (process.env.SCRUTINIX_TEST_FIXTURES ?? "1") === "1";
const childEnv = {
  ...process.env,
  E2E_PORT: PORT,
  SCRUTINIX_TEST_FIXTURES: fixtures ? "1" : "0",
  // The share-signing key, shared by the server and the specs
  // (tests/e2e/helpers.ts signs shared links with it). Fixture mode signs
  // only with this published, test-only key (lib/config/env.ts refuses any
  // other there, and refuses this one everywhere else), so a real key can
  // never sign fixture verdicts. Against real providers, a throwaway key
  // for this run. Never a real secret, and never reuse either.
  SHARE_SIGNING_SECRET: fixtures
    ? "e2e-only-share-signing-key-not-a-real-secret-0001"
    : randomBytes(32).toString("base64url"),
  SHARE_SIGNING_SECRET_PREVIOUS: "",
};

if (fixtures) {
  childEnv.UPSTASH_REDIS_REST_URL = "";
  childEnv.UPSTASH_REDIS_REST_TOKEN = "";
  childEnv.KV_REST_API_URL = "";
  childEnv.KV_REST_API_TOKEN = "";
}

// CI builds once in its own step and sets SKIP_BUILD=1.
if (process.env.SKIP_BUILD !== "1") {
  const build = spawnSync(process.execPath, [nextBin, "build"], {
    env: childEnv,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const server = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", HOST, "--port", PORT],
  {
    env: childEnv,
    stdio: "inherit",
  },
);

let cleanedUp = false;

const cleanup = () => {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  if (!server.killed) {
    server.kill("SIGTERM");
  }
};

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

server.once("exit", (code) => {
  if (!cleanedUp) {
    console.error(
      `E2E server exited unexpectedly with code ${code ?? "unknown"}.`,
    );
    process.exit(code ?? 1);
  }
});

await waitForServer();

const testRunner = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  {
    env: childEnv,
    stdio: "inherit",
  },
);

const testExitCode = await new Promise((resolve) => {
  testRunner.once("exit", (code) => {
    resolve(code ?? 1);
  });
});

cleanup();
process.exit(testExitCode);

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < TIMEOUT_MS) {
    try {
      const response = await fetch(BASE_URL, {
        method: "HEAD",
        headers: {
          accept: "text/html",
        },
        // Cap each poll so a stalled accept-without-response cannot outlive
        // the outer TIMEOUT_MS loop (OS socket timeouts can be ~75s).
        signal: AbortSignal.timeout(2_000),
      });

      if (response.ok || response.status >= 400) {
        return;
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }

  cleanup();
  throw new Error(`Timed out waiting for ${BASE_URL}`);
}
