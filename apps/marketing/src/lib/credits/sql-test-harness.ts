// @input  -- MARKETING_TEST_DATABASE_URL pointing at a disposable loopback database
// @output -- a pg Client on a schema rebuilt from the marketing migrations
// @pos    -- the only place marketing SQL is executed outside production

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const migrationsDir = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url),
);

/**
 * The same rule the product integration suite enforces. A test that can reach a
 * non-loopback host, or a database whose name is not obviously disposable, is
 * one typo away from dropping a schema that matters.
 */
export function assertDisposable(url: string): void {
  const parsed = new URL(url);
  // URL keeps the brackets on an IPv6 host, so "::1" alone never matches.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(`refusing a non-loopback test database host: ${host}`);
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!/^signalframe_(ci|e2e|codex)/.test(database)) {
    throw new Error(
      `refusing test database "${database}": the name must start with signalframe_ci, signalframe_e2e, or signalframe_codex`,
    );
  }
}

/**
 * Reproduce Supabase's roles as Supabase actually provisions them.
 *
 * Getting this wrong makes the permission tests pass for the wrong reason. A
 * bare `create role service_role` has no table privileges and no BYPASSRLS, so
 * every direct-table probe is denied whether or not the migration revoked
 * anything — a missing revoke would look exactly like a present one. Supabase
 * gives service_role BYPASSRLS and ALL on public (that is how the existing
 * waitlist route writes through PostgREST at all), so the test database has to
 * as well before "the ledger cannot be written around" means anything.
 */
const ROLE_SETUP = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase hands every role ALL on tables in public through ALTER DEFAULT
-- PRIVILEGES, so the grant lands as each table is created. Emulating it with a
-- blanket GRANT after the migrations would instead undo the migration's own
-- revoke and hide the very thing the test exists to prove.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;`;

function requireTestDatabaseUrl(): string {
  const url = process.env.MARKETING_TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "MARKETING_TEST_DATABASE_URL is required. Example: MARKETING_TEST_DATABASE_URL=postgres://$(whoami)@127.0.0.1:5432/signalframe_ci_credits pnpm test:sql:marketing",
    );
  }
  assertDisposable(url);
  return url;
}

/**
 * Every credits function runs `set timezone = 'UTC'`, so a test session on a
 * different zone is comparing two different calendars.
 *
 * On a machine in UTC+8 between local midnight and 08:00, a fixture that stages
 * `daily_granted_on = current_date - 1` writes the date the RPC still calls
 * today, the grant is correctly refused, and the suite fails for eight hours a
 * day and passes for sixteen. Pinning the session removes the wall clock from
 * the answer instead of teaching each fixture to subtract an offset.
 */
async function pinSessionToUtc(client: Client): Promise<void> {
  await client.query("set time zone 'UTC'");
}

/** Drops and rebuilds `public`, then applies every marketing migration in order. */
export async function connectFreshMarketingSchema(): Promise<Client> {
  const client = new Client({ connectionString: requireTestDatabaseUrl() });
  await client.connect();
  await pinSessionToUtc(client);
  await client.query("drop schema if exists public cascade");
  await client.query("create schema public");
  await client.query(ROLE_SETUP);

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.query(readFileSync(`${migrationsDir}/${file}`, "utf8"));
  }
  return client;
}

/**
 * A second connection, so a test can prove two transactions really race.
 * Goes through the same guard: a helper that skips it is a hole in the guard.
 */
export async function openConcurrentClient(): Promise<Client> {
  const client = new Client({ connectionString: requireTestDatabaseUrl() });
  await client.connect();
  await pinSessionToUtc(client);
  return client;
}
