#!/usr/bin/env node

/**
 * Clone-local implementation contract gate.
 *
 * This deliberately does not read the sibling implementation-spec or the old
 * SignalFrame repository. Redocly parses the checked-in OpenAPI document into
 * JSON, Node loads the executable rule registry, and every vendored target is
 * verified against the checked-in provenance manifest.
 *
 * `--root <path>` exists so the failure paths can be exercised against an
 * isolated fixture without mutating the real working tree.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRODUCT_VERSION = "0.3.0";
const CONTRACT_VERSION = "2026-07-21";
const RULE_SET_VERSION = "mvp.rules.0.2.1";
const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";
const BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.3.0";
const HISTORICAL_BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.2.0";

const EXPECTED_OPENAPI_OPERATIONS = [
  "listProjects",
  "createProject",
  "getProject",
  "getProjectContext",
  "updateProjectContext",
  "getProjectProductProfile",
  "updateProductProfileDraft",
  "createProductProfileSynthesisRun",
  "reviewProductProfileCompetitor",
  "addProductProfileCompetitor",
  "confirmProductProfile",
  "getProjectWorkspaceView",
  "listProjectSources",
  "connectProjectSource",
  "handleGoogleOAuthCallback",
  "importProjectSourceFile",
  "disconnectProjectSource",
  "createCollectionRun",
  "listProjectSnapshots",
  "getProjectRun",
  "createDiagnosticRun",
  "createGrowthAuditRun",
  "createActionRecheck",
  "listProjectAuditUrls",
  "getProjectAuditUrl",
  "listProjectAuditKeywords",
  "getProjectAuditKeyword",
  "listProjectAuditCompetitors",
  "getProjectAuditCompetitor",
  "getProjectGrowthAudit",
  "getProjectAuditModule",
  "listProjectOpportunities",
  "getProjectOpportunity",
  "getProjectResults",
  "listProjectFindings",
  "reviewProjectFinding",
  "listProjectActions",
  "updateProjectAction",
  "listProjectArtifacts",
  "createActionArtifact",
  "getProjectArtifact",
  "updateProjectArtifact",
  "getProjectReport",
  "createProjectExport",
  "getProjectExport",
];

const EXPECTED_ASYNC_OPERATIONS = [
  "createProductProfileSynthesisRun",
  "importProjectSourceFile",
  "createCollectionRun",
  "createDiagnosticRun",
  "createGrowthAuditRun",
  "createActionRecheck",
  "createActionArtifact",
  "createProjectExport",
];

const EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS = [
  {
    operationId: "createProductProfileSynthesisRun",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/product-profile/synthesis-runs/route.ts",
  },
  {
    operationId: "importProjectSourceFile",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/sources/[sourceRef]/import/route.ts",
  },
  {
    operationId: "createCollectionRun",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/collection-runs/route.ts",
  },
  {
    operationId: "createDiagnosticRun",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/diagnostic-runs/route.ts",
  },
  {
    operationId: "createGrowthAuditRun",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/audit-runs/route.ts",
  },
  {
    operationId: "createActionRecheck",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/recheck/route.ts",
  },
  {
    operationId: "createActionArtifact",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/artifacts/route.ts",
  },
  {
    operationId: "createProjectExport",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/exports/route.ts",
  },
];

const RUN_STATUS_ROUTE_FILE =
  "apps/web/src/app/api/mvp/projects/[projectId]/runs/[runId]/route.ts";

const WEB_PROXY_FILE = "apps/web/src/proxy.ts";
const INTEGRATION_SETUP_FILE =
  "packages/db/src/integration-test-setup.ts";
const INTEGRATION_SETUP_CONFIG_PATH =
  "./packages/db/src/integration-test-setup.ts";

const EXPECTED_TABLES = [
  "workspaces",
  "operator_profiles",
  "client_projects",
  "sites",
  "icp_profiles",
  "source_connections",
  "source_credentials",
  "oauth_intents",
  "import_previews",
  "async_runs",
  "collection_runs",
  "data_snapshots",
  "normalized_observations",
  "provider_discrepancies",
  "diagnostic_runs",
  "diagnostic_run_rules",
  "analysis_invocations",
  "evidence",
  "findings",
  "finding_observations",
  "finding_review_events",
  "actions",
  "action_override_audit",
  "execution_artifacts",
  "artifact_revisions",
  "export_bundles",
  "idempotency_keys",
  "telemetry_events",
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
  "flow_shadow_runs",
  "flow_shadow_research_packs",
  "flow_shadow_qa_gates",
];

const EXPECTED_RULES = [
  "TECH-HTTP-001",
  "TECH-CANONICAL-002",
  "TECH-LINKGRAPH-005",
  "SEARCH-CTR-004",
  "SEARCH-DECAY-002",
  "CONTENT-COVERAGE-001",
  "CONTENT-GAP-011",
  "CRO-PATH-001",
  "CRO-LANDING-003",
  "GEO-ENTITY-001",
  "GEO-CRAWLER-002",
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

const WORKSPACE_PACKAGES = [
  "package.json",
  "apps/web/package.json",
  "apps/worker/package.json",
  "packages/artifacts/package.json",
  "packages/contracts/package.json",
  "packages/db/package.json",
  "packages/engine/package.json",
  "packages/i18n/package.json",
  "packages/observability/package.json",
  "packages/sources/package.json",
];

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

function fail(message) {
  throw new Error(message);
}

function invariant(condition, message) {
  if (!condition) fail(message);
}

function parseRoot(argv) {
  if (argv.length === 0) return SCRIPT_REPO_ROOT;
  if (argv.length === 2 && argv[0] === "--root" && argv[1]) {
    return resolve(argv[1]);
  }
  fail("usage: node scripts/verify-implementation.mjs [--root <repository>]");
}

const root = parseRoot(process.argv.slice(2));

function fromRoot(relativePath) {
  return resolve(root, relativePath);
}

function read(relativePath) {
  return readFileSync(fromRoot(relativePath), "utf8");
}

function readJson(relativePath) {
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    fail(
      `${relativePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function difference(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value));
}

function assertExactSet(actual, expected, label) {
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  const duplicates = actual.filter(
    (value, index) => actual.indexOf(value) !== index,
  );
  invariant(
    missing.length === 0 && extra.length === 0 && duplicates.length === 0,
    `${label} drift (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}; duplicates: ${[...new Set(duplicates)].join(", ") || "none"})`,
  );
}

function assertExactOrder(actual, expected, label) {
  assertExactSet(actual, expected, label);
  invariant(
    actual.every((value, index) => value === expected[index]),
    `${label} order drift (expected ${expected.join(" -> ")}; got ${actual.join(" -> ")})`,
  );
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function bundleOpenApi() {
  const redocly = resolve(
    SCRIPT_REPO_ROOT,
    "node_modules/.bin/redocly",
  );
  const temporaryDirectory = mkdtempSync(
    resolve(tmpdir(), "signalframe-openapi-"),
  );
  const output = resolve(temporaryDirectory, "mvp.json");
  try {
    execFileSync(
      redocly,
      [
        "bundle",
        fromRoot("openapi/mvp.yaml"),
        "--ext",
        "json",
        "--output",
        output,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return JSON.parse(readFileSync(output, "utf8"));
  } catch (error) {
    fail(`cannot parse OpenAPI with the local Redocly CLI: ${formatError(error)}`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function checkOpenApi() {
  const source = read("openapi/mvp.yaml");
  invariant(
    !/\$ref\s*:\s*["']?https?:\/\//i.test(source),
    "OpenAPI must not contain external HTTP references",
  );
  const document = bundleOpenApi();
  invariant(document.openapi === "3.1.0", "OpenAPI version must be 3.1.0");
  invariant(
    document.info?.version === PRODUCT_VERSION,
    `OpenAPI info.version must be ${PRODUCT_VERSION}`,
  );

  const evidenceSchema = document.components?.schemas?.Evidence;
  invariant(
    evidenceSchema && typeof evidenceSchema === "object",
    "OpenAPI Evidence schema is missing",
  );
  invariant(
    Array.isArray(evidenceSchema.required) &&
      ["snapshotId", "collectionRunId", "analysisInvocationId"].every(
        (field) => evidenceSchema.required.includes(field),
      ),
    "OpenAPI Evidence must require explicit nullable provenance identifiers",
  );
  invariant(
    evidenceSchema.properties?.collectionRunId?.format === "uuid" &&
      Array.isArray(evidenceSchema.properties.collectionRunId.type) &&
      evidenceSchema.properties.collectionRunId.type.includes("null"),
    "OpenAPI Evidence collectionRunId must be a nullable UUID",
  );
  invariant(
    Array.isArray(evidenceSchema.oneOf) &&
      [
        "Source-backed Evidence",
        "System-derived Evidence",
        "LLM-generated Evidence",
      ].every((title) =>
        evidenceSchema.oneOf.some((shape) => shape.title === title),
      ),
    "OpenAPI Evidence must preserve the three mutually exclusive provenance shapes",
  );

  const operations = [];
  for (const [pathName, pathItem] of Object.entries(document.paths ?? {})) {
    invariant(
      pathItem && typeof pathItem === "object",
      `OpenAPI path ${pathName} must be an object`,
    );
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      invariant(
        operation && typeof operation === "object",
        `${method.toUpperCase()} ${pathName} must be an operation object`,
      );
      invariant(
        typeof operation.operationId === "string" &&
          operation.operationId.length > 0,
        `${method.toUpperCase()} ${pathName} is missing operationId`,
      );
      operations.push({
        operationId: operation.operationId,
        responses: operation.responses ?? {},
      });
    }
  }

  const operationIds = operations.map((operation) => operation.operationId);
  invariant(
    operationIds.length === EXPECTED_OPENAPI_OPERATIONS.length,
    `expected ${EXPECTED_OPENAPI_OPERATIONS.length} OpenAPI operations, found ${operationIds.length}`,
  );
  assertExactSet(
    operationIds,
    EXPECTED_OPENAPI_OPERATIONS,
    "OpenAPI operationIds",
  );

  const growthMapList =
    document.paths?.["/projects/{projectId}/audit/urls"]?.get;
  const growthMapDetail =
    document.paths?.["/projects/{projectId}/audit/urls/{sitePageId}"]?.get;
  invariant(
    growthMapList?.operationId === "listProjectAuditUrls",
    "Growth Map URL list path/operationId drift",
  );
  invariant(
    growthMapDetail?.operationId === "getProjectAuditUrl",
    "Growth Map URL detail path/operationId drift",
  );
  const listParameterRefs = (growthMapList.parameters ?? [])
    .filter((parameter) => typeof parameter?.$ref === "string")
    .map((parameter) => parameter.$ref);
  assertExactSet(
    listParameterRefs,
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/Limit",
      "#/components/parameters/Cursor",
    ],
    "Growth Map URL list shared parameters",
  );
  const sharedLimit = document.components?.parameters?.Limit?.schema;
  invariant(
    sharedLimit?.type === "integer" &&
      sharedLimit.minimum === 1 &&
      sharedLimit.maximum === 100 &&
      sharedLimit.default === 50,
    "Growth Map URL list limit must remain an integer with default 50 and bounds 1..100",
  );
  const sharedCursor = document.components?.parameters?.Cursor?.schema;
  invariant(
    sharedCursor?.type === "string" &&
      sharedCursor.minLength === 1 &&
      sharedCursor.maxLength === 1024 &&
      sharedCursor.pattern === "^[A-Za-z0-9_-]+$",
    "Growth Map URL list cursor must remain a bounded opaque base64url string",
  );
  const inlineListParameters = (growthMapList.parameters ?? []).filter(
    (parameter) => typeof parameter?.$ref !== "string",
  );
  invariant(
    inlineListParameters.length === 1 &&
      inlineListParameters[0]?.name === "search" &&
      inlineListParameters[0]?.in === "query" &&
      inlineListParameters[0]?.schema?.type === "string" &&
      inlineListParameters[0]?.schema?.minLength === 1 &&
      inlineListParameters[0]?.schema?.maxLength === 256 &&
      inlineListParameters[0]?.schema?.pattern === "\\S",
    "Growth Map URL list query must be exactly limit/cursor/search with bounded search",
  );
  assertExactSet(
    (growthMapDetail.parameters ?? []).map((parameter) => parameter.$ref),
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/SitePageId",
    ],
    "Growth Map URL detail parameters",
  );
  invariant(
    !JSON.stringify([growthMapList, growthMapDetail]).includes("auditRunId"),
    "Growth Map URL reads must not expose historical auditRunId without immutable Finding snapshots",
  );
  invariant(
    growthMapList.responses?.["200"]?.content?.["application/json"]?.schema
      ?.$ref ===
      "#/components/schemas/GrowthMapUrlPortfolioHttpResponse" &&
      growthMapDetail.responses?.["200"]?.content?.["application/json"]
        ?.schema?.$ref ===
        "#/components/schemas/GrowthMapUrlDetailHttpResponse",
    "Growth Map URL reads must return the standard HTTP envelope around the complete read model",
  );
  invariant(
    growthMapList.responses?.["503"]?.$ref ===
      "#/components/responses/DependencyUnavailable" &&
      growthMapDetail.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable",
    "Growth Map URL reads must expose fail-closed frozen-lineage failures as DEPENDENCY_UNAVAILABLE",
  );
  const growthMapFinding =
    document.components?.schemas?.GrowthMapUrlFinding;
  invariant(
    Array.isArray(growthMapFinding?.required) &&
      growthMapFinding.required.includes("reviewRevision") &&
      growthMapFinding.properties?.reviewRevision?.type === "integer" &&
      growthMapFinding.properties.reviewRevision.minimum === 0,
    "Growth Map Finding detail must carry the exact non-negative reviewRevision used for optimistic review concurrency",
  );

  const keywordListPathName = "/projects/{projectId}/audit/keywords";
  const keywordDetailPathName =
    "/projects/{projectId}/audit/keywords/{keywordId}";
  const keywordListPath = document.paths?.[keywordListPathName];
  const keywordDetailPath = document.paths?.[keywordDetailPathName];
  const keywordList = keywordListPath?.get;
  const keywordDetail = keywordDetailPath?.get;
  invariant(
    keywordList?.operationId === "listProjectAuditKeywords",
    "Growth Map Keyword list path/operationId drift",
  );
  invariant(
    keywordDetail?.operationId === "getProjectAuditKeyword",
    "Growth Map Keyword detail path/operationId drift",
  );
  assertExactSet(
    Object.keys(keywordListPath ?? {}).filter((key) => HTTP_METHODS.has(key)),
    ["get"],
    "Growth Map Keyword list methods",
  );
  assertExactSet(
    Object.keys(keywordDetailPath ?? {}).filter((key) => HTTP_METHODS.has(key)),
    ["get"],
    "Growth Map Keyword detail methods",
  );
  const keywordListParameterRefs = (keywordList.parameters ?? []).map(
    (parameter) => parameter.$ref,
  );
  assertExactSet(
    keywordListParameterRefs,
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/Limit",
      "#/components/parameters/Cursor",
    ],
    "Growth Map Keyword list query must be exactly limit/cursor",
  );
  invariant(
    keywordListParameterRefs.every((reference) => typeof reference === "string"),
    "Growth Map Keyword list query must be exactly limit/cursor",
  );
  assertExactSet(
    (keywordDetail.parameters ?? []).map((parameter) => parameter.$ref),
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/KeywordId",
    ],
    "Growth Map Keyword detail parameters",
  );
  invariant(
    keywordList.responses?.["200"]?.content?.["application/json"]?.schema
      ?.$ref ===
      "#/components/schemas/GrowthMapKeywordLibraryHttpResponse" &&
      keywordDetail.responses?.["200"]?.content?.["application/json"]
        ?.schema?.$ref ===
        "#/components/schemas/GrowthMapKeywordDetailHttpResponse",
    "Growth Map Keyword reads must return the standard HTTP envelope around the complete read model",
  );
  invariant(
    keywordList.responses?.["422"]?.$ref ===
      "#/components/responses/ValidationError" &&
      keywordList.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable" &&
      keywordDetail.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable",
    "Growth Map Keyword reads must expose cursor validation and fail-closed dependency errors",
  );

  const keywordSchemas = document.components?.schemas ?? {};
  const canonicalLibraryLanguageTag =
    keywordSchemas.GrowthMapLibraryLanguageTag;
  invariant(
    canonicalLibraryLanguageTag?.$ref ===
      "#/components/schemas/LocaleCode" &&
      canonicalLibraryLanguageTag["x-signalframe-runtime-refinement"] ===
        "canonicalIntlLocale",
    "Growth Map Library language tags must document the canonical Intl.Locale runtime refinement",
  );
  const keywordSourceOccurrence =
    keywordSchemas.GrowthMapKeywordSourceOccurrence;
  invariant(
    keywordSourceOccurrence?.discriminator?.propertyName === "sourceKind",
    "Growth Map Keyword source occurrence discriminator drift",
  );
  assertExactSet(
    Object.keys(keywordSourceOccurrence?.discriminator?.mapping ?? {}),
    ["csv_import", "dataforseo_ranked", "gsc_top_query", "manual"],
    "Growth Map Keyword source occurrence discriminator drift",
  );
  assertExactSet(
    (keywordSourceOccurrence?.oneOf ?? []).map((shape) => shape.$ref),
    [
      "#/components/schemas/GrowthMapKeywordCsvImportOccurrence",
      "#/components/schemas/GrowthMapKeywordDataForSeoRankedOccurrence",
      "#/components/schemas/GrowthMapKeywordGscTopQueryOccurrence",
      "#/components/schemas/GrowthMapKeywordManualOccurrence",
    ],
    "Growth Map Keyword source occurrence discriminator drift",
  );

  const keywordMappedTarget = keywordSchemas.GrowthMapKeywordMappedTarget;
  invariant(
    keywordMappedTarget?.discriminator?.propertyName === "kind",
    "Growth Map Keyword mapped target discriminator drift",
  );
  assertExactSet(
    Object.keys(keywordMappedTarget?.discriminator?.mapping ?? {}),
    ["unassigned", "existing_page", "new_asset"],
    "Growth Map Keyword mapped target discriminator drift",
  );
  assertExactSet(
    (keywordMappedTarget?.oneOf ?? []).map((shape) => shape.$ref),
    [
      "#/components/schemas/GrowthMapKeywordUnassignedTarget",
      "#/components/schemas/GrowthMapKeywordExistingPageTarget",
      "#/components/schemas/GrowthMapKeywordNewAssetTarget",
    ],
    "Growth Map Keyword mapped target discriminator drift",
  );

  const canonicalKeywordMetricPointers = new Map([
    ["GrowthMapKeywordVolumeMetric", "/valueJson/searchVolume"],
    [
      "GrowthMapKeywordDifficultyMetric",
      "/valueJson/keywordDifficulty",
    ],
    ["GrowthMapKeywordCurrentRankMetric", "/valueJson/currentRank"],
    ["GrowthMapKeywordCurrentUrlMetric", "/valueJson/currentUrl"],
    [
      "GrowthMapKeywordCompetitorDomainMetric",
      "/valueJson/competitorDomain",
    ],
    [
      "GrowthMapKeywordCompetitorRankMetric",
      "/valueJson/competitorRank",
    ],
  ]);
  for (const [schemaName, pointer] of canonicalKeywordMetricPointers) {
    invariant(
      keywordSchemas[schemaName]?.properties?.valuePointer?.const === pointer,
      `Growth Map Keyword canonical metric pointer drift: ${schemaName}`,
    );
  }

  const closedKeywordSchemas = [
    "GrowthMapKeywordUnassignedTarget",
    "GrowthMapKeywordExistingPageTarget",
    "GrowthMapKeywordNewAssetTarget",
    "GrowthMapKeywordCsvImportOccurrence",
    "GrowthMapKeywordDataForSeoRankedOccurrence",
    "GrowthMapKeywordGscTopQueryOccurrence",
    "GrowthMapKeywordManualOccurrence",
    ...canonicalKeywordMetricPointers.keys(),
    "GrowthMapKeywordMetricLimitations",
    "GrowthMapKeywordMetrics",
    "GrowthMapKeywordClusterRef",
    "GrowthMapKeywordClassificationLimitations",
    "GrowthMapKeywordLibraryItem",
    "GrowthMapKeywordLibraryPageMeta",
    "GrowthMapKeywordLibraryResponse",
    "GrowthMapKeywordDetailResponse",
    "GrowthMapKeywordLibraryHttpResponse",
    "GrowthMapKeywordDetailHttpResponse",
  ];
  for (const schemaName of closedKeywordSchemas) {
    invariant(
      keywordSchemas[schemaName]?.additionalProperties === false,
      `Growth Map Keyword schema must be closed: ${schemaName}`,
    );
  }

  const keywordItem = keywordSchemas.GrowthMapKeywordLibraryItem;
  assertExactSet(
    Object.keys(keywordItem?.properties ?? {}),
    [
      "projectId",
      "keywordId",
      "displayKeyword",
      "normalizedKeyword",
      "marketCode",
      "languageTag",
      "queryKind",
      "status",
      "revision",
      "intent",
      "buyerStage",
      "cluster",
      "classificationLimitations",
      "mappedTarget",
      "sourceOccurrences",
      "metrics",
      "coverage",
    ],
    "Growth Map Keyword item fields",
  );
  assertExactSet(
    keywordItem?.required ?? [],
    Object.keys(keywordItem?.properties ?? {}),
    "Growth Map Keyword item required fields",
  );
  invariant(
    keywordItem?.properties?.sourceOccurrences?.minItems === 1 &&
      keywordItem.properties.sourceOccurrences.maxItems === 100 &&
      keywordItem.properties.coverage?.$ref ===
        "#/components/schemas/GrowthMapCoverage",
    "Growth Map Keyword item must retain bounded source lineage and explicit coverage",
  );
  const canonicalKeywordLanguageReferences =
    source.match(
      /languageTag: \{ \$ref: '#\/components\/schemas\/GrowthMapLibraryLanguageTag' \}/g,
    ) ?? [];
  invariant(
    canonicalKeywordLanguageReferences.length === 5,
    `Growth Map Keyword canonical language-tag reference drift: expected 5 references, found ${canonicalKeywordLanguageReferences.length}`,
  );

  const keywordMetrics = keywordSchemas.GrowthMapKeywordMetrics;
  assertExactSet(
    Object.keys(keywordMetrics?.properties ?? {}),
    [
      "volume",
      "kd",
      "currentRank",
      "currentUrl",
      "competitorDomain",
      "competitorRank",
      "limitations",
    ],
    "Growth Map Keyword metrics fields",
  );
  invariant(
    keywordMetrics?.properties?.limitations?.$ref ===
      "#/components/schemas/GrowthMapKeywordMetricLimitations",
    "Growth Map Keyword metrics must preserve explicit field limitations",
  );

  const keywordPage = keywordSchemas.GrowthMapKeywordLibraryResponse;
  const keywordPageMeta = keywordSchemas.GrowthMapKeywordLibraryPageMeta;
  assertExactSet(
    Object.keys(keywordPage?.properties ?? {}),
    ["projectId", "data", "meta"],
    "Growth Map Keyword cursor page fields",
  );
  assertExactSet(
    keywordPage?.required ?? [],
    Object.keys(keywordPage?.properties ?? {}),
    "Growth Map Keyword cursor page required fields",
  );
  assertExactSet(
    Object.keys(keywordPageMeta?.properties ?? {}),
    ["limit", "nextCursor", "hasNext", "coverage"],
    "Growth Map Keyword cursor page metadata fields",
  );
  assertExactSet(
    keywordPageMeta?.required ?? [],
    Object.keys(keywordPageMeta?.properties ?? {}),
    "Growth Map Keyword cursor page metadata required fields",
  );
  invariant(
    keywordPage?.properties?.data?.maxItems === 100 &&
      keywordPageMeta?.properties?.coverage?.$ref ===
        "#/components/schemas/GrowthMapCoverage",
    "Growth Map Keyword cursor page must remain bounded with explicit coverage",
  );

  const competitorListPathName =
    "/projects/{projectId}/audit/competitors";
  const competitorDetailPathName =
    "/projects/{projectId}/audit/competitors/{competitorId}";
  assertExactSet(
    Object.keys(document.paths ?? {}).filter((pathName) =>
      pathName.startsWith(competitorListPathName),
    ),
    [competitorListPathName, competitorDetailPathName],
    "Growth Map Competitor read paths",
  );
  const competitorListPath = document.paths?.[competitorListPathName];
  const competitorDetailPath = document.paths?.[competitorDetailPathName];
  const competitorList = competitorListPath?.get;
  const competitorDetail = competitorDetailPath?.get;
  invariant(
    competitorList?.operationId === "listProjectAuditCompetitors",
    "Growth Map Competitor list path/operationId drift",
  );
  invariant(
    competitorDetail?.operationId === "getProjectAuditCompetitor",
    "Growth Map Competitor detail path/operationId drift",
  );
  assertExactSet(
    Object.keys(competitorListPath ?? {}).filter((key) =>
      HTTP_METHODS.has(key),
    ),
    ["get"],
    "Growth Map Competitor list methods",
  );
  assertExactSet(
    Object.keys(competitorDetailPath ?? {}).filter((key) =>
      HTTP_METHODS.has(key),
    ),
    ["get"],
    "Growth Map Competitor detail methods",
  );
  const competitorListParameterRefs = (
    competitorList?.parameters ?? []
  ).map((parameter) => parameter.$ref);
  invariant(
    competitorListParameterRefs.every(
      (reference) => typeof reference === "string",
    ),
    "Growth Map Competitor list query must be exactly limit/cursor",
  );
  assertExactSet(
    competitorListParameterRefs,
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/Limit",
      "#/components/parameters/Cursor",
    ],
    "Growth Map Competitor list query must be exactly limit/cursor",
  );
  assertExactSet(
    (competitorDetail?.parameters ?? []).map(
      (parameter) => parameter.$ref,
    ),
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/CompetitorId",
    ],
    "Growth Map Competitor detail parameters",
  );
  invariant(
    competitorList?.responses?.["200"]?.content?.["application/json"]
      ?.schema?.$ref ===
      "#/components/schemas/GrowthMapCompetitorLibraryHttpResponse" &&
      competitorDetail?.responses?.["200"]?.content?.[
        "application/json"
      ]?.schema?.$ref ===
        "#/components/schemas/GrowthMapCompetitorDetailHttpResponse",
    "Growth Map Competitor reads must return the standard HTTP envelope around the complete read model",
  );
  invariant(
    competitorList?.responses?.["422"]?.$ref ===
      "#/components/responses/ValidationError" &&
      competitorList.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable" &&
      competitorDetail?.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable",
    "Growth Map Competitor reads must expose cursor validation and fail-closed dependency errors",
  );

  const competitorSchemas = document.components?.schemas ?? {};
  const assertClosedRequiredCompetitorSchema = (schemaName, fields) => {
    const schema = competitorSchemas[schemaName];
    invariant(
      schema?.additionalProperties === false,
      `Growth Map Competitor schema must be closed: ${schemaName}`,
    );
    assertExactSet(
      Object.keys(schema?.properties ?? {}),
      fields,
      `Growth Map Competitor schema fields: ${schemaName}`,
    );
    assertExactSet(
      schema?.required ?? [],
      fields,
      `Growth Map Competitor schema required fields: ${schemaName}`,
    );
  };
  assertExactSet(
    competitorSchemas.GrowthMapCompetitorReviewStatus?.enum ?? [],
    ["candidate", "approved", "excluded"],
    "Growth Map Competitor review statuses",
  );
  assertExactSet(
    competitorSchemas.GrowthMapCompetitorRelationship?.enum ?? [],
    ["direct", "indirect", "status_quo", "benchmark", "publisher"],
    "Growth Map Competitor relationships",
  );
  const competitorOriginKinds = [
    "product_profile",
    "csv_keyword_gap",
    "manual",
    "serp_overlap",
    "ai_citation",
  ];
  assertExactSet(
    competitorSchemas.GrowthMapCompetitorOriginKind?.enum ?? [],
    competitorOriginKinds,
    "Growth Map Competitor origin kinds",
  );

  const competitorOriginOccurrence =
    competitorSchemas.GrowthMapCompetitorOriginOccurrence;
  invariant(
    competitorOriginOccurrence?.discriminator?.propertyName ===
      "originKind",
    "Growth Map Competitor origin occurrence discriminator drift",
  );
  assertExactSet(
    Object.keys(
      competitorOriginOccurrence?.discriminator?.mapping ?? {},
    ),
    competitorOriginKinds,
    "Growth Map Competitor origin occurrence discriminator drift",
  );
  const competitorOriginSchemaNames = [
    "GrowthMapCompetitorProductProfileOrigin",
    "GrowthMapCompetitorCsvKeywordGapOrigin",
    "GrowthMapCompetitorManualOrigin",
    "GrowthMapCompetitorSerpOverlapOrigin",
    "GrowthMapCompetitorAiCitationOrigin",
  ];
  assertExactSet(
    (competitorOriginOccurrence?.oneOf ?? []).map(
      (shape) => shape.$ref,
    ),
    competitorOriginSchemaNames.map(
      (schemaName) => `#/components/schemas/${schemaName}`,
    ),
    "Growth Map Competitor origin occurrence union drift",
  );

  const competitorOriginFields = new Map([
    [
      "GrowthMapCompetitorProductProfileOrigin",
      [
        "occurrenceId",
        "observedAt",
        "originKind",
        "productProfileId",
        "profileVersion",
        "candidateId",
        "fieldProvenancePath",
        "evidenceRefs",
      ],
    ],
    [
      "GrowthMapCompetitorCsvKeywordGapOrigin",
      [
        "occurrenceId",
        "observedAt",
        "originKind",
        "snapshotId",
        "observationId",
        "sourcePointer",
        "importPreviewId",
        "evidenceRefs",
      ],
    ],
    [
      "GrowthMapCompetitorManualOrigin",
      [
        "occurrenceId",
        "observedAt",
        "originKind",
        "manualEntryId",
        "evidenceRefs",
      ],
    ],
    [
      "GrowthMapCompetitorSerpOverlapOrigin",
      [
        "occurrenceId",
        "observedAt",
        "originKind",
        "snapshotId",
        "observationId",
        "evidenceRefs",
      ],
    ],
    [
      "GrowthMapCompetitorAiCitationOrigin",
      [
        "occurrenceId",
        "observedAt",
        "originKind",
        "snapshotId",
        "observationId",
        "evidenceRefs",
      ],
    ],
  ]);
  for (const [schemaName, fields] of competitorOriginFields) {
    assertClosedRequiredCompetitorSchema(schemaName, fields);
  }
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorEvidenceRef",
    ["kind", "evidenceId"],
  );
  invariant(
    competitorSchemas.GrowthMapCompetitorEvidenceRef?.properties?.kind
      ?.const === "evidence",
    "Growth Map Competitor canonical app Evidence discriminator drift",
  );
  const productProfileOrigin =
    competitorSchemas.GrowthMapCompetitorProductProfileOrigin;
  invariant(
    productProfileOrigin?.properties?.originKind?.const ===
      "product_profile" &&
      productProfileOrigin.properties?.fieldProvenancePath?.$ref ===
        "#/components/schemas/GrowthMapCompetitorProfileFieldProvenancePath" &&
      competitorSchemas.GrowthMapCompetitorProfileFieldProvenancePath
        ?.pattern === "^/competitorCandidates(?:/[0-9]+)?$" &&
      productProfileOrigin.properties?.evidenceRefs?.items?.$ref ===
        "#/components/schemas/ProductProfileEvidenceRef" &&
      productProfileOrigin.properties.evidenceRefs.maxItems === 50 &&
      productProfileOrigin.properties.evidenceRefs.uniqueItems === true,
    "Growth Map Competitor product_profile origin must keep its strict typed Product Profile evidence contract",
  );
  const csvKeywordGapOrigin =
    competitorSchemas.GrowthMapCompetitorCsvKeywordGapOrigin;
  invariant(
    csvKeywordGapOrigin?.properties?.originKind?.const ===
      "csv_keyword_gap" &&
      csvKeywordGapOrigin.properties?.sourcePointer?.const ===
        "/valueJson/competitorDomain",
    "Growth Map Competitor csv_keyword_gap origin discriminator or canonical pointer drift",
  );
  const manualOrigin = competitorSchemas.GrowthMapCompetitorManualOrigin;
  invariant(
    manualOrigin?.properties?.originKind?.const === "manual",
    "Growth Map Competitor manual origin discriminator drift",
  );
  for (const schemaName of competitorOriginSchemaNames.slice(1)) {
    const evidenceRefs =
      competitorSchemas[schemaName]?.properties?.evidenceRefs;
    invariant(
      evidenceRefs?.items?.$ref ===
        "#/components/schemas/GrowthMapCompetitorEvidenceRef" &&
        evidenceRefs.maxItems === 100 &&
        evidenceRefs.uniqueItems === true,
      `Growth Map Competitor canonical app Evidence refs drift: ${schemaName}`,
    );
  }

  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorUnavailableInsight",
    ["availability", "value", "limitation"],
  );
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorAvailableSerpOverlap",
    [
      "snapshotId",
      "observationId",
      "valuePointer",
      "observedAt",
      "limitation",
      "availability",
      "value",
    ],
  );
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorAvailableAiCitationInsight",
    [
      "snapshotId",
      "observationId",
      "valuePointer",
      "observedAt",
      "limitation",
      "availability",
      "value",
    ],
  );
  invariant(
    competitorSchemas.GrowthMapCompetitorUnavailableInsight?.properties
      ?.availability?.const === "unavailable" &&
      competitorSchemas.GrowthMapCompetitorUnavailableInsight.properties
        ?.value?.type === "null",
    "Growth Map Competitor unavailable insight discriminator drift",
  );
  const competitorInsightUnions = new Map([
    [
      "GrowthMapCompetitorSerpOverlap",
      "GrowthMapCompetitorAvailableSerpOverlap",
    ],
    [
      "GrowthMapCompetitorAiCitationInsight",
      "GrowthMapCompetitorAvailableAiCitationInsight",
    ],
  ]);
  for (const [unionName, availableName] of competitorInsightUnions) {
    const union = competitorSchemas[unionName];
    invariant(
      union?.discriminator?.propertyName === "availability",
      `Growth Map Competitor insight availability discriminator drift: ${unionName}`,
    );
    assertExactSet(
      Object.keys(union?.discriminator?.mapping ?? {}),
      ["unavailable", "available"],
      `Growth Map Competitor insight availability discriminator drift: ${unionName}`,
    );
    assertExactSet(
      (union?.oneOf ?? []).map((shape) => shape.$ref),
      [
        "#/components/schemas/GrowthMapCompetitorUnavailableInsight",
        `#/components/schemas/${availableName}`,
      ],
      `Growth Map Competitor insight union drift: ${unionName}`,
    );
  }
  invariant(
    competitorSchemas.GrowthMapCompetitorAvailableSerpOverlap?.properties
      ?.availability?.const === "available" &&
      competitorSchemas.GrowthMapCompetitorAvailableSerpOverlap.properties
        ?.valuePointer?.const === "/valueJson/serpOverlap" &&
      competitorSchemas.GrowthMapCompetitorAvailableAiCitationInsight
        ?.properties?.availability?.const === "available" &&
      competitorSchemas.GrowthMapCompetitorAvailableAiCitationInsight
        .properties?.valuePointer?.const ===
        "/valueJson/aiCitationInsight",
    "Growth Map Competitor available insight canonical Observation pointer drift",
  );

  const competitorItemFields = [
    "projectId",
    "competitorId",
    "domain",
    "name",
    "reviewStatus",
    "relationship",
    "analysisScope",
    "revision",
    "originOccurrences",
    "lastObservedAt",
    "serpOverlap",
    "aiCitationInsight",
    "coverage",
  ];
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorLibraryItem",
    competitorItemFields,
  );
  const competitorItem =
    competitorSchemas.GrowthMapCompetitorLibraryItem;
  invariant(
    competitorItem?.properties?.reviewStatus?.$ref ===
      "#/components/schemas/GrowthMapCompetitorReviewStatus" &&
      competitorItem.properties?.analysisScope?.items?.$ref ===
        "#/components/schemas/ProductProfileCompetitorAnalysisScope" &&
      competitorItem.properties.analysisScope.maxItems === 5 &&
      competitorItem.properties.analysisScope.uniqueItems === true &&
      competitorItem.properties?.originOccurrences?.items?.$ref ===
        "#/components/schemas/GrowthMapCompetitorOriginOccurrence" &&
      competitorItem.properties.originOccurrences.minItems === 1 &&
      competitorItem.properties.originOccurrences.maxItems === 100 &&
      competitorItem.properties?.coverage?.$ref ===
        "#/components/schemas/GrowthMapCoverage" &&
      competitorItem["x-signalframe-runtime-refinement"] ===
        "competitorReviewStateAndExactOriginInsightLineage",
    "Growth Map Competitor item must preserve review, bounded origin, exact insight lineage, and coverage semantics",
  );

  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorLibraryPageMeta",
    ["limit", "nextCursor", "hasNext", "coverage"],
  );
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorLibraryResponse",
    ["projectId", "data", "meta"],
  );
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorDetailResponse",
    ["projectId", "data"],
  );
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorLibraryHttpResponse",
    ["data"],
  );
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorDetailHttpResponse",
    ["data"],
  );
  const competitorPage =
    competitorSchemas.GrowthMapCompetitorLibraryResponse;
  const competitorPageMeta =
    competitorSchemas.GrowthMapCompetitorLibraryPageMeta;
  invariant(
    competitorPage?.properties?.data?.maxItems === 100 &&
      competitorPage.properties?.meta?.$ref ===
        "#/components/schemas/GrowthMapCompetitorLibraryPageMeta" &&
      competitorPageMeta?.properties?.coverage?.$ref ===
        "#/components/schemas/GrowthMapCoverage" &&
      competitorPageMeta.properties?.limit?.minimum === 1 &&
      competitorPageMeta.properties.limit.maximum === 100,
    "Growth Map Competitor cursor page must remain bounded with exact metadata and explicit coverage",
  );

  const asyncOperations = operations.filter(
    (operation) => operation.responses["202"] !== undefined,
  );
  invariant(
    asyncOperations.length === EXPECTED_ASYNC_OPERATIONS.length,
    `expected ${EXPECTED_ASYNC_OPERATIONS.length} async 202 operations, found ${asyncOperations.length}`,
  );
  assertExactSet(
    asyncOperations.map((operation) => operation.operationId),
    EXPECTED_ASYNC_OPERATIONS,
    "OpenAPI async operationIds",
  );
  for (const operation of asyncOperations) {
    invariant(
      operation.responses["202"]?.$ref ===
        "#/components/responses/AsyncAccepted",
      `${operation.operationId} must use the shared AsyncAccepted 202 response`,
    );
  }

  const asyncData =
    document.components?.schemas?.AsyncAcceptedResponse?.properties?.data;
  invariant(
    Array.isArray(asyncData?.required) &&
      asyncData.required.includes("statusUrl"),
    "AsyncAcceptedResponse.data must require statusUrl",
  );
  invariant(
    typeof asyncData?.properties?.statusUrl?.pattern === "string" &&
      asyncData.properties.statusUrl.pattern.includes("/runs/"),
    "AsyncAcceptedResponse.statusUrl must point to the canonical run endpoint",
  );

  const readableBundleSchemaVersions =
    document.components?.schemas?.ExportBundle?.properties?.schemaVersion?.enum;
  invariant(
    Array.isArray(readableBundleSchemaVersions),
    "ExportBundle.schemaVersion must enumerate readable bundle versions",
  );
  assertExactSet(
    readableBundleSchemaVersions,
    [HISTORICAL_BUNDLE_SCHEMA_VERSION, BUNDLE_SCHEMA_VERSION],
    "OpenAPI readable export bundle schema versions",
  );

  return `OpenAPI: ${EXPECTED_OPENAPI_OPERATIONS.length} operations, ${EXPECTED_ASYNC_OPERATIONS.length} shared 202 statusUrl operations`;
}

function checkAsyncRouteImplementations() {
  invariant(
    EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.length === EXPECTED_ASYNC_OPERATIONS.length,
    `expected exactly ${EXPECTED_ASYNC_OPERATIONS.length} runtime async route implementations`,
  );
  assertExactSet(
    EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.map((route) => route.operationId),
    EXPECTED_ASYNC_OPERATIONS,
    "runtime async route operationIds",
  );
  assertExactSet(
    EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.map((route) => route.file),
    [
      ...new Set(
        EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.map((route) => route.file),
      ),
    ],
    "runtime async route files",
  );

  for (const route of EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS) {
    const source = read(route.file);
    invariant(
      /import\s*\{[^}]*\basyncAccepted\b[^}]*\}\s*from\s*["']@\/lib\/http\/respond["'];?/s.test(
        source,
      ),
      `${route.operationId} must import the shared asyncAccepted responder`,
    );
    const sharedReturns = source.match(
      /\breturn\s+asyncAccepted\s*\(/g,
    ) ?? [];
    invariant(
      sharedReturns.length === 1,
      `${route.operationId} must return through asyncAccepted exactly once (found ${sharedReturns.length})`,
    );
    invariant(
      !/\bNextResponse\s*\.\s*json\s*\(/.test(source),
      `${route.operationId} must not construct a direct NextResponse.json response`,
    );
    invariant(
      !/\bstatus\s*:\s*202\b/.test(source),
      `${route.operationId} must not construct a direct 202 response`,
    );
  }

  const responder = read("apps/web/src/lib/http/respond.ts");
  invariant(
    /export\s+function\s+asyncAccepted\b/.test(responder) &&
      /\breturn\s+ok\s*\(/.test(responder) &&
      /\bstatus\s*:\s*202\b/.test(responder) &&
      /headers\s*:\s*\{\s*Location\s*:\s*location\s*,\s*["']Retry-After["']\s*:\s*["']1["']\s*\}/s.test(
        responder,
      ),
    "shared asyncAccepted responder must preserve the { data } envelope, 202 status, Location, and Retry-After",
  );

  return `async runtime: ${EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.length} route handlers use the shared asyncAccepted envelope`;
}

function checkRunPollingImplementation() {
  const source = read(RUN_STATUS_ROUTE_FILE);
  invariant(
    /import\s*\{[^}]*\brunPollingHeaders\b[^}]*\}\s*from\s*["']@\/lib\/services\/runs["'];?/s.test(
      source,
    ),
    "canonical run status route must import runPollingHeaders",
  );
  invariant(
    /headers\s*:\s*runPollingHeaders\s*\(\s*run\.status\s*\)\s*\?\?\s*\{\s*\}/s.test(
      source,
    ),
    "canonical run status route must derive response headers from runPollingHeaders(run.status)",
  );
  invariant(
    !/["']Retry-After["']\s*:/.test(source),
    "canonical run status route must not duplicate Retry-After state logic",
  );

  const service = read("apps/web/src/lib/services/runs.ts");
  invariant(
    /export\s+function\s+runPollingHeaders\b/.test(service),
    "runPollingHeaders must remain an exported shared service helper",
  );

  return "run polling: canonical status route delegates Retry-After state handling";
}

async function checkWebProxyImplementation() {
  const boundaryPattern = /^(?:proxy|middleware)\.(?:[cm]?[jt]sx?)$/;
  const boundaryEntrypoints = ["apps/web", "apps/web/src"].flatMap(
    (directory) =>
      readdirSync(fromRoot(directory))
        .filter((fileName) => boundaryPattern.test(fileName))
        .map((fileName) => `${directory}/${fileName}`),
  );
  invariant(
    existsSync(fromRoot(WEB_PROXY_FILE)),
    `Next.js request boundary must exist at ${WEB_PROXY_FILE}`,
  );
  assertExactSet(
    boundaryEntrypoints,
    [WEB_PROXY_FILE],
    "Next.js request boundary entrypoints",
  );

  const proxy = read(WEB_PROXY_FILE);
  invariant(
    /import\s*\{\s*buildContentSecurityPolicy\s*\}\s*from\s*["']\.\.\/security-headers\.ts["'];?/.test(
      proxy,
    ),
    "src/proxy.ts must import the shared CSP builder",
  );
  invariant(
    /buildContentSecurityPolicy\s*\(\s*process\.env\[\s*["']NODE_ENV["']\s*\]\s*===\s*["']development["']\s*,\s*nonce\s*,?\s*\)/s.test(
      proxy,
    ),
    "src/proxy.ts must enable CSP relaxations only in explicit development mode",
  );
  invariant(
    /function\s+requestHeaderOverrides\s*\([^)]*\bcsp\s*:\s*string[^)]*\)[\s\S]*?headers\.set\s*\(\s*["']Content-Security-Policy["']\s*,\s*csp\s*\)[\s\S]*?return\s+headers\s*;/s.test(
      proxy,
    ),
    "src/proxy.ts must propagate CSP through request header overrides",
  );
  invariant(
    /NextResponse\.next\s*\(\s*\{\s*request\s*:\s*\{\s*headers\s*\}\s*\}\s*\)/s.test(
      proxy,
    ),
    "src/proxy.ts must pass overridden request headers to NextResponse.next",
  );
  invariant(
    /function\s+secure\s*\([^)]*\bresponse\s*:\s*NextResponse[^)]*\bcsp\s*:\s*string[^)]*\)[\s\S]*?response\.headers\.set\s*\(\s*["']Content-Security-Policy["']\s*,\s*csp\s*\)[\s\S]*?return\s+response\s*;/s.test(
      proxy,
    ) && /\breturn\s+secure\s*\(/.test(proxy),
    "src/proxy.ts must attach the same CSP to outgoing responses",
  );

  const securityHeaders = read("apps/web/security-headers.ts");
  invariant(
    /export\s+function\s+buildContentSecurityPolicy\b/.test(securityHeaders),
    "buildContentSecurityPolicy must remain an exported shared builder",
  );
  const securityHeadersUrl = pathToFileURL(
    fromRoot("apps/web/security-headers.ts"),
  );
  securityHeadersUrl.searchParams.set("implementation-check", String(Date.now()));
  const securityHeadersModule = await import(securityHeadersUrl.href);
  const buildCsp = securityHeadersModule.buildContentSecurityPolicy;
  invariant(
    typeof buildCsp === "function",
    "buildContentSecurityPolicy must be executable by the implementation gate",
  );

  const nonce = "implementation-check-nonce";
  const productionCsp = buildCsp(false, nonce);
  const developmentCsp = buildCsp(true, nonce);
  const directive = (csp, name) =>
    csp
      .split(";")
      .map((value) => value.trim())
      .find((value) => value === name || value.startsWith(`${name} `)) ?? "";
  const productionScript = directive(productionCsp, "script-src");
  const productionStyle = directive(productionCsp, "style-src");
  const developmentScript = directive(developmentCsp, "script-src");
  const developmentStyle = directive(developmentCsp, "style-src");

  invariant(
    productionScript.includes(`'nonce-${nonce}'`) &&
      productionScript.includes("'strict-dynamic'") &&
      !productionScript.includes("'unsafe-eval'") &&
      !productionScript.includes("'unsafe-inline'"),
    "production script-src must be nonce/strict-dynamic gated without unsafe relaxations",
  );
  invariant(
    productionStyle === `style-src 'self' 'nonce-${nonce}'`,
    "production style-src must remain nonce-gated without unsafe-inline",
  );
  invariant(
    developmentScript.includes(`'nonce-${nonce}'`) &&
      developmentScript.includes("'strict-dynamic'") &&
      developmentScript.includes("'unsafe-eval'"),
    "development script-src must retain the Next runtime relaxation and nonce",
  );
  invariant(
    developmentStyle === "style-src 'self' 'unsafe-inline'" &&
      !developmentStyle.includes("'nonce-"),
    "development style-src must permit Next DevTools styles without a nonce",
  );

  const devAuthUrl = pathToFileURL(
    fromRoot("apps/web/src/lib/auth/dev.ts"),
  );
  devAuthUrl.searchParams.set("implementation-check", String(Date.now()));
  const devAuthModule = await import(devAuthUrl.href);
  const isDevAuthEnabled = devAuthModule.isDevAuthEnabled;
  invariant(
    typeof isDevAuthEnabled === "function",
    "the local development auth gate must remain executable",
  );
  const localDevelopment = {
    NODE_ENV: "development",
    APP_ORIGIN: "http://127.0.0.1:3000",
    SF_DEV_AUTH: "true",
  };
  invariant(
    isDevAuthEnabled(localDevelopment) === true,
    "the explicit loopback development harness must remain available",
  );
  for (const unsafeEnvironment of [
    { ...localDevelopment, NODE_ENV: "test" },
    { ...localDevelopment, NODE_ENV: "staging" },
    { ...localDevelopment, NODE_ENV: "production" },
    { ...localDevelopment, APP_ORIGIN: "https://staging.example.com" },
    { ...localDevelopment, APP_ORIGIN: "https://localhost.example.com" },
  ]) {
    invariant(
      isDevAuthEnabled(unsafeEnvironment) === false,
      "SF_DEV_AUTH must fail closed outside exact loopback development",
    );
  }

  const webPackage = readJson("apps/web/package.json");
  invariant(
    typeof webPackage.scripts?.dev === "string" &&
      /\bnext\s+dev\b/.test(webPackage.scripts.dev) &&
      /(?:--hostname|-H)\s+127\.0\.0\.1\b/.test(webPackage.scripts.dev),
    "the supported Next development command must bind to 127.0.0.1 when local dev auth can be enabled",
  );

  const session = read("apps/web/src/lib/auth/session.ts");
  invariant(
    /if\s*\(\s*isDevAuthEnabled\(\)\s*\)/.test(session),
    "operator bootstrap must remain behind the shared local-development gate",
  );
  invariant(
    /if\s*\(\s*isDevAuthEnabled\(\)\s*\)/.test(proxy),
    "the proxy auth bypass must remain behind the shared local-development gate",
  );
  const e2eShell = read("apps/web/src/app/p/[projectId]/_e2e-shell.ts");
  invariant(
    /isLoopbackDevelopmentRuntime\s*\(\s*env\s*\)/.test(e2eShell) &&
      /env\[\s*["']SF_E2E_MOCK_API["']\s*\]\s*===\s*["']true["']/.test(
        e2eShell,
      ),
    "the mock project shell must remain behind the loopback-development gate",
  );

  return "web boundary: src/proxy.ts propagates nonce CSP without production unsafe relaxations";
}

function stripCodeComments(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (char === "\n" || char === "\r") {
        state = "code";
        result += char;
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }
    if (state === "single-quote" || state === "double-quote" || state === "template") {
      result += char;
      if (char === "\\") {
        if (next !== undefined) {
          result += next;
          index += 1;
        }
        continue;
      }
      if (
        (state === "single-quote" && char === "'") ||
        (state === "double-quote" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += char;
      if (char === "'") state = "single-quote";
      else if (char === '"') state = "double-quote";
      else if (char === "`") state = "template";
    }
  }
  return result;
}

function walkSourceFiles(relativeDirectory) {
  const files = [];
  for (const entry of readdirSync(fromRoot(relativeDirectory), {
    withFileTypes: true,
  })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === "coverage"
      ) {
        continue;
      }
      files.push(...walkSourceFiles(relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function checkIntegrationDatabaseSafety() {
  const config = stripCodeComments(read("vitest.config.ts"));
  const integrationMarkers = [
    ...config.matchAll(/\bname\s*:\s*["']integration["']/g),
  ];
  invariant(
    integrationMarkers.length === 1,
    `vitest.config.ts must define exactly one integration project (found ${integrationMarkers.length})`,
  );

  const integrationStart = integrationMarkers[0].index;
  const remaining = config.slice(integrationStart + 1);
  const nextProjectMarker = remaining.search(
    /\bname\s*:\s*["'][^"']+["']/,
  );
  const integrationProject = config.slice(
    integrationStart,
    nextProjectMarker === -1
      ? undefined
      : integrationStart + 1 + nextProjectMarker,
  );
  invariant(
    new RegExp(
      `\\bsetupFiles\\s*:\\s*\\[\\s*["']${INTEGRATION_SETUP_CONFIG_PATH.replaceAll(
        ".",
        "\\.",
      )}["']\\s*\\]`,
    ).test(integrationProject),
    `the Vitest integration project must load ${INTEGRATION_SETUP_CONFIG_PATH} through setupFiles`,
  );

  const setup = stripCodeComments(read(INTEGRATION_SETUP_FILE));
  invariant(
    /\bimport\s*\{\s*requireSafeTestDatabaseUrl\s*\}\s*from\s*["']\.\/test-database-safety\.ts["'];?/.test(
      setup,
    ),
    `${INTEGRATION_SETUP_FILE} must import requireSafeTestDatabaseUrl from test-database-safety.ts`,
  );
  invariant(
    /\bimport\s*\{\s*runMigrations\s*\}\s*from\s*["']\.\/migrate\.ts["'];?/.test(
      setup,
    ),
    `${INTEGRATION_SETUP_FILE} must import runMigrations from migrate.ts`,
  );
  const safeDatabaseBinding = setup.match(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*requireSafeTestDatabaseUrl\s*\(\s*process\.env\s*\[\s*["']DATABASE_URL["']\s*\]/,
  );
  invariant(
    safeDatabaseBinding,
    `${INTEGRATION_SETUP_FILE} must bind requireSafeTestDatabaseUrl(process.env["DATABASE_URL"]) before schema bootstrap`,
  );
  invariant(
    new RegExp(
      `\\bawait\\s+runMigrations\\s*\\(\\s*${safeDatabaseBinding[1]}\\s*\\)`,
    ).test(setup),
    `${INTEGRATION_SETUP_FILE} must migrate only the URL returned by requireSafeTestDatabaseUrl`,
  );

  const integrationSources = ["apps", "packages"]
    .flatMap(walkSourceFiles)
    .filter(
      (relativePath) =>
        /(?:^|[./_-])integration(?:[./_-]|$)/i.test(relativePath) ||
        /(?:^|[./_-])harness(?:[./_-]|$)/i.test(relativePath),
    )
    .filter((relativePath) => /\.[cm]?[jt]sx?$/.test(relativePath));
  const unsafeDefaults = integrationSources.filter((relativePath) =>
    /signalframe_mvp_dev/.test(read(relativePath)),
  );
  invariant(
    unsafeDefaults.length === 0,
    `integration tests and harnesses must not contain a signalframe_mvp_dev fallback (${unsafeDefaults.join(
      ", ",
    )})`,
  );

  return `integration safety: Vitest preflight validates DATABASE_URL and migrates the disposable database; ${integrationSources.length} integration/harness sources have no dev-database fallback`;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n\r]*/g, "");
}

function checkDatabaseContract() {
  const migrationsDirectory = fromRoot("packages/db/migrations");
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter(
      (fileName) =>
        fileName.endsWith(".sql") && fileName !== "schema-smoke.sql",
    )
    .sort();
  invariant(migrationFiles.length > 0, "at least one SQL migration is required");
  const migration = stripSqlComments(
    migrationFiles
      .map((fileName) =>
        read(`packages/db/migrations/${fileName}`),
      )
      .join("\n"),
  );
  const tables = [
    ...migration.matchAll(
      /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.([a-z][a-z0-9_]*)\s*\(/gi,
    ),
  ].map((match) => match[1]);
  invariant(
    tables.length === EXPECTED_TABLES.length,
    `expected ${EXPECTED_TABLES.length} app tables in the migrations, found ${tables.length}`,
  );
  assertExactSet(tables, EXPECTED_TABLES, "application tables");
  invariant(
    !tables.some((table) => table.startsWith("pgboss") || table === "job"),
    "pg-boss tables must not be counted as application tables",
  );

  const tableDefinition = (tableName) => {
    const marker = `CREATE TABLE IF NOT EXISTS app.${tableName}`;
    const start = migration.indexOf(marker);
    invariant(start >= 0, `${tableName} table definition is missing`);
    const next = migration.indexOf("CREATE TABLE IF NOT EXISTS app.", start + marker.length);
    return migration.slice(start, next === -1 ? undefined : next);
  };
  const capabilityRuns = tableDefinition("capability_runs");
  invariant(
    /async_run_id\s+uuid\s+PRIMARY KEY\s+REFERENCES\s+app\.async_runs\(id\)\s+ON DELETE RESTRICT/i.test(
      capabilityRuns,
    ),
    "capability_runs must extend the canonical async run with an ON DELETE RESTRICT primary key",
  );
  invariant(
    !/^\s*status\s+/im.test(capabilityRuns),
    "capability_runs must not create a second mutable status lifecycle",
  );

  const auditRuns = tableDefinition("audit_runs");
  invariant(
    /REFERENCES\s+app\.diagnostic_runs\(id\)\s+ON DELETE RESTRICT/i.test(auditRuns) &&
      /REFERENCES\s+app\.capability_runs\(async_run_id\)\s+ON DELETE RESTRICT/i.test(
        auditRuns,
      ),
    "audit_runs must retain RESTRICT lineage to canonical diagnostic and capability runs",
  );
  invariant(
    !/^\s*status\s+/im.test(auditRuns),
    "audit_runs must not create a second mutable status lifecycle",
  );
  invariant(
    /CHECK\s*\(diagnostic_run_id\s*=\s*capability_run_id\)/i.test(auditRuns),
    "audit_runs must bind diagnostic and capability projections to the same canonical run",
  );

  const pageSnapshots = tableDefinition("page_snapshots");
  invariant(
    /data_snapshot_id\s+uuid\s+NOT NULL\s+REFERENCES\s+app\.data_snapshots\(id\)\s+ON DELETE RESTRICT/i.test(
      pageSnapshots,
    ),
    "page_snapshots must retain RESTRICT lineage to canonical data snapshots",
  );
  invariant(
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+canonical_extract\s+text/i.test(
      migration,
    ) &&
      /CHECK\s*\(canonical_extract\s+IS\s+NOT\s+NULL\)\s+NOT\s+VALID/i.test(
        migration,
      ),
    "page_snapshots must preserve legacy rows while requiring retained application bytes on every new row",
  );
  invariant(
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+page_snapshots_verified_source_identity_idx[\s\S]*?WHERE\s+canonical_extract\s+IS\s+NOT\s+NULL/i.test(
      migration,
    ),
    "verified page snapshots must be unique by page and canonical source snapshot",
  );
  invariant(
    /NEW\.captured_at\s+IS\s+DISTINCT\s+FROM\s+source_captured_at/i.test(
      migration,
    ) &&
      /canonical_extract_json\s+IS\s+DISTINCT\s+FROM\s+NEW\.extract/i.test(
        migration,
      ) &&
      /digest\s*\(convert_to\s*\(NEW\.canonical_extract,\s*'UTF8'\),\s*'sha256'\)/i.test(
        migration,
      ),
    "page snapshot provenance must bind capture time, JSON semantics, application-retained bytes, and sha256 without claiming database-side JCS validation",
  );
  invariant(
    !/UPDATE\s+app\.page_snapshots[\s\S]*?SET\s+(?:content_hash|extract|canonical_extract)/i.test(
      migration,
    ),
    "page snapshot hardening must not rewrite immutable legacy content or hashes",
  );

  const findingTargets = tableDefinition("finding_targets");
  invariant(
    /finding_id\s+uuid\s+NOT NULL[\s\S]*?REFERENCES\s+app\.findings\(id\)\s+ON DELETE RESTRICT/i.test(
      findingTargets,
    ) &&
      /diagnostic_run_id\s+uuid\s+NOT NULL[\s\S]*?REFERENCES\s+app\.diagnostic_runs\(id\)\s+ON DELETE RESTRICT/i.test(
        findingTargets,
      ) &&
      /source_observation_id\s+uuid[\s\S]*?REFERENCES\s+app\.normalized_observations\(id\)\s+ON DELETE RESTRICT/i.test(
        findingTargets,
      ),
    "finding_targets must retain immutable Finding, DiagnosticRun, and Observation lineage",
  );
  invariant(
    /resolution_state\s+text\s+NOT NULL\s+CHECK\s*\(resolution_state\s+IN\s*\(\s*'resolved','unresolved','definition_only'/i.test(
      findingTargets,
    ) &&
      /basis_kind\s+text\s+NOT NULL\s+CHECK\s*\(basis_kind\s+IN\s*\(\s*'crawl_exact_fetch',\s*'observation_site_page',\s*'unresolved_observation',\s*'target_definition'/i.test(
        findingTargets,
      ),
    "finding_targets must distinguish resolved, unresolved, and definition-only provenance",
  );
  invariant(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.finding_target_relation_key\b/i.test(
      migration,
    ) &&
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_finding_target_lineage\b/i.test(
        migration,
      ),
    "finding target identity and frozen-lineage guards must be database-owned",
  );

  for (const indexName of [
    "audit_runs_project_created_idx",
    "site_pages_project_updated_idx",
    "site_pages_site_idx",
    "page_snapshots_page_captured_idx",
    "page_snapshots_project_captured_idx",
    "finding_targets_one_direct_root_idx",
    "finding_targets_one_definition_root_idx",
    "finding_targets_one_observation_member_idx",
    "finding_targets_site_page_read_idx",
    "finding_targets_finding_run_read_idx",
    "finding_targets_operational_idx",
  ]) {
    invariant(
      new RegExp(
        `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+IF NOT EXISTS\\s+${indexName}\\b`,
        "i",
      ).test(
        migration,
      ),
      `required Slice 1 index is missing: ${indexName}`,
    );
  }
  for (const triggerName of [
    "audit_runs_provenance_guard",
    "site_pages_provenance_guard",
    "page_snapshots_provenance_guard",
    "capability_runs_append_only",
    "audit_runs_append_only",
    "audit_module_results_append_only",
    "page_snapshots_append_only",
    "finding_targets_lineage_guard",
    "finding_targets_append_only",
  ]) {
    invariant(
      new RegExp(`CREATE\\s+TRIGGER\\s+${triggerName}\\b`, "i").test(migration),
      `required Slice 1 provenance/immutability trigger is missing: ${triggerName}`,
    );
  }
  invariant(
    /CREATE\s+TRIGGER\s+site_pages_set_updated_at\b/i.test(migration),
    "site_pages must retain the shared updated_at trigger",
  );
  invariant(
    /ALTER\s+TABLE\s+app\.async_runs\s+ALTER\s+COLUMN\s+contract_version\s+SET\s+DEFAULT\s+'2026-07-21'/i.test(
      migration,
    ),
    "new async runs must default to contract 2026-07-21",
  );
  invariant(
    /ALTER\s+TABLE\s+app\.export_bundles[\s\S]{0,300}?ALTER\s+COLUMN\s+schema_version\s+SET\s+DEFAULT\s+'signalframe\.service-bundle\.0\.3\.0'/i.test(
      migration,
    ) &&
      migration.includes("signalframe.service-bundle.0.2.0") &&
      migration.includes("signalframe.service-bundle.0.3.0"),
    "new exports must default to bundle 0.3.0 while preserving historical 0.2.0 rows",
  );

  const smoke = read("packages/db/migrations/schema-smoke.sql");
  invariant(
    /\bROLLBACK\s*;\s*$/.test(smoke),
    "schema-smoke.sql must finish with ROLLBACK",
  );
  return `database: ${EXPECTED_TABLES.length} app tables (pg-boss excluded)`;
}

async function importSource(relativePath) {
  const url = pathToFileURL(fromRoot(relativePath));
  url.searchParams.set("implementation-check", String(Date.now()));
  return import(url.href);
}

function loadRuleContract() {
  const registryUrl = pathToFileURL(
    fromRoot("packages/engine/src/registry.ts"),
  ).href;
  const rulesUrl = pathToFileURL(
    fromRoot("packages/engine/src/rules/index.ts"),
  ).href;
  const evaluation = `
    import * as registryModule from ${JSON.stringify(registryUrl)};
    import { ALL_RULES } from ${JSON.stringify(rulesUrl)};
    process.stdout.write(JSON.stringify({
      RULE_SET_VERSION: registryModule.RULE_SET_VERSION,
      PROMPT_SET_VERSION: registryModule.PROMPT_SET_VERSION,
      FINDING_REGISTRY: registryModule.FINDING_REGISTRY,
      ALL_RULES: ALL_RULES.map(({ id, version, domain }) => ({ id, version, domain })),
    }));
  `;
  try {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        evaluation,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return JSON.parse(output);
  } catch (error) {
    fail(`cannot load executable rules through tsx: ${formatError(error)}`);
  }
}

function checkRuleContract() {
  const registryModule = loadRuleContract();
  invariant(
    registryModule.RULE_SET_VERSION === RULE_SET_VERSION,
    `RULE_SET_VERSION must be ${RULE_SET_VERSION}`,
  );
  invariant(
    registryModule.PROMPT_SET_VERSION === PROMPT_SET_VERSION,
    `PROMPT_SET_VERSION must be ${PROMPT_SET_VERSION}`,
  );

  const registry = registryModule.FINDING_REGISTRY;
  invariant(
    registry && typeof registry === "object",
    "FINDING_REGISTRY must be an object",
  );
  assertExactSet(Object.keys(registry), EXPECTED_RULES, "finding registry");

  const rules = registryModule.ALL_RULES;
  invariant(Array.isArray(rules), "ALL_RULES must be an array");
  const ruleIds = rules.map((rule) => rule.id);
  invariant(
    ruleIds.length === 11,
    `expected 11 executable rules, found ${ruleIds.length}`,
  );
  assertExactOrder(ruleIds, EXPECTED_RULES, "executable frozen rules");
  for (const rule of rules) {
    const expectedVersion = EXPECTED_RULE_VERSIONS.get(rule.id);
    invariant(
      rule.version === expectedVersion,
      `${rule.id} must remain at rule version ${expectedVersion}`,
    );
    invariant(
      registry[rule.id]?.domain === rule.domain,
      `${rule.id} domain differs between ALL_RULES and FINDING_REGISTRY`,
    );
  }
  return "diagnostics: 11 executable frozen rules in canonical order";
}

async function checkVersions() {
  for (const packagePath of WORKSPACE_PACKAGES) {
    const packageJson = readJson(packagePath);
    invariant(
      packageJson.version === PRODUCT_VERSION,
      `${packagePath} version must be ${PRODUCT_VERSION}`,
    );
  }

  const health = await importSource("packages/contracts/src/zod/health.ts");
  invariant(
    health.PRODUCT_VERSION === PRODUCT_VERSION,
    `health PRODUCT_VERSION must be ${PRODUCT_VERSION}`,
  );
  invariant(
    health.CONTRACT_VERSION === CONTRACT_VERSION,
    `health CONTRACT_VERSION must be ${CONTRACT_VERSION}`,
  );

  const schema = readJson("schemas/service-bundle-manifest.schema.json");
  invariant(
    schema.properties?.schemaVersion?.const === BUNDLE_SCHEMA_VERSION,
    `bundle schemaVersion must be ${BUNDLE_SCHEMA_VERSION}`,
  );
  invariant(
    schema.properties?.productVersion?.const === PRODUCT_VERSION,
    `bundle productVersion must be ${PRODUCT_VERSION}`,
  );
  invariant(
    schema.properties?.contractVersion?.const === CONTRACT_VERSION,
    `bundle contractVersion must be ${CONTRACT_VERSION}`,
  );
  invariant(
    schema.properties?.ruleSetVersion?.const === RULE_SET_VERSION,
    `bundle ruleSetVersion must be ${RULE_SET_VERSION}`,
  );
  invariant(
    typeof schema.$id === "string" && schema.$id.endsWith(`/${PRODUCT_VERSION}`),
    `bundle schema $id must end with /${PRODUCT_VERSION}`,
  );

  return `versions: product ${PRODUCT_VERSION}, contract ${CONTRACT_VERSION}`;
}

function assertSafeRelativePath(value, label) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    `${label} must be a non-empty string`,
  );
  invariant(!isAbsolute(value), `${label} must be repository-relative`);
  const normalized = resolve(root, value);
  const rel = relative(root, normalized);
  invariant(
    rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    `${label} escapes the repository root`,
  );
  return normalized;
}

function checkVendorManifest() {
  const manifestPath = "docs/vendor/signalframe-manifest.json";
  const manifest = readJson(manifestPath);
  invariant(
    typeof manifest.purpose === "string" && manifest.purpose.trim().length > 0,
    "vendor manifest purpose is required",
  );
  invariant(
    typeof manifest.sourceRepo === "string" &&
      manifest.sourceRepo.trim().length > 0,
    "vendor manifest sourceRepo is required",
  );
  invariant(
    /^[0-9a-f]{40}$/.test(manifest.sourceRepoHeadAtBaseline ?? ""),
    "vendor manifest sourceRepoHeadAtBaseline must be a 40-character git SHA",
  );
  invariant(
    Array.isArray(manifest.allowedSources) &&
      manifest.allowedSources.length > 0 &&
      manifest.allowedSources.every(
        (entry) => typeof entry === "string" && entry.trim().length > 0,
      ),
    "vendor manifest allowedSources must be a non-empty string array",
  );
  invariant(
    Array.isArray(manifest.entries) && manifest.entries.length > 0,
    "vendor manifest entries must be a non-empty array",
  );

  const rootRealPath = `${realpathSync(root)}${sep}`;
  const targetPaths = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `vendor entry ${index + 1}`;
    invariant(
      entry && typeof entry === "object" && !Array.isArray(entry),
      `${label} must be an object`,
    );
    invariant(
      /^[0-9a-f]{40}$/.test(entry.sourceCommit ?? ""),
      `${label}.sourceCommit must be a 40-character git SHA`,
    );
    invariant(
      entry.sourceCommit === manifest.sourceRepoHeadAtBaseline,
      `${label}.sourceCommit differs from sourceRepoHeadAtBaseline`,
    );
    assertSafeRelativePath(entry.sourcePath, `${label}.sourcePath`);
    const target = assertSafeRelativePath(
      entry.targetPath,
      `${label}.targetPath`,
    );
    targetPaths.push(entry.targetPath);
    invariant(
      typeof entry.adaptation === "string" &&
        entry.adaptation.trim().length > 0,
      `${label}.adaptation is required`,
    );
    invariant(
      /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""),
      `${label}.sha256 must be a lowercase SHA-256 digest`,
    );

    let targetRealPath;
    try {
      targetRealPath = realpathSync(target);
      invariant(statSync(targetRealPath).isFile(), `${entry.targetPath} is not a file`);
    } catch (error) {
      fail(`${label} target is unreadable (${entry.targetPath}): ${formatError(error)}`);
    }
    invariant(
      targetRealPath.startsWith(rootRealPath),
      `${label}.targetPath resolves outside the repository`,
    );
    const actualHash = createHash("sha256")
      .update(readFileSync(targetRealPath))
      .digest("hex");
    invariant(
      actualHash === entry.sha256,
      `${label} hash drift for ${entry.targetPath}: expected ${entry.sha256}, found ${actualHash}`,
    );
  }

  assertExactSet(targetPaths, [...new Set(targetPaths)], "vendor targets");
  for (const requiredTarget of [
    "packages/sources/src/url-safety/pin-agent.ts",
    "packages/sources/src/crawl/engine.ts",
  ]) {
    invariant(
      targetPaths.includes(requiredTarget),
      `vendor manifest is missing required target ${requiredTarget}`,
    );
  }
  return `vendor provenance: ${manifest.entries.length} target hashes current`;
}

function checkE2eDatabaseSafety() {
  const realConfig = read("playwright.config.ts");
  invariant(
    /requireSafeTestDatabaseUrl\s*\(\s*process\.env\["E2E_DATABASE_URL"\]/s.test(
      realConfig,
    ),
    "database-backed Playwright must fail closed through E2E_DATABASE_URL",
  );
  invariant(
    /reuseExistingServer\s*:\s*false\b/.test(realConfig),
    "database-backed Playwright must never reuse an unknown local server",
  );
  invariant(
    !/\bglobalTeardown\s*:/.test(realConfig) &&
      /\["\.\/e2e\/real-global-teardown\.ts"\]/.test(realConfig),
    "database-backed E2E cleanup must run as a reporter after webServer teardown",
  );

  const mockConfig = read("playwright.mock.config.ts");
  invariant(
    /reuseExistingServer\s*:\s*false\b/.test(mockConfig),
    "mock Playwright must never reuse an unknown local server",
  );
  invariant(
    !/\bglobalTeardown\s*:/.test(mockConfig) &&
      /\["\.\/e2e\/mock-global-teardown\.ts"\]/.test(mockConfig),
    "mock E2E cleanup must run as a reporter after webServer teardown",
  );

  const cleanupReporter = read("e2e/cleanup-reporter.ts");
  invariant(
    /async onEnd\([\s\S]*await cleanupE2eArtifacts\(this\.paths\)/.test(
      cleanupReporter,
    ),
    "E2E artifact cleanup reporter must remove artifacts from reporter.onEnd",
  );
  return "E2E safety: guarded disposable DB, no unknown server reuse, ordered cleanup";
}

const checks = [
  ["OpenAPI contract", checkOpenApi],
  ["async route implementations", checkAsyncRouteImplementations],
  ["run polling implementation", checkRunPollingImplementation],
  ["web proxy implementation", checkWebProxyImplementation],
  ["integration database safety", checkIntegrationDatabaseSafety],
  ["E2E database safety", checkE2eDatabaseSafety],
  ["database contract", checkDatabaseContract],
  ["diagnostic rules", checkRuleContract],
  ["product/contract versions", checkVersions],
  ["vendor manifest", checkVendorManifest],
];

const failures = [];
const summaries = [];
for (const [label, check] of checks) {
  try {
    summaries.push(await check());
  } catch (error) {
    failures.push(`${label}: ${formatError(error)}`);
  }
}

if (failures.length > 0) {
  console.error(
    `SignalFrame implementation consistency FAILED (${failures.length} section${failures.length === 1 ? "" : "s"}):`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("SignalFrame implementation consistency passed:");
for (const summary of summaries) console.log(`- ${summary}`);
console.log("- generated OpenAPI types: enforced separately by contracts:check");
