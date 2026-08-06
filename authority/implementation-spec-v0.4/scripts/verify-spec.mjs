#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractOpenApiOperations,
  listOrderedMigrationSources,
  migrationTableInventory,
  renderAuthoritySchema,
} from "../../../scripts/spec-authority-lib.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultAuthorityRoot = resolve(scriptDirectory, "..");
const sharedAsyncAcceptedPattern =
  /'202':\s*(?:\{\s*)?\$ref:\s*'#\/components\/responses\/AsyncAccepted'\s*(?:\}\s*)?/s;

function parseArguments(argv) {
  const options = {
    authorityRoot: defaultAuthorityRoot,
    appRoot: undefined,
    lockPath: undefined,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    assert.ok(
      value &&
        ["--app-root", "--authority-root", "--lock"].includes(option),
      "usage: verify-spec.mjs [--app-root <repository>] [--authority-root <directory>] [--lock <path>]",
    );
    if (option === "--app-root") options.appRoot = resolve(value);
    if (option === "--authority-root") {
      options.authorityRoot = resolve(value);
    }
    if (option === "--lock") options.lockPath = value;
  }
  options.appRoot ??= resolve(options.authorityRoot, "../..");
  options.lockPath ??= "scripts/spec-v0.4-lock.json";
  return options;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function exactSet(actual, expected, label) {
  const sorted = (values) => [...new Set(values)].sort();
  const duplicates = actual.filter(
    (value, index) => actual.indexOf(value) !== index,
  );
  assert.deepEqual(sorted(duplicates), [], `${label} contains duplicates`);
  assert.deepEqual(
    sorted(actual),
    sorted(expected),
    `${label} drifted from the active lock`,
  );
}

function markerBlock(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `${label} start marker is missing`);
  assert.ok(endIndex > startIndex, `${label} end marker is missing`);
  assert.equal(
    source.indexOf(start, startIndex + start.length),
    -1,
    `${label} start marker is duplicated`,
  );
  assert.equal(
    source.indexOf(end, endIndex + end.length),
    -1,
    `${label} end marker is duplicated`,
  );
  return source.slice(startIndex + start.length, endIndex);
}

function listMarkerValues(source, start, end, label) {
  return [
    ...markerBlock(source, start, end, label).matchAll(
      /^-\s+`([a-z][A-Za-z0-9_-]+)`(?:\s*:\s*\d+)?\s*$/gm,
    ),
  ].map((match) => match[1]);
}

function ruleMarkerVersions(source) {
  const block = markerBlock(
    source,
    "<!-- RULES_BEGIN -->",
    "<!-- RULES_END -->",
    "rule inventory",
  );
  return Object.fromEntries(
    [...block.matchAll(/^-\s+`([^`]+)`:\s*(\d+)\s*$/gm)].map(
      ([, id, version]) => [id, Number(version)],
    ),
  );
}

function operationBlock(openapi, operationId) {
  const marker = `operationId: ${operationId}`;
  const start = openapi.indexOf(marker);
  assert.ok(start >= 0, `OpenAPI operation ${operationId} is missing`);
  const next = openapi.indexOf("operationId:", start + marker.length);
  return openapi.slice(start, next === -1 ? undefined : next);
}

function componentBlock(openapi, componentName) {
  const lines = openapi.split("\n");
  const header = `    ${componentName}:`;
  const start = lines.findIndex((line) => line === header);
  assert.ok(start >= 0, `OpenAPI component ${componentName} is missing`);
  let end = start + 1;
  while (
    end < lines.length &&
    !/^ {4}[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(lines[end])
  ) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function componentPropertyNames(openapi, componentName) {
  const block = componentBlock(openapi, componentName);
  assert.match(
    block,
    /^ {6}properties:\s*$/m,
    `OpenAPI component ${componentName} properties are missing`,
  );
  return [...block.matchAll(/^ {8}([A-Za-z][A-Za-z0-9]*):/gm)].map(
    (match) => match[1],
  );
}

function operationParameterRefs(openapi, operationId) {
  return [
    ...operationBlock(openapi, operationId).matchAll(
      /- \$ref: '#\/components\/parameters\/([A-Za-z][A-Za-z0-9]+)'/g,
    ),
  ].map((match) => match[1]);
}

export function verifyAuthoritySourceSet({
  appRoot,
  authorityRoot,
  lock,
  sources,
}) {
  const {
    readme,
    spec,
    authorityOpenApi,
    implementationOpenApi,
    authoritySchema,
    authoritySmoke,
    implementationSmoke,
    authorityBundleSchema,
    implementationBundleSchema,
  } = sources;

  assert.equal(lock.lockFormat, 3, "active v0.4 lockFormat must be 3");
  assert.equal(lock.authorityVersion, "0.4.0");
  assert.equal(lock.authorityStatus, "active");
  assert.equal(lock.normative, true);
  assert.equal(lock.ruleSetVersion, "mvp.rules.0.2.4");
  assert.equal(lock.ruleVersions["CONTENT-GAP-011"], 2);
  assert.equal(lock.ruleVersions["TECH-LINKGRAPH-005"], 3);
  assert.equal(lock.ruleVersions["TECH-INDEXABILITY-006"], 1);
  assert.equal(
    lock.migrationHead,
    "0044_dataforseo_backlinks",
  );

  assert.match(readme, /状态：\*\*active\*\*/);
  assert.match(readme, /规范性：\*\*normative\*\*/);
  assert.match(spec, /authority_status: active/);
  assert.match(spec, /normative: true/);
  assert.match(spec, /Current v0\.4 external-write boundary: \*\*no external writes\*\*/);
  assert.doesNotMatch(
    `${readme}\n${spec}`,
    /non-normative v0\.4 candidate|状态：\*\*candidate\*\*/i,
  );

  assert.equal(
    authorityOpenApi,
    implementationOpenApi,
    "authority openapi.yaml must be byte-identical to openapi/mvp.yaml",
  );
  assert.equal(
    authoritySmoke,
    implementationSmoke,
    "authority schema-smoke.sql must be byte-identical to the implementation smoke",
  );
  assert.equal(
    authorityBundleSchema,
    implementationBundleSchema,
    "authority bundle schema must be byte-identical to the implementation schema",
  );

  const migrations = listOrderedMigrationSources({
    root: appRoot,
    migrationDirectory: lock.migrationDirectory,
    migrationFilePattern: lock.migrationFilePattern,
  });
  assert.equal(migrations.length, 44, "v0.4 must freeze 44 migrations");
  assert.equal(
    authoritySchema,
    renderAuthoritySchema(migrations),
    "authority schema.sql differs from the deterministic ordered-migration output",
  );
  assert.equal(
    migrations.at(-1)?.migrationVersion,
    lock.migrationHead,
    "ordered migration head drifted from the active lock",
  );

  const tables = migrationTableInventory(migrations);
  exactSet(tables, lock.tables, "application table inventory");
  assert.equal(tables.length, 78, "v0.4 must freeze exactly 78 app tables");
  assert.ok(
    !tables.some((table) => table === "job" || table.startsWith("pgboss")),
    "pg-boss tables are not part of the app inventory",
  );

  const operations = extractOpenApiOperations(authorityOpenApi);
  exactSet(operations, lock.apiOperations, "OpenAPI operation inventory");
  assert.equal(operations.length, 79, "v0.4 must freeze exactly 79 operations");
  const markerOperations = listMarkerValues(
    spec,
    "<!-- API_OPERATIONS_BEGIN -->",
    "<!-- API_OPERATIONS_END -->",
    "API operation inventory",
  );
  exactSet(markerOperations, lock.apiOperations, "narrative API inventory");

  const markerAsync = listMarkerValues(
    spec,
    "<!-- ASYNC_OPERATIONS_BEGIN -->",
    "<!-- ASYNC_OPERATIONS_END -->",
    "shared async inventory",
  );
  exactSet(markerAsync, lock.asyncOperations, "narrative shared async inventory");
  assert.equal(markerAsync.length, 10, "v0.4 must freeze ten shared async operations");
  for (const operationId of lock.asyncOperations) {
    assert.match(
      operationBlock(authorityOpenApi, operationId),
      sharedAsyncAcceptedPattern,
      `${operationId} must use the shared AsyncAccepted response`,
    );
  }
  const sharedAcceptedRefs = (
    authorityOpenApi.match(
      new RegExp(sharedAsyncAcceptedPattern.source, "gs"),
    ) ?? []
  ).length;
  assert.equal(
    sharedAcceptedRefs,
    lock.asyncOperations.length,
    "OpenAPI contains an unclassified shared AsyncAccepted operation",
  );
  const publicCollectionRequest = componentBlock(
    authorityOpenApi,
    "CreateCollectionRunRequest",
  );
  exactSet(
    componentPropertyNames(authorityOpenApi, "CreateCollectionRunRequest"),
    ["operation", "provider", "sourceConnectionId"],
    "public collection request properties",
  );
  assert.match(
    publicCollectionRequest,
    /provider:\s*\{\s*type:\s*string,\s*enum:\s*\[crawl,\s*gsc,\s*ga4\]\s*\}/,
    "public collection provider allowlist must remain exactly crawl/gsc/ga4",
  );
  assert.match(
    publicCollectionRequest,
    /enum:\s*\[site_graph,\s*search_analytics,\s*organic_landing\]/,
    "public collection operation allowlist drifted",
  );
  assert.doesNotMatch(
    publicCollectionRequest,
    /(?:enum|const):[^\n]*(?:dataforseo|search_landscape)/i,
    "public collection request must not expose server-owned DFS Search Landscape",
  );
  const analysisRefreshRequest = componentBlock(
    authorityOpenApi,
    "CreateAnalysisRefreshRunRequest",
  );
  assert.match(
    analysisRefreshRequest,
    /additionalProperties:\s*false[\s\S]*maxProperties:\s*0/,
    "Analysis Refresh request must remain a strict empty object",
  );
  assert.match(
    authorityOpenApi,
    /DataForSEO Search\s+Landscape \(DFS\)/,
    "OpenAPI must identify DFS Search Landscape as a server-owned Analysis Refresh step",
  );
  assert.match(
    authorityOpenApi,
    /analysis-refresh\.plan\.v2[\s\S]*dataforseo_backlinks[\s\S]*Growth Audit/,
    "new Analysis Refresh parents must freeze the six-step v2 plan",
  );
  assert.match(
    authorityOpenApi,
    /default-off rollout gate[\s\S]*500\/1000 backlink rows[\s\S]*20\/20 selective source-page verifications/,
    "DataForSEO Backlinks must retain a default-off bounded rollout",
  );
  assert.match(
    authorityOpenApi,
    /analysis-refresh\.plan\.v1[\s\S]*readable and[\s\S]*resumable/,
    "legacy five-step Analysis Refresh v1 parents must remain readable and resumable",
  );
  const backlinkAuthorityMetric = componentBlock(
    authorityOpenApi,
    "BacklinkAuthorityMetric",
  );
  assert.match(
    backlinkAuthorityMetric,
    /enum:\s*\[domain_rating,\s*domain_authority,\s*dataforseo_rank\]/,
    "Backlink authority scales must include the distinct DataForSEO Rank metric",
  );
  const backlinkSnapshotSource = componentBlock(
    authorityOpenApi,
    "BacklinkSnapshotSource",
  );
  assert.match(
    backlinkSnapshotSource,
    /provider:[\s\S]*enum:\s*\[ahrefs,\s*moz,\s*dataforseo,\s*manual_csv,\s*search_derived\]/,
    "Backlink provider imports must include DataForSEO",
  );
  const backlinkComparison = componentBlock(
    authorityOpenApi,
    "BacklinkComparison",
  );
  assert.match(
    backlinkComparison,
    /provider:\s*\{\s*type:\s*\[string,\s*'null'\],\s*enum:\s*\[ahrefs,\s*moz,\s*dataforseo,\s*null\]\s*\}/,
    "Backlink comparisons must allow like-for-like DataForSEO snapshots",
  );
  const sourcesRead = operationBlock(
    authorityOpenApi,
    "listProjectSources",
  );
  assert.match(
    sourcesRead,
    /Active projects require a confirmed Product Profile and ICP[\s\S]*CONTEXT_INCOMPLETE[\s\S]*Archived projects preserve/,
    "Sources read must gate active projects on confirmed Product/ICP while preserving archived history",
  );
  assert.match(
    sourcesRead,
    /'422':\s*\{\s*\$ref:\s*'#\/components\/responses\/ValidationError'\s*\}/,
    "Sources read must publish its CONTEXT_INCOMPLETE 422 response",
  );

  const diagnosticRunPin = componentBlock(
    authorityOpenApi,
    "DiagnosticRunIdPin",
  );
  assert.match(
    diagnosticRunPin,
    /name:\s*diagnosticRunId[\s\S]*in:\s*query[\s\S]*required:\s*false[\s\S]*format:\s*uuid[\s\S]*pattern:\s*'\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-8\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$'/,
    "diagnosticRunId pin must remain one optional canonical lowercase UUID",
  );
  const reviewView = componentBlock(authorityOpenApi, "ReviewView");
  assert.match(
    reviewView,
    /name:\s*view[\s\S]*in:\s*query[\s\S]*required:\s*false[\s\S]*const:\s*review/,
    "review view must remain the exact optional view=review literal",
  );

  for (const [operationId, expectedParameters] of [
    [
      "listProjectAuditUrls",
      ["ProjectId", "Limit", "Cursor", "DiagnosticRunIdPin"],
    ],
    [
      "getProjectAuditUrl",
      ["ProjectId", "SitePageId", "DiagnosticRunIdPin"],
    ],
    [
      "listProjectAuditKeywords",
      ["ProjectId", "Limit", "Cursor", "DiagnosticRunIdPin"],
    ],
    [
      "getProjectAuditKeyword",
      [
        "ProjectId",
        "KeywordId",
        "DiagnosticRunIdPin",
        "ReviewView",
      ],
    ],
    [
      "listProjectAuditCompetitors",
      ["ProjectId", "Limit", "Cursor", "DiagnosticRunIdPin"],
    ],
    [
      "getProjectAuditCompetitor",
      [
        "ProjectId",
        "CompetitorId",
        "DiagnosticRunIdPin",
        "ReviewView",
      ],
    ],
  ]) {
    exactSet(
      operationParameterRefs(authorityOpenApi, operationId),
      expectedParameters,
      `${operationId} parameter contract`,
    );
  }
  for (const operationId of [
    "getProjectAuditKeyword",
    "getProjectAuditCompetitor",
  ]) {
    assert.match(
      operationBlock(authorityOpenApi, operationId),
      /x-signalframe-query-refinement:\s*reviewViewAndDiagnosticRunIdAreMutuallyExclusive/,
      `${operationId} must keep review view mutually exclusive with the generation pin`,
    );
  }
  for (const [operationId, identityParameter] of [
    ["reviewProjectAuditKeyword", "KeywordId"],
    ["reviewProjectAuditCompetitor", "CompetitorId"],
  ]) {
    exactSet(
      operationParameterRefs(authorityOpenApi, operationId),
      ["ProjectId", identityParameter],
      `${operationId} path-only parameter contract`,
    );
    assert.match(
      operationBlock(authorityOpenApi, operationId),
      /x-signalframe-query-contract:\s*rejectAllQueryParameters/,
      `${operationId} must reject every query parameter`,
    );
  }

  const measurementOperation = operationBlock(
    authorityOpenApi,
    "createProjectMeasurementWindow",
  );
  assert.match(measurementOperation, /'202':/);
  assert.match(
    measurementOperation,
    /MeasurementWindowAcceptedHttpResponse/,
    "measurement 202 must retain its dedicated typed accepted response",
  );
  assert.doesNotMatch(
    measurementOperation,
    /#\/components\/responses\/AsyncAccepted/,
    "measurement 202 must not masquerade as shared AsyncAccepted",
  );

  const markerTables = listMarkerValues(
    spec,
    "<!-- TABLES_BEGIN -->",
    "<!-- TABLES_END -->",
    "table inventory",
  );
  exactSet(markerTables, lock.tables, "narrative table inventory");

  const markerRuleVersions = ruleMarkerVersions(spec);
  exactSet(
    Object.keys(markerRuleVersions),
    lock.rules,
    "narrative rule inventory",
  );
  assert.deepEqual(
    markerRuleVersions,
    lock.ruleVersions,
    "narrative rule versions drifted from the active lock",
  );

  for (const [label, expected, patterns] of [
    ["operations", 79, [/79 个 operation/g]],
    ["shared async operations", 10, [/10 个 shared async operation/g]],
    ["tables", 78, [/78 张应用表/g]],
    ["rules", 12, [/12 条规则/g]],
  ]) {
    const count = patterns.reduce(
      (total, pattern) =>
        total + (readme.match(pattern)?.length ?? 0) + (spec.match(pattern)?.length ?? 0),
      0,
    );
    assert.ok(
      count > 0,
      `authority narrative no longer states the frozen ${label} count ${expected}`,
    );
  }

  return {
    migrationCount: migrations.length,
    migrationHead: migrations.at(-1)?.migrationVersion,
    operationCount: operations.length,
    asyncCount: markerAsync.length,
    tableCount: tables.length,
    ruleCount: Object.keys(markerRuleVersions).length,
    authorityRoot,
  };
}

export function verifyAuthority({
  appRoot,
  authorityRoot,
  lockPath,
}) {
  const resolvedLockPath = isAbsolute(lockPath)
    ? lockPath
    : resolve(appRoot, lockPath);
  const lock = readJson(resolvedLockPath, "active spec lock");
  const readAuthority = (relativePath) =>
    readFileSync(join(authorityRoot, relativePath), "utf8");
  const readApp = (relativePath) =>
    readFileSync(join(appRoot, relativePath), "utf8");

  const index = readJson(
    resolve(appRoot, "authority/index.json"),
    "authority discovery index",
  );
  assert.deepEqual(index.active, {
    version: lock.authorityVersion,
    status: "active",
    normative: true,
    authorityRoot: lock.authorityRoot,
    lockPath: lock.lockPath,
  });
  assert.deepEqual(
    index.history,
    [
      {
        version: "0.3.0",
        status: "historical",
        normative: false,
        authorityRoot: "authority/implementation-spec-v0.3",
        lockPath: "scripts/spec-v0.3-lock.json",
      },
    ],
    "authority discovery must retain exactly the historical v0.3 snapshot",
  );
  assert.deepEqual(index.historicalDesignInputs, [
    {
      label: "v0.4 publication candidate before atomic promotion",
      status: "historical",
      normative: false,
      executable: false,
      path: "authority/implementation-spec-v0.4/historical-publication-candidate",
    },
  ]);
  const historicalCandidateRoot = resolve(
    appRoot,
    index.historicalDesignInputs[0].path,
  );
  assert.ok(
    existsSync(historicalCandidateRoot),
    "historical publication candidate audit trail is missing",
  );
  const historicalReadme = readFileSync(
    resolve(historicalCandidateRoot, "README.md"),
    "utf8",
  );
  assert.match(historicalReadme, /Normative: \*\*false\*\*/);
  assert.match(historicalReadme, /Executable: \*\*false\*\*/);
  const activeCandidateFiles = [
    ...readdirSync(authorityRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
    ...readdirSync(resolve(authorityRoot, "scripts"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => `scripts/${entry.name}`),
  ].filter(
    (name) =>
      /(?:^|[./-])candidate(?:[./-]|$)/i.test(name) ||
      /verify-candidate/i.test(name),
  );
  assert.deepEqual(
    activeCandidateFiles,
    [],
    "candidate machine files must not remain in the active authority root",
  );

  return verifyAuthoritySourceSet({
    appRoot,
    authorityRoot,
    lock,
    sources: {
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
    },
  });
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = verifyAuthority(options);
  console.log(
    `Active v0.4 authority passed: ${result.operationCount} operations, ${result.asyncCount} shared async operations, ${result.tableCount} tables, ${result.ruleCount} rules, ${result.migrationCount} migrations through ${result.migrationHead}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
