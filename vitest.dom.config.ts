import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const config = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": rootDir,
      // The marker throws outside the react-server condition; tests run the
      // server modules directly, as Next does on the server.
      "server-only": path.join(rootDir, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/dom/**/*.test.{ts,tsx}"],
  },
});

export default config;
