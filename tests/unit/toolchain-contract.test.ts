import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function major(version: string): number {
  const match = version.match(/\d+/);
  if (!match) {
    throw new Error(`Missing major version in ${version}.`);
  }
  return Number(match[0]);
}

describe("Node toolchain contract", () => {
  it("keeps runtime, engine, and typings on Node 24", () => {
    const root = process.cwd();
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      allowScripts: { "onnxruntime-node": boolean };
      engines: { node: string };
      devDependencies: { "@types/node": string };
    };
    const typesPackage = JSON.parse(
      readFileSync(require.resolve("@types/node/package.json"), "utf8"),
    ) as { version: string };
    const nvmVersion = readFileSync(join(root, ".nvmrc"), "utf8").trim();

    expect({
      onnxInstaller: packageJson.allowScripts["onnxruntime-node"],
      engine: major(packageJson.engines.node),
      nvm: major(nvmVersion),
      runtime: major(process.versions.node),
      types: major(typesPackage.version),
    }).toEqual({
      onnxInstaller: true,
      engine: 24,
      nvm: 24,
      runtime: 24,
      types: 24,
    });
  });
});
