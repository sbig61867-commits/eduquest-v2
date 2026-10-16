import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Isolated Playwright harness (playwright.local.config.ts): `use` there is
  // Playwright's fixture callback, not a React hook, and net-guard.cjs must stay
  // CommonJS because Node preloads it with --require.
  {
    files: ['tests-local/**'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  {
    files: ['tests-local/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
