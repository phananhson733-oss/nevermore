import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Flat ESLint config for the monorepo. Next 16 dropped built-in `next lint`, so
 * lint runs standalone via `pnpm lint`. Type-aware rules are intentionally not
 * enabled (fast, no per-package project wiring); tsc handles type correctness.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.next-*/**",
      "**/.next-e2e-mock/**",
      "**/.next-e2e-real/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.swc/**",
      "**/*.config.{js,mjs,ts}",
      "apps/marketing/src/app/.well-known/workflow/**",
      "packages/contracts/src/generated/**",
      "apps/web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already resolves identifiers; no-undef produces false positives
      // on DOM/Node globals in .ts files.
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
