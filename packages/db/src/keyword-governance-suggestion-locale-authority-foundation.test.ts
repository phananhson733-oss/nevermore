import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_APP_MIGRATION } from "./migration-version.ts";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../migrations/0053_keyword_governance_suggestion_locale_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const generationRunsRepository = readFileSync(
  fileURLToPath(
    new URL(
      "./repositories/keyword-governance-suggestion-generation-runs.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);

function replacedFunction(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return (
    migration.match(
      new RegExp(
        `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+app\\.${escapedName}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
        "iu",
      ),
    )?.[0] ?? ""
  );
}

describe("Keyword governance suggestion locale authority migration", () => {
  it("advances the forward-only head and replaces every persisted authority fence", () => {
    expect(LATEST_APP_MIGRATION).toBe(
      "0053_keyword_governance_suggestion_locale_authority",
    );
    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
    expect(migration).toContain(
      "SELECT '0053_keyword_governance_suggestion_locale_authority'::text",
    );
    expect(migration).toContain(
      "The SQL identity helper is not a BCP-47 canonicalizer",
    );
    expect(replacedFunction("is_bcp47_canonical_identity")).toBe("");

    for (const functionName of [
      "enforce_keyword_review_suggestion_mutation",
      "insert_keyword_review_suggestions_batch",
      "supersede_stale_pending_keyword_review_suggestions",
    ]) {
      const sql = replacedFunction(functionName);
      expect(sql, functionName).not.toBe("");
      expect(sql, functionName).toContain(
        "cardinality(primary_site.language_codes) = 1",
      );
      expect(sql, functionName).toContain(
        "app.is_bcp47_canonical_identity(",
      );
      expect(sql, functionName).toContain("primary_site.language_codes[1]");
      expect(sql, functionName).not.toContain("default_delivery_locale");
    }
    expect(migration).not.toContain("default_delivery_locale");

    const mutation = replacedFunction(
      "enforce_keyword_review_suggestion_mutation",
    );
    expect(mutation).toMatch(
      /IF\s+NEW\.status\s+IS\s+DISTINCT\s+FROM\s+'pending'[\s\S]*?cardinality\(primary_site\.language_codes\)\s*=\s*1[\s\S]*?app\.is_bcp47_canonical_identity\s*\(\s*primary_site\.language_codes\[1\],\s*generation_run\.input_manifest\s*->>\s*'languageTag'\s*\)/iu,
    );
  });

  it("keeps actual BCP-47 canonicalization in the server-owned freezer", () => {
    expect(generationRunsRepository).toMatch(
      /Intl\.getCanonicalLocales\(value\)[\s\S]*?languageTag\.toLowerCase\(\)\s*===\s*value\.toLowerCase\(\)/u,
    );
  });

  it("runs the final paid-batch authority CAS before any suggestion write", () => {
    const batch = replacedFunction("insert_keyword_review_suggestions_batch");
    const authorityCheck = batch.indexOf(
      "cardinality(primary_site.language_codes) = 1",
    );
    const staleAuthority = batch.indexOf(
      "RETURN jsonb_build_object('kind', 'stale_authority')",
      authorityCheck,
    );
    const firstSuggestionWrite = Math.min(
      ...[
        "UPDATE app.keyword_review_suggestions",
        "INSERT INTO app.keyword_review_suggestions",
      ]
        .map((statement) => batch.indexOf(statement))
        .filter((index) => index >= 0),
    );

    expect(authorityCheck).toBeGreaterThan(0);
    expect(staleAuthority).toBeGreaterThan(authorityCheck);
    expect(firstSuggestionWrite).not.toBe(Infinity);
    expect(firstSuggestionWrite).toBeGreaterThan(staleAuthority);
  });
});
