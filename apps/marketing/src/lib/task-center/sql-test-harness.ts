// @input  -- MARKETING_TEST_DATABASE_URL pointing at a disposable loopback database; psql on PATH
// @output -- a pg Client on a task_center schema rebuilt by the real migrate.sh
// @pos    -- the only place task center SQL runs outside production
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

// Relative, not `@/`: the root Vitest alias maps `@/` to apps/web.
import { assertDisposable } from "../credits/sql-test-harness.ts";

export const migrateScript = fileURLToPath(
  new URL("../../../db/tasks/migrate.sh", import.meta.url),
);

export function requireTaskTestDatabaseUrl(): string {
  const url = process.env.MARKETING_TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "MARKETING_TEST_DATABASE_URL is required. Example: MARKETING_TEST_DATABASE_URL=postgres://$(whoami)@127.0.0.1:5432/signalframe_ci_task_center pnpm test:sql:marketing",
    );
  }
  assertDisposable(url);
  return url;
}

/** Runs migrate.sh against the test database and returns what it printed. */
export function runMigrations(script = migrateScript): string {
  return execFileSync(script, {
    env: { ...process.env, TASKS_DATABASE_URL: requireTaskTestDatabaseUrl() },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Drops only `task_center`, never `public`, so this suite and the credits
 * suite can share one database: the marketing-sql project runs files one at
 * a time, and each rebuilds only its own schema.
 */
export async function connectFreshTaskSchema(): Promise<Client> {
  const client = new Client({ connectionString: requireTaskTestDatabaseUrl() });
  await client.connect();
  // Production is UTC; a session on the laptop's zone would read dates differently.
  await client.query("set time zone 'UTC'");
  await client.query("drop schema if exists task_center cascade");
  runMigrations();
  return client;
}
