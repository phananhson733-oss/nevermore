import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const webSrc = fileURLToPath(new URL("./apps/web/src", import.meta.url));

/**
 * `@/*` here means apps/web/src, and ONLY apps/web/src.
 *
 * apps/marketing declares the same specifier against its own `src` in its own
 * tsconfig, and one Vite alias table cannot hold two entries for one
 * specifier. So a marketing module reached through `@/` from a test resolves
 * into the web app and fails on a missing file. Marketing modules that need to
 * be importable from a unit test therefore import each other relatively; see
 * `components/tools/quick-wins-evidence-table.tsx`. Fixing this properly means
 * an importer-aware resolver or a second project, and both are their own
 * change.
 *
 * In Vitest 4 each entry in `test.projects` is its own Vite config and does NOT
 * inherit the root-level `resolve`, so the alias is applied per project.
 */
const webAlias = [{ find: /^@\/(.*)$/, replacement: `${webSrc}/$1` }] as const;

/**
 * Two projects:
 * - unit: pure logic, no external services. Runs in CI without a database.
 * - integration: requires a real Postgres (DATABASE_URL). Runs in `test:integration`.
 *
 * Integration files are named `*.integration.test.ts`; everything else `*.test.ts`.
 */
export default defineConfig({
  resolve: { alias: [...webAlias] },
  test: {
    passWithNoTests: true,
    coverage: {
      /**
       * The gate runs over BOTH projects at once (`vitest run --coverage`, no
       * `--project`), so it is measured on the `database` CI job that already
       * has Postgres and already runs the integration project.
       *
       * Why both: the question a coverage gate asks is "is this code tested?".
       * Measuring only `unit` answered a different question, because the tests
       * that verify the highest-risk behavior CANNOT be unit tests here. The
       * repository unit suite drives a `FakeExecutor` that only records what
       * `.where()` received, so a unit test for keyset pagination can assert
       * "we passed some drizzle expression object" and nothing more — the shape
       * of the implementation, never "paging loses and repeats no row". A gate
       * that only a non-assertable test can satisfy measures the wrong thing.
       *
       * The threshold stays at 80%. If this merge is ever reverted, the correct
       * response is to lower the threshold or narrow `include` AND record the
       * reason in an ADR — never to write mock-shaped assertions to clear it.
       *
       * Merging hides "this file has no unit test at all", so
       * `scripts/report-unit-coverage-gaps.mjs` prints that list as a
       * non-blocking CI step. Do not let the caliber fix become a fig leaf.
       */
      exclude: [
        // Drizzle's table/index callback declarations are exercised by the
        // migration/schema smoke and Postgres integration gates. Coverage here
        // measures repository/runtime behavior rather than those declarations.
        "packages/db/src/schema.ts",
        // Test harnesses and fixtures are test code, not product code. Only
        // three files match: `__tests__/{full-chain-harness,
        // current-diagnostic-fixture,project-archive-race}.ts`, which are
        // helper modules (not `*.test.ts`) and so were counted as product.
        "**/__tests__/**",
        // Repo tooling, not shipped product. `backup-restore-drill.mjs` alone
        // is 289 branches and already carries its own independent 80% branch
        // gate (`restore:drill:test` via `node --test-coverage-branches=80`),
        // so counting it here is double-scoring against a different suite.
        "scripts/**",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    projects: [
      {
        resolve: { alias: [...webAlias] },
        // The apps set `jsx: "preserve"` for Next's own compiler, which leaves
        // Vite's transformer handing raw JSX to import analysis. Without this a
        // `.test.tsx` file fails to parse rather than failing an assertion.
        oxc: { jsx: { runtime: "automatic" } },
        test: {
          name: "unit",
          include: [
            "packages/**/*.test.ts",
            "apps/**/*.test.ts",
            // `.tsx` too, or a component test is collected by nothing and
            // stays green by never running.
            "packages/**/*.test.tsx",
            "apps/**/*.test.tsx",
            // Root E2E harness logic is unit-tested without being collected by
            // Playwright, whose test matcher only includes *.spec / *.test.
            "e2e/**/*.vitest.ts",
          ],
          exclude: [
            "**/node_modules/**",
            "**/*.integration.test.ts",
            "**/*.integration.vitest.ts",
            "**/.next/**",
          ],
          environment: "node",
          // next-intl's ESM build imports the bare specifier "next/server",
          // which pnpm's isolated layout does not expose inside next-intl's own
          // directory. Inlining routes the import through Vite's resolver,
          // which finds it from the workspace root, so apps/marketing/src/
          // proxy.test.ts can drive the real locale middleware.
          server: { deps: { inline: ["next-intl"] } },
        },
      },
      {
        resolve: { alias: [...webAlias] },
        test: {
          name: "integration",
          include: [
            "packages/**/*.integration.test.ts",
            "apps/**/*.integration.test.ts",
            "e2e/**/*.integration.vitest.ts",
          ],
          exclude: ["**/node_modules/**", "**/.next/**"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 60_000,
          setupFiles: ["./packages/db/src/integration-test-setup.ts"],
          // Integration files share one real Postgres and run DDL / role changes
          // (migrations, REVOKE, SET ROLE). Running files concurrently races on
          // the shared schema, so integration runs one file at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
