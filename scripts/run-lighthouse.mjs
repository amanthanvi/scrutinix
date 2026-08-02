import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const HOST = "127.0.0.1";
const PORT = "3000";
const BASE_URL = `http://${HOST}:${PORT}/`;
const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const OUTPUT_DIR = path.join(process.cwd(), ".lighthouseci");
const CONFIG_PATH = path.join(process.cwd(), "lighthouserc.json");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const server = spawn(
  npmCommand,
  ["run", "start", "--", "--hostname", HOST, "--port", PORT],
  {
    env: process.env,
    stdio: "inherit",
  },
);

let cleanedUp = false;
let chrome;

const cleanup = async () => {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;

  if (chrome) {
    try {
      chrome.kill();
    } catch {
      // Ignore shutdown failures from the local Chrome process.
    }
  }

  if (!server.killed) {
    server.kill("SIGTERM");
  }
};

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

server.once("exit", (code) => {
  if (!cleanedUp) {
    console.error(
      `Lighthouse server exited unexpectedly with code ${code ?? "unknown"}.`,
    );
    process.exit(code ?? 1);
  }
});

await waitForServer();

const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
const chromePath = process.env.CHROME_PATH?.trim() || undefined;
chrome = await launch({
  chromePath,
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
});

const runnerResult = await lighthouse(
  BASE_URL,
  {
    port: chrome.port,
    logLevel: "error",
    output: "json",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
  },
  undefined,
);

if (!runnerResult?.report || !runnerResult.lhr) {
  await cleanup();
  throw new Error("Lighthouse did not return a report.");
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const reportPath = path.join(OUTPUT_DIR, `lhr-${Date.now()}.json`);
await fs.writeFile(reportPath, runnerResult.report, "utf8");

const failures = [];

for (const [assertionKey, [level, options]] of Object.entries(
  config.ci.assert.assertions,
)) {
  const categoryId = assertionKey.replace("categories:", "");
  const actual = runnerResult.lhr.categories[categoryId]?.score ?? 0;
  const minScore = options.minScore ?? 0;

  console.log(
    `${categoryId}: ${actual.toFixed(2)} (minimum ${minScore.toFixed(2)}, ${level})`,
  );

  if (actual < minScore && level === "error") {
    failures.push(
      `${categoryId} score ${actual.toFixed(2)} fell below ${minScore.toFixed(2)}`,
    );
  }
}

console.log(`Saved Lighthouse report to ${reportPath}`);

await cleanup();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }

  process.exit(1);
}

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < TIMEOUT_MS) {
    try {
      const response = await fetch(BASE_URL, {
        method: "HEAD",
        headers: {
          accept: "text/html",
        },
        signal: AbortSignal.timeout(2_000),
      });

      if (response.ok) {
        return;
      }
    } catch {
      // The server is still booting.
    }

    await sleep(POLL_INTERVAL_MS);
  }

  await cleanup();
  throw new Error(`Timed out waiting for ${BASE_URL} after ${TIMEOUT_MS}ms.`);
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
