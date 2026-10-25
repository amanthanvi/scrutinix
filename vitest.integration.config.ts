import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const config = defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
      // The marker throws outside the react-server condition; tests run the
      // server modules directly, as Next does on the server.
      "server-only": path.join(rootDir, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup/env.ts", "./tests/setup/msw.ts"],
  },
});

export default config;
