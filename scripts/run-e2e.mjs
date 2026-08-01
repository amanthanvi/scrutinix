import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const HOST = "127.0.0.1";
const PORT = "3000";
const BASE_URL = `http://${HOST}:${PORT}/`;
const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const playwrightCli = require.resolve("@playwright/test/cli");

// CI builds once in its own step and sets SKIP_BUILD=1.
if (process.env.SKIP_BUILD !== "1") {
  const build = spawnSync(process.execPath, [nextBin, "build"], {
    env: process.env,
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
    env: process.env,
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
    env: process.env,
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
