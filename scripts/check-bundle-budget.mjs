import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

export function summarizeAssets(assets) {
  const scripts = assets.filter((asset) => asset.type === "script");
  const fonts = assets.filter((asset) => asset.type === "font");
  return {
    scripts: scripts.map(({ path, body }) => ({
      path,
      rawBytes: body.length,
      gzipBytes: gzipSync(body).length,
    })),
    scriptCount: scripts.length,
    jsRawBytes: scripts.reduce((total, asset) => total + asset.body.length, 0),
    jsGzipBytes: scripts.reduce(
      (total, asset) => total + gzipSync(asset.body).length,
      0,
    ),
    fontBytes: fonts.reduce((total, asset) => total + asset.body.length, 0),
  };
}

export function budgetFailures(measurement, budget) {
  return ["jsGzipBytes", "fontBytes"].flatMap((key) =>
    measurement[key] > budget[key]
      ? [
          `${key} grew to ${measurement[key]} bytes (budget ${budget[key]}, over by ${measurement[key] - budget[key]}).`,
        ]
      : [],
  );
}

async function main() {
  // Ask the OS for a free port; never attach to another worktree's server.
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { stdio: "ignore" },
  );
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null)
        throw new Error("Budget server exited before it was ready.");
      try {
        ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        /* Server is still starting. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("Budget server did not become ready.");
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || undefined,
    });
    const page = await browser.newPage();
    const assets = new Map();
    const pending = [];
    page.on("response", (response) => {
      const type = response.request().resourceType();
      if (!["script", "font"].includes(type)) return;
      pending.push(
        (async () => {
          if (!response.ok())
            throw new Error(`Failed ${type} response: ${response.status()}`);
          assets.set(response.url(), {
            path: new URL(response.url()).pathname,
            type,
            body: await response.body(),
          });
        })(),
      );
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await Promise.all(pending);
    const measurement = summarizeAssets([...assets.values()]);
    if (!measurement.scriptCount)
      throw new Error("No scripts measured; refusing an empty budget result.");
    console.log(JSON.stringify(measurement, null, 2));
    if (!process.argv.includes("--measure")) {
      const { bundleBudget } = JSON.parse(
        await readFile("package.json", "utf8"),
      );
      const failures = budgetFailures(measurement, bundleBudget);
      if (failures.length) throw new Error(failures.join("\n"));
    }
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
