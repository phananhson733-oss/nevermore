import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  listOrderedMigrationSources,
  migrationExecutableContract,
  migrationTableInventory,
  renderAuthoritySchema,
} from "../../../scripts/spec-authority-lib.mjs";
import {
  verifyAuthority,
  verifyAuthoritySourceSet,
} from "./verify-spec.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const authorityRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(authorityRoot, "../..");
const lockPath = "scripts/spec-v0.4-lock.json";

function readApp(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function readAuthority(relativePath) {
  return readFileSync(join(authorityRoot, relativePath), "utf8");
}

function sourceSet() {
  return {
    readme: readAuthority("README.md"),
    spec: readAuthority("MVP-IMPLEMENTATION-SPEC.md"),
    authorityOpenApi: readAuthority("openapi.yaml"),
    implementationOpenApi: readApp("openapi/mvp.yaml"),
    authoritySchema: readAuthority("schema.sql"),
    authoritySmoke: readAuthority("scripts/schema-smoke.sql"),
    implementationSmoke: readApp(
      "packages/db/migrations/schema-smoke.sql",
    ),
    authorityBundleSchema: readAuthority(
      "schemas/service-bundle-manifest.schema.json",
    ),
    implementationBundleSchema: readApp(
      "schemas/service-bundle-manifest.schema.json",
    ),
  };
}

function verifySources(overrides = {}) {
  return verifyAuthoritySourceSet({
    appRoot: repositoryRoot,
    authorityRoot,
    lock: JSON.parse(readApp(lockPath)),
    sources: { ...sourceSet(), ...overrides },
  });
}

test("accepts the active v0.4 authority and complete current inventory", () => {
  const result = verifyAuthority({
    appRoot: repositoryRoot,
    authorityRoot,
    lockPath,
  });
  assert.deepEqual(
    {
      operations: result.operationCount,
      async: result.asyncCount,
      tables: result.tableCount,
      rules: result.ruleCount,
      migrations: result.migrationCount,
      head: result.migrationHead,
    },
    {
      operations: 79,
      async: 10,
      tables: 78,
      rules: 12,
      migrations: 45,
      head: "0045_dataforseo_backlink_target_lineage",
    },
  );
});

test("rejects authority OpenAPI that differs by one byte", () => {
  assert.throws(
    () =>
      verifySources({
        authorityOpenApi: `${readAuthority("openapi.yaml")}# drift\n`,
      }),
    /byte-identical to openapi\/mvp\.yaml/,
  );
});

test("rejects hand-edited generated authority SQL", () => {
  assert.throws(
    () =>
      verifySources({
        authoritySchema: readAuthority("schema.sql").replace(
          "-- Nevermore active authority schema.",
          "-- hand edited",
        ),
      }),
    /deterministic ordered-migration output/,
  );
});

test("generated schema is the exact ordered migration chain", () => {
  const migrations = listOrderedMigrationSources({ root: repositoryRoot });
  assert.equal(migrations.length, 45);
  assert.equal(
    readAuthority("schema.sql"),
    renderAuthoritySchema(migrations),
  );
  for (const { name } of migrations) {
    assert.equal(
      readAuthority("schema.sql").match(
        new RegExp(`-- BEGIN EXACT ORDERED MIGRATION ${name}`, "g"),
      )?.length,
      1,
    );
  }
});

test("catalog recognizes CREATE TABLE with and without IF NOT EXISTS", () => {
  const migrations = listOrderedMigrationSources({ root: repositoryRoot });
  const tables = migrationTableInventory(migrations);
  assert.equal(tables.length, 78);
  for (const table of [
    "keyword_relation_identities",
    "action_execution_state_events",
    "competitor_monitor_signals",
    "geo_citation_occurrences",
    "backlink_facts",
  ]) {
    assert.ok(tables.includes(table), `${table} is missing`);
  }
});

test("rejects a narrative operation marker drift", () => {
  assert.throws(
    () =>
      verifySources({
        spec: readAuthority("MVP-IMPLEMENTATION-SPEC.md").replace(
          "- `getProjectMeasurementWindowHistory`\n",
          "",
        ),
      }),
    /narrative API inventory drifted/,
  );
});

test("rejects a narrative rule version drift", () => {
  assert.throws(
    () =>
      verifySources({
        spec: readAuthority("MVP-IMPLEMENTATION-SPEC.md").replace(
          "- `CONTENT-GAP-011`: 2",
          "- `CONTENT-GAP-011`: 999",
        ),
      }),
    /narrative rule versions drifted/,
  );
});

test("rejects migration transaction and identity drift", () => {
  assert.throws(
    () =>
      migrationExecutableContract(
        "SELECT 1; COMMIT;",
        "9998_missing_begin",
      ),
    /must begin with BEGIN/,
  );
  assert.throws(
    () =>
      migrationExecutableContract(
        [
          "BEGIN;",
          "CREATE OR REPLACE VIEW app.schema_migration_version AS",
          "  SELECT 'wrong'::text AS migration_version;",
          "COMMIT;",
        ].join("\n"),
        "9999_expected",
      ),
    /must declare its exact schema_migration_version/,
  );
});

test("freezes the dedicated measurement 202 outside shared AsyncAccepted", () => {
  const openapi = readAuthority("openapi.yaml");
  const start = openapi.indexOf(
    "operationId: createProjectMeasurementWindow",
  );
  const end = openapi.indexOf("operationId:", start + 1);
  const operation = openapi.slice(start, end);
  assert.match(operation, /MeasurementWindowAcceptedHttpResponse/);
  assert.doesNotMatch(operation, /components\/responses\/AsyncAccepted/);
  assert.equal(
    (
      openapi.match(
        /'202':\s*(?:\{\s*)?\$ref:\s*'#\/components\/responses\/AsyncAccepted'\s*(?:\}\s*)?/gs,
      ) ?? []
    ).length,
    10,
  );
});

test("rejects widening public collection to server-owned DFS", () => {
  const current = readAuthority("openapi.yaml");
  const widened = current.replace(
    "provider: { type: string, enum: [crawl, gsc, ga4] }",
    "provider: { type: string, enum: [crawl, gsc, ga4, dataforseo] }",
  );
  assert.notEqual(widened, current);
  assert.throws(
    () =>
      verifySources({
        authorityOpenApi: widened,
        implementationOpenApi: widened,
      }),
    /public collection provider allowlist/,
  );
});

test("rejects removing the confirmed Product/ICP gate from the Sources read contract", () => {
  const current = readAuthority("openapi.yaml");
  const operation = "operationId: listProjectSources";
  const start = current.indexOf(operation);
  const next = current.indexOf("operationId:", start + operation.length);
  const block = current.slice(start, next);
  const weakened = block
    .replace(
      "        Active projects require a confirmed Product Profile and ICP before this\n",
      "        Active projects may read source metadata before Product/ICP confirmation.\n",
    )
    .replace(
      "        '422': { $ref: '#/components/responses/ValidationError' }\n",
      "",
    );
  assert.notEqual(weakened, block);
  const mutated = `${current.slice(0, start)}${weakened}${current.slice(next)}`;

  assert.throws(
    () =>
      verifySources({
        authorityOpenApi: mutated,
        implementationOpenApi: mutated,
      }),
    /Sources read must gate active projects on confirmed Product\/ICP/,
  );
});

test("rejects removing a published-generation pin from a Growth Map read", () => {
  const current = readAuthority("openapi.yaml");
  const operation = "operationId: listProjectAuditKeywords";
  const start = current.indexOf(operation);
  const next = current.indexOf("operationId:", start + operation.length);
  const block = current.slice(start, next);
  const narrowed = block.replace(
    "        - $ref: '#/components/parameters/DiagnosticRunIdPin'\n",
    "",
  );
  assert.notEqual(narrowed, block);
  const mutated = `${current.slice(0, start)}${narrowed}${current.slice(next)}`;
  assert.throws(
    () =>
      verifySources({
        authorityOpenApi: mutated,
        implementationOpenApi: mutated,
      }),
    /listProjectAuditKeywords parameter contract/,
  );
});

test("rejects mixing live review view with a published generation", () => {
  const current = readAuthority("openapi.yaml");
  const weakened = current.replace(
    "x-signalframe-query-refinement: reviewViewAndDiagnosticRunIdAreMutuallyExclusive",
    "x-signalframe-query-refinement: mayMixReviewAndDiagnosticRun",
  );
  assert.notEqual(weakened, current);
  assert.throws(
    () =>
      verifySources({
        authorityOpenApi: weakened,
        implementationOpenApi: weakened,
      }),
    /must keep review view mutually exclusive/,
  );
});

test("rejects a Keyword PATCH that does not reject all query parameters", () => {
  const current = readAuthority("openapi.yaml");
  const weakened = current.replace(
    "x-signalframe-query-contract: rejectAllQueryParameters",
    "x-signalframe-query-contract: allowGenerationPin",
  );
  assert.notEqual(weakened, current);
  assert.throws(
    () =>
      verifySources({
        authorityOpenApi: weakened,
        implementationOpenApi: weakened,
      }),
    /must reject every query parameter/,
  );
});
