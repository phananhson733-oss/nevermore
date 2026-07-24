import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifier = join(repositoryRoot, "scripts/verify-spec-lock.mjs");
const activatedLock = JSON.parse(
  readFileSync(join(repositoryRoot, "scripts/spec-v0.3-lock.json"), "utf8"),
);

const REQUIRED_AUTHORITY_FILES = [
  "README.md",
  "MVP-IMPLEMENTATION-SPEC.md",
  "openapi.yaml",
  "schema.sql",
  "schemas/service-bundle-manifest.schema.json",
  "scripts/schema-smoke.sql",
  "scripts/verify-spec.mjs",
];

const REQUIRED_IMPLEMENTATION_FILES = [
  "openapi/mvp.yaml",
  "packages/contracts/src/generated/openapi.ts",
  "schemas/service-bundle-manifest.schema.json",
  "packages/db/migrations/schema-smoke.sql",
  "scripts/verify-implementation.mjs",
];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function makeFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "spec-lock-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  write(root, "package.json", JSON.stringify({ version: "0.3.0" }));
  const implementationOpenApi = write(
    root,
    "openapi/mvp.yaml",
    [
      "openapi: 3.1.0",
      "info:",
      "  title: fixture",
      "  version: 0.3.0",
      "paths:",
      "  /projects:",
      "    get:",
      "      operationId: listProjects",
      "      responses:",
      "        '200':",
      "          description: ok",
      "",
    ].join("\n"),
  );
  write(
    root,
    "packages/contracts/src/zod/health.ts",
    'export const CONTRACT_VERSION = "2026-07-21";\n',
  );
  const generatedOpenApi = write(
    root,
    "packages/contracts/src/generated/openapi.ts",
    "// generated fixture contract\n",
  );
  const implementationBundleSchema = write(
    root,
    "schemas/service-bundle-manifest.schema.json",
    '{"schema":"fixture"}\n',
  );
  const implementationSchemaSmoke = write(
    root,
    "packages/db/migrations/schema-smoke.sql",
    "BEGIN; ROLLBACK;\n",
  );
  const implementationVerifier = write(
    root,
    "scripts/verify-implementation.mjs",
    [
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const rootIndex = process.argv.indexOf("--root");',
      'if (rootIndex === -1 || !process.argv[rootIndex + 1]) process.exit(8);',
      'writeFileSync(join(process.argv[rootIndex + 1], "implementation-ran"), "yes");',
      "",
    ].join("\n"),
  );
  write(
    root,
    "packages/engine/src/rules/fixture.ts",
    [
      "export const fixtureRule = {",
      '  id: "TECH-HTTP-001",',
      "  version: 2,",
      '  domain: "technical_seo",',
      "  requiredDatasets: [],",
      '  evaluate() { return { status: "pass" }; },',
      "} satisfies DiagnosticRule;",
      "",
    ].join("\n"),
  );

  const migrations = options.migrations ?? {
    "0001_init.sql":
      "CREATE TABLE IF NOT EXISTS app.workspaces (id uuid PRIMARY KEY);\n",
    "0010_growth_audit_slice1.sql":
      "CREATE TABLE IF NOT EXISTS app.capability_runs (async_run_id uuid PRIMARY KEY);\n",
  };
  for (const [name, sql] of Object.entries(migrations)) {
    write(root, `packages/db/migrations/${name}`, sql);
  }

  const authorityReadme = write(root, "authority/README.md", "fixture authority\n");
  const authoritySpec = write(
    root,
    "authority/MVP-IMPLEMENTATION-SPEC.md",
    "# Fixture implementation specification\n",
  );
  const authoritySchema = write(
    root,
    "authority/schema.sql",
    "CREATE SCHEMA IF NOT EXISTS app;\n",
  );
  const authorityVerifier = write(
    root,
    "authority/scripts/verify-spec.mjs",
    [
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const appRootIndex = process.argv.indexOf("--app-root");',
      'if (appRootIndex === -1 || !process.argv[appRootIndex + 1]) process.exit(9);',
      'writeFileSync(join(process.argv[appRootIndex + 1], "authority-ran"), "yes");',
      "",
    ].join("\n"),
  );
  const authorityOpenApi = write(
    root,
    "authority/openapi.yaml",
    readFileSync(implementationOpenApi),
  );
  const authorityBundleSchema = write(
    root,
    "authority/schemas/service-bundle-manifest.schema.json",
    readFileSync(implementationBundleSchema),
  );
  const authoritySchemaSmoke = write(
    root,
    "authority/scripts/schema-smoke.sql",
    readFileSync(implementationSchemaSmoke),
  );

  const tables = options.tables ?? ["workspaces", "capability_runs"];
  const lock = {
    lockFormat: 2,
    productVersion: "0.3.0",
    contractVersion: "2026-07-21",
    authorityRoot: "authority",
    migrationDirectory: "packages/db/migrations",
    migrationFilePattern: "^[0-9]{4}_.+\\.sql$",
    authorityFiles: {
      "README.md": sha256(authorityReadme),
      "MVP-IMPLEMENTATION-SPEC.md": sha256(authoritySpec),
      "openapi.yaml": sha256(authorityOpenApi),
      "schema.sql": sha256(authoritySchema),
      "schemas/service-bundle-manifest.schema.json": sha256(
        authorityBundleSchema,
      ),
      "scripts/schema-smoke.sql": sha256(authoritySchemaSmoke),
      "scripts/verify-spec.mjs": sha256(authorityVerifier),
    },
    implementationFiles: {
      "openapi/mvp.yaml": sha256(implementationOpenApi),
      "packages/contracts/src/generated/openapi.ts": sha256(generatedOpenApi),
      "schemas/service-bundle-manifest.schema.json": sha256(
        implementationBundleSchema,
      ),
      "packages/db/migrations/schema-smoke.sql": sha256(
        implementationSchemaSmoke,
      ),
      "scripts/verify-implementation.mjs": sha256(implementationVerifier),
    },
    apiOperations: ["listProjects"],
    asyncOperations: [],
    tables,
    rules: ["TECH-HTTP-001"],
    ruleVersions: {
      "TECH-HTTP-001": 2,
    },
  };
  const lockPath = options.lockPath ?? "scripts/custom-lock.json";
  write(root, lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  return { root, lock, lockPath };
}

function writeLock(fixture, lock = fixture.lock) {
  write(
    fixture.root,
    fixture.lockPath,
    `${JSON.stringify(lock, null, 2)}\n`,
  );
}

function runVerifier(fixture, extraArguments = []) {
  return spawnSync(
    process.execPath,
    [verifier, "--root", fixture.root, ...extraArguments],
    { encoding: "utf8" },
  );
}

test("freezes the activated traceable audit surface at 45 operations, eight async commands, and 44 tables", () => {
  assert.equal(activatedLock.apiOperations.length, 45);
  assert.equal(activatedLock.asyncOperations.length, 8);
  assert.equal(activatedLock.tables.length, 44);

  for (const operationId of [
    "getProjectProductProfile",
    "updateProductProfileDraft",
    "createProductProfileSynthesisRun",
    "reviewProductProfileCompetitor",
    "addProductProfileCompetitor",
    "confirmProductProfile",
    "listProjectAuditUrls",
    "getProjectAuditUrl",
    "listProjectAuditKeywords",
    "getProjectAuditKeyword",
    "listProjectAuditCompetitors",
    "getProjectAuditCompetitor",
  ]) {
    assert.ok(
      activatedLock.apiOperations.includes(operationId),
      `${operationId} is missing from the activated lock`,
    );
  }

  assert.ok(
    activatedLock.asyncOperations.includes("createProductProfileSynthesisRun"),
  );
  for (const table of [
    "product_profile_runs",
    "product_profile_invocation_attempts",
    "finding_targets",
  ]) {
    assert.ok(
      activatedLock.tables.includes(table),
      `${table} is missing from the activated lock`,
    );
  }
});

test("accepts a caller-supplied lock and scans the complete ordered migration set", (t) => {
  const fixture = makeFixture(t);
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 tables/);
  assert.equal(readFileSync(join(fixture.root, "authority-ran"), "utf8"), "yes");
  assert.equal(
    readFileSync(join(fixture.root, "implementation-ran"), "utf8"),
    "yes",
  );
});

test("uses scripts/spec-v0.3-lock.json as the activated default lock path", (t) => {
  const fixture = makeFixture(t, { lockPath: "scripts/spec-v0.3-lock.json" });
  const result = runVerifier(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Spec lock passed/);
});

test("rejects a current v0.3 lock downgraded to lockFormat 1", (t) => {
  const fixture = makeFixture(t);
  const downgradedLock = {
    ...fixture.lock,
    lockFormat: 1,
  };
  delete downgradedLock.implementationFiles;
  write(
    fixture.root,
    fixture.lockPath,
    `${JSON.stringify(downgradedLock, null, 2)}\n`,
  );

  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lockFormat 2 is required for product version 0\.3\.0/i);
});

test("rejects an explicitly supplied legacy v1 lock before it can bypass implementation equality", (t) => {
  const fixture = makeFixture(t);
  write(
    fixture.root,
    "package.json",
    `${JSON.stringify({ version: "0.2.0" })}\n`,
  );
  write(
    fixture.root,
    "authority/openapi.yaml",
    `${readFileSync(join(fixture.root, "openapi/mvp.yaml"), "utf8")}x-authority-only: true\n`,
  );
  write(
    fixture.root,
    "authority/scripts/verify-spec.mjs",
    "process.exit(0);\n",
  );

  const legacyLock = {
    ...fixture.lock,
    lockFormat: 1,
    productVersion: "0.2.0",
    authorityFiles: {
      ...fixture.lock.authorityFiles,
      "openapi.yaml": sha256(join(fixture.root, "authority/openapi.yaml")),
      "scripts/verify-spec.mjs": sha256(
        join(fixture.root, "authority/scripts/verify-spec.mjs"),
      ),
    },
  };
  delete legacyLock.implementationFiles;
  write(
    fixture.root,
    fixture.lockPath,
    `${JSON.stringify(legacyLock, null, 2)}\n`,
  );

  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /legacy lockFormat 1 cannot verify activated v0\.3 authority/i);
});

test("rejects a table declared by the lock but absent from every migration", (t) => {
  const fixture = makeFixture(t, {
    tables: ["workspaces", "capability_runs", "audit_runs"],
  });
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /application tables drifted/i);
});

test("rejects a table created by more than one ordered migration", (t) => {
  const fixture = makeFixture(t, {
    migrations: {
      "0001_init.sql":
        "CREATE TABLE IF NOT EXISTS app.workspaces (id uuid PRIMARY KEY);\n",
      "0010_growth_audit.sql":
        "CREATE TABLE IF NOT EXISTS app.workspaces (id uuid PRIMARY KEY);\n",
    },
    tables: ["workspaces"],
  });
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /table workspaces is created by multiple migrations/i);
});

test("rejects duplicate migration ordinals", (t) => {
  const fixture = makeFixture(t, {
    migrations: {
      "0010_growth_audit.sql":
        "CREATE TABLE IF NOT EXISTS app.audit_runs (id uuid PRIMARY KEY);\n",
      "0010_other.sql":
        "CREATE TABLE IF NOT EXISTS app.site_pages (id uuid PRIMARY KEY);\n",
    },
    tables: ["audit_runs", "site_pages"],
  });
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate migration ordinal 0010/i);
});

test("rejects an authority file whose content no longer matches the lock", (t) => {
  const fixture = makeFixture(t);
  write(fixture.root, "authority/README.md", "changed after review\n");
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authority file drifted/i);
});

for (const relativePath of REQUIRED_AUTHORITY_FILES) {
  test(`rejects a lock missing the required authority hash for ${relativePath}`, (t) => {
    const fixture = makeFixture(t);
    delete fixture.lock.authorityFiles[relativePath];
    writeLock(fixture);

    const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`authorityFiles is missing ${relativePath.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`, "i"));
  });
}

for (const relativePath of REQUIRED_IMPLEMENTATION_FILES) {
  test(`rejects a lock missing the required implementation hash for ${relativePath}`, (t) => {
    const fixture = makeFixture(t);
    delete fixture.lock.implementationFiles[relativePath];
    writeLock(fixture);

    const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`implementationFiles is missing ${relativePath.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`, "i"));
  });
}

test("rejects a diagnostic rule version that drifts from the frozen lock", (t) => {
  const fixture = makeFixture(t);
  const rulePath = join(
    fixture.root,
    "packages/engine/src/rules/fixture.ts",
  );
  write(
    fixture.root,
    "packages/engine/src/rules/fixture.ts",
    readFileSync(rulePath, "utf8").replace("version: 2", "version: 999"),
  );

  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TECH-HTTP-001.*version.*2/is);
});

test("rejects a tampered implementation verifier before executing it", (t) => {
  const fixture = makeFixture(t);
  write(
    fixture.root,
    "scripts/verify-implementation.mjs",
    'throw new Error("tampered verifier");\n',
  );

  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /implementation file drifted.*scripts\/verify-implementation\.mjs/is,
  );
});

test("rejects a hash-pinned implementation verifier that throws", (t) => {
  const fixture = makeFixture(t);
  const verifierPath = write(
    fixture.root,
    "scripts/verify-implementation.mjs",
    'throw new Error("fixture implementation verifier exploded");\n',
  );
  fixture.lock.implementationFiles["scripts/verify-implementation.mjs"] =
    sha256(verifierPath);
  writeLock(fixture);

  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixture implementation verifier exploded/i);
  assert.match(result.stderr, /implementation verifier failed/i);
});

test("rejects non-operation implementation OpenAPI drift", (t) => {
  const fixture = makeFixture(t);
  const openApiPath = join(fixture.root, "openapi/mvp.yaml");
  write(
    fixture.root,
    "openapi/mvp.yaml",
    readFileSync(openApiPath, "utf8").replace("version: 0.3.0", "version: 9.9.9"),
  );

  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /implementation file drifted.*openapi\/mvp\.yaml/is);
});

test("rejects generated contract drift independently of OpenAPI operations", (t) => {
  const fixture = makeFixture(t);
  write(
    fixture.root,
    "packages/contracts/src/generated/openapi.ts",
    "// stale generated fixture contract\n",
  );

  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /implementation file drifted.*generated\/openapi\.ts/is);
});
