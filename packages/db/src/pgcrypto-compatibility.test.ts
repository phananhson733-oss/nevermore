import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LATEST_APP_MIGRATION } from "./migration-version.ts";

const migrationSql = readFileSync(
  new URL(
    "../migrations/0031_pgcrypto_digest_compatibility.sql",
    import.meta.url,
  ),
  "utf8",
);
const migrateCheck = readFileSync(
  new URL("./migrate-check.ts", import.meta.url),
  "utf8",
);
const smokeSql = readFileSync(
  new URL("../migrations/schema-smoke.sql", import.meta.url),
  "utf8",
);

function occurrences(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

describe("0031 pgcrypto digest compatibility", () => {
  it("adapts only the Supabase extensions layout without moving the managed extension", () => {
    expect(migrationSql).toMatch(
      /FROM\s+pg_catalog\.pg_extension\s+extension_row[\s\S]*?JOIN\s+pg_catalog\.pg_namespace\s+extension_namespace[\s\S]*?extension_row\.extname\s*=\s*'pgcrypto'/iu,
    );
    expect(migrationSql).toMatch(
      /IF\s+pgcrypto_schema\s*=\s*'extensions'\s+THEN/iu,
    );
    expect(migrationSql).toMatch(
      /ELSIF\s+pgcrypto_schema\s*=\s*'public'\s+THEN/iu,
    );
    expect(migrationSql).not.toMatch(
      /ALTER\s+EXTENSION\s+pgcrypto\s+SET\s+SCHEMA/iu,
    );
    expect(migrationSql).not.toMatch(
      /(?:UPDATE|DELETE\s+FROM)\s+pg_catalog\.pg_extension/iu,
    );
    expect(migrationSql).toContain(
      "SELECT '0031_pgcrypto_digest_compatibility'::text AS migration_version",
    );
  });

  it("creates both hardened public overloads and delegates through exact qualified signatures", () => {
    expect(migrationSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.digest\s*\(\s*data\s+bytea,\s*algorithm\s+text\s*\)/iu,
    );
    expect(migrationSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.digest\s*\(\s*data\s+text,\s*algorithm\s+text\s*\)/iu,
    );
    expect(
      occurrences(migrationSql, /\bSECURITY\s+INVOKER\b/giu),
    ).toBe(2);
    expect(
      occurrences(migrationSql, /\bSET\s+search_path\s*=\s*pg_catalog\b/giu),
    ).toBe(2);
    expect(
      occurrences(
        migrationSql,
        /SELECT\s+extensions\.digest\s*\(\s*\$1,\s*\$2\s*\)/giu,
      ),
    ).toBe(2);
    expect(migrationSql).not.toMatch(/\bSECURITY\s+DEFINER\b/iu);
    expect(migrationSql).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.digest\s*\(\s*bytea,\s*text\s*\)\s+FROM\s+PUBLIC/iu,
    );
    expect(migrationSql).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.digest\s*\(\s*text,\s*text\s*\)\s+FROM\s+PUBLIC/iu,
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(migrationSql).toContain(`'${role}'`);
    }
  });

  it("keeps migration check and schema smoke fail-closed on signatures, privileges, and runtime resolution", () => {
    for (const source of [migrateCheck, smokeSql]) {
      expect(source).toContain("public.digest(bytea,text)");
      expect(source).toContain("public.digest(text,text)");
      expect(source).toContain("prosecdef");
      expect(source).toContain("has_function_privilege");
      expect(source).toContain("anon");
      expect(source).toContain("authenticated");
      expect(source).toContain("service_role");
    }

    expect(smokeSql).toMatch(
      /SET\s+LOCAL\s+search_path\s*=\s*"\$user",\s*public[\s\S]*?digest\s*\(\s*convert_to\s*\([\s\S]*?digest\s*\(\s*'signalframe-pgcrypto-compat'/iu,
    );
    expect(smokeSql).toContain(
      "6bc55c2be22e768cdca86865ec8f910f2d81e10ffdea5fb3a4610240b52473ae",
    );
    expect(smokeSql).toContain(
      `IS DISTINCT FROM '${LATEST_APP_MIGRATION}'`,
    );
  });
});
