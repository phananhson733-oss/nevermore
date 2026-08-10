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
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSchemaCatalog } from "./schema-catalog.mjs";

const SCRIPT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseRoot(argv) {
  if (argv.length === 0) return SCRIPT_REPO_ROOT;
  if (argv.length === 2 && argv[0] === "--root" && argv[1]) {
    return resolve(argv[1]);
  }
  throw new Error(
    "usage: node scripts/verify-implementation.mjs [--root <repository>]",
  );
}

const root = parseRoot(process.argv.slice(2));
const ACTIVE_LOCK_PATH = "scripts/spec-v0.4-lock.json";
let ACTIVE_LOCK;
try {
  ACTIVE_LOCK = JSON.parse(
    readFileSync(resolve(root, ACTIVE_LOCK_PATH), "utf8"),
  );
} catch (error) {
  throw new Error(
    `${ACTIVE_LOCK_PATH} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (
  ACTIVE_LOCK.lockFormat !== 3 ||
  ACTIVE_LOCK.authorityVersion !== "0.4.0" ||
  ACTIVE_LOCK.authorityStatus !== "active" ||
  ACTIVE_LOCK.normative !== true
) {
  throw new Error(
    `${ACTIVE_LOCK_PATH} must identify the active normative v0.4 authority`,
  );
}

const PRODUCT_VERSION = ACTIVE_LOCK.productVersion;
const CONTRACT_VERSION = ACTIVE_LOCK.contractVersion;
const RULE_SET_VERSION = ACTIVE_LOCK.ruleSetVersion;
const PROMPT_SET_VERSION = ACTIVE_LOCK.promptSetVersion;
const BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.3.0";
const HISTORICAL_BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.2.0";

const EXPECTED_OPENAPI_OPERATIONS = ACTIVE_LOCK.apiOperations;
const EXPECTED_ASYNC_OPERATIONS = ACTIVE_LOCK.asyncOperations;
const EXPECTED_MIGRATION_HEAD =
  "0052_keyword_governance_schedule_requests";

const ANALYSIS_REFRESH_PLAN_CONTRACTS = [
  {
    version: "analysis-refresh.plan.v1",
    hash: "d725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af",
    steps: [
      { ordinal: 1, stepKey: "crawl", required: true },
      { ordinal: 2, stepKey: "gsc", required: false },
      { ordinal: 3, stepKey: "ga4", required: false },
      { ordinal: 4, stepKey: "dataforseo", required: false },
      { ordinal: 5, stepKey: "growth_audit", required: true },
    ],
  },
  {
    version: "analysis-refresh.plan.v2",
    hash: "3049a718f77263f766e47d0d7318a9414520d07c8ab92960f50c85b864977c65",
    steps: [
      { ordinal: 1, stepKey: "crawl", required: true },
      { ordinal: 2, stepKey: "gsc", required: false },
      { ordinal: 3, stepKey: "ga4", required: false },
      { ordinal: 4, stepKey: "dataforseo", required: false },
      { ordinal: 5, stepKey: "dataforseo_backlinks", required: false },
      { ordinal: 6, stepKey: "growth_audit", required: true },
    ],
  },
  {
    version: "analysis-refresh.plan.v3",
    hash: "fc527bb7203d61ce126625a0b2bb4bffb59fe5999d9f6b78e5aa05409918368b",
    steps: [
      { ordinal: 1, stepKey: "crawl", required: true },
      { ordinal: 2, stepKey: "gsc", required: false },
      { ordinal: 3, stepKey: "ga4", required: false },
      { ordinal: 4, stepKey: "dataforseo", required: false },
      { ordinal: 5, stepKey: "dataforseo_backlinks", required: false },
      { ordinal: 6, stepKey: "topic_model", required: false },
      { ordinal: 7, stepKey: "growth_audit", required: true },
    ],
  },
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
    operationId: "createAnalysisRefreshRun",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/analysis-refresh-runs/route.ts",
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
    operationId: "createContentShadowRun",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/content-shadow-runs/route.ts",
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

const EXPECTED_TABLES = ACTIVE_LOCK.tables;
const EXPECTED_RULES = ACTIVE_LOCK.rules;
const EXPECTED_RULE_VERSIONS = new Map(
  Object.entries(ACTIVE_LOCK.ruleVersions),
);

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

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeWhitespace(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*([(),=])\s*/g, "$1")
    .trim();
}

function analysisRefreshPlanSql({ version, hash, steps }) {
  const sqlSteps = steps
    .map(
      ({ ordinal, stepKey, required }) =>
        `jsonb_build_object('ordinal', ${ordinal}, 'stepKey', '${stepKey}', 'required', ${String(required)})`,
    )
    .join(", ");
  return normalizeWhitespace(
    `plan_manifest = jsonb_build_object('version', '${version}', 'steps', jsonb_build_array(${sqlSteps})) AND plan_hash = '${hash}'`,
  );
}

function yamlComponentSchemaBlock(source, schemaName) {
  const lines = source.split("\n");
  const header = `    ${schemaName}:`;
  const start = lines.findIndex((line) => line === header);
  invariant(start >= 0, `OpenAPI component schema is missing: ${schemaName}`);
  let end = start + 1;
  while (
    end < lines.length &&
    !/^ {4}[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(lines[end])
  ) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
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

  const sourcesRead =
    document.paths?.["/projects/{projectId}/sources"]?.get;
  invariant(
    sourcesRead?.operationId === "listProjectSources" &&
      typeof sourcesRead.description === "string" &&
      sourcesRead.description.includes("CONTEXT_INCOMPLETE") &&
      /Archived projects preserve/.test(sourcesRead.description) &&
      sourcesRead.responses?.["422"]?.$ref ===
        "#/components/responses/ValidationError",
    "Sources read must gate active projects on confirmed Product/ICP, expose CONTEXT_INCOMPLETE, and preserve archived history",
  );

  const publicCollection =
    document.paths?.["/projects/{projectId}/collection-runs"]?.post;
  const analysisRefresh =
    document.paths?.["/projects/{projectId}/analysis-refresh-runs"]?.post;
  invariant(
    publicCollection?.operationId === "createCollectionRun",
    "public collection path/operationId drift",
  );
  invariant(
    analysisRefresh?.operationId === "createAnalysisRefreshRun",
    "Analysis Refresh path/operationId drift",
  );
  const collectionRequest =
    document.components?.schemas?.CreateCollectionRunRequest;
  invariant(
    collectionRequest?.additionalProperties === false &&
      Array.isArray(collectionRequest.required),
    "public collection request must remain a closed provider command",
  );
  assertExactSet(
    collectionRequest?.required ?? [],
    ["provider"],
    "public collection required fields",
  );
  assertExactSet(
    Object.keys(collectionRequest?.properties ?? {}),
    ["provider", "sourceConnectionId", "operation"],
    "public collection request fields",
  );
  assertExactSet(
    collectionRequest?.properties?.provider?.enum ?? [],
    ["crawl", "gsc", "ga4"],
    "public collection provider allowlist",
  );
  assertExactSet(
    collectionRequest?.properties?.operation?.enum ?? [],
    ["site_graph", "search_analytics", "organic_landing"],
    "public collection operation allowlist",
  );
  invariant(
    typeof publicCollection.description === "string" &&
      /DataForSEO Search\s+Landscape \(DFS\)/.test(
        publicCollection.description,
      ),
    "public collection contract must identify DFS Search Landscape as server-owned",
  );
  const analysisRefreshRequest =
    document.components?.schemas?.CreateAnalysisRefreshRunRequest;
  invariant(
    analysisRefreshRequest?.type === "object" &&
      analysisRefreshRequest.additionalProperties === false &&
      analysisRefreshRequest.maxProperties === 0 &&
      Object.keys(analysisRefreshRequest.properties ?? {}).length === 0 &&
      /Analysis Refresh v3/.test(analysisRefreshRequest.description ?? ""),
    "Analysis Refresh request must remain a strict empty v3 command",
  );
  invariant(
    analysisRefresh?.requestBody?.required === false &&
      analysisRefresh.requestBody?.content?.["application/json"]?.schema
        ?.$ref ===
        "#/components/schemas/CreateAnalysisRefreshRunRequest" &&
      typeof analysisRefresh.description === "string" &&
      /DataForSEO Search\s+Landscape \(DFS\)/.test(
        analysisRefresh.description,
      ) &&
      /analysis-refresh\.plan\.v3/.test(analysisRefresh.description) &&
      /internal Topic Model generation/.test(analysisRefresh.description) &&
      /analysis-refresh\.plan\.v1/.test(analysisRefresh.description) &&
      /analysis-refresh\.plan\.v2/.test(analysisRefresh.description) &&
      /no\s+raw provider\/model options or reservation API/.test(
        analysisRefresh.description,
      ),
    "Analysis Refresh must own the fixed v3 DFS/Backlinks/Topic/Growth Audit plan while retaining exact v1/v2 readability and no public model options",
  );
  invariant(
    !Object.keys(document.paths ?? {}).some((pathName) =>
      /topic-model-generation|invocation-attempt|reservation/i.test(pathName),
    ),
    "Topic generation child reservation and provider options must remain internal with no public path",
  );

  const runKind = document.components?.schemas?.RunKind;
  assertExactSet(
    runKind?.enum ?? [],
    [
      "collection",
      "product_profile_synthesis",
      "diagnostic",
      "artifact_generation",
      "export",
      "content_shadow",
      "publication",
      "measurement",
      "analysis_refresh",
      "topic_model_generation",
    ],
    "shared AsyncRun kinds",
  );
  invariant(
    /internal Analysis Refresh child kind/.test(runKind?.description ?? ""),
    "topic_model_generation must remain documented as an internal child kind",
  );
  const asyncRunResultTypes =
    document.components?.schemas?.AsyncRun?.properties?.resultRef?.properties
      ?.type?.enum;
  assertExactSet(
    asyncRunResultTypes ?? [],
    [
      "collection_run",
      "product_profile_run",
      "icp_profile",
      "diagnostic_run",
      "artifact",
      "export",
      "flow_shadow_run",
      "publication_attempt",
      "measurement_window",
      "analysis_refresh_run",
      "topic_model_generation_run",
    ],
    "shared AsyncRun result resource types",
  );

  const diagnosticRunIdPin =
    document.components?.parameters?.DiagnosticRunIdPin;
  invariant(
    diagnosticRunIdPin?.name === "diagnosticRunId" &&
      diagnosticRunIdPin.in === "query" &&
      diagnosticRunIdPin.required === false &&
      diagnosticRunIdPin.schema?.type === "string" &&
      diagnosticRunIdPin.schema.format === "uuid" &&
      diagnosticRunIdPin.schema.pattern ===
        "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    "Growth Map diagnosticRunId pin must remain one optional canonical lowercase UUID",
  );
  const reviewView = document.components?.parameters?.ReviewView;
  invariant(
    reviewView?.name === "view" &&
      reviewView.in === "query" &&
      reviewView.required === false &&
      reviewView.schema?.type === "string" &&
      reviewView.schema.const === "review",
    "Growth Map review view must remain the exact optional view=review literal",
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
      "#/components/parameters/DiagnosticRunIdPin",
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
      "#/components/parameters/DiagnosticRunIdPin",
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
      growthMapList.responses?.["422"]?.$ref ===
        "#/components/responses/ValidationError" &&
      growthMapDetail.responses?.["422"]?.$ref ===
        "#/components/responses/ValidationError" &&
      growthMapDetail.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable",
    "Growth Map URL reads must expose query validation and fail-closed frozen-lineage failures",
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
  const keywordSuggestionApprovalPathName =
    "/projects/{projectId}/audit/keywords/{keywordId}/review-suggestions/{suggestionId}/approve";
  const keywordListPath = document.paths?.[keywordListPathName];
  const keywordDetailPath = document.paths?.[keywordDetailPathName];
  const keywordList = keywordListPath?.get;
  const keywordDetail = keywordDetailPath?.get;
  const keywordReview = keywordDetailPath?.patch;
  const keywordSuggestionApproval =
    document.paths?.[keywordSuggestionApprovalPathName]?.post;
  invariant(
    keywordList?.operationId === "listProjectAuditKeywords",
    "Growth Map Keyword list path/operationId drift",
  );
  invariant(
    keywordDetail?.operationId === "getProjectAuditKeyword",
    "Growth Map Keyword detail path/operationId drift",
  );
  invariant(
    keywordReview?.operationId === "reviewProjectAuditKeyword",
    "Growth Map Keyword review path/operationId drift",
  );
  invariant(
    keywordSuggestionApproval?.operationId ===
      "approveProjectAuditKeywordReviewSuggestion",
    "Growth Map Keyword suggestion approval path/operationId drift",
  );
  invariant(
    keywordSuggestionApproval.requestBody?.required === true &&
      keywordSuggestionApproval.requestBody?.content?.["application/json"]
        ?.schema?.$ref ===
        "#/components/schemas/ApproveKeywordReviewSuggestionRequest" &&
      (document.components?.schemas ?? {}).ApproveKeywordReviewSuggestionRequest
        ?.additionalProperties === false &&
      JSON.stringify(
        (document.components?.schemas ?? {}).ApproveKeywordReviewSuggestionRequest?.required,
      ) ===
        JSON.stringify(["expectedGovernanceRevision", "suggestionVersion"]),
    "Growth Map Keyword suggestion approval request must remain a strict two-field compare-and-swap command",
  );
  assertExactSet(
    Object.keys(keywordListPath ?? {}).filter((key) => HTTP_METHODS.has(key)),
    ["get"],
    "Growth Map Keyword list methods",
  );
  assertExactSet(
    Object.keys(keywordDetailPath ?? {}).filter((key) => HTTP_METHODS.has(key)),
    ["get", "patch"],
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
      "#/components/parameters/DiagnosticRunIdPin",
      "#/components/parameters/KeywordSourceKindFilter",
    ],
    "Growth Map Keyword list query must be exactly limit/cursor/diagnosticRunId/sourceKind",
  );
  invariant(
    keywordListParameterRefs.every((reference) => typeof reference === "string"),
    "Growth Map Keyword list query must be exactly limit/cursor/diagnosticRunId/sourceKind",
  );
  assertExactSet(
    (keywordDetail.parameters ?? []).map((parameter) => parameter.$ref),
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/KeywordId",
      "#/components/parameters/DiagnosticRunIdPin",
      "#/components/parameters/ReviewView",
    ],
    "Growth Map Keyword detail parameters",
  );
  invariant(
    keywordDetail?.["x-signalframe-query-refinement"] ===
      "reviewViewAndDiagnosticRunIdAreMutuallyExclusive",
    "Growth Map Keyword detail must keep review view mutually exclusive with the generation pin",
  );
  assertExactSet(
    (keywordReview.parameters ?? []).map((parameter) => parameter.$ref),
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/KeywordId",
    ],
    "Growth Map Keyword review parameters",
  );
  invariant(
    keywordReview?.["x-signalframe-query-contract"] ===
      "rejectAllQueryParameters",
    "Growth Map Keyword PATCH must reject every query parameter",
  );
  invariant(
    keywordReview.requestBody?.required === true &&
      keywordReview.requestBody?.content?.["application/json"]?.schema?.$ref ===
        "#/components/schemas/ReviewKeywordRequest",
    "Growth Map Keyword review must require the governed review request",
  );
  invariant(
    keywordList.responses?.["200"]?.content?.["application/json"]?.schema
      ?.$ref ===
      "#/components/schemas/GrowthMapKeywordLibraryHttpResponse" &&
      keywordDetail.responses?.["200"]?.content?.["application/json"]
        ?.schema?.$ref ===
        "#/components/schemas/GrowthMapKeywordDetailHttpResponse" &&
      keywordReview.responses?.["200"]?.content?.["application/json"]?.schema
        ?.$ref ===
        "#/components/schemas/GrowthMapKeywordDetailHttpResponse",
    "Growth Map Keyword reads and review must return the standard HTTP envelope around the complete read model",
  );
  invariant(
    keywordList.responses?.["422"]?.$ref ===
      "#/components/responses/ValidationError" &&
      keywordList.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable" &&
      keywordDetail.responses?.["422"]?.$ref ===
        "#/components/responses/ValidationError" &&
      keywordDetail.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable" &&
      keywordReview.responses?.["409"]?.$ref ===
        "#/components/responses/Conflict" &&
      keywordReview.responses?.["422"]?.$ref ===
        "#/components/responses/ValidationError" &&
      keywordReview.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable",
    "Growth Map Keyword reads and review must expose validation, optimistic concurrency, and fail-closed dependency errors",
  );

  const keywordSchemas = document.components?.schemas ?? {};
  const keywordDetailResponse = keywordSchemas.GrowthMapKeywordDetailResponse;
  invariant(
    keywordSchemas.KeywordGovernancePendingSuggestion?.[
      "x-signalframe-runtime-refinement"
    ] === "keywordSuggestionReadinessProvenanceAndExcludedAssignment",
    "Keyword pending suggestion must enforce complete ready provenance and excluded assignment semantics",
  );
  invariant(
    /Any non-unassigned mappingDecision requires complete Topic identity/.test(
      keywordSchemas.KeywordGovernancePendingSuggestion?.description ?? "",
    ),
    "Keyword pending suggestion mapped states must require complete Topic identity",
  );
  invariant(
    /State and readinessReason remain one deterministic pair: pending_ready\/all_authorities_confirmed, generating\/generation_in_progress, pending_needs_review\/insufficient_authority, stale\/governance_revision_changed, unavailable\/authority_unavailable\./.test(
      keywordSchemas.KeywordGovernancePendingSuggestion?.description ?? "",
    ),
    "Keyword pending suggestion state and readiness reason must remain a deterministic pair",
  );
  assertExactSet(
    keywordSchemas.KeywordGovernancePendingSuggestion?.properties?.intent?.enum ??
      [],
    ["informational", "navigational", "commercial", "transactional", null],
    "Keyword pending suggestion intent must remain the canonical nullable four-value taxonomy",
  );
  assertExactSet(
    keywordSchemas.KeywordGovernancePendingSuggestion?.properties?.buyerStage
      ?.enum ?? [],
    ["awareness", "consideration", "decision", "retention", null],
    "Keyword pending suggestion buyer stage must remain the canonical nullable four-value taxonomy",
  );
  invariant(
    keywordSchemas.KeywordGovernancePendingSuggestion?.properties?.reason
      ?.minLength === 3 &&
      keywordSchemas.KeywordGovernancePendingSuggestion?.properties?.reason
        ?.maxLength === 2000,
    "Keyword pending suggestion reason must remain nullable with 3..2000 bounded text when present",
  );
  invariant(
    Array.isArray(keywordDetailResponse?.oneOf) &&
      keywordDetailResponse.oneOf.length === 2 &&
      keywordDetailResponse?.["x-signalframe-runtime-refinement"] ===
        "keywordDetailScopeCurrentSuggestionOnly",
    "Growth Map Keyword pinned detail must never expose a current pending suggestion",
  );
  invariant(
    read("authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md").includes(
      "keyword_governance_suggestion_generation",
    ),
    "Keyword governance suggestion generation must remain an exact internal async identity with no public model/config selector",
  );
  const keywordSuggestionContract = read(
    "packages/contracts/src/zod/keyword-governance-suggestions.ts",
  );
  const manifestFieldBlock = keywordSuggestionContract.match(
    /KEYWORD_GOVERNANCE_SUGGESTION_MANIFEST_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const/u,
  )?.[1];
  const manifestFields = [...(manifestFieldBlock ?? "").matchAll(/"([A-Za-z]+)"/gu)].map(
    (match) => match[1],
  );
  assertExactSet(
    manifestFields,
    ["schemaVersion", "generationVersion", "promptSetVersion", "workspaceId", "projectId", "marketCode", "languageTag", "confirmedProductProfile", "confirmedTopicModel", "topicAllowlist", "pageAllowlist", "candidates"],
    "Keyword suggestion manifest field inventory",
  );
  invariant(
    /Current Page key requires current Topic key/.test(
      keywordSuggestionContract,
    ),
    "Keyword suggestion manifest must require a current Topic key whenever a current Page key is present",
  );
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
    [
      "product_profile",
      "csv_import",
      "dataforseo_ranked",
      "gsc_top_query",
      "interview_summary",
      "user_review",
      "manual",
    ],
    "Growth Map Keyword source occurrence discriminator drift",
  );
  assertExactSet(
    (keywordSourceOccurrence?.oneOf ?? []).map((shape) => shape.$ref),
    [
      "#/components/schemas/GrowthMapKeywordProductProfileOccurrence",
      "#/components/schemas/GrowthMapKeywordCsvImportOccurrence",
      "#/components/schemas/GrowthMapKeywordDataForSeoRankedOccurrence",
      "#/components/schemas/GrowthMapKeywordGscTopQueryOccurrence",
      "#/components/schemas/GrowthMapKeywordInterviewSummaryOccurrence",
      "#/components/schemas/GrowthMapKeywordUserReviewOccurrence",
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
    "GrowthMapKeywordRecollection",
    "GrowthMapKeywordSearchIntent",
    "GrowthMapKeywordClassificationLimitations",
    "GrowthMapKeywordLibraryItem",
    "GrowthMapKeywordLibraryPageMeta",
    "GrowthMapKeywordLibraryResponse",
    "GrowthMapKeywordLibraryHttpResponse",
    "GrowthMapKeywordDetailHttpResponse",
  ];
  for (const schemaName of closedKeywordSchemas) {
    invariant(
      keywordSchemas[schemaName]?.additionalProperties === false,
      `Growth Map Keyword schema must be closed: ${schemaName}`,
    );
  }
  invariant(
    keywordSchemas.GrowthMapKeywordDetailResponse?.oneOf?.every(
      (branch) => branch.additionalProperties === false,
    ),
    "Growth Map Keyword detail branches must remain closed",
  );

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
      "reviewOrigin",
      "revision",
      "intent",
      "searchIntent",
      "buyerStage",
      "cluster",
      "classificationLimitations",
      "mappedTarget",
      "sourceOccurrences",
      "metrics",
      "recollection",
      "coverage",
    ],
    "Growth Map Keyword item fields",
  );
  assertExactSet(
    keywordItem?.required ?? [],
    Object.keys(keywordItem?.properties ?? {}),
    "Growth Map Keyword item required fields",
  );
  const keywordSearchIntent = keywordSchemas.GrowthMapKeywordSearchIntent;
  const keywordRecollection = keywordSchemas.GrowthMapKeywordRecollection;
  assertExactSet(
    Object.keys(keywordRecollection?.properties ?? {}),
    ["reason", "fields"],
    "Growth Map Keyword recollection fields",
  );
  assertExactSet(
    keywordRecollection?.required ?? [],
    ["reason", "fields"],
    "Growth Map Keyword recollection required fields",
  );
  const recollectionFields = keywordRecollection?.properties?.fields;
  const recollectionBranches =
    keywordItem?.properties?.recollection?.oneOf ?? [];
  invariant(
    keywordRecollection?.properties?.reason?.const ===
      "historical_dataforseo_observation_missing_fields" &&
      recollectionFields?.type === "array" &&
      recollectionFields.minItems === 1 &&
      recollectionFields.maxItems === 2 &&
      recollectionFields.uniqueItems === true &&
      recollectionFields.items?.type === "string" &&
      recollectionFields.items?.enum?.length === 2 &&
      recollectionFields.items.enum.includes("keyword_difficulty") &&
      recollectionFields.items.enum.includes("provider_search_intent") &&
      recollectionBranches.length === 2 &&
      recollectionBranches.some(
        (branch) =>
          branch.$ref ===
          "#/components/schemas/GrowthMapKeywordRecollection",
      ) &&
      recollectionBranches.some((branch) => branch.type === "null"),
    "Growth Map Keyword recollection must remain closed, bounded, exact, and nullable",
  );
  const searchIntentFields = [
    "value",
    "authority",
    "snapshotId",
    "observationId",
    "analysisInvocationId",
    "observedAt",
    "limitation",
  ];
  const searchIntentAuthorities = [
    "user_confirmed",
    "governed_legacy",
    "provider_observed",
    "llm_generated",
    "unavailable",
  ];
  assertExactSet(
    Object.keys(keywordSearchIntent?.properties ?? {}),
    searchIntentFields,
    "Growth Map Keyword search intent fields",
  );
  assertExactSet(
    keywordSearchIntent?.required ?? [],
    searchIntentFields,
    "Growth Map Keyword search intent required fields",
  );
  assertExactSet(
    keywordSearchIntent?.properties?.authority?.enum ?? [],
    searchIntentAuthorities,
    "Growth Map Keyword search intent authorities",
  );
  assertExactSet(
    keywordSearchIntent?.properties?.value?.type ?? [],
    ["string", "null"],
    "Growth Map Keyword search intent value types",
  );
  invariant(
    keywordSearchIntent?.properties?.value?.minLength === 1 &&
      keywordSearchIntent.properties.value.maxLength === 500 &&
      keywordSearchIntent.properties.value.pattern ===
        "^\\S(?:[\\s\\S]*\\S)?$",
    "Growth Map Keyword search intent value must remain a bounded backward-readable string",
  );
  assertExactSet(
    keywordSearchIntent?.properties?.limitation?.type ?? [],
    ["string", "null"],
    "Growth Map Keyword search intent limitation types",
  );
  invariant(
    keywordSearchIntent?.properties?.limitation?.minLength === 1 &&
      keywordSearchIntent.properties.limitation.maxLength === 2000 &&
      keywordSearchIntent.properties.limitation.pattern ===
        "^\\S(?:[\\s\\S]*\\S)?$",
    "Growth Map Keyword search intent limitation must remain exact and bounded",
  );
  const searchIntentBranches = new Map(
    (keywordSearchIntent?.oneOf ?? []).map((branch) => [
      branch.properties?.authority?.const,
      branch,
    ]),
  );
  assertExactSet(
    [...searchIntentBranches.keys()],
    searchIntentAuthorities,
    "Growth Map Keyword search intent authority branches",
  );
  const canonicalGeneratedIntents = [
    "informational",
    "navigational",
    "commercial",
    "transactional",
  ];
  for (const authority of ["provider_observed", "llm_generated"]) {
    assertExactSet(
      searchIntentBranches.get(authority)?.properties?.value?.enum ?? [],
      canonicalGeneratedIntents,
      `Growth Map Keyword ${authority} values`,
    );
  }
  invariant(
    keywordSearchIntent?.["x-signalframe-runtime-refinement"] ===
      "searchIntentAuthorityLineage" &&
      /successful topic_model_generation AnalysisInvocation/.test(
        keywordSearchIntent.description ?? "",
      ) &&
      keywordItem?.properties?.searchIntent?.$ref ===
        "#/components/schemas/GrowthMapKeywordSearchIntent" &&
      keywordItem?.["x-signalframe-runtime-refinement"] ===
        "normalizedKeywordIdentityExactSourceSearchIntentAndRecollectionLineage",
    "Growth Map Keyword search intent must retain authority, item, and exact-lineage runtime refinements",
  );
  invariant(
    keywordItem?.properties?.sourceOccurrences?.minItems === 1 &&
      keywordItem.properties.sourceOccurrences.maxItems === 100 &&
      keywordItem.properties.coverage?.$ref ===
        "#/components/schemas/GrowthMapCoverage",
    "Growth Map Keyword item must retain bounded source lineage and explicit coverage",
  );
  const canonicalKeywordLanguageSchemas = [
    "GrowthMapKeywordCsvImportOccurrence",
    "GrowthMapKeywordDataForSeoRankedOccurrence",
    "GrowthMapKeywordGscTopQueryOccurrence",
    "GrowthMapKeywordInterviewSummaryOccurrence",
    "GrowthMapKeywordUserReviewOccurrence",
    "GrowthMapKeywordManualOccurrence",
    "GrowthMapKeywordLibraryItem",
    "KeywordRelationParticipantSnapshot",
    "MeasurementTargetKeywordRank",
    "GeoCitationQueryEvidence",
  ];
  for (const schemaName of canonicalKeywordLanguageSchemas) {
    const rawSchema = yamlComponentSchemaBlock(source, schemaName);
    const directAliasReferences =
      rawSchema.match(
        /^ {8}languageTag: \{ \$ref: '#\/components\/schemas\/GrowthMapLibraryLanguageTag' \}\s*$/gm,
      ) ?? [];
    invariant(
      directAliasReferences.length === 1,
      `${schemaName}.languageTag must directly reference the canonical GrowthMapLibraryLanguageTag alias in raw OpenAPI`,
    );
    invariant(
      keywordSchemas[schemaName]?.properties?.languageTag?.$ref ===
        "#/components/schemas/LocaleCode",
      `${schemaName}.languageTag must resolve through the canonical alias to LocaleCode in bundled OpenAPI`,
    );
  }

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
    ["projectId", "diagnosticRunId", "data", "meta"],
    "Growth Map Keyword cursor page fields",
  );
  assertExactSet(
    keywordPage?.required ?? [],
    Object.keys(keywordPage?.properties ?? {}),
    "Growth Map Keyword cursor page required fields",
  );
  assertExactSet(
    keywordPage?.properties?.diagnosticRunId?.type ?? [],
    ["string", "null"],
    "Growth Map Keyword cursor page diagnostic run identity types",
  );
  invariant(
    keywordPage?.properties?.diagnosticRunId?.format === "uuid" &&
      keywordPage?.["x-signalframe-runtime-refinement"] ===
        "keywordPageScopeRunIdentityAndItemUniqueness",
    "Growth Map Keyword cursor page must identify the exact frozen run and keep live reads null",
  );
  assertExactSet(
    Object.keys(keywordPageMeta?.properties ?? {}),
    ["limit", "nextCursor", "hasNext", "coverage", "sourceCounts"],
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
  const competitorReview = competitorDetailPath?.patch;
  invariant(
    competitorList?.operationId === "listProjectAuditCompetitors",
    "Growth Map Competitor list path/operationId drift",
  );
  invariant(
    competitorDetail?.operationId === "getProjectAuditCompetitor",
    "Growth Map Competitor detail path/operationId drift",
  );
  invariant(
    competitorReview?.operationId === "reviewProjectAuditCompetitor",
    "Growth Map Competitor review path/operationId drift",
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
    ["get", "patch"],
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
      "#/components/parameters/DiagnosticRunIdPin",
    ],
    "Growth Map Competitor list query must be exactly limit/cursor/diagnosticRunId",
  );
  assertExactSet(
    (competitorDetail?.parameters ?? []).map(
      (parameter) => parameter.$ref,
    ),
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/CompetitorId",
      "#/components/parameters/DiagnosticRunIdPin",
      "#/components/parameters/ReviewView",
    ],
    "Growth Map Competitor detail parameters",
  );
  invariant(
    competitorDetail?.["x-signalframe-query-refinement"] ===
      "reviewViewAndDiagnosticRunIdAreMutuallyExclusive",
    "Growth Map Competitor detail must keep review view mutually exclusive with the generation pin",
  );
  assertExactSet(
    (competitorReview?.parameters ?? []).map(
      (parameter) => parameter.$ref,
    ),
    [
      "#/components/parameters/ProjectId",
      "#/components/parameters/CompetitorId",
    ],
    "Growth Map Competitor review parameters",
  );
  invariant(
    competitorReview?.["x-signalframe-query-contract"] ===
      "rejectAllQueryParameters",
    "Growth Map Competitor PATCH must reject every query parameter",
  );
  invariant(
    competitorReview?.requestBody?.required === true &&
      competitorReview.requestBody?.content?.["application/json"]?.schema
        ?.$ref === "#/components/schemas/ReviewCompetitorRequest",
    "Growth Map Competitor review must require the governed review request",
  );
  invariant(
    competitorList?.responses?.["200"]?.content?.["application/json"]
      ?.schema?.$ref ===
      "#/components/schemas/GrowthMapCompetitorLibraryHttpResponse" &&
      competitorDetail?.responses?.["200"]?.content?.[
        "application/json"
      ]?.schema?.$ref ===
        "#/components/schemas/GrowthMapCompetitorDetailHttpResponse" &&
      competitorReview?.responses?.["200"]?.content?.[
        "application/json"
      ]?.schema?.$ref ===
        "#/components/schemas/GrowthMapCompetitorDetailHttpResponse",
    "Growth Map Competitor reads and review must return the standard HTTP envelope around the complete read model",
  );
  invariant(
    competitorList?.responses?.["422"]?.$ref ===
      "#/components/responses/ValidationError" &&
      competitorList.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable" &&
      competitorDetail.responses?.["422"]?.$ref ===
        "#/components/responses/ValidationError" &&
      competitorDetail?.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable" &&
      competitorReview?.responses?.["409"]?.$ref ===
        "#/components/responses/Conflict" &&
      competitorReview?.responses?.["422"]?.$ref ===
        "#/components/responses/ValidationError" &&
      competitorReview?.responses?.["503"]?.$ref ===
        "#/components/responses/DependencyUnavailable",
    "Growth Map Competitor reads and review must expose validation, optimistic concurrency, and fail-closed dependency errors",
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
      "attemptedQueries",
      "observedQueries",
      "unavailableQueries",
      "cohortCoverage",
      "querySetHash",
      "platform",
      "model",
      "marketCode",
      "languageTag",
    ],
  );
  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorAvailableSharedKeywordInsight",
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
    [
      "GrowthMapCompetitorSharedKeywordInsight",
      "GrowthMapCompetitorAvailableSharedKeywordInsight",
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
        "/valueJson/citedQueries" &&
      competitorSchemas.GrowthMapCompetitorAvailableSharedKeywordInsight
        ?.properties?.availability?.const === "available" &&
      competitorSchemas.GrowthMapCompetitorAvailableSharedKeywordInsight
        .properties?.valuePointer?.const === "/valueJson/intersections",
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
    "sharedKeywordInsight",
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
    "GrowthMapCompetitorDiscoveryCounts",
    [
      "customer_input",
      "serp_duplicate",
      "ai_co_citation",
      "approved_corpus",
    ],
  );
  const competitorDiscoveryCounts =
    competitorSchemas.GrowthMapCompetitorDiscoveryCounts;
  invariant(
    Object.values(competitorDiscoveryCounts?.properties ?? {}).every(
      (property) =>
        property?.type === "integer" && property.minimum === 0,
    ),
    "Growth Map Competitor discovery counts must remain exact non-negative whole-library integers",
  );

  assertClosedRequiredCompetitorSchema(
    "GrowthMapCompetitorLibraryPageMeta",
    ["limit", "nextCursor", "hasNext", "coverage", "discoveryCounts"],
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
  const competitorPageDiscoveryCounts =
    competitorPageMeta?.properties?.discoveryCounts;
  invariant(
    competitorPage?.properties?.data?.maxItems === 100 &&
      competitorPage.properties?.meta?.$ref ===
        "#/components/schemas/GrowthMapCompetitorLibraryPageMeta" &&
      competitorPageMeta?.properties?.coverage?.$ref ===
        "#/components/schemas/GrowthMapCoverage" &&
      Array.isArray(competitorPageDiscoveryCounts?.anyOf) &&
      competitorPageDiscoveryCounts.anyOf.length === 2 &&
      competitorPageDiscoveryCounts.anyOf.some(
        (shape) =>
          shape?.$ref ===
          "#/components/schemas/GrowthMapCompetitorDiscoveryCounts",
      ) &&
      competitorPageDiscoveryCounts.anyOf.some(
        (shape) => shape?.type === "null",
      ) &&
      competitorPageMeta.properties?.limit?.minimum === 1 &&
      competitorPageMeta.properties.limit.maximum === 100,
    "Growth Map Competitor cursor page must remain bounded with exact metadata and explicit coverage",
  );

  const asyncOperations = operations.filter(
    (operation) =>
      operation.responses["202"]?.$ref ===
      "#/components/responses/AsyncAccepted",
  );
  invariant(
    asyncOperations.length === EXPECTED_ASYNC_OPERATIONS.length,
    `expected ${EXPECTED_ASYNC_OPERATIONS.length} shared AsyncAccepted operations, found ${asyncOperations.length}`,
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
  const dedicatedAcceptedOperations = operations.filter(
    (operation) =>
      operation.responses["202"] !== undefined &&
      operation.responses["202"]?.$ref !==
        "#/components/responses/AsyncAccepted",
  );
  assertExactSet(
    dedicatedAcceptedOperations.map((operation) => operation.operationId),
    ["createProjectMeasurementWindow"],
    "OpenAPI dedicated typed 202 operationIds",
  );
  const measurementAccepted =
    dedicatedAcceptedOperations[0]?.responses["202"]?.content?.[
      "application/json"
    ]?.schema?.$ref;
  invariant(
    measurementAccepted ===
      "#/components/schemas/MeasurementWindowAcceptedHttpResponse",
    "createProjectMeasurementWindow must retain its dedicated typed accepted response",
  );

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
  assertExactSet(
    asyncData?.properties?.resourceRef?.properties?.type?.enum ?? [],
    [
      "collection_run",
      "product_profile_run",
      "icp_profile",
      "diagnostic_run",
      "artifact",
      "export",
      "audit_run",
      "flow_shadow_run",
      "analysis_refresh_run",
      "topic_model_generation_run",
    ],
    "shared AsyncAccepted resource types",
  );
  invariant(
    !Object.keys(document.components?.schemas ?? {}).some((schemaName) =>
      /TopicModelGeneration(?:Reservation|InvocationAttempt|ProviderOptions)/.test(
        schemaName,
      ),
    ),
    "OpenAPI must not expose Topic generation reservation, attempt, or provider-option internals",
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
    /import\s*\{\s*updateSession\s*\}\s*from\s*["']@\/lib\/supabase\/refresh["'];?/.test(
      proxy,
    ),
    "src/proxy.ts must refresh and verify the Supabase session at the production boundary",
  );
  invariant(
    // `/auth/callback` joined the list with self-serve Google sign-in (spec
    // §1.6). It is the leg of the OAuth flow that CREATES the session, so it
    // necessarily arrives without one — gating it would bounce every sign-in
    // back to /login before the code could be exchanged. The list stays
    // exhaustive and exact so a third entry cannot be added without a decision.
    /const\s+PUBLIC_PAGES\s*=\s*\[\s*["']\/login["']\s*,\s*["']\/auth\/callback["']\s*\]/.test(
      proxy,
    ) &&
      /const\s+PUBLIC_API_PREFIXES\s*=\s*\[\s*["']\/api\/mvp\/health["']\s*\]/.test(
        proxy,
      ),
    "only login, the OAuth callback, and health may bypass the authenticated page boundary",
  );
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
  invariant(
    /const\s+session\s*=\s*await\s+updateSession\s*\(\s*request\s*,\s*overrides\s*\)/s.test(
      proxy,
    ) &&
      /userPresent\s*=\s*session\.user\s*!==\s*null/.test(proxy),
    "production requests must derive page authentication from refreshed Supabase user state",
  );
  invariant(
    /if\s*\(\s*!userPresent\s*&&\s*!isPublicPage\s*\)[\s\S]*?url\.pathname\s*=\s*["']\/login["'][\s\S]*?loginRedirectTarget\s*\(\s*request\s*\)/s.test(
      proxy,
    ),
    "unauthenticated pages must redirect to login with a sanitized return target",
  );
  invariant(
    /createSupabaseServerClient\s*\(\s*\)[\s\S]*?supabase\.auth\.getUser\s*\(\s*\)/s.test(
      session,
    ),
    "operator resolution must verify the authenticated user with Supabase Auth",
  );
  invariant(
    /async\s+function\s+findOperator\s*\([^)]*userId[^)]*\)[\s\S]*?\.from\s*\(\s*operatorProfiles\s*\)[\s\S]*?\.where\s*\(\s*eq\s*\(\s*operatorProfiles\.user_id\s*,\s*userId\s*\)\s*\)/s.test(
      session,
    ),
    "operator resolution must look membership up by the authenticated user id",
  );
  invariant(
    /const\s+user\s*=\s*await\s+getAuthUser\s*\(\s*\)[\s\S]*?if\s*\(\s*!user\s*\)\s*return\s+null\s*;/s.test(
      session,
    ),
    "non-development sessions must fail closed before any membership resolution",
  );

  // Spec §1.6 opened self-serve signup, which replaced "an unknown account gets
  // nothing" with "an unknown account gets a workspace". The dangerous way to
  // implement that is to hand it an EXISTING workspace — isolation is
  // application-level `workspace_id` scoping with no RLS beneath it, so joining
  // one workspace to another account is a full read of that customer's data.
  // The dev bootstrap legitimately does `select … from workspaces limit 1`
  // because local dev is a single-workspace world, and it sits in this same
  // file. So the invariant is scoped to the signup function: it must INSERT a
  // workspace, and must never SELECT one.
  const signupFunction =
    /async\s+function\s+provisionSelfServeOperator\s*\([\s\S]*?\n}/s.exec(
      session,
    )?.[0] ?? "";
  invariant(
    signupFunction !== "",
    "self-serve signup must live in provisionSelfServeOperator so its isolation can be verified",
  );
  invariant(
    /\.insert\s*\(\s*workspaces\s*\)/s.test(signupFunction),
    "self-serve signup must create the workspace it admits an account into",
  );
  invariant(
    !/\.from\s*\(\s*workspaces\s*\)/s.test(signupFunction),
    "self-serve signup must never select an existing workspace to join",
  );
  invariant(
    /pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*\$\{`sf_signup:\$\{user\.id\}`\}/s.test(
      signupFunction,
    ),
    "self-serve signup must serialize per user so a concurrent first request cannot orphan a workspace",
  );

  return "web boundary: Supabase session refresh + self-serve signup into a newly created workspace + nonce CSP, with dev auth fail-closed outside exact loopback development";
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
      // `.next` was matched by exact name while this repository carries
      // `.next-mock-3112` and friends; a widened root would have walked tens of
      // thousands of generated files. Dot-directories are never source.
      if (
        entry.name === "node_modules" ||
        entry.name.startsWith(".") ||
        entry.name === "dist" ||
        entry.name === "coverage" ||
        entry.name === "playwright-report" ||
        entry.name === "test-results"
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

function sourceStringArray(source, name) {
  const block = new RegExp(
    `const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const;`,
  ).exec(source)?.[1];
  invariant(block !== undefined, `${name} inventory is missing`);
  return [...block.matchAll(/^\s*"([^"]+)",?\s*$/gm)].map(
    (match) => match[1],
  );
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
  const migrationSources = migrationFiles.map((fileName) => ({
    name: fileName,
    sql: read(`packages/db/migrations/${fileName}`),
  }));
  invariant(
    ACTIVE_LOCK.migrationHead === EXPECTED_MIGRATION_HEAD,
    `active lock migration head must be ${EXPECTED_MIGRATION_HEAD}`,
  );
  invariant(
    migrationFiles.length === 52 &&
      migrationFiles.at(-1) === `${EXPECTED_MIGRATION_HEAD}.sql`,
    `ordered migrations must contain exactly 52 files through ${EXPECTED_MIGRATION_HEAD}.sql`,
  );
  const topicModelGenerationMigration = migrationSources.find(
    ({ name }) => name === "0048_topic_model_generation.sql",
  )?.sql;
  invariant(
    typeof topicModelGenerationMigration === "string",
    "Topic Model generation migration source is missing",
  );
  const authoritySchema = read(
    "authority/implementation-spec-v0.4/schema.sql",
  );
  const topicMigrationBegin =
    "-- BEGIN EXACT ORDERED MIGRATION 0048_topic_model_generation.sql";
  const topicMigrationEnd =
    "-- END EXACT ORDERED MIGRATION 0048_topic_model_generation.sql";
  invariant(
    authoritySchema.split(topicMigrationBegin).length === 2 &&
      authoritySchema.split(topicMigrationEnd).length === 2 &&
      authoritySchema.includes(
        `${topicMigrationBegin}\n${topicModelGenerationMigration.trimEnd()}\n${topicMigrationEnd}`,
      ),
    "authority schema must contain migration 0048 verbatim and exactly once",
  );
  const migration = stripSqlComments(
    migrationSources.map(({ sql }) => sql).join("\n"),
  );
  const tables = [...buildSchemaCatalog(migrationSources).keys()];
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

  const analysisRefreshRuns = tableDefinition("analysis_refresh_runs");
  invariant(
    /id\s+uuid\s+PRIMARY KEY\s+REFERENCES\s+app\.async_runs\(id\)\s+ON DELETE RESTRICT/i.test(
      analysisRefreshRuns,
    ) &&
      /\bsite_id\s+uuid\s+NOT NULL[\s\S]*?REFERENCES\s+app\.sites\(id\)/i.test(
        analysisRefreshRuns,
      ) &&
      /\bicp_profile_id\s+uuid\s+NOT NULL[\s\S]*?REFERENCES\s+app\.icp_profiles\(id\)/i.test(
        analysisRefreshRuns,
      ) &&
      /\bplan_manifest\s+jsonb\s+NOT NULL/i.test(analysisRefreshRuns) &&
      /\bplan_hash\s+text\s+NOT NULL/i.test(analysisRefreshRuns),
    "analysis_refresh_runs must freeze one canonical async run, Site, ICP, manifest, and hash",
  );
  const analysisRefreshSteps = tableDefinition("analysis_refresh_steps");
  invariant(
    /state\s+text\s+NOT NULL\s+DEFAULT\s+'pending'[\s\S]*?'running'[\s\S]*?'completed'[\s\S]*?'skipped'[\s\S]*?'failed'/i.test(
      analysisRefreshSteps,
    ) &&
      /UNIQUE\s*\(\s*analysis_refresh_run_id\s*,\s*step_key\s*\)/i.test(
        analysisRefreshSteps,
      ) &&
      /UNIQUE\s*\(\s*analysis_refresh_run_id\s*,\s*ordinal\s*\)/i.test(
        analysisRefreshSteps,
      ),
    "analysis_refresh_steps must freeze unique ordered step identity and the complete execution state vocabulary",
  );

  const topicMigration = stripSqlComments(topicModelGenerationMigration);
  const constraintLiterals = (constraintName) => {
    const body = new RegExp(
      `ADD\\s+CONSTRAINT\\s+${constraintName}\\s+CHECK\\s*\\([\\s\\S]*?IN\\s*\\(([\\s\\S]*?)\\)\\s*\\)\\s*;`,
      "i",
    ).exec(topicMigration)?.[1];
    invariant(body !== undefined, `${constraintName} is missing from migration 0047`);
    return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  };
  assertExactSet(
    constraintLiterals("async_runs_kind_check"),
    [
      "collection",
      "diagnostic",
      "artifact_generation",
      "export",
      "product_profile_synthesis",
      "content_shadow",
      "publication",
      "measurement",
      "analysis_refresh",
      "topic_model_generation",
    ],
    "database async run kinds",
  );
  assertExactSet(
    constraintLiterals("async_runs_result_type_check"),
    [
      "collection_run",
      "diagnostic_run",
      "artifact",
      "export",
      "icp_profile",
      "flow_shadow_run",
      "publication_attempt",
      "measurement_window",
      "analysis_refresh_run",
      "topic_model_generation_run",
    ],
    "database async result resource types",
  );
  assertExactSet(
    constraintLiterals("analysis_invocations_task_check"),
    [
      "finding_summary",
      "artifact_generation",
      "product_profile_synthesis",
      "content_shadow_draft",
      "topic_model_generation",
    ],
    "AnalysisInvocation tasks",
  );

  const topicGenerationRuns = tableDefinition("topic_model_generation_runs");
  invariant(
    /id\s+uuid\s+PRIMARY KEY\s+REFERENCES\s+app\.async_runs\(id\)\s+ON DELETE RESTRICT/i.test(
      topicGenerationRuns,
    ) &&
      /analysis_refresh_run_id\s+uuid\s+NOT NULL[\s\S]*?REFERENCES\s+app\.analysis_refresh_runs\(id\)\s+ON DELETE RESTRICT/i.test(
        topicGenerationRuns,
      ) &&
      /input_manifest\s+jsonb\s+NOT NULL[\s\S]*?octet_length\(input_manifest::text\)\s*<=\s*262144[\s\S]*?topic-model-generation-input\.v1/i.test(
        topicGenerationRuns,
      ) &&
      /input_hash\s+text\s+NOT NULL[\s\S]*?\^\[a-f0-9\]\{64\}\$/i.test(
        topicGenerationRuns,
      ) &&
      /UNIQUE\s*\(analysis_refresh_run_id\)/i.test(topicGenerationRuns),
    "Topic generation resource ledger must share AsyncRun identity and freeze one bounded parent-scoped input manifest/hash",
  );
  const topicInvocationAttempts = tableDefinition(
    "topic_model_generation_invocation_attempts",
  );
  invariant(
    /ordinal\s+smallint\s+NOT NULL\s+CHECK\s*\(ordinal\s+BETWEEN\s+1\s+AND\s+3\)/i.test(
      topicInvocationAttempts,
    ) &&
      /async_attempt_count\s+integer\s+NOT NULL\s+CHECK\s*\(async_attempt_count\s*>=\s*1\)/i.test(
        topicInvocationAttempts,
      ) &&
      /status\s+text\s+NOT NULL\s+DEFAULT\s+'reserved'[\s\S]*?'succeeded'[\s\S]*?'failed'[\s\S]*?'rejected'[\s\S]*?'outcome_unknown'/i.test(
        topicInvocationAttempts,
      ) &&
      /UNIQUE\s*\(topic_model_generation_run_id,\s*ordinal\)/i.test(
        topicInvocationAttempts,
      ) &&
      /UNIQUE\s*\(topic_model_generation_run_id,\s*async_attempt_count\)/i.test(
        topicInvocationAttempts,
      ),
    "Topic invocation ledger must bound budget and fence every reservation to one exact AsyncRun attempt",
  );
  invariant(
    !/raw_prompt|raw_output|raw_response|prompt_text|response_text/i.test(
      topicModelGenerationMigration,
    ),
    "Topic migration must store hashes and bounded metadata, never raw prompt/provider/model output",
  );
  invariant(
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+analysis_invocation_id\s+uuid/i.test(
      topicMigration,
    ) &&
      /keyword_review_decisions_analysis_invocation_shape_check[\s\S]*?decision_origin\s*=\s*'system_suggestion'[\s\S]*?status\s*=\s*'approved'[\s\S]*?decided_by\s+IS\s+NULL/i.test(
        topicMigration,
      ) &&
      /generated Keyword intent lacks matching successful Topic invocation/i.test(
        topicModelGenerationMigration,
      ),
    "generated Keyword intent must carry only exact successful Topic invocation lineage",
  );
  invariant(
    /actorless Topic Model confirmation lacks successful generation lineage/i.test(
      topicModelGenerationMigration,
    ) &&
      /manual Topic Model confirmation requires a human actor/i.test(
        topicModelGenerationMigration,
      ) &&
      /attempt\.status\s*=\s*'succeeded'[\s\S]*?invocation\.status\s*=\s*'succeeded'/i.test(
        topicMigration,
      ),
    "actorless system confirmation must require the exact successful invocation and reservation lineage",
  );

  const planConstraintStart = topicMigration.indexOf(
    "ADD CONSTRAINT analysis_refresh_runs_plan_contract_check CHECK",
  );
  const planConstraintEnd = topicMigration.indexOf(
    ") NOT VALID;",
    planConstraintStart,
  );
  invariant(
    planConstraintStart >= 0 && planConstraintEnd > planConstraintStart,
    "Analysis Refresh exact manifest/hash constraint is missing",
  );
  const planConstraint = normalizeWhitespace(
    topicMigration.slice(planConstraintStart, planConstraintEnd),
  );
  invariant(
    (planConstraint.match(/plan_manifest=/g) ?? []).length === 3 &&
      (planConstraint.match(/plan_hash=/g) ?? []).length === 3,
    "Analysis Refresh plan constraint must accept exactly v1, v2, and v3 branches",
  );
  for (const contract of ANALYSIS_REFRESH_PLAN_CONTRACTS) {
    const calculatedHash = createHash("sha256")
      .update(
        canonicalJson({ version: contract.version, steps: contract.steps }),
      )
      .digest("hex");
    invariant(
      calculatedHash === contract.hash,
      `${contract.version} frozen manifest hash drift`,
    );
    invariant(
      planConstraint.includes(analysisRefreshPlanSql(contract)),
      `${contract.version} exact manifest/hash branch is missing or shape-drifted`,
    );
    invariant(
      (topicModelGenerationMigration.match(new RegExp(contract.hash, "g")) ?? [])
        .length === 1,
      `${contract.version} hash must occur exactly once in migration 0047`,
    );
  }

  const topicIndexes = [
    "topic_model_generation_runs_project_created_idx",
    "topic_model_generation_runs_result_revision_idx",
    "topic_model_generation_invocation_attempts_project_idx",
    "topic_model_generation_invocation_attempts_unresolved_idx",
  ];
  const topicTriggers = [
    "topic_model_generation_runs_provenance_guard",
    "topic_model_generation_runs_frozen_input_guard",
    "async_runs_topic_model_generation_result_guard",
    "topic_model_generation_invocation_attempts_transition_guard",
    "keyword_review_decisions_analysis_invocation_guard",
  ];
  const topicRoutines = [
    "enforce_topic_model_generation_run_provenance",
    "enforce_topic_model_generation_run_frozen_input",
    "enforce_topic_model_generation_async_result",
    "enforce_topic_model_generation_invocation_attempt_transition",
    "reserve_topic_model_generation_invocation_attempt",
    "finalize_topic_model_generation_invocation_attempt",
    "mark_topic_model_generation_invocation_outcome_unknown",
    "terminalize_topic_model_generation_run",
    "enforce_keyword_review_analysis_invocation",
  ];
  for (const indexName of topicIndexes) {
    invariant(
      new RegExp(
        `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+IF NOT EXISTS\\s+${indexName}\\b`,
        "i",
      ).test(topicMigration),
      `required Topic generation index is missing: ${indexName}`,
    );
  }
  for (const triggerName of topicTriggers) {
    invariant(
      new RegExp(`CREATE\\s+TRIGGER\\s+${triggerName}\\b`, "i").test(
        topicMigration,
      ),
      `required Topic generation trigger is missing: ${triggerName}`,
    );
  }
  for (const routineName of topicRoutines) {
    invariant(
      new RegExp(
        `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:app\\.)?${routineName}\\b`,
        "i",
      ).test(topicMigration),
      `required Topic generation routine is missing: ${routineName}`,
    );
  }
  for (const tableName of [
    "topic_model_generation_runs",
    "topic_model_generation_invocation_attempts",
  ]) {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      invariant(
        new RegExp(
          `REVOKE\\s+ALL\\s+ON\\s+app\\.${tableName}\\s+FROM\\s+${role}`,
          "i",
        ).test(topicMigration),
        `internal Topic ledger privilege is not revoked: ${tableName} from ${role}`,
      );
    }
  }
  const topicPrivilegeContract = normalizeWhitespace(
    topicMigration,
  ).toLowerCase();
  for (const signature of [
    "reserve_topic_model_generation_invocation_attempt(uuid,uuid,uuid,integer,text,text,text,text)",
    "finalize_topic_model_generation_invocation_attempt(uuid,uuid,uuid,integer,uuid,text,text,text,text,text,text,integer,integer,numeric,integer,text)",
    "mark_topic_model_generation_invocation_outcome_unknown(uuid,uuid,uuid,integer,uuid,text)",
    "terminalize_topic_model_generation_run(uuid,uuid,uuid,integer,text,uuid,text,text)",
  ]) {
    for (const role of ["public", "anon", "authenticated"]) {
      invariant(
        topicPrivilegeContract.includes(
          normalizeWhitespace(
            `REVOKE ALL ON FUNCTION app.${signature} FROM ${role}`,
          ).toLowerCase(),
        ),
        `internal Topic mutator EXECUTE privilege is not revoked: ${signature} from ${role}`,
      );
    }
  }

  const migrateCheck = read("packages/db/src/migrate-check.ts");
  const migrateCheckInventories = [
    ["EXPECTED_TABLES", 84],
    ["REQUIRED_INDEXES", 118],
    ["REQUIRED_TRIGGERS", 166],
    ["REQUIRED_ROUTINES", 105],
  ];
  for (const [inventoryName, expectedCount] of migrateCheckInventories) {
    const inventory = sourceStringArray(migrateCheck, inventoryName);
    invariant(
      inventory.length === expectedCount,
      `${inventoryName} must contain exactly ${expectedCount} entries, found ${inventory.length}`,
    );
  }
  for (const requiredName of [
    "topic_model_generation_runs",
    "topic_model_generation_invocation_attempts",
    ...topicIndexes,
    ...topicTriggers,
    ...topicRoutines,
  ]) {
    invariant(
      migrateCheck.includes(`"${requiredName}"`),
      `migrate-check inventory is missing ${requiredName}`,
    );
  }

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
    smoke ===
      read("authority/implementation-spec-v0.4/scripts/schema-smoke.sql"),
    "authority schema smoke must be byte-identical to the implementation smoke",
  );
  for (const [pattern, label] of [
    [/expected exactly 84 app tables/, "84 app tables"],
    [/expected all 94 named app indexes/, "94 named smoke indexes"],
    [/expected all 122 app triggers/, "122 named smoke triggers"],
    [/expected all 73 runtime routines/, "73 runtime smoke routines"],
    [
      /schema_migration_version[\s\S]*?IS\s+DISTINCT\s+FROM\s+'0052_keyword_governance_schedule_requests'/i,
      "0052 migration head",
    ],
  ]) {
    invariant(pattern.test(smoke), `schema smoke must freeze ${label}`);
  }
  invariant(
    /\bROLLBACK\s*;\s*$/.test(smoke),
    "schema-smoke.sql must finish with ROLLBACK",
  );
  return `database: 52 migrations through ${EXPECTED_MIGRATION_HEAD}, ${EXPECTED_TABLES.length} app tables (pg-boss excluded), 118 indexes, 166 triggers, and 105 routines in migrate-check`;
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
    ruleIds.length === EXPECTED_RULES.length,
    `expected ${EXPECTED_RULES.length} executable rules, found ${ruleIds.length}`,
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
  return `diagnostics: ${EXPECTED_RULES.length} executable frozen rules in canonical order`;
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
  const realRuntime = read("e2e/real-e2e-runtime.ts");
  const realRunner = read("e2e/run-real-e2e.ts");
  const databaseSafety = read(
    "packages/db/src/test-database-safety.ts",
  );
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
  invariant(
    /REAL_E2E_SEGMENTS\s*=\s*\["light",\s*"ac044",\s*"ac045"\]\s+as const/.test(
      realRuntime,
    ),
    "database-backed E2E must retain the light, AC-044, and AC-045 segments",
  );
  invariant(
    /deriveRealE2eDatabaseUrl/.test(realRunner) &&
      /for\s*\(\s*const\s+\[index,\s*segment\]\s+of\s+REAL_E2E_SEGMENTS\.entries\(\)\s*\)/.test(
        realRunner,
      ) &&
      /finally\s*\{[\s\S]*?"dropdb"/.test(realRunner),
    "database-backed E2E must provision, execute, and clean every isolated segment",
  );
  invariant(
    /SEGMENT\s*===\s*"light"[\s\S]*?real-vertical-chains\.spec\.ts/.test(
      realConfig,
    ),
    "the light real-E2E segment must exclude the heavy vertical-chain file",
  );
  invariant(
    /getRealE2eSegmentPaths/.test(realConfig) &&
      /REAL_E2E_INVOCATION_ID/.test(realConfig) &&
      /outputDir:\s*SEGMENT_PATHS\.outputDir/.test(realConfig) &&
      /SF_BLOB_DIR:\s*SEGMENT_PATHS\.blobDir/.test(realConfig) &&
      /NEXT_DIST_DIR:\s*SEGMENT_PATHS\.distDirectoryName/.test(realConfig),
    "every real-E2E invocation and segment must own its Next, blob, and Playwright output paths",
  );
  invariant(
    /realE2eInvocationHash/.test(realRuntime) &&
      /deriveRealE2eBasePort/.test(realRuntime) &&
      /resourceKey\s*=\s*`\$\{invocationHash\}-\$\{validatedSegment\}`/.test(
        realRuntime,
      ) &&
      /REAL_E2E_INVOCATION_ID:\s*invocationId/.test(realRunner),
    "real-E2E non-database resources and default ports must be invocation scoped",
  );
  invariant(
    /retries:\s*0\b/.test(realConfig) &&
      /trace:\s*"retain-on-failure"/.test(realConfig),
    "stateful real E2E must use one honest attempt while retaining failure traces",
  );
  invariant(
    !/max-old-space-size/.test(realConfig),
    "real E2E must solve Next memory accumulation with process isolation, not a heap bump",
  );
  invariant(
    /CONNECTION_ROUTING_QUERY_PARAMETERS/.test(databaseSafety) &&
      /hostaddr/.test(databaseSafety) &&
      /servicefile/.test(databaseSafety),
    "destructive test URLs must reject PostgreSQL query routing overrides",
  );
  invariant(
    /INHERITED_POSTGRES_ROUTING_ENVIRONMENT/.test(realRunner) &&
      /"PGHOSTADDR"/.test(realRunner) &&
      /"PGSERVICE"/.test(realRunner) &&
      /delete sanitized\[variableName\]/.test(realRunner),
    "real-E2E children must not inherit ambient PostgreSQL routing",
  );
  invariant(
    /let databaseCreated = false/.test(realRunner) &&
      /databaseCreated = created/.test(realRunner) &&
      /if \(databaseCreated\)\s*\{[\s\S]*?"dropdb"/.test(realRunner),
    "real E2E must only delete a database it created successfully",
  );
  const vertical = read("e2e/real-vertical-chains.spec.ts");
  const completeContext = vertical.match(
    /async function completeContext\([\s\S]*?\n}\n\nasync function waitForRun/,
  )?.[0];
  invariant(
    completeContext !== undefined &&
      !/ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|setTimeout/.test(
        completeContext,
      ),
    "completeContext must expose a dead Next process instead of retrying HTTP mutations",
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
  invariant(
    /retries:\s*0\b/.test(mockConfig) &&
      /trace:\s*"retain-on-failure"/.test(mockConfig),
    "mock E2E must use one honest attempt while retaining failure traces",
  );

  const cleanupReporter = read("e2e/cleanup-reporter.ts");
  invariant(
    /async onEnd\([\s\S]*await cleanupE2eArtifacts\(this\.paths\)/.test(
      cleanupReporter,
    ),
    "E2E artifact cleanup reporter must remove artifacts from reporter.onEnd",
  );
  return "E2E safety: invocation-scoped DB/Next/blob/output/ports, one honest attempt per real and mock test, no unknown server reuse, ordered owned cleanup";
}

/**
 * The Content Shadow QA gate is the one place a reproducible run makes a
 * factual assertion about model output, so its judgement has to be a pure
 * function of its frozen inputs. Each pattern below corresponds to a way the
 * same frozen draft could otherwise be judged differently on a second machine
 * (a clock, randomness, an environment switch, an ICU-version-dependent API) or
 * to a hidden input the content hash does not cover (a file read, a database
 * row). This is a source guard rather than a convention because the failure it
 * prevents is silent: a verdict that simply differs on replay.
 */
const QA_PURITY_FORBIDDEN = [
  // Hidden inputs. The module-specifier rules are stated as an ALLOWLIST —
  // only relative specifiers — rather than as a list of banned packages,
  // because the banned-list version let `import("fs")`, `require("fs")` and
  // `await import("@sf/db")` straight through: it only ever matched the
  // `node:` prefix and the static `from "@sf/…"` form. A guard whose summary
  // claims more than it checks is worse than no guard. The allowlist is over
  // the three syntaxes `moduleSpecifiers` reads — `from "…"`, `import("…")` and
  // the side-effect `import "…"` — and it is exactly that third one that went
  // unread while the guard was described as syntax-proof.
  [/\brequire\s*\(/, "use require()"],
  [/process\s*\./, "read anything off `process`"],
  [/\bglobalThis\b/, "reach through globalThis"],
  // Clock and randomness.
  [/\bDate\s*\.\s*now\b/, "read the clock"],
  [/\bnew\s+Date\b/, "read the clock"],
  [/\bperformance\s*\.\s*now\b/, "read a high-resolution clock"],
  [/\bhrtime\b/, "read a high-resolution clock"],
  [/\bMath\s*\.\s*random\b/, "use randomness"],
  [/\brandomUUID\b/, "use randomness"],
  // Locale-sensitive APIs: their output tracks the host's ICU version, so the
  // same frozen draft can score differently on two machines.
  [/\bIntl\s*\./, "use a locale-sensitive Intl API"],
  [/\bSegmenter\b/, "use a locale-sensitive segmenter"],
  [/\blocaleCompare\b/, "sort with a locale-sensitive comparison"],
  [/\btoLocale[A-Z]\w*\s*\(/, "format with a locale-sensitive method"],
  // Network.
  [/\bfetch\s*\(/, "perform network IO"],
  [/\bXMLHttpRequest\b/, "perform network IO"],
];

/**
 * Every root red line D's grep has to cover.
 *
 * The blueprint asked for a whole-repository grep and this list was three
 * directories, so `e2e/`, `scripts/` and everything in `apps/web` outside `src`
 * (config, instrumentation, `next.config.ts`) were never scanned — and `e2e/`
 * is precisely where a "just point the fixture at the sibling repo" import
 * would be written. Widened to the roots that hold executable source.
 */
const SIBLING_REPO_SOURCE_ROOTS = [
  "packages",
  "apps/web",
  "apps/worker",
  "e2e",
  "scripts",
];

/** This guard's own file, which must state the tokens it forbids. */
const GUARD_SOURCE = "scripts/verify-implementation.mjs";

function posixDirname(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

/** Resolve a relative module specifier against a repo-relative directory. */
function posixJoin(directory, specifier) {
  const segments = directory === "." ? [] : directory.split("/");
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/**
 * Every file the gate actually executes, not just the ones under `qa/`.
 *
 * The guard used to scan the `qa/` directory alone while the gate imports
 * `../version.ts` and `../types.ts` (and its fixtures reach into `../research/`)
 * — so a clock or a database read could have been introduced one relative
 * import away and the guard would have stayed green. Purity is a property of
 * the reachable graph, so the graph is what gets walked.
 */
/**
 * Every module specifier a file imports, in every syntax that loads a module.
 *
 * There are three, and the guard used to cover two: `import "fs";` — a
 * SIDE-EFFECT import, with no binding and no `from` — walked straight through
 * while the guard's own summary said module specifiers were an allowlist that
 * "cannot be worked around by choosing a different import syntax". That claim
 * was false for the shortest syntax there is, which is the same
 * says-more-than-it-checks failure the guard exists to catch elsewhere. All
 * three forms are matched here, and each is verified to fail the guard.
 *
 * The `from` form is anchored on the character BEFORE it so a data literal
 * cannot be mistaken for an import: the QA coverage check carries `"from"` in
 * its stopword list, and a naive `/\bfrom\s*["\']/` reported it as a forbidden
 * bare-package import. A guard that cries wolf on a string constant gets
 * deleted. The side-effect form is anchored the same way, and excludes
 * `import(` so a dynamic import is not counted twice.
 */
function moduleSpecifiers(source) {
  const found = [];
  for (const match of source.matchAll(
    /(?<![\w"'`])from\s*["']([^"'\n]+)["']/g,
  )) {
    found.push(match[1]);
  }
  for (const match of source.matchAll(
    /\bimport\s*\(\s*["']([^"'\n]+)["']/g,
  )) {
    found.push(match[1]);
  }
  for (const match of source.matchAll(
    /(?<![\w"'`.$])import\s+["']([^"'\n]+)["']/g,
  )) {
    found.push(match[1]);
  }
  return found.filter((specifier) => !/\s/.test(specifier));
}

function qaImportClosure() {
  const seen = new Set();
  const queue = walkSourceFiles("packages/flow-shadow/src/qa").filter((file) =>
    file.endsWith(".ts"),
  );
  const files = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    const source = read(file);
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const resolved = normalize(join(dirname(file), specifier))
        .split(sep)
        .join("/");
      if (!resolved.startsWith("packages/flow-shadow/src/")) continue;
      if (!resolved.endsWith(".ts")) continue;
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }
  return files.sort();
}

function checkContentShadowQaPurity() {
  const qaFiles = qaImportClosure();
  invariant(
    qaFiles.length > 0,
    "the Content Shadow QA gate source must exist for its purity guard to mean anything",
  );
  invariant(
    qaFiles.includes("packages/flow-shadow/src/version.ts") &&
      qaFiles.includes("packages/flow-shadow/src/types.ts"),
    "the QA purity closure must reach the modules the gate imports from outside `qa/`",
  );
  for (const file of qaFiles) {
    // The gate's own tests import `vitest`, and nothing else non-relative. That
    // one specifier is allowlisted rather than skipping test files wholesale: a
    // test that reaches for `node:fs` is exactly as good a way to grow an IO
    // dependency as production code is, and the fixtures are production-shaped
    // input builders that must stay pure.
    const source = stripCodeComments(read(file));
    // The gate's own tests import `vitest`, and nothing else non-relative. That
    // one specifier is allowlisted rather than skipping test files wholesale: a
    // test reaching for `node:fs` is exactly as good a way to grow an IO
    // dependency as production code is, and the fixtures are input builders
    // that have to stay as pure as the rules they feed.
    const allowed = file.endsWith(".test.ts") ? new Set(["vitest"]) : new Set();
    for (const specifier of moduleSpecifiers(source)) {
      invariant(
        specifier.startsWith("./") ||
          specifier.startsWith("../") ||
          allowed.has(specifier),
        `${file} must not import \`${specifier}\`: the QA gate reads only relative modules, so no Node built-in, workspace package or third-party dependency can smuggle IO, a clock or hidden state into a verdict that has to be a pure function of the frozen run inputs`,
      );
    }
    for (const [pattern, description] of QA_PURITY_FORBIDDEN) {
      invariant(
        !pattern.test(source),
        `${file} must not ${description}: the QA verdict has to be a pure function of the frozen run inputs`,
      );
    }
  }

  // The role boundary, enforced structurally rather than by memory.
  //
  // `resolveAttribution` answers "does the pack hold anything this attribution
  // names?" — and one link to the customer's OWN site answers it yes. While the
  // rules called it directly and tested `source !== null`, that link vouched
  // for any invented reference sharing its line: a fabricated study, a
  // fabricated bibliography and an `et al.` citation each returned `passed` on
  // the strength of a call-to-action URL. The two questions a rule may ask are
  // `resolveAssertionSupport` (whose return type has no first-party inhabitant)
  // and `resolveLinkProvenance`, so the low-level lookup stays inside the
  // module that owns the distinction.
  const RESOLUTION_OWNER = "packages/flow-shadow/src/qa/claims.ts";

  // Red line D: the ported Flow tooling is an EXTRACTION, never a runtime
  // dependency. A comment may name the sibling repository; code may not.
  const sourceFiles = SIBLING_REPO_SOURCE_ROOTS.flatMap((root) =>
    walkSourceFiles(root).filter(
      (file) =>
        (file.endsWith(".ts") ||
          file.endsWith(".tsx") ||
          file.endsWith(".mjs")) &&
        !file.includes("/node_modules/"),
    ),
  );

  // The role boundary reaches every consumer, not only the gate's own closure —
  // and it is stated as "the NAME may not appear", not as one export syntax.
  //
  // The previous re-export check was `/^\\s*resolveAttribution,\\s*$/m`, which
  // matches exactly one shape: an entry on its own line of a multi-line export
  // list. Measured, all four of these walked straight past it —
  // `export { resolveAttribution } from "./claims.ts";`,
  // `export { resolveAttribution, x } from "./claims.ts";`,
  // `export { resolveAttribution as resolve } from "./claims.ts";` and
  // `export * from "./claims.ts";` — while the gate printed that every scanned
  // file was free of re-exports. A guard whose summary claims more than it
  // checks is the failure this repository keeps finding, so the rule is now the
  // strongest one that is also simple: outside its owner and the tests, the
  // identifier may not appear at all. That covers calls, imports, aliases and
  // every export syntax in one predicate.
  for (const file of [...new Set([...qaFiles, ...sourceFiles])]) {
    if (file === RESOLUTION_OWNER) continue;
    if (file === GUARD_SOURCE) continue;
    if (file.endsWith(".test.ts") || file.endsWith(".test.mjs")) continue;
    const source = stripCodeComments(read(file));
    invariant(
      !/\bresolveAttribution\b/.test(source),
      `${file} must not name resolveAttribution: it reports whether an attribution matches ANYTHING in the pack, including the customer's own site, so a rule reading it decides that a first-party link supports a fabricated claim. Ask resolveAssertionSupport (evidence) or resolveLinkProvenance (is this address ours) instead. Importing, aliasing or re-exporting it moves the same mistake one line outside this guard's range`,
    );
  }

  // The one syntax an identifier ban cannot see: `export *` republishes a
  // module's whole surface without naming anything on it. Resolved rather than
  // pattern-matched, and followed transitively, because a two-hop barrel is the
  // same hole with an extra file in it.
  const starExports = new Map();
  for (const file of [...new Set([...qaFiles, ...sourceFiles])]) {
    const targets = [];
    for (const match of stripCodeComments(read(file)).matchAll(
      /\bexport\s+\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*["']([^"'\n]+)["']/g,
    )) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      targets.push(posixJoin(posixDirname(file), specifier));
    }
    if (targets.length > 0) starExports.set(file, targets);
  }
  for (const [file, targets] of starExports) {
    const seen = new Set([file]);
    const queue = [...targets];
    while (queue.length > 0) {
      const target = queue.pop();
      if (seen.has(target)) continue;
      seen.add(target);
      invariant(
        target !== RESOLUTION_OWNER,
        `${file} must not \`export *\` from ${RESOLUTION_OWNER}: a star re-export republishes resolveAttribution without naming it, which is the one shape the identifier ban above cannot see`,
      );
      queue.push(...(starExports.get(target) ?? []));
    }
  }

  for (const file of sourceFiles) {
    // The guard's own file states the forbidden token in order to report it.
    // Exempting exactly one path, by equality, keeps the rule readable; the
    // alternative is assembling the string from fragments so the guard can scan
    // itself, which hides the rule from the person who has to maintain it.
    if (file === GUARD_SOURCE) continue;
    invariant(
      !/gengrowth-flow-mvp/.test(stripCodeComments(read(file))),
      `${file} must not reference the sibling gengrowth-flow-mvp repository in code`,
    );
  }
  return `Content Shadow QA purity: ${qaFiles.length} files in the gate's import closure free of non-relative imports (\`from\`, \`import()\` and side-effect \`import\`), require(), process, globalThis, clock, randomness, locale-sensitive APIs and network; ${sourceFiles.length} source files across ${SIBLING_REPO_SOURCE_ROOTS.join(", ")} free of sibling-repo references, free of the identifier resolveAttribution in any syntax outside ${RESOLUTION_OWNER} and its tests, and free of any \`export *\` chain reaching it (${GUARD_SOURCE}, which must state both forbidden tokens to report them, is the single exemption)`;
}

const checks = [
  ["OpenAPI contract", checkOpenApi],
  ["content shadow QA purity", checkContentShadowQaPurity],
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
