import nextPlugin from "@next/eslint-plugin-next";
import jsxA11yX from "eslint-plugin-jsx-a11y-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactX from "eslint-plugin-react-x";
import globals from "globals";
import tseslint from "typescript-eslint";

const codeFiles = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const tsFiles = ["**/*.{ts,tsx,mts,cts}"];
const jsxFiles = ["**/*.{jsx,tsx}"];

const config = [
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "dist/**",
    ],
  },
  ...tseslint.configs.recommended.map((entry) => ({
    ...entry,
    files: tsFiles,
  })),
  {
    ...reactX.configs["recommended-typescript"],
    files: jsxFiles,
  },
  {
    ...jsxA11yX.configs.recommended,
    files: jsxFiles,
  },
  {
    files: codeFiles,
    plugins: {
      ...nextPlugin.configs["core-web-vitals"].plugins,
      ...reactHooks.configs.flat["recommended-latest"].plugins,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.flat["recommended-latest"].rules,
    },
  },
  {
    files: jsxFiles,
    rules: {
      // The official hooks plugin owns these overlapping checks.
      "react-x/error-boundaries": "off",
      "react-x/exhaustive-deps": "off",
      "react-x/purity": "off",
      "react-x/rules-of-hooks": "off",
      "react-x/set-state-in-effect": "off",
      "react-x/set-state-in-render": "off",
      "react-x/static-components": "off",
      "react-x/unsupported-syntax": "off",
      "react-x/use-memo": "off",
      // These are style migrations rather than correctness checks.
      "react-x/no-array-index-key": "off",
      "react-x/no-context-provider": "off",
      "react-x/no-use-context": "off",
    },
  },
  {
    files: tsFiles,
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
