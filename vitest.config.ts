import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const webSrc = fileURLToPath(new URL("./apps/web/src", import.meta.url));

/**
 * The web app uses the `@/*` -> apps/web/src alias; no other package uses `@`.
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
    projects: [
      {
        resolve: { alias: [...webAlias] },
        test: {
          name: "unit",
          include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            "**/*.integration.test.ts",
            "**/.next/**",
          ],
          environment: "node",
        },
      },
      {
        resolve: { alias: [...webAlias] },
        test: {
          name: "integration",
          include: [
            "packages/**/*.integration.test.ts",
            "apps/**/*.integration.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/.next/**"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Integration files share one real Postgres and run DDL / role changes
          // (migrations, REVOKE, SET ROLE). Running files concurrently races on
          // the shared schema, so integration runs one file at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
