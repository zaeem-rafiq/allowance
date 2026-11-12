import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The browser tests build into .next-test (playwright.config.ts sets ALLOWANCE_DIST_DIR).
    ".next-test/**",
    // Claude Code keeps tooling and other sessions' worktrees here; it holds no project source.
    ".claude/**",
  ]),
]);

export default eslintConfig;
