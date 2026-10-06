import { readFileSync, statSync } from "node:fs";
import path from "node:path";

// Guards the hand-maintained outputFileTracingIncludes in next.config.ts.
// transformers loads onnxruntime-node through createRequire(), which file
// tracing cannot follow, so a broken include only shows up in production as
// a silent fallback to lexical heuristics. And on linux-x64 the onnxruntime
// postinstall downloads ~250MB of CUDA providers beside the CPU binaries, so
// an over-broad include fails the Vercel deploy on size instead.
// Run after `npm run build`.

const ROUTES = ["api/analyze", "api/analyze/batch"];
const REQUIRED = [
  "onnxruntime-node/dist/index.js",
  "onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node",
  "onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1",
  "onnxruntime-common/dist/cjs/index.js",
  "lib/server/ml/model/onnx/model_quantized.onnx",
];
const FORBIDDEN = /libonnxruntime_providers_/;
// Vercel's uncompressed function limit, minus headroom for the runtime layer.
const MAX_BYTES = 220 * 1024 * 1024;

const problems = [];

for (const route of ROUTES) {
  const manifest = path.join(".next/server/app", `${route}/route.js.nft.json`);
  const base = path.dirname(manifest);
  const files = [...new Set(JSON.parse(readFileSync(manifest, "utf8")).files)];

  for (const required of REQUIRED) {
    if (!files.some((file) => file.endsWith(required))) {
      problems.push(`${route}: missing ${required}`);
    }
  }

  for (const file of files.filter((entry) => FORBIDDEN.test(entry))) {
    problems.push(`${route}: ships GPU provider ${path.basename(file)}`);
  }

  let bytes = 0;
  for (const file of files) {
    const stats = statSync(path.join(base, file), { throwIfNoEntry: false });
    if (stats?.isFile()) bytes += stats.size;
  }
  const megabytes = (bytes / 1024 / 1024).toFixed(1);
  if (bytes > MAX_BYTES) {
    problems.push(`${route}: traced files total ${megabytes}MB`);
  }
  console.log(`${route}: ${files.length} traced files, ${megabytes}MB`);
}

if (problems.length > 0) {
  console.error(problems.map((problem) => `- ${problem}`).join("\n"));
  console.error("Function trace check failed; see next.config.ts.");
  process.exit(1);
}

console.log("Function trace check passed.");
