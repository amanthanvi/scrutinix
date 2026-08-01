import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "dist/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // warn/error are legitimate degradation channels; anything chattier
      // must go through lib/server/logger.ts.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: true },
      ],
    },
  },
  {
    // The structured logger writes JSON lines to stdout by design.
    files: ["lib/server/logger.ts"],
    rules: { "no-console": "off" },
  },
];

export default config;
