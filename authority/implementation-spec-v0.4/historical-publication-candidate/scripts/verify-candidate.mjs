import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CANDIDATE_VERSION = "0.4.0";
const ACTIVE_VERSION = "0.3.0";
const CANDIDATE_ROOT = "authority/implementation-spec-v0.4";
const CANDIDATE_LOCK = "scripts/spec-v0.4-candidate-lock.json";
const ACTIVE_LOCK = "scripts/spec-v0.3-lock.json";

const CANDIDATE_FILES = [
  "README.md",
  "openapi.candidate.yaml",
  "schema.candidate.sql",
  "provider-boundaries.md",
  "repository-invariants.md",
  "acceptance-matrix.md",
  "scripts/verify-candidate.mjs",
  "scripts/verify-candidate.test.mjs",
];

const PROVIDER_KINDS = ["github", "wordpress"];
const RECEIPT_KINDS = ["change_receipt", "delivery_receipt"];
const ASYNC_RUN_KINDS = [
  "collection",
  "diagnostic",
  "artifact_generation",
  "export",
  "product_profile_synthesis",
  "content_shadow",
  "publication",
];
const ASYNC_RESULT_TYPES = [
  "collection_run",
  "diagnostic_run",
  "artifact",
  "export",
  "icp_profile",
  "flow_shadow_run",
  "publication_attempt",
];
const CANDIDATE_TABLES = [
  "app.artifact_approval_events",
  "app.publication_destinations",
  "app.publication_attempts",
  "app.publication_receipts",
];
const CANDIDATE_OPERATION_IDS = [
  "listArtifactApprovalEvents",
  "appendArtifactApprovalEvent",
  "listPublicationDestinations",
  "appendPublicationDestinationRevision",
  "getPublicationDestination",
  "revokePublicationDestination",
  "createPublicationAttempt",
  "getPublicationAttempt",
  "reconcilePublicationAttempt",
  "createPublicationRollbackAttempt",
];

const OPENAPI_MARKER_COUNTS = new Map([
  ["sideEffectClass", 2],
  ["external_write", 3],
  ["authorizationSnapshot", 7],
  ["previewRef", 6],
  ["rollbackPlan", 7],
  ["remotePrecondition", 4],
  ["idempotencyKey", 4],
  ["approvedArtifactRevision", 4],
  ["approvedArtifactContentHash", 4],
  ["approvalEventId", 7],
  ["artifactRevisionId", 6],
  ["reviewerActorId", 7],
  ["eventActorId", 3],
  ["publicationApproval", 4],
  ["sourceApproval", 4],
  ["predecessorDeliveryReceiptId", 4],
  ["remoteScopeRef", 2],
  ["qaGateVersion", 4],
  ["qaGateSnapshot", 8],
  ["customerAcknowledgementId", 2],
  ["listArtifactApprovalEvents", 1],
  ["appendArtifactApprovalEvent", 1],
  ["attemptKind", 3],
  ["sourcePublicationAttemptId", 5],
  ["authorizationGrantRef", 3],
]);

const SCHEMA_MARKER_COUNTS = new Map([
  ["CREATE TABLE app.artifact_approval_events", 1],
  ["CREATE TABLE app.publication_destinations", 1],
  ["CREATE TABLE app.publication_attempts", 1],
  ["CREATE TABLE app.publication_receipts", 1],
  ["async_runs remains status truth", 2],
  ["canonical target_ref", 2],
  ["reject_append_only_mutation", 4],
  ["approved_artifact_content_hash", 2],
  ["artifact_approval_events_one_terminal_per_event_idx", 1],
  ["attempt_kind", 4],
  ["source_publication_attempt_id", 5],
  ["event_actor_id", 4],
  ["publication_approval_event_id", 4],
  ["source_approval_event_id", 5],
  ["authorization_purpose", 6],
  ["predecessor_delivery_receipt_id", 4],
  ["remote_scope_ref", 5],
  ["enforce_publication_receipt_lineage", 2],
  ["ADD CONSTRAINT async_runs_kind_check", 1],
  ["ADD CONSTRAINT async_runs_result_type_check", 1],
  ["'publication'", 1],
  ["'publication_attempt'", 1],
  ["delivery_receipt", 10],
  ["change_receipt", 6],
]);

const PROVIDER_MARKER_COUNTS = new Map([
  ["GitHub App installation", 1],
  ["repository selection", 1],
  ["base branch", 1],
  ["permission probe", 1],
  ["encrypted secret reference", 2],
  ["capability probe", 2],
  ["author allowlist", 1],
  ["status allowlist", 2],
  ["merged SHA", 3],
  ["live canonical URL", 5],
  ["pending", 6],
  ["unavailable", 7],
  ["revoked", 6],
]);

const ACCEPTANCE_CASE_IDS = [
  "PUB-POS-DURABLE-APPROVAL",
  "PUB-POS-APPROVAL-TERMINAL-LINEAGE",
  "PUB-NEG-TERMINAL-ACTOR-MISSING",
  "PUB-POS-CANONICAL-ASYNC-RUN",
  "PUB-POS-GITHUB-DELIVERY",
  "PUB-POS-GITHUB-CHANGE",
  "PUB-POS-WORDPRESS-DELIVERY",
  "PUB-POS-WORDPRESS-CHANGE",
  "PUB-POS-IDEMPOTENT-REPLAY",
  "PUB-POS-STALE-SAME-KEY-READONLY-REPLAY",
  "PUB-NEG-STALE-REPLAY-NEW-KEY",
  "PUB-NEG-STALE-APPROVAL",
  "PUB-NEG-MUTABLE-CONTENT",
  "PUB-NEG-CROSS-SCOPE-TARGET",
  "PUB-NEG-MISSING-PREVIEW",
  "PUB-NEG-MISSING-ROLLBACK",
  "PUB-NEG-IDEMPOTENCY-HASH-MISMATCH",
  "PUB-NEG-SECOND-ACTIVE",
  "PUB-NEG-DELIVERY-AS-STATE",
  "PUB-NEG-NO-DURABLE-APPROVAL",
  "PUB-NEG-REVOKED-APPROVAL",
  "PUB-NEG-APPROVAL-HASH-MISMATCH",
  "PUB-NEG-CROSS-SCOPE-APPROVAL",
  "PUB-NEG-CLIENT-APPROVAL-FACTS",
  "PUB-NEG-CLIENT-AUTH-SNAPSHOT",
  "PUB-NEG-ROLLBACK-WITHOUT-SOURCE",
  "PUB-NEG-ROLLBACK-REUSES-PUBLISH-AUTH",
  "PUB-POS-ROLLBACK-REVOKED-SOURCE-LINEAGE",
  "PUB-NEG-CHANGE-WITHOUT-DELIVERY",
  "PUB-NEG-REMOTE-REVISION-DRIFT",
  "PUB-NEG-REVOKED-AUTH",
  "PUB-NEG-RECEIPT-ONLY-RESULTS",
  "PUB-STATE-PENDING",
  "PUB-STATE-UNAVAILABLE",
  "PUB-STATE-REVOKED",
  "PUB-POS-ROLLBACK",
  "PUB-NEG-ROLLBACK-REWRITE",
];

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countLiteral(source, marker, flags = "g") {
  return (
    source.match(new RegExp(escapeRegularExpression(marker), flags)) ?? []
  ).length;
}

function assertExactMarkerCount(source, marker, expected, label, flags = "g") {
  const actual = countLiteral(source, marker, flags);
  invariant(
    actual === expected,
    `${label} marker ${marker} expected ${expected} occurrence(s), found ${actual}`,
  );
}

function assertIncludes(source, marker, label) {
  invariant(
    source.includes(marker),
    `${label} is missing required marker ${marker}`,
  );
}

function assertExactArray(actual, expected, label) {
  invariant(
    Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((entry, index) => entry === expected[index]),
    `${label} drifted: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
  );
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function listFilesRecursively(root) {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return listFilesRecursively(path);
    }
    return entry.isFile() ? [path] : [];
  });
}

function readCandidateFile(authorityRoot, relativePath, sourceOverrides) {
  if (Object.hasOwn(sourceOverrides, relativePath)) {
    return sourceOverrides[relativePath];
  }
  return readFileSync(join(authorityRoot, relativePath), "utf8");
}

function extractOperationIds(openapi) {
  return [...openapi.matchAll(/^\s+operationId:\s+([A-Za-z0-9_]+)\s*$/gm)].map(
    (match) => match[1],
  );
}

function extractCandidateTables(schema) {
  return [
    ...schema.matchAll(/^CREATE TABLE\s+(app\.[a-z0-9_]+)\s*\(/gim),
  ].map((match) => match[1]);
}

function sliceBetween(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  invariant(
    startIndex >= 0 && endIndex > startIndex,
    `${label} boundaries are missing`,
  );
  return source.slice(startIndex, endIndex);
}

function assertUniqueIndentedYamlKeys(source, indent, label) {
  const expression = new RegExp(`^ {${indent}}([^\\s][^:]*):(?:\\s|$)`, "gm");
  const seen = new Set();
  for (const match of source.matchAll(expression)) {
    const key = match[1];
    invariant(!seen.has(key), `${label} contains duplicate YAML key ${key}`);
    seen.add(key);
  }
}

function assertNoDuplicateCandidateYamlKeys(openapi) {
  const paths = sliceBetween(openapi, "\npaths:\n", "\ncomponents:\n", "paths");
  const components = openapi.slice(openapi.indexOf("\ncomponents:\n"));
  const securitySchemes = sliceBetween(
    components,
    "\n  securitySchemes:\n",
    "\n  parameters:\n",
    "components.securitySchemes",
  );
  const parameters = sliceBetween(
    components,
    "\n  parameters:\n",
    "\n  responses:\n",
    "components.parameters",
  );
  const responses = sliceBetween(
    components,
    "\n  responses:\n",
    "\n  schemas:\n",
    "components.responses",
  );
  const schemas = components.slice(components.indexOf("\n  schemas:\n"));

  assertUniqueIndentedYamlKeys(paths, 2, "paths");
  assertUniqueIndentedYamlKeys(
    securitySchemes,
    4,
    "components.securitySchemes",
  );
  assertUniqueIndentedYamlKeys(parameters, 4, "components.parameters");
  assertUniqueIndentedYamlKeys(responses, 4, "components.responses");
  assertUniqueIndentedYamlKeys(schemas, 4, "components.schemas");
}

export function verifyCandidateSourceSet({
  readme,
  openapi,
  schema,
  providerBoundaries,
  repositoryInvariants,
  acceptanceMatrix,
}) {
  for (const [label, source] of Object.entries({
    readme,
    openapi,
    schema,
    providerBoundaries,
    repositoryInvariants,
    acceptanceMatrix,
  })) {
    invariant(
      typeof source === "string" && source.length > 0,
      `${label} candidate source is missing`,
    );
  }

  assertIncludes(readme, "状态：**candidate**", "candidate README");
  assertIncludes(readme, "规范性：**non-normative**", "candidate README");
  assertIncludes(readme, "当前 active authority", "candidate README");
  assertIncludes(readme, "0.3", "candidate README");
  assertIncludes(readme, "原子地", "candidate README");
  assertIncludes(
    readme,
    "不得创造第二个 active status",
    "candidate README",
  );
  assertIncludes(
    readme,
    "execution_artifacts.status = ready",
    "candidate README",
  );
  assertIncludes(readme, "artifact_approval_events", "candidate README");
  assertIncludes(readme, "authorizationGrantRef", "candidate README");
  assertIncludes(readme, "repository-invariants.md", "candidate README");
  assertIncludes(readme, "kind = publication", "candidate README");
  assertIncludes(readme, "result_type = publication_attempt", "candidate README");
  assertIncludes(
    readme,
    "任何正向 Results 必须来自后续独立、不可变、有时间窗与限制说明的 Observation",
    "candidate README",
  );

  assertIncludes(openapi, "x-authority-status: candidate", "candidate OpenAPI");
  assertIncludes(openapi, "x-normative: false", "candidate OpenAPI");
  assertIncludes(openapi, "version: 0.4.0-candidate", "candidate OpenAPI");
  assertNoDuplicateCandidateYamlKeys(openapi);
  for (const [marker, expected] of OPENAPI_MARKER_COUNTS) {
    assertExactMarkerCount(openapi, marker, expected, "candidate OpenAPI");
  }
  assertExactArray(
    extractOperationIds(openapi),
    CANDIDATE_OPERATION_IDS,
    "candidate OpenAPI operationIds",
  );
  assertIncludes(openapi, "enum: [github, wordpress]", "candidate OpenAPI");
  assertIncludes(
    openapi,
    "enum: [delivery_receipt, change_receipt]",
    "candidate OpenAPI",
  );
  assertIncludes(
    openapi,
    "execution_artifacts.status=ready and updatedAt are never approval facts",
    "candidate OpenAPI",
  );
  assertExactMarkerCount(
    openapi,
    "pattern: '^[ -~]+$'",
    3,
    "candidate OpenAPI Idempotency-Key",
  );
  assertIncludes(
    openapi,
    "A delivery receipt never proves a live change",
    "candidate OpenAPI",
  );
  assertIncludes(
    openapi,
    "never proves positive Results",
    "candidate OpenAPI",
  );
  const approvalEvent = sliceBetween(
    openapi,
    "    ArtifactApprovalEvent:",
    "    ArtifactApprovalSnapshot:",
    "candidate approval event",
  );
  assertIncludes(approvalEvent, "eventActorId", "candidate approval event");
  assertIncludes(approvalEvent, "reviewerActorId", "candidate approval event");
  assertIncludes(
    approvalEvent,
    "eventKind: { const: approved }",
    "candidate approval event",
  );
  const publicationState = sliceBetween(
    openapi,
    "    PublicationState:",
    "    AuthorizationSnapshot:",
    "candidate publication state",
  );
  invariant(
    !/\bdelivered\b/.test(publicationState),
    "candidate PublicationState must not permit delivered",
  );
  assertIncludes(publicationState, "pending", "candidate publication state");
  assertIncludes(publicationState, "changed", "candidate publication state");
  const destinationRequest = sliceBetween(
    openapi,
    "    AppendPublicationDestinationRevisionRequest:",
    "    PublicationDestination:",
    "candidate destination request",
  );
  const attemptRequest = sliceBetween(
    openapi,
    "    CreatePublicationAttemptRequest:",
    "    PublicationAttemptAccepted:",
    "candidate publication request",
  );
  const reconcileOperation = sliceBetween(
    openapi,
    "      operationId: reconcilePublicationAttempt",
    "  /projects/{projectId}/publication-attempts/{publicationAttemptId}/rollback-requests:",
    "candidate reconciliation operation",
  );
  const rollbackOperation = sliceBetween(
    openapi,
    "      operationId: createPublicationRollbackAttempt",
    "\ncomponents:",
    "candidate rollback operation",
  );
  assertIncludes(
    destinationRequest,
    "authorizationGrantRef",
    "candidate destination request",
  );
  invariant(
    !destinationRequest.includes("authorizationSnapshot"),
    "candidate destination request must not accept a client authorizationSnapshot",
  );
  assertIncludes(
    attemptRequest,
    "approvalEventId",
    "candidate publication request",
  );
  invariant(
    !attemptRequest.includes("authorizationSnapshot"),
    "candidate publication request must not accept a client authorizationSnapshot",
  );
  assertIncludes(
    reconcileOperation,
    "x-side-effect-class: internal_write",
    "candidate reconciliation operation",
  );
  invariant(
    !reconcileOperation.includes("authorizationSnapshot"),
    "candidate reconciliation must re-read authorization instead of accepting a snapshot",
  );
  invariant(
    !rollbackOperation.includes("authorizationSnapshot"),
    "candidate rollback must re-read authorization instead of accepting a snapshot",
  );

  for (const [marker, expected] of SCHEMA_MARKER_COUNTS) {
    assertExactMarkerCount(schema, marker, expected, "candidate schema", "gi");
  }
  assertExactArray(
    extractCandidateTables(schema),
    CANDIDATE_TABLES,
    "candidate schema tables",
  );
  assertIncludes(schema, "BEGIN;", "candidate schema");
  assertIncludes(schema, "ROLLBACK;", "candidate schema");
  invariant(
    !schema.includes("prevent_append_only_mutation"),
    "candidate schema must reuse app.reject_append_only_mutation",
  );
  invariant(
    !/CREATE TABLE\s+app\.publication_targets\b/i.test(schema),
    "candidate schema must not create a second publication target truth",
  );
  invariant(
    !/CREATE TABLE\s+app\.(?:publication_)?(?:results|outcomes|measurements)\b/i.test(
      schema,
    ),
    "candidate schema must not create a second Results or measurement truth",
  );
  assertIncludes(
    schema,
    "A ready execution_artifacts row is not approval authority",
    "candidate schema",
  );
  assertIncludes(
    schema,
    "length(idempotency_key) BETWEEN 1 AND 128",
    "candidate schema",
  );
  assertIncludes(
    schema,
    "idempotency_key ~ '^[ -~]+$'",
    "candidate schema",
  );
  assertIncludes(
    schema,
    "current publication approval with no later",
    "candidate schema",
  );
  assertIncludes(
    schema,
    "No receipt row contains outcome metrics or directly drives positive",
    "candidate schema",
  );

  for (const [marker, expected] of PROVIDER_MARKER_COUNTS) {
    assertExactMarkerCount(
      providerBoundaries,
      marker,
      expected,
      "provider boundary",
      "gi",
    );
  }
  assertIncludes(
    providerBoundaries,
    "Delivery Receipt 与 Change Receipt 分离",
    "provider boundary",
  );
  assertIncludes(
    providerBoundaries,
    "execution_artifacts.status = ready",
    "provider boundary",
  );
  assertIncludes(
    providerBoundaries,
    "Results 不得从 receipt",
    "provider boundary",
  );

  for (const marker of [
    "async_runs_one_active_key_idx",
    "same-hash replay",
    "different-hash conflict",
    "stale replay",
    "sourcePublicationAttemptId",
    "predecessorDeliveryReceiptId",
    "delivery_receipt",
    "change_receipt",
  ]) {
    assertIncludes(marker === "sourcePublicationAttemptId" ? repositoryInvariants : repositoryInvariants.toLowerCase(), marker === "sourcePublicationAttemptId" ? marker : marker.toLowerCase(), "repository invariants");
  }

  for (const caseId of ACCEPTANCE_CASE_IDS) {
    assertIncludes(acceptanceMatrix, caseId, "acceptance matrix");
  }
  assertIncludes(
    acceptanceMatrix,
    "receipt-only Results negative test",
    "acceptance matrix",
  );
  assertIncludes(acceptanceMatrix, "原子晋升", "acceptance matrix");

  return {
    providerKinds: [...PROVIDER_KINDS],
    receiptKinds: [...RECEIPT_KINDS],
    operationIds: [...CANDIDATE_OPERATION_IDS],
    tables: [...CANDIDATE_TABLES],
    acceptanceCaseIds: [...ACCEPTANCE_CASE_IDS],
    asyncRunKinds: [...ASYNC_RUN_KINDS],
    asyncResultTypes: [...ASYNC_RESULT_TYPES],
  };
}

function inspectActiveSurface(repositoryRoot) {
  const sharedOpenApiPath = join(repositoryRoot, "openapi/mvp.yaml");
  const sharedOpenApi = existsSync(sharedOpenApiPath)
    ? readFileSync(sharedOpenApiPath, "utf8")
    : "";
  const candidateApiMarkers = [
    "x-authority-status: candidate",
    "0.4.0-candidate",
    ...CANDIDATE_OPERATION_IDS,
  ];

  const migrationRoot = join(repositoryRoot, "packages/db/migrations");
  const publicationMigrationExists = listFilesRecursively(migrationRoot).some(
    (path) => {
      if (!path.endsWith(".sql")) {
        return false;
      }
      if (/publication/i.test(basename(path))) {
        return true;
      }
      return /CREATE TABLE\s+app\.(?:artifact_approval_events|publication_(?:destinations|attempts|receipts))\b/i.test(
        readFileSync(path, "utf8"),
      );
    },
  );

  const explicitRuntimePaths = [
    join(repositoryRoot, "packages/publishing"),
    join(repositoryRoot, "packages/db/src/repositories/publications.ts"),
    join(repositoryRoot, "packages/db/src/repositories/publication.ts"),
    join(repositoryRoot, "apps/worker/src/publication"),
    join(
      repositoryRoot,
      "apps/web/src/app/api/mvp/projects/[projectId]/publication-destinations",
    ),
    join(
      repositoryRoot,
      "apps/web/src/app/api/mvp/projects/[projectId]/publication-attempts",
    ),
  ];
  const activeRuntimeRoots = [
    join(repositoryRoot, "packages/db/src"),
    join(repositoryRoot, "apps/worker/src"),
    join(repositoryRoot, "apps/web/src/app/api"),
    join(repositoryRoot, "apps/web/src/lib"),
  ];
  const publicationRuntimePattern =
    /\b(?:artifact_approval_events|publication_destinations|publication_attempts|publication_receipts|appendArtifactApprovalEvent|listArtifactApprovalEvents|createPublicationAttempt|listPublicationDestinations)\b/;
  const runtimeMarkerPath = activeRuntimeRoots
    .flatMap((root) => listFilesRecursively(root))
    .filter((path) => /\.(?:[cm]?[jt]sx?|sql)$/.test(path))
    .find((path) =>
      publicationRuntimePattern.test(readFileSync(path, "utf8")),
    );

  return {
    sharedOpenApiContainsCandidate: candidateApiMarkers.some((marker) =>
      sharedOpenApi.includes(marker),
    ),
    activeV04LockExists: existsSync(
      join(repositoryRoot, "scripts/spec-v0.4-lock.json"),
    ),
    publicationMigrationExists,
    publicationRuntimeExists:
      explicitRuntimePaths.some((path) => existsSync(path)) ||
      Boolean(runtimeMarkerPath),
  };
}

function verifyDiscovery(discovery) {
  invariant(
    discovery.schemaVersion === 1,
    "authority discovery schemaVersion drifted",
  );
  invariant(discovery.active?.version === ACTIVE_VERSION, "v0.3 must remain active");
  invariant(
    discovery.active?.status === "active",
    "v0.3 status must remain active",
  );
  invariant(
    discovery.active?.normative === true,
    "v0.3 must remain normative",
  );
  invariant(
    discovery.active?.authorityRoot === "authority/implementation-spec-v0.3",
    "active authority root drifted",
  );
  invariant(
    discovery.active?.lockPath === ACTIVE_LOCK,
    "active v0.3 lock drifted",
  );

  invariant(
    Array.isArray(discovery.candidates) && discovery.candidates.length === 1,
    "authority discovery must contain exactly one review candidate",
  );
  const candidate = discovery.candidates[0];
  invariant(
    candidate.version === CANDIDATE_VERSION,
    "v0.4 candidate version drifted",
  );
  invariant(
    candidate.status === "candidate",
    "v0.4 status must remain candidate",
  );
  invariant(
    candidate.normative === false,
    "v0.4 candidate must remain non-normative",
  );
  invariant(
    candidate.authorityRoot === CANDIDATE_ROOT,
    "candidate authority root drifted",
  );
  invariant(
    candidate.lockPath === CANDIDATE_LOCK,
    "candidate lock path drifted",
  );
}

function verifyActivePackageIdentity(repositoryRoot) {
  const packageJson = parseJson(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    "package.json",
  );
  invariant(
    packageJson.version === ACTIVE_VERSION,
    "package version must remain v0.3.0",
  );
  invariant(
    packageJson.scripts?.["verify:authority"] ===
      "node authority/implementation-spec-v0.3/scripts/verify-spec.mjs",
    "verify:authority must remain pinned to active v0.3",
  );
  invariant(
    packageJson.scripts?.["verify:spec"] === "node scripts/verify-spec-lock.mjs",
    "verify:spec active lock command drifted",
  );
}

function verifyCandidateLock({
  authorityRoot,
  discoverySource,
  lock,
  sourceOverrides,
}) {
  invariant(lock.lockFormat === 1, "candidate lockFormat drifted");
  invariant(
    lock.candidateVersion === CANDIDATE_VERSION,
    "candidate lock version drifted",
  );
  invariant(
    lock.baseActiveVersion === ACTIVE_VERSION,
    "candidate base active version drifted",
  );
  invariant(
    lock.authorityStatus === "candidate",
    "candidate lock status drifted",
  );
  invariant(
    lock.normative === false,
    "candidate lock must remain non-normative",
  );
  invariant(
    lock.authorityRoot === CANDIDATE_ROOT,
    "candidate lock authorityRoot drifted",
  );
  invariant(
    lock.discovery?.path === "authority/index.json",
    "candidate discovery path drifted",
  );
  invariant(
    lock.discovery?.sha256 === sha256(discoverySource),
    "authority discovery hash drift detected",
  );
  assertExactArray(
    lock.inventory?.providerKinds,
    PROVIDER_KINDS,
    "locked provider kinds",
  );
  assertExactArray(
    lock.inventory?.receiptKinds,
    RECEIPT_KINDS,
    "locked receipt kinds",
  );
  assertExactArray(
    lock.inventory?.candidateTables,
    CANDIDATE_TABLES,
    "locked candidate tables",
  );
  assertExactArray(
    lock.inventory?.operationIds,
    CANDIDATE_OPERATION_IDS,
    "locked candidate operationIds",
  );
  assertExactArray(
    lock.inventory?.asyncRunKinds,
    ASYNC_RUN_KINDS,
    "locked async run kinds",
  );
  assertExactArray(
    lock.inventory?.asyncResultTypes,
    ASYNC_RESULT_TYPES,
    "locked async result types",
  );

  const lockedFiles = Object.keys(lock.candidateFiles ?? {});
  assertExactArray(
    lockedFiles,
    CANDIDATE_FILES,
    "candidate locked file inventory",
  );
  for (const relativePath of CANDIDATE_FILES) {
    const source = readCandidateFile(
      authorityRoot,
      relativePath,
      sourceOverrides,
    );
    invariant(
      lock.candidateFiles[relativePath] === sha256(source),
      `candidate authority hash drift detected for ${relativePath}`,
    );
  }
}

export function verifyCandidateAuthority({
  repositoryRoot,
  authorityRoot = join(repositoryRoot, CANDIDATE_ROOT),
  lockPath = join(repositoryRoot, CANDIDATE_LOCK),
  sourceOverrides = {},
}) {
  invariant(repositoryRoot, "repositoryRoot is required");
  invariant(
    existsSync(authorityRoot),
    `candidate authority root not found: ${authorityRoot}`,
  );
  invariant(existsSync(lockPath), `candidate lock not found: ${lockPath}`);

  const sources = {
    readme: readCandidateFile(authorityRoot, "README.md", sourceOverrides),
    openapi: readCandidateFile(
      authorityRoot,
      "openapi.candidate.yaml",
      sourceOverrides,
    ),
    schema: readCandidateFile(
      authorityRoot,
      "schema.candidate.sql",
      sourceOverrides,
    ),
    providerBoundaries: readCandidateFile(
      authorityRoot,
      "provider-boundaries.md",
      sourceOverrides,
    ),
    repositoryInvariants: readCandidateFile(
      authorityRoot,
      "repository-invariants.md",
      sourceOverrides,
    ),
    acceptanceMatrix: readCandidateFile(
      authorityRoot,
      "acceptance-matrix.md",
      sourceOverrides,
    ),
  };
  const sourceReport = verifyCandidateSourceSet(sources);

  const discoveryPath = join(repositoryRoot, "authority/index.json");
  const discoverySource = readFileSync(discoveryPath, "utf8");
  const discovery = parseJson(discoverySource, "authority/index.json");
  verifyDiscovery(discovery);
  verifyActivePackageIdentity(repositoryRoot);

  const lock = parseJson(readFileSync(lockPath, "utf8"), CANDIDATE_LOCK);
  verifyCandidateLock({
    authorityRoot,
    discoverySource,
    lock,
    sourceOverrides,
  });

  const activeSurface = inspectActiveSurface(repositoryRoot);
  for (const [check, promoted] of Object.entries(activeSurface)) {
    invariant(
      promoted === false,
      `v0.4 candidate leaked into active surface: ${check}`,
    );
  }

  return {
    authority: {
      activeVersion: discovery.active.version,
      activeStatus: discovery.active.status,
      candidateVersion: discovery.candidates[0].version,
      candidateStatus: discovery.candidates[0].status,
      candidateNormative: discovery.candidates[0].normative,
    },
    providerKinds: sourceReport.providerKinds,
    receiptKinds: sourceReport.receiptKinds,
    operationIds: sourceReport.operationIds,
    tables: sourceReport.tables,
    acceptanceCaseCount: sourceReport.acceptanceCaseIds.length,
    asyncRunKinds: sourceReport.asyncRunKinds,
    asyncResultTypes: sourceReport.asyncResultTypes,
    activeSurface,
  };
}

function parseCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--report") {
      continue;
    }
    if (argument === "--root") {
      invariant(argv[index + 1], "--root requires a path");
      options.repositoryRoot = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const scriptDirectory = dirname(currentFile);
  const defaults = {
    repositoryRoot: resolve(scriptDirectory, "../../.."),
  };
  try {
    const options = { ...defaults, ...parseCliArguments(process.argv.slice(2)) };
    const report = verifyCandidateAuthority(options);
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "review-only-candidate",
          ...report,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          mode: "review-only-candidate",
          error: error.message,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}
