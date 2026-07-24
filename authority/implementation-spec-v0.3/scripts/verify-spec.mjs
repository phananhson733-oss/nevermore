#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultAuthorityRoot = path.resolve(scriptDirectory, "..");
const PRODUCT_VERSION = "0.3.0";
const CONTRACT_VERSION = "2026-07-21";
const BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.3.0";
const HISTORICAL_BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.2.0";
const RULE_SET_VERSION = "mvp.rules.0.2.1";
const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";
const EXPECTED_OPERATION_COUNT = 45;
const EXPECTED_ASYNC_OPERATION_COUNT = 8;
const EXPECTED_TABLE_COUNT = 44;
const MIGRATION_VERSION_VIEW_PATTERN =
  /^CREATE\s+OR\s+REPLACE\s+VIEW\s+app\.schema_migration_version\s+AS\s+SELECT\s+'([^']+)'::text\s+AS\s+migration_version$/is;
const SLICE_1_TABLES = [
  "capability_runs",
  "audit_runs",
  "audit_module_results",
  "site_pages",
  "page_snapshots",
  "product_profile_runs",
  "product_profile_invocation_attempts",
  "finding_targets",
  "keyword_occurrences",
  "keyword_entities",
  "keyword_entity_sources",
  "competitor_entities",
  "competitor_origin_occurrences",
];
const EXPECTED_RULE_VERSIONS = new Map([
  ["TECH-HTTP-001", 2],
  ["TECH-CANONICAL-002", 2],
  ["TECH-LINKGRAPH-005", 2],
  ["SEARCH-CTR-004", 1],
  ["SEARCH-DECAY-002", 1],
  ["CONTENT-COVERAGE-001", 1],
  ["CONTENT-GAP-011", 1],
  ["CRO-PATH-001", 1],
  ["CRO-LANDING-003", 1],
  ["GEO-ENTITY-001", 1],
  ["GEO-CRAWLER-002", 1],
]);

function parseArguments(argv) {
  let authorityRoot = defaultAuthorityRoot;
  let appRoot;

  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value) {
      throw new Error(
        "usage: node authority/implementation-spec-v0.3/scripts/verify-spec.mjs [--app-root <repository>] [--authority-root <authority-directory>]",
      );
    }
    if (option === "--app-root") {
      appRoot = path.resolve(value);
    } else if (option === "--authority-root") {
      authorityRoot = path.resolve(value);
    } else {
      throw new Error(
        "usage: node authority/implementation-spec-v0.3/scripts/verify-spec.mjs [--app-root <repository>] [--authority-root <authority-directory>]",
      );
    }
  }

  return {
    appRoot: appRoot ?? path.resolve(authorityRoot, "../.."),
    authorityRoot,
  };
}

const { appRoot, authorityRoot } = parseArguments(process.argv.slice(2));
const readAuthority = (name) =>
  fs.readFileSync(path.join(authorityRoot, name), "utf8");

const files = {
  readme: readAuthority("README.md"),
  spec: readAuthority("MVP-IMPLEMENTATION-SPEC.md"),
  openapi: readAuthority("openapi.yaml"),
  sql: readAuthority("schema.sql"),
  bundleSchema: readAuthority(
    "schemas/service-bundle-manifest.schema.json",
  ),
  schemaSmoke: readAuthority("scripts/schema-smoke.sql"),
};

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const unique = (values) => [...new Set(values)].sort();
const difference = (left, right) => {
  const rightSet = new Set(right);
  return unique(left).filter((value) => !rightSet.has(value));
};

function exactSet(actual, expected, label) {
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  const duplicates = actual.filter(
    (value, index) => actual.indexOf(value) !== index,
  );
  check(
    missing.length === 0 && extra.length === 0 && duplicates.length === 0,
    `${label} drift (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}; duplicates: ${unique(duplicates).join(", ") || "none"})`,
  );
}

function between(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  check(startIndex >= 0, `missing marker ${start}`);
  check(endIndex > startIndex, `missing marker ${end}`);
  return startIndex >= 0 && endIndex > startIndex
    ? text.slice(startIndex + start.length, endIndex)
    : "";
}

function stripSqlComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ");
}

function executableSqlStatements(source) {
  const statements = [];
  let statement = "";
  let state = "code";
  let blockCommentDepth = 0;
  let dollarDelimiter = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        statement += character;
        state = "code";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) state = "code";
      } else if (character === "\n") {
        statement += character;
      }
      continue;
    }

    if (state === "single-quote") {
      statement += character;
      if (character === "'" && next === "'") {
        statement += next;
        index += 1;
      } else if (character === "'") {
        state = "code";
      }
      continue;
    }

    if (state === "double-quote") {
      statement += character;
      if (character === '"' && next === '"') {
        statement += next;
        index += 1;
      } else if (character === '"') {
        state = "code";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (source.startsWith(dollarDelimiter, index)) {
        statement += dollarDelimiter;
        index += dollarDelimiter.length - 1;
        state = "code";
      } else {
        statement += character;
      }
      continue;
    }

    if (character === "-" && next === "-") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      statement += " ";
      state = "block-comment";
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (character === "'") {
      statement += character;
      state = "single-quote";
      continue;
    }
    if (character === '"') {
      statement += character;
      state = "double-quote";
      continue;
    }
    if (character === "$") {
      const delimiter = source
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        statement += delimiter;
        dollarDelimiter = delimiter;
        index += delimiter.length - 1;
        state = "dollar-quote";
        continue;
      }
    }
    if (character === ";") {
      const executable = statement.trim();
      if (executable) statements.push(executable);
      statement = "";
      continue;
    }
    statement += character;
  }

  const executable = statement.trim();
  if (executable) statements.push(executable);
  return statements;
}

function migrationExecutableContract(source, migrationVersion) {
  const statements = executableSqlStatements(source);
  const startsWithBegin = /^BEGIN$/i.test(statements[0] ?? "");
  const endsWithCommit = /^COMMIT$/i.test(statements.at(-1) ?? "");
  check(
    startsWithBegin && endsWithCommit,
    `${migrationVersion} must use BEGIN/COMMIT transaction framing with no executable prologue or epilogue`,
  );

  const migrationViews = statements
    .map((statement, index) => ({
      index,
      version: statement.match(MIGRATION_VERSION_VIEW_PATTERN)?.[1],
    }))
    .filter(({ version }) => version !== undefined);
  const hasExactFinalView =
    migrationViews.length === 1 &&
    migrationViews[0].index === statements.length - 2 &&
    migrationViews[0].version === migrationVersion;
  check(
    hasExactFinalView,
    `${migrationVersion} must end with its exact schema_migration_version projection immediately before COMMIT`,
  );

  if (!startsWithBegin || !endsWithCommit || !hasExactFinalView) return [];
  return statements.slice(1, migrationViews[0].index);
}

function markedExecutableContract(source, migrationVersion) {
  const startMarker = `-- BEGIN EXACT EXECUTABLE MIGRATION ${migrationVersion}`;
  const endMarker = `-- END EXACT EXECUTABLE MIGRATION ${migrationVersion}`;
  const startIndexes = [...source.matchAll(new RegExp(startMarker, "g"))].map(
    (match) => match.index,
  );
  const endIndexes = [...source.matchAll(new RegExp(endMarker, "g"))].map(
    (match) => match.index,
  );
  check(
    startIndexes.length === 1 && endIndexes.length === 1,
    `authority SQL must contain exactly one bounded ${migrationVersion} executable block`,
  );
  if (
    startIndexes.length !== 1 ||
    endIndexes.length !== 1 ||
    endIndexes[0] <= startIndexes[0]
  ) {
    return [];
  }
  return executableSqlStatements(
    source.slice(startIndexes[0] + startMarker.length, endIndexes[0]),
  );
}

function exactExecutableMigrationCoverage({
  authoritySource,
  migrationSource,
  migrationVersion,
  failureMessage,
}) {
  const expected = migrationExecutableContract(
    migrationSource,
    migrationVersion,
  );
  const actual = markedExecutableContract(authoritySource, migrationVersion);
  check(
    expected.length > 0 &&
      actual.length === expected.length &&
      actual.every((statement, index) => statement === expected[index]),
    failureMessage,
  );
  return expected;
}

function migrationOwnedDefinitions(statements) {
  const definitions = [];
  for (const statement of statements) {
    const functionName = statement.match(
      /^CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+app\.([a-z][a-z0-9_]*)\s*\(/i,
    )?.[1];
    if (functionName) {
      definitions.push({ kind: "function", name: `app.${functionName}` });
    }
    const triggerName = statement.match(
      /^CREATE(?:\s+OR\s+REPLACE)?\s+TRIGGER\s+([a-z][a-z0-9_]*)\b/i,
    )?.[1];
    if (triggerName) {
      definitions.push({ kind: "trigger", name: triggerName });
    }
  }
  return definitions;
}

function verifyMigrationOwnedDefinitionUniqueness(migrationContracts) {
  const expectedDefinitions = migrationContracts.flatMap((contract) =>
    migrationOwnedDefinitions(contract),
  );
  const expectedCounts = new Map();
  for (const definition of expectedDefinitions) {
    const key = `${definition.kind}:${definition.name}`;
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
  }

  const authorityDefinitions = migrationOwnedDefinitions(
    executableSqlStatements(files.sql),
  );
  for (const [key, expectedCount] of expectedCounts) {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator);
    const name = key.slice(separator + 1);
    const definitionCount = authorityDefinitions.filter(
      (definition) => definition.kind === kind && definition.name === name,
    ).length;
    const expectation =
      expectedCount === 1 ? "exactly once" : `exactly ${expectedCount} times`;
    check(
      definitionCount === expectedCount,
      `authority SQL must define migration-owned ${kind} ${name} ${expectation} (found ${definitionCount})`,
    );
  }
}

function applicationMigrationTables() {
  const migrationDirectory = path.join(appRoot, "packages/db/migrations");
  if (!fs.existsSync(migrationDirectory)) {
    failures.push(
      `application migration directory does not exist: ${migrationDirectory}`,
    );
    return [];
  }

  const migrationFiles = fs
    .readdirSync(migrationDirectory)
    .filter((fileName) => /^[0-9]{4}_.+\.sql$/.test(fileName))
    .sort();
  check(
    migrationFiles.length > 0,
    "at least one ordered application migration is required",
  );

  const ordinalOwners = new Map();
  for (const fileName of migrationFiles) {
    const ordinal = fileName.match(/^([0-9]{4})_/)?.[1];
    if (!ordinal) {
      failures.push(`migration lacks a four-digit ordinal: ${fileName}`);
      continue;
    }
    if (ordinalOwners.has(ordinal)) {
      failures.push(
        `duplicate migration ordinal ${ordinal}: ${ordinalOwners.get(ordinal)} and ${fileName}`,
      );
    } else {
      ordinalOwners.set(ordinal, fileName);
    }
  }

  const tableOwners = new Map();
  const tables = [];
  for (const fileName of migrationFiles) {
    const sql = stripSqlComments(
      fs.readFileSync(path.join(migrationDirectory, fileName), "utf8"),
    );
    const createdTables = [
      ...sql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
      ),
    ].map((match) => match[1]);
    for (const table of createdTables) {
      if (tableOwners.has(table)) {
        failures.push(
          `table ${table} is created by multiple migrations: ${tableOwners.get(table)} and ${fileName}`,
        );
      } else {
        tableOwners.set(table, fileName);
      }
      tables.push(table);
    }
  }
  return tables;
}

check(
  files.spec.includes("status: activated"),
  "main spec must identify the activated v0.3 machine surface",
);
check(
  files.spec.includes(`product_version: ${PRODUCT_VERSION}`),
  `authority product version must be ${PRODUCT_VERSION}`,
);
check(
  files.spec.includes(`contract_version: ${CONTRACT_VERSION}`),
  `authority contract version must be ${CONTRACT_VERSION}`,
);
check(
  files.spec.includes(`implemented_surface_version: ${PRODUCT_VERSION}`),
  `authority must identify the implemented ${PRODUCT_VERSION} machine surface`,
);
check(
  files.spec.includes("CSV 与 DataForSEO 可同时冻结") &&
    files.spec.includes("search volume 不得重复相加"),
  "authority must preserve concurrent CSV/DataForSEO lineage without double-counting demand",
);
check(
  !files.spec.includes("一次 DiagnosticRun 最多选择其中一个"),
  "authority must not restore the obsolete CSV/DataForSEO mutual exclusion",
);
check(
  files.spec.includes("`resolved`：成员必须引用冻结在该 DiagnosticRun manifest") &&
    files.spec.includes("`unresolved`：只允许页级 GSC/GA4 Observation") &&
    files.spec.includes("`definition_only`：用于规则只有稳定集合") &&
    files.spec.includes("scope 和完整语义 tuple 上完全一致的重放") &&
    files.spec.includes("任何 novel stale-run insert 仍必须拒绝") &&
    files.spec.includes("迁移不得为既有历史 Finding 回填 target") &&
    files.spec.includes("不得从当前 `subject_refs`") &&
    files.spec.includes("任一写入失败则整体回滚"),
  "authority must freeze truthful per-run Finding target membership, transactional persistence, and exact-only historical retry semantics",
);
check(
  files.spec.includes("source_provider=system + derived/computed/B") &&
    files.spec.includes("source_provider=llm + generated/generated/C") &&
    files.spec.includes("snapshot_id + collection_run_id + capturedAt"),
  "authority must freeze the three mutually exclusive Evidence provenance shapes",
);
check(files.openapi.includes("openapi: 3.1.0"), "OpenAPI must be 3.1.0");
check(
  files.openapi.includes(`version: ${PRODUCT_VERSION}`),
  `OpenAPI must expose the activated ${PRODUCT_VERSION} surface`,
);
check(
  !files.openapi.includes("bearerAuth"),
  "bearerAuth is forbidden; use same-origin session cookie",
);
check(
  files.openapi.includes("supabaseSessionCookie"),
  "session cookie security scheme missing",
);
check(files.openapi.includes("statusUrl"), "async statusUrl schema missing");
const publicEvidenceBlock = between(
  files.openapi,
  "    Evidence:",
  "    SubjectRef:",
);
check(
  /required: \[[^\]]*snapshotId[^\]]*collectionRunId[^\]]*analysisInvocationId[^\]]*\]/.test(
    publicEvidenceBlock,
  ) &&
    publicEvidenceBlock.includes(
      "collectionRunId: { type: [string, 'null'], format: uuid }",
    ) &&
    [
      "Source-backed Evidence",
      "System-derived Evidence",
      "LLM-generated Evidence",
    ].every((title) => publicEvidenceBlock.includes(`title: ${title}`)),
  "public Evidence must expose exact collection-run lineage and all three provenance shapes",
);
const growthMapFindingBlock = between(
  files.openapi,
  "    GrowthMapUrlFinding:",
  "    GrowthMapUrlPortfolioItem:",
);
check(
  /required: \[[^\]]*reviewState[^\]]*reviewRevision[^\]]*\]/.test(
    growthMapFindingBlock,
  ) &&
    growthMapFindingBlock.includes(
      "reviewRevision: { type: integer, minimum: 0 }",
    ),
  "Growth Map Finding must expose the exact non-negative reviewRevision required by optimistic review concurrency",
);
const openApiReadMethods = (pathBlock) => [
  ...pathBlock.matchAll(
    /^    (get|put|post|delete|options|head|patch|trace):\s*$/gm,
  ),
].map((match) => match[1]);
const openApiParameterRefs = (operationBlock) => [
  ...operationBlock.matchAll(
    /^        - \$ref: '(#\/components\/parameters\/[^']+)'\s*$/gm,
  ),
].map((match) => match[1]);

const keywordListPathBlock = between(
  files.openapi,
  "  /projects/{projectId}/audit/keywords:",
  "  /projects/{projectId}/audit/keywords/{keywordId}:",
);
const keywordDetailPathBlock = between(
  files.openapi,
  "  /projects/{projectId}/audit/keywords/{keywordId}:",
  "  /projects/{projectId}/audit/competitors:",
);
exactSet(
  openApiReadMethods(keywordListPathBlock),
  ["get"],
  "Growth Map Keyword list methods",
);
exactSet(
  openApiReadMethods(keywordDetailPathBlock),
  ["get"],
  "Growth Map Keyword detail methods",
);
exactSet(
  openApiParameterRefs(keywordListPathBlock),
  [
    "#/components/parameters/ProjectId",
    "#/components/parameters/Limit",
    "#/components/parameters/Cursor",
  ],
  "Growth Map Keyword list query must be exactly limit/cursor",
);
exactSet(
  openApiParameterRefs(keywordDetailPathBlock),
  [
    "#/components/parameters/ProjectId",
    "#/components/parameters/KeywordId",
  ],
  "Growth Map Keyword detail parameters",
);
check(
  keywordListPathBlock.includes(
    "operationId: listProjectAuditKeywords",
  ) &&
    keywordDetailPathBlock.includes(
      "operationId: getProjectAuditKeyword",
    ) &&
    keywordListPathBlock.includes(
      "#/components/schemas/GrowthMapKeywordLibraryHttpResponse",
    ) &&
    keywordDetailPathBlock.includes(
      "#/components/schemas/GrowthMapKeywordDetailHttpResponse",
    ),
  "Growth Map Keyword authority paths must expose only the implemented list/detail reads",
);
const competitorListPathBlock = between(
  files.openapi,
  "  /projects/{projectId}/audit/competitors:",
  "  /projects/{projectId}/audit/competitors/{competitorId}:",
);
const competitorDetailPathBlock = between(
  files.openapi,
  "  /projects/{projectId}/audit/competitors/{competitorId}:",
  "  /projects/{projectId}/findings:",
);
exactSet(
  openApiReadMethods(competitorListPathBlock),
  ["get"],
  "Growth Map Competitor list methods",
);
exactSet(
  openApiReadMethods(competitorDetailPathBlock),
  ["get"],
  "Growth Map Competitor detail methods",
);
exactSet(
  openApiParameterRefs(competitorListPathBlock),
  [
    "#/components/parameters/ProjectId",
    "#/components/parameters/Limit",
    "#/components/parameters/Cursor",
  ],
  "Growth Map Competitor list query must be exactly limit/cursor",
);
exactSet(
  openApiParameterRefs(competitorDetailPathBlock),
  [
    "#/components/parameters/ProjectId",
    "#/components/parameters/CompetitorId",
  ],
  "Growth Map Competitor detail parameters",
);
check(
  competitorListPathBlock.includes(
    "operationId: listProjectAuditCompetitors",
  ) &&
    competitorDetailPathBlock.includes(
      "operationId: getProjectAuditCompetitor",
    ) &&
    competitorListPathBlock.includes(
      "#/components/schemas/GrowthMapCompetitorLibraryHttpResponse",
    ) &&
    competitorDetailPathBlock.includes(
      "#/components/schemas/GrowthMapCompetitorDetailHttpResponse",
    ),
  "Growth Map Competitor authority paths must expose only the implemented list/detail reads",
);
const keywordSchemaBlock = between(
  files.openapi,
  "    GrowthMapKeywordUnassignedTarget:",
  "    GrowthMapCompetitorReviewStatus:",
);
const competitorSchemaBlock = between(
  files.openapi,
  "    GrowthMapCompetitorReviewStatus:",
  "    CreateDiagnosticRunRequest:",
);
check(
  [
    "csv_import: '#/components/schemas/GrowthMapKeywordCsvImportOccurrence'",
    "dataforseo_ranked: '#/components/schemas/GrowthMapKeywordDataForSeoRankedOccurrence'",
    "gsc_top_query: '#/components/schemas/GrowthMapKeywordGscTopQueryOccurrence'",
    "manual: '#/components/schemas/GrowthMapKeywordManualOccurrence'",
    "unassigned: '#/components/schemas/GrowthMapKeywordUnassignedTarget'",
    "existing_page: '#/components/schemas/GrowthMapKeywordExistingPageTarget'",
    "new_asset: '#/components/schemas/GrowthMapKeywordNewAssetTarget'",
  ].every((mapping) => keywordSchemaBlock.includes(mapping)) &&
    keywordSchemaBlock.includes("propertyName: sourceKind") &&
    keywordSchemaBlock.includes("propertyName: kind"),
  "Growth Map Keyword authority must preserve source and mapped-target discriminators",
);
check(
  [
    "/valueJson/searchVolume",
    "/valueJson/keywordDifficulty",
    "/valueJson/currentRank",
    "/valueJson/currentUrl",
    "/valueJson/competitorDomain",
    "/valueJson/competitorRank",
  ].every((pointer) =>
    keywordSchemaBlock.includes(`const: ${pointer}`),
  ),
  "Growth Map Keyword authority must preserve every canonical metric pointer",
);
check(
  files.openapi.includes("    GrowthMapLibraryLanguageTag:") &&
    files.openapi.includes(
      "x-signalframe-runtime-refinement: canonicalIntlLocale",
    ) &&
    [
      "GrowthMapKeywordCsvImportOccurrence",
      "GrowthMapKeywordDataForSeoRankedOccurrence",
      "GrowthMapKeywordGscTopQueryOccurrence",
      "GrowthMapKeywordManualOccurrence",
      "GrowthMapKeywordLibraryItem",
    ].every((schemaName) => {
      const start = keywordSchemaBlock.indexOf(`    ${schemaName}:`);
      if (start < 0) return false;
      const remaining = keywordSchemaBlock.slice(start);
      const nextSchema = remaining.slice(1).search(/^    [A-Z][A-Za-z0-9]+:/m);
      const schemaBlock =
        nextSchema < 0
          ? remaining
          : remaining.slice(0, nextSchema + 1);
      return schemaBlock.includes(
        "languageTag: { $ref: '#/components/schemas/GrowthMapLibraryLanguageTag' }",
      );
    }),
  "Growth Map Keyword authority must use canonical Growth Map Library language tags",
);
check(
  /GrowthMapKeywordLibraryItem:\s+type: object\s+additionalProperties: false/.test(
    keywordSchemaBlock,
  ) &&
    /GrowthMapKeywordLibraryPageMeta:\s+type: object\s+additionalProperties: false/.test(
      keywordSchemaBlock,
    ) &&
    keywordSchemaBlock.includes(
      "limitations: { $ref: '#/components/schemas/GrowthMapKeywordMetricLimitations' }",
    ) &&
    keywordSchemaBlock.includes(
      "coverage: { $ref: '#/components/schemas/GrowthMapCoverage' }",
    ) &&
    keywordSchemaBlock.includes("minItems: 1") &&
    keywordSchemaBlock.includes("maxItems: 100") &&
    keywordSchemaBlock.includes("GrowthMapKeywordLibraryResponse:") &&
    keywordSchemaBlock.includes("GrowthMapKeywordDetailResponse:") &&
    /GrowthMapKeywordLibraryResponse:\s+type: object\s+additionalProperties: false\s+required: \[projectId, data, meta\]/.test(
      keywordSchemaBlock,
    ) &&
    /GrowthMapKeywordLibraryPageMeta:\s+type: object\s+additionalProperties: false\s+required: \[limit, nextCursor, hasNext, coverage\]/.test(
      keywordSchemaBlock,
    ),
  "Growth Map Keyword authority must keep closed bounded coverage/limitation cursor contracts",
);
check(
  [
    "product_profile: '#/components/schemas/GrowthMapCompetitorProductProfileOrigin'",
    "csv_keyword_gap: '#/components/schemas/GrowthMapCompetitorCsvKeywordGapOrigin'",
    "manual: '#/components/schemas/GrowthMapCompetitorManualOrigin'",
    "serp_overlap: '#/components/schemas/GrowthMapCompetitorSerpOverlapOrigin'",
    "ai_citation: '#/components/schemas/GrowthMapCompetitorAiCitationOrigin'",
  ].every((mapping) => competitorSchemaBlock.includes(mapping)) &&
    competitorSchemaBlock.includes("propertyName: originKind"),
  "Growth Map Competitor authority must preserve every exact origin discriminator",
);
const competitorProductProfileOriginBlock = between(
  competitorSchemaBlock,
  "    GrowthMapCompetitorProductProfileOrigin:",
  "    GrowthMapCompetitorCsvKeywordGapOrigin:",
);
const competitorCsvKeywordGapOriginBlock = between(
  competitorSchemaBlock,
  "    GrowthMapCompetitorCsvKeywordGapOrigin:",
  "    GrowthMapCompetitorManualOrigin:",
);
const competitorManualOriginBlock = between(
  competitorSchemaBlock,
  "    GrowthMapCompetitorManualOrigin:",
  "    GrowthMapCompetitorSerpOverlapOrigin:",
);
check(
  /GrowthMapCompetitorProductProfileOrigin:\s+type: object\s+additionalProperties: false/.test(
    competitorSchemaBlock,
  ) &&
    competitorProductProfileOriginBlock.includes(
      "items: { $ref: '#/components/schemas/ProductProfileEvidenceRef' }",
    ) &&
    competitorSchemaBlock.includes(
      "pattern: '^/competitorCandidates(?:/[0-9]+)?$'",
    ) &&
    competitorCsvKeywordGapOriginBlock.includes(
      "items: { $ref: '#/components/schemas/GrowthMapCompetitorEvidenceRef' }",
    ) &&
    competitorManualOriginBlock.includes(
      "items: { $ref: '#/components/schemas/GrowthMapCompetitorEvidenceRef' }",
    ) &&
    competitorCsvKeywordGapOriginBlock.includes(
      "sourcePointer: { type: string, const: /valueJson/competitorDomain }",
    ),
  "Growth Map Competitor authority must keep strict typed evidence for product_profile, csv_keyword_gap, and manual origins",
);
check(
  [
    "unavailable: '#/components/schemas/GrowthMapCompetitorUnavailableInsight'",
    "available: '#/components/schemas/GrowthMapCompetitorAvailableSerpOverlap'",
    "available: '#/components/schemas/GrowthMapCompetitorAvailableAiCitationInsight'",
  ].every((mapping) => competitorSchemaBlock.includes(mapping)) &&
    competitorSchemaBlock.includes("propertyName: availability") &&
    competitorSchemaBlock.includes("const: /valueJson/serpOverlap") &&
    competitorSchemaBlock.includes(
      "const: /valueJson/aiCitationInsight",
    ) &&
    /GrowthMapCompetitorUnavailableInsight:\s+type: object\s+additionalProperties: false\s+required: \[availability, value, limitation\]/.test(
      competitorSchemaBlock,
    ),
  "Growth Map Competitor authority must preserve available/unavailable insight discriminators and canonical Observation pointers",
);
check(
  /GrowthMapCompetitorLibraryItem:\s+type: object\s+additionalProperties: false\s+required: \[projectId, competitorId, domain, name, reviewStatus, relationship, analysisScope, revision, originOccurrences, lastObservedAt, serpOverlap, aiCitationInsight, coverage\]/.test(
    competitorSchemaBlock,
  ) &&
    /GrowthMapCompetitorLibraryResponse:\s+type: object\s+additionalProperties: false\s+required: \[projectId, data, meta\]/.test(
      competitorSchemaBlock,
    ) &&
    /GrowthMapCompetitorLibraryPageMeta:\s+type: object\s+additionalProperties: false\s+required: \[limit, nextCursor, hasNext, coverage\]/.test(
      competitorSchemaBlock,
    ) &&
    competitorSchemaBlock.includes("minItems: 1") &&
    competitorSchemaBlock.includes("maxItems: 100") &&
    competitorSchemaBlock.includes(
      "coverage: { $ref: '#/components/schemas/GrowthMapCoverage' }",
    ),
  "Growth Map Competitor authority must keep closed bounded exact-field cursor contracts",
);
const exportBundleBlock = between(
  files.openapi,
  "    ExportBundle:",
  "    ExportResponse:",
);
const readableBundleSchemaVersions = [
  ...exportBundleBlock.matchAll(
    /^\s+-\s+(signalframe\.service-bundle\.[0-9]+\.[0-9]+\.[0-9]+)\s*$/gm,
  ),
].map((match) => match[1]);
exactSet(
  readableBundleSchemaVersions,
  [HISTORICAL_BUNDLE_SCHEMA_VERSION, BUNDLE_SCHEMA_VERSION],
  "OpenAPI readable export bundle schema versions",
);
check(files.sql.includes(RULE_SET_VERSION), "SQL rule-set version drift");
check(files.sql.includes(PROMPT_SET_VERSION), "SQL prompt-set version drift");
check(
  files.sql.includes(`DEFAULT '${BUNDLE_SCHEMA_VERSION}'`),
  `SQL export schema must default to ${BUNDLE_SCHEMA_VERSION}`,
);
check(
  files.sql.includes(HISTORICAL_BUNDLE_SCHEMA_VERSION) &&
    files.sql.includes(BUNDLE_SCHEMA_VERSION),
  "SQL export schema must preserve historical 0.2.0 rows while accepting current 0.3.0 rows",
);
check(
  files.sql.includes(`DEFAULT '${CONTRACT_VERSION}'`),
  `SQL async-run contract version must default to ${CONTRACT_VERSION}`,
);
check(
  files.sql.includes(
    "origin <> 'generated' OR (analysis_invocation_id IS NOT NULL",
  ),
  "generated evidence lineage check missing",
);
check(
  files.sql.includes("signalframe.evidence-provenance.v2") &&
    files.sql.includes("system evidence must be deterministic derived/computed/B evidence") &&
    files.sql.includes("invocation-backed evidence must be generated LLM grade-C evidence") &&
    files.sql.includes("evidence trust axes do not match observed or derived semantics"),
  "Evidence provenance v2 fingerprint or trust-axis guards are missing",
);
check(
  files.sql.includes("async_runs_one_active_key_idx"),
  "active-run uniqueness index missing",
);
for (const databaseObject of [
  "CREATE OR REPLACE FUNCTION app.reject_async_run_terminal_transition()",
  "CREATE TRIGGER async_runs_terminal_status_immutable",
  "CREATE OR REPLACE FUNCTION app.enforce_export_bundle_invariants()",
  "ADD CONSTRAINT export_bundles_object_key_invariant",
  "CREATE TRIGGER export_bundles_invariant_guard",
  "CREATE OR REPLACE FUNCTION app.is_bcp47_language_tag(candidate text)",
  "CREATE OR REPLACE FUNCTION app.are_bcp47_language_tags(candidates text[])",
  "CREATE OR REPLACE FUNCTION app.enforce_collection_run_provenance()",
  "CREATE OR REPLACE FUNCTION app.enforce_data_snapshot_provenance()",
  "CREATE OR REPLACE FUNCTION app.enforce_normalized_observation_provenance()",
  "CREATE OR REPLACE FUNCTION app.enforce_diagnostic_run_frozen_input()",
  "CREATE OR REPLACE FUNCTION app.enforce_current_diagnostic_manifest()",
  "CREATE OR REPLACE FUNCTION app.expected_diagnostic_rule_version(",
  "CREATE OR REPLACE FUNCTION app.enforce_diagnostic_rule_version_lineage()",
  "CREATE OR REPLACE FUNCTION app.enforce_finding_rule_version_lineage()",
]) {
  check(
    files.sql.includes(databaseObject),
    `cumulative database invariant missing: ${databaseObject}`,
  );
}
for (const constraint of [
  "client_projects_default_delivery_locale_check",
  "sites_language_codes_bcp47_check",
  "diagnostic_runs_output_locale_check",
  "findings_summary_locale_check",
  "actions_content_locale_check",
  "execution_artifacts_output_locale_check",
  "artifact_revisions_output_locale_check",
  "export_bundles_output_locale_check",
]) {
  check(
    files.sql.includes(`ADD CONSTRAINT ${constraint}`),
    `cumulative BCP 47 constraint missing: ${constraint}`,
  );
}
check(
  files.schemaSmoke.includes("ROLLBACK;"),
  "schema smoke test must roll back fixture data",
);
const implementationSchemaSmokePath = path.join(
  appRoot,
  "packages/db/migrations/schema-smoke.sql",
);
check(
  fs.existsSync(implementationSchemaSmokePath),
  "application schema smoke is missing",
);
if (fs.existsSync(implementationSchemaSmokePath)) {
  check(
    files.schemaSmoke === fs.readFileSync(implementationSchemaSmokePath, "utf8"),
    "authority schema smoke must be byte-identical to the application schema smoke",
  );
}
for (const phrase of [
  "expected exactly 44 app tables",
  "expected all 51 named app indexes",
  "expected all 63 app triggers",
  "expected all 16 runtime routines",
  "unavailable observation with zero was accepted",
  "generated evidence without invocation was accepted",
  "append-only evidence update was accepted",
  "ready artifact without a revision was accepted",
  "duplicate audit module result was accepted",
  "capability run mutation was accepted",
  "audit run mutation was accepted",
  "audit module result mutation was accepted",
  "page snapshot mutation was accepted",
  "current diagnostic accepted duplicate provider snapshots",
  "growth audit projection introduced a second status",
  "async run contract-version default is stale",
  "export bundle schema-version compatibility is stale",
  "database migration version projection is stale",
  "product profile invocation reservation was not persisted",
  "a fourth product profile invocation reservation was accepted",
  "unresolved product profile invocation allowed another provider call",
  "product profile provenance accepted a foreign canonical reference",
  "product profile run accepted an unfrozen manifest",
  "Crawl seed accepted a different exact URL",
  "frozen Crawl seed identity was mutated",
  "Finding target ledger relation and resolution constraints are missing",
  "Finding target ledger indexes are incomplete",
  "Finding target lineage and append-only guards are incomplete",
  "Finding target runtime routines are incomplete",
]) {
  check(
    files.schemaSmoke.includes(phrase),
    `PostgreSQL smoke assertion missing: ${phrase}`,
  );
}

let parsedBundleSchema;
try {
  parsedBundleSchema = JSON.parse(files.bundleSchema);
} catch (error) {
  failures.push(`bundle manifest schema is invalid JSON: ${error.message}`);
}
check(
  parsedBundleSchema?.properties?.schemaVersion?.const ===
    BUNDLE_SCHEMA_VERSION,
  `bundle manifest schema must expose ${BUNDLE_SCHEMA_VERSION}`,
);
check(
  parsedBundleSchema?.properties?.productVersion?.const === PRODUCT_VERSION,
  `bundle manifest product version must be ${PRODUCT_VERSION}`,
);
check(
  parsedBundleSchema?.properties?.contractVersion?.const === CONTRACT_VERSION,
  `bundle manifest contract version must be ${CONTRACT_VERSION}`,
);
check(
  parsedBundleSchema?.properties?.ruleSetVersion?.const === RULE_SET_VERSION,
  "bundle manifest rule-set version drift",
);

const declaredOperationBlock = between(
  files.spec,
  "<!-- API_OPERATIONS_START -->",
  "<!-- API_OPERATIONS_END -->",
);
const declaredOperations = [
  ...declaredOperationBlock.matchAll(/^- `([a-z][A-Za-z0-9]+)`/gm),
].map((match) => match[1]);
const openapiOperations = [
  ...files.openapi.matchAll(
    /^\s+operationId:\s*([a-z][A-Za-z0-9]+)\s*$/gm,
  ),
].map((match) => match[1]);
check(
  declaredOperations.length === EXPECTED_OPERATION_COUNT,
  `expected ${EXPECTED_OPERATION_COUNT} declared API operations, got ${declaredOperations.length}`,
);
check(
  openapiOperations.length === EXPECTED_OPERATION_COUNT,
  `expected ${EXPECTED_OPERATION_COUNT} OpenAPI operations, got ${openapiOperations.length}`,
);
exactSet(openapiOperations, declaredOperations, "API operations");

const asyncBlock = between(
  files.spec,
  "<!-- ASYNC_OPERATIONS_START -->",
  "<!-- ASYNC_OPERATIONS_END -->",
);
const asyncOperations = [
  ...asyncBlock.matchAll(/^- `([a-z][A-Za-z0-9]+)`/gm),
].map((match) => match[1]);
check(
  asyncOperations.length === EXPECTED_ASYNC_OPERATION_COUNT,
  `expected ${EXPECTED_ASYNC_OPERATION_COUNT} async operations, got ${asyncOperations.length}`,
);
for (const operationId of asyncOperations) {
  const marker = `operationId: ${operationId}`;
  const start = files.openapi.indexOf(marker);
  const next = files.openapi.indexOf("operationId:", start + marker.length);
  const operationText = files.openapi.slice(
    start,
    next === -1 ? files.openapi.length : next,
  );
  check(start >= 0, `async operation ${operationId} missing from OpenAPI`);
  check(
    /'202':/.test(operationText),
    `async operation ${operationId} has no 202 response`,
  );
  check(
    /AsyncAccepted/.test(operationText),
    `async operation ${operationId} does not use AsyncAccepted`,
  );
}

const tableBlock = between(
  files.spec,
  "<!-- TABLES_START -->",
  "<!-- TABLES_END -->",
);
const declaredTables = [
  ...tableBlock.matchAll(/^- `([a-z][a-z0-9_]+)`/gm),
].map((match) => match[1]);
const sqlTables = [
  ...stripSqlComments(files.sql).matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
  ),
].map((match) => match[1]);
const appTables = applicationMigrationTables();
check(
  declaredTables.length === EXPECTED_TABLE_COUNT,
  `expected ${EXPECTED_TABLE_COUNT} declared tables, got ${declaredTables.length}`,
);
check(
  sqlTables.length === declaredTables.length,
  `expected ${declaredTables.length} SQL tables, got ${sqlTables.length}`,
);
exactSet(sqlTables, declaredTables, "authority SQL tables");
exactSet(appTables, declaredTables, "application migration tables");
for (const tableName of SLICE_1_TABLES) {
  check(
    declaredTables.includes(tableName),
    `required Slice 1 table missing: ${tableName}`,
  );
}

const sqlWithoutComments = stripSqlComments(files.sql);
const tableDefinition = (tableName) => {
  const marker = `CREATE TABLE IF NOT EXISTS app.${tableName}`;
  const start = sqlWithoutComments.indexOf(marker);
  check(start >= 0, `${tableName} table definition missing from authority SQL`);
  const next = sqlWithoutComments.indexOf(
    "CREATE TABLE IF NOT EXISTS app.",
    start + marker.length,
  );
  return start >= 0
    ? sqlWithoutComments.slice(start, next === -1 ? undefined : next)
    : "";
};
const capabilityRuns = tableDefinition("capability_runs");
check(
  /async_run_id\s+uuid\s+PRIMARY KEY\s+REFERENCES\s+app\.async_runs\(id\)\s+ON DELETE RESTRICT/i.test(
    capabilityRuns,
  ),
  "capability_runs must extend canonical async_runs through an ON DELETE RESTRICT primary key",
);
check(
  !/^\s*status\s+/im.test(capabilityRuns),
  "capability_runs must not create a second status lifecycle",
);
const auditRuns = tableDefinition("audit_runs");
check(
  /REFERENCES\s+app\.diagnostic_runs\(id\)\s+ON DELETE RESTRICT/i.test(
    auditRuns,
  ) &&
    /REFERENCES\s+app\.capability_runs\(async_run_id\)\s+ON DELETE RESTRICT/i.test(
      auditRuns,
    ),
  "audit_runs must retain RESTRICT lineage to diagnostic and capability runs",
);
check(
  !/^\s*status\s+/im.test(auditRuns),
  "audit_runs must not create a second status lifecycle",
);
check(
  /CHECK\s*\(diagnostic_run_id\s*=\s*capability_run_id\)/i.test(auditRuns),
  "audit_runs must bind diagnostic and capability projections to the same canonical run",
);
const pageSnapshots = tableDefinition("page_snapshots");
check(
  /data_snapshot_id\s+uuid\s+NOT NULL\s+REFERENCES\s+app\.data_snapshots\(id\)\s+ON DELETE RESTRICT/i.test(
    pageSnapshots,
  ),
  "page_snapshots must retain RESTRICT lineage to canonical data snapshots",
);
check(
  /canonical_extract\s+text/i.test(pageSnapshots) &&
    /CONSTRAINT\s+page_snapshots_canonical_extract_required\s+CHECK\s*\(canonical_extract\s+IS\s+NOT\s+NULL\)/i.test(
      pageSnapshots,
    ),
  "page_snapshots must retain the exact JCS bytes required for new projections",
);
check(
  /CONSTRAINT\s+page_snapshots_site_page_data_snapshot_key\s+UNIQUE\s*\(site_page_id,\s*data_snapshot_id\)/i.test(
    pageSnapshots,
  ),
  "page_snapshots must have one canonical projection per page/source snapshot",
);
check(
  /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+page_snapshots_verified_source_identity_idx[\s\S]*?WHERE\s+canonical_extract\s+IS\s+NOT\s+NULL/i.test(
    sqlWithoutComments,
  ),
  "verified page snapshots must retain their partial unique upgrade index",
);
check(
  /NEW\.captured_at\s+IS\s+DISTINCT\s+FROM\s+source_captured_at/i.test(
    sqlWithoutComments,
  ) &&
    /canonical_extract_json\s+IS\s+DISTINCT\s+FROM\s+NEW\.extract/i.test(
      sqlWithoutComments,
    ) &&
    /digest\s*\(convert_to\s*\(NEW\.canonical_extract,\s*'UTF8'\),\s*'sha256'\)/i.test(
      sqlWithoutComments,
    ),
  "page snapshot trigger must bind capture time, extract, retained JCS bytes, and sha256",
);
const evidence = tableDefinition("evidence");
check(
  /CONSTRAINT\s+evidence_source_lineage_required\s+CHECK[\s\S]*?snapshot_id\s+IS\s+NOT\s+NULL[\s\S]*?collection_run_id\s+IS\s+NOT\s+NULL/i.test(
    evidence,
  ),
  "source-backed evidence must require immutable snapshot and collection lineage",
);
check(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_evidence_provenance\(\)/i.test(
    sqlWithoutComments,
  ) &&
    /frozen_snapshot\.entry\s*->>\s*'snapshotId'\s*=\s*NEW\.snapshot_id::text/i.test(
      sqlWithoutComments,
    ),
  "evidence provenance guard must bind source evidence to the frozen diagnostic manifest",
);

const pageSnapshotLineageMigrationPath = path.join(
  appRoot,
  "packages/db/migrations/0012_page_snapshot_lineage_hardening.sql",
);
const cumulativeMigrationContracts = [];
check(
  fs.existsSync(pageSnapshotLineageMigrationPath),
  "page snapshot lineage hardening migration is missing",
);
if (fs.existsSync(pageSnapshotLineageMigrationPath)) {
  const pageSnapshotLineageMigration = fs.readFileSync(
    pageSnapshotLineageMigrationPath,
    "utf8",
  );
  const pageSnapshotLineageMigrationWithoutComments = stripSqlComments(
    pageSnapshotLineageMigration,
  );
  const pageSnapshotLineageContract = exactExecutableMigrationCoverage({
    authoritySource: files.sql,
    migrationSource: pageSnapshotLineageMigration,
    migrationVersion: "0012_page_snapshot_lineage_hardening",
    failureMessage:
      "authority SQL must embed the exact cumulative 0012 lineage contract as one bounded executable block",
  });
  cumulativeMigrationContracts.push(pageSnapshotLineageContract);
  check(
    /CHECK\s*\(canonical_extract\s+IS\s+NOT\s+NULL\)\s+NOT\s+VALID/i.test(
      pageSnapshotLineageMigrationWithoutComments,
    ) &&
      /WHERE\s+canonical_extract\s+IS\s+NOT\s+NULL/i.test(
        pageSnapshotLineageMigrationWithoutComments,
      ),
    "page snapshot migration must preserve explicit legacy rows while hardening every new row",
  );
  check(
    /ADD\s+CONSTRAINT\s+page_snapshots_site_page_data_snapshot_key[\s\S]*?UNIQUE\s*\(site_page_id,\s*data_snapshot_id\)/i.test(
      pageSnapshotLineageMigrationWithoutComments,
    ) &&
      /NEW\.captured_at\s+IS\s+DISTINCT\s+FROM\s+source_captured_at/i.test(
        pageSnapshotLineageMigrationWithoutComments,
      ) &&
      /canonical_extract_json\s+IS\s+DISTINCT\s+FROM\s+NEW\.extract/i.test(
        pageSnapshotLineageMigrationWithoutComments,
      ) &&
      /digest\s*\(convert_to\s*\(NEW\.canonical_extract,\s*'UTF8'\),\s*'sha256'\)/i.test(
        pageSnapshotLineageMigrationWithoutComments,
      ),
    "application migration must implement page/source uniqueness and the full PageSnapshot lineage guard",
  );
  check(
    !/UPDATE\s+app\.page_snapshots[\s\S]*?SET\s+(?:content_hash|extract|canonical_extract)/i.test(
      pageSnapshotLineageMigrationWithoutComments,
    ) &&
      !/ALTER\s+TABLE\s+app\.page_snapshots[\s\S]*?ALTER\s+COLUMN\s+canonical_extract\s+SET\s+NOT\s+NULL/i.test(
        pageSnapshotLineageMigrationWithoutComments,
      ),
    "page snapshot migration must not rewrite immutable legacy content or hashes",
  );
}
const exactVariantRulesMigrationPath = path.join(
  appRoot,
  "packages/db/migrations/0013_exact_url_variant_rules.sql",
);
check(
  fs.existsSync(exactVariantRulesMigrationPath),
  "exact URL variant rule-set migration is missing",
);
if (fs.existsSync(exactVariantRulesMigrationPath)) {
  const exactVariantRulesMigrationSource = fs.readFileSync(
    exactVariantRulesMigrationPath,
    "utf8",
  );
  const exactVariantRulesMigration = stripSqlComments(
    exactVariantRulesMigrationSource,
  );
  const exactVariantRulesContract = exactExecutableMigrationCoverage({
    authoritySource: files.sql,
    migrationSource: exactVariantRulesMigrationSource,
    migrationVersion: "0013_exact_url_variant_rules",
    failureMessage:
      "authority SQL must embed the exact cumulative 0013 diagnostic and rule-lineage contract as one bounded executable block",
  });
  cumulativeMigrationContracts.push(exactVariantRulesContract);
  check(
    /CHECK\s*\(rule_set_version\s+IN\s*\(\s*'mvp\.rules\.0\.2\.0'\s*,\s*'mvp\.rules\.0\.2\.1'\s*\)\s*\)/i.test(
      exactVariantRulesMigration,
    ),
    "rule-set migration must preserve historical 0.2.0 runs and accept current 0.2.1 runs",
  );
}
const productProfileSynthesisMigrationPath = path.join(
  appRoot,
  "packages/db/migrations/0014_product_profile_synthesis.sql",
);
check(
  fs.existsSync(productProfileSynthesisMigrationPath),
  "Product Profile synthesis migration is missing",
);
if (fs.existsSync(productProfileSynthesisMigrationPath)) {
  const productProfileSynthesisMigrationSource = fs.readFileSync(
    productProfileSynthesisMigrationPath,
    "utf8",
  );
  const productProfileSynthesisContract = exactExecutableMigrationCoverage({
    authoritySource: files.sql,
    migrationSource: productProfileSynthesisMigrationSource,
    migrationVersion: "0014_product_profile_synthesis",
    failureMessage:
      "authority SQL must embed the exact cumulative 0014 Product Profile synthesis and reservation contract as one bounded executable block",
  });
  cumulativeMigrationContracts.push(productProfileSynthesisContract);
  const productProfileSynthesisMigration = stripSqlComments(
    productProfileSynthesisMigrationSource,
  );
  for (const requiredObject of [
    "product_profile_runs",
    "product_profile_invocation_attempts",
    "reserve_product_profile_invocation_attempt",
    "finalize_product_profile_invocation_attempt",
    "mark_product_profile_invocation_outcome_unknown",
    "validate_product_profile_provenance",
  ]) {
    check(
      productProfileSynthesisMigration.includes(requiredObject),
      `Product Profile synthesis migration is missing ${requiredObject}`,
    );
  }
}
const frozenCrawlSeedMigrationPath = path.join(
  appRoot,
  "packages/db/migrations/0015_frozen_crawl_seed.sql",
);
check(
  fs.existsSync(frozenCrawlSeedMigrationPath),
  "frozen Crawl seed migration is missing",
);
if (fs.existsSync(frozenCrawlSeedMigrationPath)) {
  const frozenCrawlSeedMigrationSource = fs.readFileSync(
    frozenCrawlSeedMigrationPath,
    "utf8",
  );
  const frozenCrawlSeedContract = exactExecutableMigrationCoverage({
    authoritySource: files.sql,
    migrationSource: frozenCrawlSeedMigrationSource,
    migrationVersion: "0015_frozen_crawl_seed",
    failureMessage:
      "authority SQL must embed the exact cumulative 0015 frozen Crawl seed contract as one bounded executable block",
  });
  cumulativeMigrationContracts.push(frozenCrawlSeedContract);
  const frozenCrawlSeedMigration = stripSqlComments(
    frozenCrawlSeedMigrationSource,
  );
  check(
    /crawl_seed_site_page_id\s+uuid/i.test(frozenCrawlSeedMigration) &&
      /crawl_seed_url\s+text/i.test(frozenCrawlSeedMigration) &&
      /collection run Crawl seed does not match its exact SitePage identity/i.test(
        frozenCrawlSeedMigration,
      ),
    "frozen Crawl seed migration must bind the exact SitePage identity and URL",
  );
}
const observationSitePageLineageMigrationPath = path.join(
  appRoot,
  "packages/db/migrations/0016_observation_site_page_lineage.sql",
);
check(
  fs.existsSync(observationSitePageLineageMigrationPath),
  "Observation-to-SitePage lineage migration is missing",
);
if (fs.existsSync(observationSitePageLineageMigrationPath)) {
  const observationSitePageLineageMigrationSource = fs.readFileSync(
    observationSitePageLineageMigrationPath,
    "utf8",
  );
  const observationSitePageLineageContract = exactExecutableMigrationCoverage({
    authoritySource: files.sql,
    migrationSource: observationSitePageLineageMigrationSource,
    migrationVersion: "0016_observation_site_page_lineage",
    failureMessage:
      "authority SQL must embed the exact cumulative 0016 Observation-to-SitePage lineage contract as one bounded executable block",
  });
  cumulativeMigrationContracts.push(observationSitePageLineageContract);
  const observationSitePageLineageMigration = stripSqlComments(
    observationSitePageLineageMigrationSource,
  );
  check(
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+site_page_id\s+uuid/i.test(
      observationSitePageLineageMigration,
    ) &&
      /normalized_observations_site_page_fk[\s\S]*?FOREIGN\s+KEY\s*\(site_page_id\)[\s\S]*?REFERENCES\s+app\.site_pages\(id\)\s+ON\s+DELETE\s+RESTRICT/i.test(
        observationSitePageLineageMigration,
      ) &&
      /normalized_observations_site_page_subject_check[\s\S]*?CHECK\s*\(site_page_id\s+IS\s+NULL\s+OR\s+subject_type\s*=\s*'url'\)/i.test(
        observationSitePageLineageMigration,
      ),
    "Observation lineage migration must add the nullable SitePage FK and URL-subject check",
  );
  check(
    /FUNCTION\s+app\.lock_site_page_canonical_subjects\s*\([\s\S]*?cardinality\(subject_refs\)\s+NOT\s+BETWEEN\s+1\s+AND\s+500[\s\S]*?SELECT\s+DISTINCT\s+candidate\.subject_ref[\s\S]*?ORDER\s+BY\s+candidate\.subject_ref[\s\S]*?pg_advisory_xact_lock/i.test(
      observationSitePageLineageMigration,
    ) &&
      /CREATE\s+TRIGGER\s+site_pages_canonical_subject_lock[\s\S]*?EXECUTE\s+FUNCTION\s+app\.lock_site_page_canonical_subject\(\)/i.test(
        observationSitePageLineageMigration,
      ),
    "SitePage lineage migration must acquire bounded canonical-subject locks in deterministic order",
  );
  check(
    /NEW\.value_json\s*->>\s*'fetchUrl'\s+IS\s+DISTINCT\s+FROM\s+page_normalized_url/i.test(
      observationSitePageLineageMigration,
    ) &&
      /NEW\.subject_ref\s+IS\s+DISTINCT\s+FROM\s+canonical_subject/i.test(
        observationSitePageLineageMigration,
      ) &&
      /candidate_count\s*<>\s*1/i.test(observationSitePageLineageMigration) &&
      /HAVING\s+count\(\*\)\s*=\s*1/i.test(
        observationSitePageLineageMigration,
      ),
    "Observation lineage migration must reject forged Crawl identities and bind analytics only at cardinality one",
  );
  check(
    /normalized_observations_site_page_metric_idx/i.test(
      observationSitePageLineageMigration,
    ) &&
      !/\bpage_snapshot_id\b/i.test(observationSitePageLineageMigration) &&
      !/INSERT\s+INTO\s+app\.page_snapshots/i.test(
        observationSitePageLineageMigration,
      ),
    "Observation lineage migration must index exact SitePage reads without fabricating PageSnapshots",
  );
}
const findingTargetLedgerMigrationPath = path.join(
  appRoot,
  "packages/db/migrations/0017_finding_target_ledger.sql",
);
check(
  fs.existsSync(findingTargetLedgerMigrationPath),
  "Finding target ledger migration is missing",
);
if (fs.existsSync(findingTargetLedgerMigrationPath)) {
  const findingTargetLedgerMigrationSource = fs.readFileSync(
    findingTargetLedgerMigrationPath,
    "utf8",
  );
  const findingTargetLedgerContract = exactExecutableMigrationCoverage({
    authoritySource: files.sql,
    migrationSource: findingTargetLedgerMigrationSource,
    migrationVersion: "0017_finding_target_ledger",
    failureMessage:
      "authority SQL must embed the exact cumulative 0017 Finding target ledger contract as one bounded executable block",
  });
  cumulativeMigrationContracts.push(findingTargetLedgerContract);
  const findingTargetLedgerMigration = stripSqlComments(
    findingTargetLedgerMigrationSource,
  );
  check(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.finding_targets/i.test(
      findingTargetLedgerMigration,
    ) &&
      /resolution_state\s+text\s+NOT\s+NULL\s+CHECK\s*\(resolution_state\s+IN\s*\(\s*'resolved'\s*,\s*'unresolved'\s*,\s*'definition_only'\s*\)\s*\)/i.test(
        findingTargetLedgerMigration,
      ) &&
      /basis_kind\s+text\s+NOT\s+NULL\s+CHECK\s*\(basis_kind\s+IN\s*\([\s\S]*?'crawl_exact_fetch'[\s\S]*?'observation_site_page'[\s\S]*?'unresolved_observation'[\s\S]*?'target_definition'/i.test(
        findingTargetLedgerMigration,
      ),
    "Finding target ledger must freeze resolved, unresolved, and definition-only provenance shapes",
  );
  check(
    /finding_last_seen_run_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.diagnostic_run_id/i.test(
      findingTargetLedgerMigration,
    ) &&
      /observation_site_page_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.site_page_id/i.test(
        findingTargetLedgerMigration,
      ) &&
      /page_snapshot\.data_snapshot_id\s*=\s*observation_snapshot_id/i.test(
        findingTargetLedgerMigration,
      ) &&
      /Finding target Observation is not frozen in its DiagnosticRun manifest/i.test(
        findingTargetLedgerMigration,
      ),
    "Finding target ledger must bind the current Finding sighting to exact Observation, SitePage, PageSnapshot, and frozen-run lineage",
  );
  check(
    /CREATE\s+TRIGGER\s+finding_targets_lineage_guard[\s\S]*?EXECUTE\s+FUNCTION\s+app\.enforce_finding_target_lineage\(\)/i.test(
      findingTargetLedgerMigration,
    ) &&
      /CREATE\s+TRIGGER\s+finding_targets_append_only[\s\S]*?EXECUTE\s+FUNCTION\s+app\.reject_append_only_mutation\(\)/i.test(
        findingTargetLedgerMigration,
      ) &&
      /finding_targets_site_page_read_idx/i.test(findingTargetLedgerMigration) &&
      /finding_targets_finding_run_read_idx/i.test(
        findingTargetLedgerMigration,
      ) &&
      /finding_targets_operational_idx/i.test(findingTargetLedgerMigration),
    "Finding target ledger must keep immutable guarded rows and all operational read indexes",
  );
  check(
    !/\b(?:INSERT\s+INTO|UPDATE)\s+app\.finding_targets\b/i.test(
      findingTargetLedgerMigration,
    ),
    "Finding target ledger migration must not backfill or infer historical target membership",
  );
}
const keywordLibraryFoundationMigrationPath = path.join(
  appRoot,
  "packages/db/migrations/0018_keyword_library_foundation.sql",
);
check(
  fs.existsSync(keywordLibraryFoundationMigrationPath),
  "Keyword Library foundation migration is missing",
);
if (fs.existsSync(keywordLibraryFoundationMigrationPath)) {
  const source = fs.readFileSync(keywordLibraryFoundationMigrationPath, "utf8");
  const contract = exactExecutableMigrationCoverage({
    authoritySource: files.sql,
    migrationSource: source,
    migrationVersion: "0018_keyword_library_foundation",
    failureMessage:
      "authority SQL must embed the exact cumulative 0018 Keyword Library foundation contract as one bounded executable block",
  });
  cumulativeMigrationContracts.push(contract);
  const migration = stripSqlComments(source);
  check(
    [
      "keyword_occurrences",
      "keyword_entities",
      "keyword_entity_sources",
    ].every((tableName) =>
      new RegExp(
        `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+app\\.${tableName}\\b`,
        "i",
      ).test(migration),
    ) &&
      /dataforseo\.ranked_keywords\.v1/i.test(migration) &&
      /CREATE\s+TRIGGER\s+keyword_occurrences_lineage_guard/i.test(migration) &&
      /CREATE\s+TRIGGER\s+keyword_entity_sources_lineage_guard/i.test(migration) &&
      /FUNCTION\s+app\.upsert_keyword_library_occurrence/i.test(migration),
    "Keyword Library foundation must freeze stable identities, immutable source occurrences, exact provider datasets, and guarded projection",
  );
}
const competitorLibraryFoundationMigrationPath = path.join(
  appRoot,
  "packages/db/migrations/0019_competitor_library_foundation.sql",
);
check(
  fs.existsSync(competitorLibraryFoundationMigrationPath),
  "Competitor Library foundation migration is missing",
);
if (fs.existsSync(competitorLibraryFoundationMigrationPath)) {
  const source = fs.readFileSync(
    competitorLibraryFoundationMigrationPath,
    "utf8",
  );
  const contract = exactExecutableMigrationCoverage({
    authoritySource: files.sql,
    migrationSource: source,
    migrationVersion: "0019_competitor_library_foundation",
    failureMessage:
      "authority SQL must embed the exact cumulative 0019 Competitor Library foundation contract as one bounded executable block",
  });
  cumulativeMigrationContracts.push(contract);
  const migration = stripSqlComments(source);
  check(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.competitor_entities\b/i.test(
      migration,
    ) &&
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.competitor_origin_occurrences\b/i.test(
        migration,
      ) &&
      /origin_kind\s+IN\s*\(\s*'product_profile'\s*,\s*'csv_keyword_gap'\s*,\s*'manual'/i.test(
        migration,
      ) &&
      /provenance_derivation\s+NOT\s+IN\s*\([\s\S]*?'declared'[\s\S]*?'observed'[\s\S]*?'computed'[\s\S]*?'inferred'/i.test(
        migration,
      ) &&
      /NEW\.source_pointer\s*=\s*'\/valueJson\/competitorDomain'/i.test(
        migration,
      ) &&
      /CREATE\s+TRIGGER\s+competitor_entities_governance_guard/i.test(
        migration,
      ) &&
      /CREATE\s+TRIGGER\s+competitor_origins_lineage_guard/i.test(migration),
    "Competitor Library foundation must freeze governed stable domains and exact Product Profile/CSV/manual lineage",
  );
}
verifyMigrationOwnedDefinitionUniqueness(cumulativeMigrationContracts);
const authorityExecutableStatements = executableSqlStatements(files.sql);
const canonicalSitePageFunctionIndex = authorityExecutableStatements.findIndex(
  (statement) =>
    /^CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_site_page_provenance\s*\(/i.test(
      statement,
    ),
);
const sitePageTriggerDefinitions = authorityExecutableStatements
  .map((statement, index) => ({ statement, index }))
  .filter(({ statement }) =>
    /^CREATE(?:\s+OR\s+REPLACE)?\s+TRIGGER\s+site_pages_provenance_guard\b/i.test(
      statement,
    ),
  );
check(
  canonicalSitePageFunctionIndex >= 0 &&
    sitePageTriggerDefinitions.length === 1 &&
    sitePageTriggerDefinitions[0].index > canonicalSitePageFunctionIndex &&
    /ON\s+app\.site_pages[\s\S]*?EXECUTE\s+FUNCTION\s+app\.enforce_site_page_provenance\(\)/i.test(
      sitePageTriggerDefinitions[0].statement,
    ),
  "site_pages provenance trigger must bind once after its canonical 0012 function",
);
for (const triggerName of [
  "audit_runs_provenance_guard",
  "site_pages_provenance_guard",
  "page_snapshots_provenance_guard",
  "evidence_provenance_guard",
  "collection_runs_provenance_guard",
  "data_snapshots_provenance_guard",
  "normalized_observations_provenance_guard",
  "normalized_observations_site_page_guard",
  "site_pages_canonical_subject_lock",
  "finding_targets_lineage_guard",
  "finding_targets_append_only",
  "diagnostic_runs_frozen_input_guard",
  "diagnostic_runs_current_manifest_guard",
  "diagnostic_run_rules_version_guard",
  "findings_rule_version_guard",
  "capability_runs_append_only",
  "audit_runs_append_only",
  "audit_module_results_append_only",
  "page_snapshots_append_only",
]) {
  check(
    new RegExp(`CREATE\\s+TRIGGER\\s+${triggerName}\\b`, "i").test(
      sqlWithoutComments,
    ),
    `database trigger missing: ${triggerName}`,
  );
}
for (const constraintName of [
  "site_pages_project_id_normalized_url_hash_key",
  "page_snapshots_canonical_extract_required",
  "page_snapshots_site_page_data_snapshot_key",
  "evidence_source_lineage_required",
  "diagnostic_runs_rule_set_version_check",
  "normalized_observations_site_page_fk",
  "normalized_observations_site_page_subject_check",
  "finding_targets_one_direct_root_idx",
  "finding_targets_one_definition_root_idx",
  "finding_targets_one_observation_member_idx",
]) {
  check(
    files.sql.includes(constraintName),
    `cumulative lineage constraint missing: ${constraintName}`,
  );
}
const authorityMigrationVersions = executableSqlStatements(files.sql)
  .map((statement) => statement.match(MIGRATION_VERSION_VIEW_PATTERN)?.[1])
  .filter((version) => version !== undefined);
check(
  authorityMigrationVersions.length === 1 &&
    authorityMigrationVersions[0] === "0019_competitor_library_foundation",
  "authority SQL must define exactly one final 0019 migration-version projection",
);
check(
  /CREATE\s+TRIGGER\s+site_pages_set_updated_at\b/i.test(sqlWithoutComments),
  "site_pages updated_at trigger missing",
);

const ruleDeclarations = [
  ...files.spec.matchAll(
    /`((?:TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3})@([12])`/g,
  ),
].map((match) => ({ id: match[1], version: Number(match[2]) }));
const mvpRules = unique(ruleDeclarations.map((rule) => rule.id));
check(
  mvpRules.length === 11,
  `expected 11 frozen MVP rules, got ${mvpRules.length}`,
);
for (const [ruleId, expectedVersion] of EXPECTED_RULE_VERSIONS) {
  const versions = unique(
    ruleDeclarations
      .filter((rule) => rule.id === ruleId)
      .map((rule) => rule.version),
  );
  check(
    versions.length === 1 && versions[0] === expectedVersion,
    `${ruleId} must be frozen at rule version ${expectedVersion}`,
  );
}
for (const prefix of ["TECH", "SEARCH", "CONTENT", "CRO", "GEO"]) {
  check(
    mvpRules.some((rule) => rule.startsWith(`${prefix}-`)),
    `rule domain ${prefix} is empty`,
  );
}

const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const [fileName, source] of [
  ["README.md", files.readme],
  ["MVP-IMPLEMENTATION-SPEC.md", files.spec],
]) {
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1].split("#", 1)[0];
    if (
      !target ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("#")
    ) {
      continue;
    }
    check(
      fs.existsSync(path.resolve(authorityRoot, target)),
      `${fileName}: broken local link ${match[1]}`,
    );
  }
}

for (const phrase of [
  "phase=authorize",
  "phase=select_property",
  "mode=preview",
  "mode=confirm",
  "baseRevision",
  "outputLocale",
  "同一 DB transaction",
  "DataForSEO",
  "RBAC",
  "Billing",
  "Capability Lenses",
  "Opportunity table",
  "second Action creation path",
  "performance_checkpoints",
  "CMS publishing",
  "content lifecycle",
  "reviewed Slice 1 change sequence",
  "Project → Source/Snapshot/Observation → Evidence → Finding → Finding Review → Action → Artifact Revision → Approval/Authorized Delivery → Recheck/Outcome → Results",
]) {
  check(
    files.spec.includes(phrase),
    `required implementation decision missing: ${phrase}`,
  );
}

if (failures.length > 0) {
  console.error(`Spec verification failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("GenGrowth v0.3 activated authority verified.");
console.log(`- API operations: ${openapiOperations.length}`);
console.log(`- Async operations: ${asyncOperations.length}`);
console.log(`- PostgreSQL application tables: ${appTables.length}`);
console.log(`- Frozen diagnostic rules: ${mvpRules.length}`);
console.log(`- Current implemented machine surface: ${PRODUCT_VERSION}`);
console.log("- Service bundle manifest schema: valid JSON and version-aligned");
console.log("- PostgreSQL smoke assertions: present and rollback-safe");
console.log("- Local Markdown links: valid");
