import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifyCandidateAuthority,
  verifyCandidateSourceSet,
} from "./verify-candidate.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const authorityRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(scriptDirectory, "../../..");

function read(relativePath) {
  return readFileSync(join(authorityRoot, relativePath), "utf8");
}

function sources(overrides = {}) {
  return {
    readme: read("README.md"),
    openapi: read("openapi.candidate.yaml"),
    schema: read("schema.candidate.sql"),
    providerBoundaries: read("provider-boundaries.md"),
    repositoryInvariants: read("repository-invariants.md"),
    acceptanceMatrix: read("acceptance-matrix.md"),
    ...overrides,
  };
}

test("the repository reports v0.3 active and v0.4 as a non-normative candidate", () => {
  const result = verifyCandidateAuthority({ repositoryRoot });

  assert.deepEqual(result.authority, {
    activeVersion: "0.3.0",
    activeStatus: "active",
    candidateVersion: "0.4.0",
    candidateStatus: "candidate",
    candidateNormative: false,
  });
  assert.deepEqual(result.providerKinds, ["github", "wordpress"]);
  assert.deepEqual(result.receiptKinds, [
    "change_receipt",
    "delivery_receipt",
  ]);
});

test("candidate OpenAPI must stay explicitly non-normative and freeze the complete external-write request", () => {
  assert.throws(
    () =>
      verifyCandidateSourceSet(
        sources({
          openapi: read("openapi.candidate.yaml").replace(
            "x-authority-status: candidate",
            "x-authority-status: active",
          ),
        }),
      ),
    /candidate|non-normative/i,
  );
  for (const requiredMarker of [
    "sideEffectClass",
    "external_write",
    "authorizationSnapshot",
    "previewRef",
    "rollbackPlan",
    "remotePrecondition",
    "idempotencyKey",
    "approvedArtifactRevision",
    "approvedArtifactContentHash",
    "approvalEventId",
    "artifactRevisionId",
    "reviewerActorId",
    "qaGateVersion",
    "qaGateSnapshot",
    "customerAcknowledgementId",
    "listArtifactApprovalEvents",
    "appendArtifactApprovalEvent",
    "attemptKind",
    "sourcePublicationAttemptId",
    "authorizationGrantRef",
    "eventActorId",
    "publicationApproval",
    "sourceApproval",
    "predecessorDeliveryReceiptId",
    "remoteScopeRef",
  ]) {
    assert.throws(
      () =>
        verifyCandidateSourceSet(
          sources({
            openapi: read("openapi.candidate.yaml").replace(
              requiredMarker,
              "REMOVED_REQUIRED_OPENAPI_MARKER",
            ),
          }),
        ),
      new RegExp(requiredMarker, "i"),
    );
  }
});

test("candidate schema owns durable approval, destination, attempt and receipt facts without a second status truth", () => {
  for (const requiredMarker of [
    "CREATE TABLE app.artifact_approval_events",
    "CREATE TABLE app.publication_destinations",
    "CREATE TABLE app.publication_attempts",
    "CREATE TABLE app.publication_receipts",
    "async_runs remains status truth",
    "canonical target_ref",
    "reject_append_only_mutation",
    "approved_artifact_content_hash",
    "artifact_approval_events_one_terminal_per_event_idx",
    "attempt_kind",
    "source_publication_attempt_id",
    "event_actor_id",
    "publication_approval_event_id",
    "source_approval_event_id",
    "authorization_purpose",
    "predecessor_delivery_receipt_id",
    "remote_scope_ref",
    "enforce_publication_receipt_lineage",
    "ADD CONSTRAINT async_runs_kind_check",
    "ADD CONSTRAINT async_runs_result_type_check",
    "'publication'",
    "'publication_attempt'",
    "delivery_receipt",
    "change_receipt",
  ]) {
    assert.throws(
      () =>
        verifyCandidateSourceSet(
          sources({
            schema: read("schema.candidate.sql").replace(
              requiredMarker,
              "REMOVED_REQUIRED_SCHEMA_MARKER",
            ),
          }),
        ),
      new RegExp(
        requiredMarker
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\\ /g, "\\s+"),
        "i",
      ),
    );
  }
});

test("provider boundaries require GitHub and WordPress authorization, reconciliation and revocation behavior", () => {
  for (const requiredMarker of [
    "GitHub App installation",
    "repository selection",
    "base branch",
    "permission probe",
    "encrypted secret reference",
    "capability probe",
    "author allowlist",
    "status allowlist",
    "merged SHA",
    "live canonical URL",
    "pending",
    "unavailable",
    "revoked",
  ]) {
    assert.throws(
      () =>
        verifyCandidateSourceSet(
          sources({
            providerBoundaries: read("provider-boundaries.md").replace(
              requiredMarker,
              "REMOVED_REQUIRED_PROVIDER_MARKER",
            ),
          }),
        ),
      new RegExp(requiredMarker.replace(/\s+/g, "\\s+"), "i"),
    );
  }
});

test("acceptance matrix rejects every dishonest publication and Results path", () => {
  for (const caseId of [
    "PUB-POS-DURABLE-APPROVAL",
    "PUB-POS-CANONICAL-ASYNC-RUN",
    "PUB-NEG-STALE-APPROVAL",
    "PUB-NEG-MUTABLE-CONTENT",
    "PUB-NEG-CROSS-SCOPE-TARGET",
    "PUB-NEG-MISSING-PREVIEW",
    "PUB-NEG-MISSING-ROLLBACK",
    "PUB-NEG-IDEMPOTENCY-HASH-MISMATCH",
    "PUB-NEG-SECOND-ACTIVE",
    "PUB-NEG-NO-DURABLE-APPROVAL",
    "PUB-NEG-REVOKED-APPROVAL",
    "PUB-NEG-APPROVAL-HASH-MISMATCH",
    "PUB-NEG-CROSS-SCOPE-APPROVAL",
    "PUB-NEG-CLIENT-APPROVAL-FACTS",
    "PUB-NEG-CLIENT-AUTH-SNAPSHOT",
    "PUB-NEG-ROLLBACK-WITHOUT-SOURCE",
    "PUB-POS-APPROVAL-TERMINAL-LINEAGE",
    "PUB-NEG-TERMINAL-ACTOR-MISSING",
    "PUB-NEG-DELIVERY-AS-STATE",
    "PUB-NEG-ROLLBACK-REUSES-PUBLISH-AUTH",
    "PUB-POS-ROLLBACK-REVOKED-SOURCE-LINEAGE",
    "PUB-NEG-CHANGE-WITHOUT-DELIVERY",
    "PUB-POS-STALE-SAME-KEY-READONLY-REPLAY",
    "PUB-NEG-STALE-REPLAY-NEW-KEY",
    "PUB-NEG-RECEIPT-ONLY-RESULTS",
    "PUB-STATE-PENDING",
    "PUB-STATE-UNAVAILABLE",
    "PUB-STATE-REVOKED",
  ]) {
    assert.throws(
      () =>
        verifyCandidateSourceSet(
          sources({
            acceptanceMatrix: read("acceptance-matrix.md").replace(
              caseId,
              "REMOVED_REQUIRED_ACCEPTANCE_CASE",
            ),
          }),
        ),
      new RegExp(caseId, "i"),
    );
  }
});

test("approval events separate the event actor from approved-only reviewer semantics", () => {
  const openapi = read("openapi.candidate.yaml");
  const approvalEvent = openapi.slice(
    openapi.indexOf("    ArtifactApprovalEvent:"),
    openapi.indexOf("    ArtifactApprovalSnapshot:"),
  );
  const approveRequest = openapi.slice(
    openapi.indexOf("    ApproveArtifactRevisionRequest:"),
    openapi.indexOf("    InvalidateArtifactApprovalRequest:"),
  );
  const terminalRequest = openapi.slice(
    openapi.indexOf("    InvalidateArtifactApprovalRequest:"),
    openapi.indexOf("    AppendArtifactApprovalEventRequest:"),
  );

  assert.match(approvalEvent, /eventActorId/);
  assert.match(approvalEvent, /reviewerActorId/);
  assert.match(approvalEvent, /eventKind: \{ const: approved \}/);
  assert.doesNotMatch(approveRequest, /eventActorId|reviewerActorId/);
  assert.doesNotMatch(terminalRequest, /eventActorId|reviewerActorId/);
});

test("delivery receipts keep customer publication state pending", () => {
  const openapi = read("openapi.candidate.yaml");
  const publicationState = openapi.slice(
    openapi.indexOf("    PublicationState:"),
    openapi.indexOf("    AuthorizationSnapshot:"),
  );

  assert.doesNotMatch(publicationState, /\bdelivered\b/);
  assert.match(publicationState, /\bpending\b/);
  assert.match(publicationState, /\bchanged\b/);
});

test("repository invariants freeze concurrency, replay, rollback and receipt lineage", () => {
  const invariants = read("repository-invariants.md");
  for (const requiredMarker of [
    "async_runs_one_active_key_idx",
    "same-hash replay",
    "different-hash conflict",
    "stale replay",
    "sourcePublicationAttemptId",
    "predecessorDeliveryReceiptId",
    "delivery_receipt",
    "change_receipt",
  ]) {
    assert.match(
      invariants,
      new RegExp(
        requiredMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
        "i",
      ),
    );
  }
});

test("candidate accepts only server-owned authorization references and treats reconciliation as an internal write", () => {
  const openapi = read("openapi.candidate.yaml");
  const approvalRequest = openapi.slice(
    openapi.indexOf("    ApproveArtifactRevisionRequest:"),
    openapi.indexOf("    InvalidateArtifactApprovalRequest:"),
  );
  const destinationRequest = openapi.slice(
    openapi.indexOf("    AppendPublicationDestinationRevisionRequest:"),
    openapi.indexOf("    PublicationDestination:"),
  );
  const attemptRequest = openapi.slice(
    openapi.indexOf("    CreatePublicationAttemptRequest:"),
    openapi.indexOf("    PublicationAttemptAccepted:"),
  );
  const reconcileOperation = openapi.slice(
    openapi.indexOf("      operationId: reconcilePublicationAttempt"),
    openapi.indexOf(
      "  /projects/{projectId}/publication-attempts/{publicationAttemptId}/rollback-requests:",
    ),
  );
  const rollbackOperation = openapi.slice(
    openapi.indexOf("      operationId: createPublicationRollbackAttempt"),
    openapi.indexOf("\ncomponents:"),
  );

  assert.match(approvalRequest, /expectedArtifactRevision/);
  assert.match(approvalRequest, /expectedQaGateVersion/);
  assert.match(approvalRequest, /customerAcknowledgementInput/);
  assert.doesNotMatch(approvalRequest, /artifactContentHash/);
  assert.doesNotMatch(approvalRequest, /qaGateSnapshot/);
  assert.doesNotMatch(approvalRequest, /customerAcknowledgementId|actorId|acknowledgedAt/);
  assert.match(destinationRequest, /authorizationGrantRef/);
  assert.doesNotMatch(destinationRequest, /authorizationSnapshot/);
  assert.match(attemptRequest, /approvalEventId/);
  assert.doesNotMatch(attemptRequest, /artifactId/);
  assert.doesNotMatch(attemptRequest, /approvedArtifactRevision/);
  assert.doesNotMatch(attemptRequest, /approvedArtifactContentHash/);
  assert.doesNotMatch(attemptRequest, /authorizationSnapshot/);
  assert.match(reconcileOperation, /x-side-effect-class: internal_write/);
  assert.doesNotMatch(reconcileOperation, /authorizationSnapshot/);
  assert.doesNotMatch(rollbackOperation, /authorizationSnapshot/);
  assert.match(rollbackOperation, /customerAcknowledgementInput/);
  assert.doesNotMatch(
    rollbackOperation,
    /customerAcknowledgementId|actorId|acknowledgedAt/,
  );
});

test("candidate OpenAPI component maps reject duplicate keys", () => {
  assert.throws(
    () =>
      verifyCandidateSourceSet(
        sources({
          openapi: read("openapi.candidate.yaml").replace(
            "    PublicationAttemptId:\n",
            "    PublicationAttemptId:\n    PublicationAttemptId:\n",
          ),
        }),
      ),
    /duplicate|PublicationAttemptId/i,
  );
});

test("candidate lock detects authority-file drift", () => {
  assert.throws(
    () =>
      verifyCandidateAuthority({
        repositoryRoot,
        sourceOverrides: {
          "provider-boundaries.md": `${read("provider-boundaries.md")}\ndrift\n`,
        },
      }),
    /hash|drift/i,
  );
});

test("candidate verification proves no promotion into active OpenAPI, migrations or runtime packages", () => {
  const result = verifyCandidateAuthority({ repositoryRoot });

  assert.equal(result.activeSurface.sharedOpenApiContainsCandidate, false);
  assert.equal(result.activeSurface.activeV04LockExists, false);
  assert.equal(result.activeSurface.publicationMigrationExists, false);
  assert.equal(result.activeSurface.publicationRuntimeExists, false);
});
