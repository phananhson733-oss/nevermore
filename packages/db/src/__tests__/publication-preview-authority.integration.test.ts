import { randomUUID } from "node:crypto";
import pg, { type Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { contentHash, type CanonicalValue } from "../hash.ts";
import { runMigrations } from "../migrate.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

type SqlClient = Pool | PoolClient;
type PreviewKind = "publish" | "rollback";
type TerminalPreviewKind = "revoked" | "superseded";
type JsonObject = { readonly [key: string]: CanonicalValue };

interface PublicationFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  readonly actionId: string;
  readonly artifactId: string;
  readonly artifactRevisionId: string;
  readonly artifactRevision: number;
  readonly artifactContentHash: string;
  readonly approvalEventId: string;
  readonly destinationId: string;
  readonly destinationRef: string;
  readonly destinationRevision: number;
  readonly providerKind: "github";
  readonly targetRef: string;
  readonly providerScope: JsonObject;
}

interface IssuedPreview {
  readonly id: string;
  readonly kind: PreviewKind;
  readonly ref: string;
  readonly factsHash: string;
  readonly contentChecksum: string;
  readonly providerPlan: JsonObject;
  readonly remotePrecondition: JsonObject;
  readonly rollbackPlan: JsonObject;
  readonly sourcePublicationAttemptId: string | null;
  readonly sourceChangeReceiptId: string | null;
}

interface AttemptAuthorization {
  readonly id: string;
  readonly purpose: PreviewKind;
  readonly snapshot: JsonObject;
  readonly snapshotHash: string;
}

interface PublicationAttempt {
  readonly id: string;
  readonly asyncRunId: string;
  readonly preview: IssuedPreview;
}

interface VerifiedPublication {
  readonly attempt: PublicationAttempt;
  readonly deliveryReceiptId: string;
  readonly changeReceiptId: string;
}

interface ScopeOverride {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
}

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

function opaquePreviewRef(): string {
  return `prv_${randomUUID().replaceAll("-", "")}_${randomUUID().replaceAll("-", "")}`;
}

async function createFixture(pool: Pool): Promise<PublicationFixture> {
  const client = await pool.connect();
  const actorId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const icpProfileId = randomUUID();
  const diagnosticRunId = randomUUID();
  const evidenceId = randomUUID();
  const findingId = randomUUID();
  const observationId = randomUUID();
  const actionId = randomUUID();
  const artifactId = randomUUID();
  const artifactRevisionId = randomUUID();
  const approvalEventId = randomUUID();
  const connectorGrantId = randomUUID();
  const destinationId = randomUUID();
  const destinationRef = randomUUID();
  const targetRef = "content/blog/customer-onboarding.md";
  const observedAt = new Date().toISOString();
  const host = `${projectId}.example.test`;
  const icpProfile = {};
  const artifactContent = "# Customer onboarding\n\nFixture publication content.";
  const artifactContentHash = contentHash({
    contentFormat: "markdown",
    contentText: artifactContent,
  });
  const qaGateSnapshot = {
    gate: "fixture.qa.v1",
    passed: true,
    checks: ["content", "sources", "links"],
  };
  const customerAcknowledgement = {
    customerAcknowledgementId: randomUUID(),
    actorId,
    acknowledgedAt: observedAt,
    acknowledgementScope: {
      artifactId,
      artifactRevision: 1,
      artifactContentHash,
    },
  };
  const providerScope = {
    providerKind: "github",
    installationId: 201,
    repositoryId: 101,
    repositoryOwner: "gengrowth",
    repositoryName: "website",
    baseBranch: "main",
    branchPrefix: "gengrowth/",
    contentPath: targetRef,
    grantedPermissions: [
      "metadata_read",
      "contents_read",
      "contents_write",
      "pull_requests_write",
    ],
  };
  const requestedScope = {
    providerKind: "github",
    repositoryId: 101,
    baseBranch: "main",
    branchPrefix: "gengrowth/",
    contentPath: targetRef,
  };
  const connectorSnapshot = {
    purpose: "connector_configuration",
    destinationRef,
    destinationRevision: 1,
    providerKind: "github",
    targetRef,
  };

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO app.workspaces (id, name) VALUES ($1, $2)`,
      [workspaceId, `Publication authority ${workspaceId}`],
    );
    await client.query(
      `
        INSERT INTO app.client_projects (
          id, workspace_id, client_name, project_name,
          default_delivery_locale, created_by
        )
        VALUES ($1, $2, $3, $4, 'en-US', $5)
      `,
      [
        projectId,
        workspaceId,
        `Client ${projectId}`,
        `Project ${projectId}`,
        actorId,
      ],
    );
    await client.query(
      `
        INSERT INTO app.sites (
          id, workspace_id, project_id, origin, host,
          market_codes, language_codes, is_primary
        )
        VALUES ($1, $2, $3, $4, $5, ARRAY['US'], ARRAY['en'], true)
      `,
      [siteId, workspaceId, projectId, `https://${host}`, host],
    );
    await client.query(
      `
        INSERT INTO app.icp_profiles (
          id, workspace_id, project_id, version, status,
          profile, content_hash, created_by
        )
        VALUES ($1, $2, $3, 1, 'complete', $4, $5, $6)
      `,
      [
        icpProfileId,
        workspaceId,
        projectId,
        icpProfile,
        contentHash(icpProfile),
        actorId,
      ],
    );
    await client.query(
      `
        INSERT INTO app.async_runs (
          id, workspace_id, project_id, kind, status,
          result_type, result_id, initiated_by, started_at, completed_at
        )
        VALUES (
          $1, $2, $3, 'diagnostic', 'completed',
          'diagnostic_run', $1, $4, $5, $5
        )
      `,
      [diagnosticRunId, workspaceId, projectId, actorId, observedAt],
    );
    await client.query(
      `
        INSERT INTO app.diagnostic_runs (
          id, workspace_id, project_id, site_id,
          icp_profile_id, icp_profile_version,
          rule_set_version, prompt_set_version, output_locale,
          input_manifest, input_hash, coverage
        )
        VALUES (
          $1, $2, $3, $4, $5, 1,
          'mvp.rules.0.2.0', 'mvp.prompts.0.2.0', 'en-US',
          '{}'::jsonb, $6, '{}'::jsonb
        )
      `,
      [
        diagnosticRunId,
        workspaceId,
        projectId,
        siteId,
        icpProfileId,
        contentHash({ diagnosticRunId }),
      ],
    );
    await client.query(
      `
        INSERT INTO app.evidence (
          id, workspace_id, project_id, diagnostic_run_id,
          source_provider, origin, method, grade, availability, support,
          subject_refs, claim, observed_at, limitation
        )
        VALUES (
          $1, $2, $3, $4,
          'system', 'derived', 'computed', 'B', 'available', 'supports',
          $5, $6, $7, $8
        )
      `,
      [
        evidenceId,
        workspaceId,
        projectId,
        diagnosticRunId,
        JSON.stringify([
          { type: "url", value: "/customer-onboarding/" },
        ]),
        "The page has a deterministic publication opportunity.",
        observedAt,
        "Deterministic integration fixture.",
      ],
    );
    await client.query(
      `
        INSERT INTO app.findings (
          id, workspace_id, project_id, finding_key,
          rule_id, rule_version, rule_family, intent, domain,
          title_key, title_args, summary, summary_locale, subject_refs,
          severity, confidence, review_state,
          first_seen_run_id, last_seen_run_id,
          first_seen_at, last_seen_at
        )
        VALUES (
          $1, $2, $3, $4,
          'CONTENT-GAP-011', 1, 'content', 'coverage', 'content_intent',
          'fixture.publication.title', '{}'::jsonb, $5, 'en-US', $6,
          'medium', 'high', 'confirmed',
          $7, $7, $8, $8
        )
      `,
      [
        findingId,
        workspaceId,
        projectId,
        contentHash({ findingId }),
        "Confirmed content opportunity for publication.",
        JSON.stringify([
          { type: "url", value: "/customer-onboarding/" },
        ]),
        diagnosticRunId,
        observedAt,
      ],
    );
    await client.query(
      `
        INSERT INTO app.finding_observations (
          id, workspace_id, project_id, finding_id,
          diagnostic_run_id, evidence_id, role
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'primary')
      `,
      [
        observationId,
        workspaceId,
        projectId,
        findingId,
        diagnosticRunId,
        evidenceId,
      ],
    );
    await client.query(
      `
        INSERT INTO app.actions (
          id, workspace_id, project_id,
          source_finding_id, source_diagnostic_run_id,
          action_key, template_id, template_version,
          title, description, content_locale,
          priority_band, roadmap_lane, status,
          effort, risk, expected_outcome, evidence_refs, created_by
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, 'fixture.publication', 1,
          'Publish customer onboarding content',
          'Publish the approved customer onboarding artifact.',
          'en-US', 'medium', 'now', 'planned',
          'small', 'low', 'Create a verifiable live change.', $7, $8
        )
      `,
      [
        actionId,
        workspaceId,
        projectId,
        findingId,
        diagnosticRunId,
        contentHash({ actionId }),
        JSON.stringify([evidenceId]),
        actorId,
      ],
    );
    await client.query(
      `
        INSERT INTO app.execution_artifacts (
          id, workspace_id, project_id, action_id,
          artifact_type, status, generation_mode, output_locale,
          current_revision, validation_state, content_hash, created_by
        )
        VALUES (
          $1, $2, $3, $4,
          'content_brief', 'ready', 'template', 'en-US',
          1, 'valid', $5, $6
        )
      `,
      [
        artifactId,
        workspaceId,
        projectId,
        actionId,
        artifactContentHash,
        actorId,
      ],
    );
    await client.query(
      `
        INSERT INTO app.artifact_revisions (
          id, workspace_id, project_id, artifact_id,
          revision, output_locale, content_format, content_text,
          content_hash, generated_by, validation_errors
        )
        VALUES (
          $1, $2, $3, $4,
          1, 'en-US', 'markdown', $5,
          $6, 'template', '[]'::jsonb
        )
      `,
      [
        artifactRevisionId,
        workspaceId,
        projectId,
        artifactId,
        artifactContent,
        artifactContentHash,
      ],
    );
    await client.query(
      `
        INSERT INTO app.artifact_approval_events (
          id, workspace_id, project_id,
          artifact_id, artifact_revision_id, artifact_revision,
          artifact_content_hash, event_kind,
          event_actor_id, reviewer_actor_id,
          qa_gate_version, qa_gate_snapshot, qa_gate_snapshot_hash,
          customer_acknowledgement, customer_acknowledgement_hash
        )
        VALUES (
          $1, $2, $3,
          $4, $5, 1,
          $6, 'approved',
          $7, $7,
          'fixture.qa.v1', $8, $9,
          $10, $11
        )
      `,
      [
        approvalEventId,
        workspaceId,
        projectId,
        artifactId,
        artifactRevisionId,
        artifactContentHash,
        actorId,
        qaGateSnapshot,
        contentHash(qaGateSnapshot),
        customerAcknowledgement,
        contentHash(customerAcknowledgement),
      ],
    );
    await client.query(
      `
        INSERT INTO app.delivery_authorization_grants (
          id, workspace_id, project_id, site_id,
          provider_kind, purpose, state,
          destination_ref, destination_revision, target_ref,
          requested_scope, requested_scope_hash,
          authorization_snapshot, authorization_snapshot_hash,
          secret_metadata, created_by
        )
        VALUES (
          $1, $2, $3, $4,
          'github', 'connector_configuration', 'ready',
          $5, 1, $6,
          $7, $8,
          $9, $10,
          '{}'::jsonb, $11
        )
      `,
      [
        connectorGrantId,
        workspaceId,
        projectId,
        siteId,
        destinationRef,
        targetRef,
        requestedScope,
        contentHash(requestedScope),
        connectorSnapshot,
        contentHash(connectorSnapshot),
        actorId,
      ],
    );
    await client.query(
      `
        INSERT INTO app.publication_destinations (
          id, destination_ref, revision, supersedes_id,
          workspace_id, project_id, site_id,
          provider_kind, target_ref, state, authorization_grant_id,
          provider_scope, provider_scope_hash,
          authorization_snapshot, authorization_snapshot_hash,
          readiness_observation, limitation, created_by
        )
        VALUES (
          $1, $2, 1, NULL,
          $3, $4, $5,
          'github', $6, 'ready', $7,
          $8, $9,
          $10, $11,
          $12, NULL, $13
        )
      `,
      [
        destinationId,
        destinationRef,
        workspaceId,
        projectId,
        siteId,
        targetRef,
        connectorGrantId,
        providerScope,
        contentHash(providerScope),
        connectorSnapshot,
        contentHash(connectorSnapshot),
        { permissionProbe: "passed" },
        actorId,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    actorId,
    workspaceId,
    projectId,
    siteId,
    diagnosticRunId,
    actionId,
    artifactId,
    artifactRevisionId,
    artifactRevision: 1,
    artifactContentHash,
    approvalEventId,
    destinationId,
    destinationRef,
    destinationRevision: 1,
    providerKind: "github",
    targetRef,
    providerScope,
  };
}

async function issuePreview(
  db: SqlClient,
  fixture: PublicationFixture,
  options: {
    readonly kind?: PreviewKind;
    readonly scope?: ScopeOverride;
    readonly sourcePublicationAttemptId?: string;
    readonly sourceChangeReceiptId?: string;
    readonly contentChecksum?: string;
  } = {},
): Promise<IssuedPreview> {
  const id = randomUUID();
  const kind = options.kind ?? "publish";
  const scope = options.scope ?? fixture;
  const ref = opaquePreviewRef();
  const providerPlan = {
    providerKind: fixture.providerKind,
    operation:
      kind === "publish" ? "create_pull_request" : "create_revert_pull_request",
    destinationRef: fixture.destinationRef,
    destinationRevision: fixture.destinationRevision,
    targetRef: fixture.targetRef,
  };
  const remotePrecondition = {
    kind: "must_match",
    revision: "main@fixture-before",
  };
  const rollbackPlan = {
    providerKind: fixture.providerKind,
    strategy: "github_revert_pr",
    priorRemoteRevision: "main@fixture-before",
    expectedCurrentRemoteRevision: "main@fixture-after",
  };
  const contentChecksum =
    options.contentChecksum ??
    contentHash({ artifact: fixture.artifactContentHash, preview: id });
  const factsHash = contentHash({
    id,
    kind,
    scope: {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId: scope.siteId,
    },
    destinationId: fixture.destinationId,
    destinationRef: fixture.destinationRef,
    destinationRevision: fixture.destinationRevision,
    actionId: fixture.actionId,
    artifactRevisionId: fixture.artifactRevisionId,
    approvalEventId: fixture.approvalEventId,
    sourcePublicationAttemptId:
      options.sourcePublicationAttemptId ?? null,
    sourceChangeReceiptId: options.sourceChangeReceiptId ?? null,
    providerPlan,
    remotePrecondition,
    rollbackPlan,
    contentChecksum,
  });

  await db.query(
    `
      INSERT INTO app.publication_preview_events (
        id, preview_ref, event_kind,
        supersedes_preview_event_id, supersedes_preview_event_kind,
        preview_kind, facts_schema_version,
        workspace_id, project_id, site_id,
        destination_id, destination_ref, destination_revision,
        provider_kind, target_ref, action_id,
        artifact_id, artifact_revision_id, artifact_revision,
        artifact_content_hash,
        artifact_approval_event_id, artifact_approval_event_kind,
        source_publication_attempt_id, source_change_receipt_id,
        provider_plan, remote_precondition, rollback_plan,
        preview_checksum, content_checksum, facts_hash,
        expires_at, event_actor_id,
        idempotency_key, request_hash, reason
      )
      VALUES (
        $1, $2, 'issued',
        NULL, NULL,
        $3, 'publication-preview-facts.v1',
        $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15,
        $16,
        $17, 'approved',
        $18, $19,
        $20, $21, $22,
        $16, $23, $24,
        $25, $26,
        $27, $28, NULL
      )
    `,
    [
      id,
      ref,
      kind,
      scope.workspaceId,
      scope.projectId,
      scope.siteId,
      fixture.destinationId,
      fixture.destinationRef,
      fixture.destinationRevision,
      fixture.providerKind,
      fixture.targetRef,
      fixture.actionId,
      fixture.artifactId,
      fixture.artifactRevisionId,
      fixture.artifactRevision,
      fixture.artifactContentHash,
      fixture.approvalEventId,
      options.sourcePublicationAttemptId ?? null,
      options.sourceChangeReceiptId ?? null,
      providerPlan,
      remotePrecondition,
      rollbackPlan,
      contentChecksum,
      factsHash,
      new Date(Date.now() + 10 * 60_000).toISOString(),
      fixture.actorId,
      `preview:${randomUUID()}`,
      contentHash({ request: id }),
    ],
  );

  return {
    id,
    kind,
    ref,
    factsHash,
    contentChecksum,
    providerPlan,
    remotePrecondition,
    rollbackPlan,
    sourcePublicationAttemptId:
      options.sourcePublicationAttemptId ?? null,
    sourceChangeReceiptId: options.sourceChangeReceiptId ?? null,
  };
}

async function createAttemptAuthorization(
  db: SqlClient,
  fixture: PublicationFixture,
  purpose: PreviewKind,
): Promise<AttemptAuthorization> {
  const id = randomUUID();
  const requestedScope = {
    providerKind: fixture.providerKind,
    repositoryId: 101,
    contentPath: fixture.targetRef,
  };
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const snapshot = {
    purpose,
    destinationRef: fixture.destinationRef,
    destinationRevision: fixture.destinationRevision,
    providerKind: fixture.providerKind,
    targetRef: fixture.targetRef,
    expiresAt,
    nonce: randomUUID(),
  };
  const snapshotHash = contentHash(snapshot);

  await db.query(
    `
      INSERT INTO app.delivery_authorization_grants (
        id, workspace_id, project_id, site_id,
        provider_kind, purpose, state,
        destination_ref, destination_revision, target_ref,
        requested_scope, requested_scope_hash,
        authorization_snapshot, authorization_snapshot_hash,
        secret_metadata, expires_at, created_by
      )
      VALUES (
        $1, $2, $3, $4,
        'github', $5, 'ready',
        $6, $7, $8,
        $9, $10,
        $11, $12,
        '{}'::jsonb, $13, $14
      )
    `,
    [
      id,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      purpose,
      fixture.destinationRef,
      fixture.destinationRevision,
      fixture.targetRef,
      requestedScope,
      contentHash(requestedScope),
      snapshot,
      snapshotHash,
      expiresAt,
      fixture.actorId,
    ],
  );
  return { id, purpose, snapshot, snapshotHash };
}

async function insertAttempt(
  db: SqlClient,
  fixture: PublicationFixture,
  preview: IssuedPreview,
  authorization?: AttemptAuthorization,
): Promise<PublicationAttempt> {
  const attemptId = randomUUID();
  const asyncRunId = randomUUID();
  const grant =
    authorization ??
    (await createAttemptAuthorization(db, fixture, preview.kind));

  await db.query(
    `
      INSERT INTO app.async_runs (
        id, workspace_id, project_id,
        kind, status, active_key,
        result_type, result_id, initiated_by
      )
      VALUES (
        $1, $2, $3,
        'publication', 'queued', $4,
        'publication_attempt', $5, $6
      )
    `,
    [
      asyncRunId,
      fixture.workspaceId,
      fixture.projectId,
      `publication:${fixture.destinationRef}:${fixture.targetRef}`,
      attemptId,
      fixture.actorId,
    ],
  );

  await db.query(
    `
      INSERT INTO app.publication_attempts (
        id, attempt_kind,
        source_publication_attempt_id, source_change_receipt_id,
        preview_event_id, preview_event_kind, preview_facts_hash,
        workspace_id, project_id, site_id, async_run_id,
        destination_id, destination_ref, destination_revision,
        provider_kind, target_ref, action_id,
        artifact_id, artifact_revision_id,
        approved_artifact_revision, approved_artifact_content_hash,
        publication_approval_event_id, publication_approval_event_kind,
        source_approval_event_id, source_approval_event_kind,
        side_effect_class,
        authorization_grant_id, authorization_purpose,
        authorization_snapshot, authorization_snapshot_hash,
        preview_ref, preview_checksum, content_checksum,
        remote_precondition, rollback_plan,
        idempotency_key, request_hash, requested_by
      )
      VALUES (
        $1, $2,
        $3, $4,
        $5, 'issued', $6,
        $7, $8, $9, $10,
        $11, $12, $13,
        $14, $15, $16,
        $17, $18,
        $19, $20,
        $21, $22,
        $23, $24,
        'external_write',
        $25, $26,
        $27, $28,
        $29, $20, $30,
        $31, $32,
        $33, $34, $35
      )
    `,
    [
      attemptId,
      preview.kind,
      preview.sourcePublicationAttemptId,
      preview.sourceChangeReceiptId,
      preview.id,
      preview.factsHash,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      asyncRunId,
      fixture.destinationId,
      fixture.destinationRef,
      fixture.destinationRevision,
      fixture.providerKind,
      fixture.targetRef,
      fixture.actionId,
      fixture.artifactId,
      fixture.artifactRevisionId,
      fixture.artifactRevision,
      fixture.artifactContentHash,
      preview.kind === "publish" ? fixture.approvalEventId : null,
      preview.kind === "publish" ? "approved" : null,
      preview.kind === "rollback" ? fixture.approvalEventId : null,
      preview.kind === "rollback" ? "approved" : null,
      grant.id,
      grant.purpose,
      grant.snapshot,
      grant.snapshotHash,
      preview.ref,
      preview.contentChecksum,
      preview.remotePrecondition,
      preview.rollbackPlan,
      `attempt:${randomUUID()}`,
      contentHash({ request: attemptId }),
      fixture.actorId,
    ],
  );

  return { id: attemptId, asyncRunId, preview };
}

async function terminalPreview(
  db: SqlClient,
  fixture: PublicationFixture,
  issuedPreviewId: string,
  eventKind: TerminalPreviewKind = "revoked",
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `
      INSERT INTO app.publication_preview_events (
        id, preview_ref, event_kind,
        supersedes_preview_event_id, supersedes_preview_event_kind,
        preview_kind, facts_schema_version,
        workspace_id, project_id, site_id,
        destination_id, destination_ref, destination_revision,
        provider_kind, target_ref, action_id,
        artifact_id, artifact_revision_id, artifact_revision,
        artifact_content_hash,
        artifact_approval_event_id, artifact_approval_event_kind,
        source_publication_attempt_id, source_change_receipt_id,
        provider_plan, remote_precondition, rollback_plan,
        preview_checksum, content_checksum, facts_hash,
        expires_at, event_actor_id,
        idempotency_key, request_hash, reason
      )
      SELECT
        $1, source.preview_ref, $2,
        source.id, 'issued',
        source.preview_kind, source.facts_schema_version,
        source.workspace_id, source.project_id, source.site_id,
        source.destination_id, source.destination_ref, source.destination_revision,
        source.provider_kind, source.target_ref, source.action_id,
        source.artifact_id, source.artifact_revision_id, source.artifact_revision,
        source.artifact_content_hash,
        source.artifact_approval_event_id, source.artifact_approval_event_kind,
        source.source_publication_attempt_id, source.source_change_receipt_id,
        source.provider_plan, source.remote_precondition, source.rollback_plan,
        source.preview_checksum, source.content_checksum, source.facts_hash,
        source.expires_at, $3,
        $4, $5, $6
      FROM app.publication_preview_events source
      WHERE source.id = $7
        AND source.workspace_id = $8
        AND source.project_id = $9
        AND source.event_kind = 'issued'
    `,
    [
      id,
      eventKind,
      fixture.actorId,
      `preview-terminal:${randomUUID()}`,
      contentHash({ terminal: id }),
      "Fixture authority reduction.",
      issuedPreviewId,
      fixture.workspaceId,
      fixture.projectId,
    ],
  );
  return id;
}

async function terminateApproval(
  db: SqlClient,
  fixture: PublicationFixture,
): Promise<void> {
  await db.query(
    `
      INSERT INTO app.artifact_approval_events (
        id, workspace_id, project_id,
        artifact_id, artifact_revision_id, artifact_revision,
        artifact_content_hash, event_kind,
        supersedes_approval_event_id, supersedes_approval_event_kind,
        event_actor_id, reviewer_actor_id,
        qa_gate_version, qa_gate_snapshot, qa_gate_snapshot_hash,
        customer_acknowledgement, customer_acknowledgement_hash,
        reason
      )
      SELECT
        $1, workspace_id, project_id,
        artifact_id, artifact_revision_id, artifact_revision,
        artifact_content_hash, 'revoked',
        id, 'approved',
        $2, NULL,
        qa_gate_version, qa_gate_snapshot, qa_gate_snapshot_hash,
        customer_acknowledgement, customer_acknowledgement_hash,
        'Fixture approval revocation.'
      FROM app.artifact_approval_events
      WHERE id = $3
        AND workspace_id = $4
        AND project_id = $5
        AND event_kind = 'approved'
    `,
    [
      randomUUID(),
      fixture.actorId,
      fixture.approvalEventId,
      fixture.workspaceId,
      fixture.projectId,
    ],
  );
}

async function createDestinationRevision(
  db: SqlClient,
  fixture: PublicationFixture,
): Promise<string> {
  const connectorGrantId = randomUUID();
  const destinationId = randomUUID();
  const revision = fixture.destinationRevision + 1;
  const requestedScope = {
    providerKind: fixture.providerKind,
    repositoryId: 101,
    contentPath: fixture.targetRef,
  };
  const connectorSnapshot = {
    purpose: "connector_configuration",
    destinationRef: fixture.destinationRef,
    destinationRevision: revision,
    providerKind: fixture.providerKind,
    targetRef: fixture.targetRef,
  };
  await db.query(
    `
      INSERT INTO app.delivery_authorization_grants (
        id, workspace_id, project_id, site_id,
        provider_kind, purpose, state,
        destination_ref, destination_revision, target_ref,
        requested_scope, requested_scope_hash,
        authorization_snapshot, authorization_snapshot_hash,
        secret_metadata, created_by
      )
      VALUES (
        $1, $2, $3, $4,
        'github', 'connector_configuration', 'ready',
        $5, $6, $7,
        $8, $9,
        $10, $11,
        '{}'::jsonb, $12
      )
    `,
    [
      connectorGrantId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      fixture.destinationRef,
      revision,
      fixture.targetRef,
      requestedScope,
      contentHash(requestedScope),
      connectorSnapshot,
      contentHash(connectorSnapshot),
      fixture.actorId,
    ],
  );
  await db.query(
    `
      INSERT INTO app.publication_destinations (
        id, destination_ref, revision, supersedes_id,
        workspace_id, project_id, site_id,
        provider_kind, target_ref, state, authorization_grant_id,
        provider_scope, provider_scope_hash,
        authorization_snapshot, authorization_snapshot_hash,
        readiness_observation, limitation, created_by
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        'github', $8, 'ready', $9,
        $10, $11,
        $12, $13,
        $14, NULL, $15
      )
    `,
    [
      destinationId,
      fixture.destinationRef,
      revision,
      fixture.destinationId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      fixture.targetRef,
      connectorGrantId,
      fixture.providerScope,
      contentHash(fixture.providerScope),
      connectorSnapshot,
      contentHash(connectorSnapshot),
      { permissionProbe: "passed", revision },
      fixture.actorId,
    ],
  );
  return destinationId;
}

async function completeAsyncRun(
  db: SqlClient,
  asyncRunId: string,
): Promise<void> {
  await db.query(
    `
      UPDATE app.async_runs
      SET status = 'completed', completed_at = now()
      WHERE id = $1
    `,
    [asyncRunId],
  );
}

async function advanceArtifact(
  db: SqlClient,
  fixture: PublicationFixture,
): Promise<void> {
  const contentText = "# Customer onboarding\n\nA newer artifact revision.";
  const contentHashValue = contentHash({
    contentFormat: "markdown",
    contentText,
  });
  await db.query(
    `
      INSERT INTO app.artifact_revisions (
        id, workspace_id, project_id, artifact_id,
        revision, output_locale, content_format, content_text,
        content_hash, generated_by, validation_errors
      )
      VALUES (
        $1, $2, $3, $4,
        2, 'en-US', 'markdown', $5,
        $6, 'operator', '[]'::jsonb
      )
    `,
    [
      randomUUID(),
      fixture.workspaceId,
      fixture.projectId,
      fixture.artifactId,
      contentText,
      contentHashValue,
    ],
  );
  await db.query(
    `
      UPDATE app.execution_artifacts
      SET current_revision = 2, content_hash = $1
      WHERE id = $2
        AND workspace_id = $3
        AND project_id = $4
    `,
    [
      contentHashValue,
      fixture.artifactId,
      fixture.workspaceId,
      fixture.projectId,
    ],
  );
}

async function createVerifiedPublication(
  db: SqlClient,
  fixture: PublicationFixture,
): Promise<VerifiedPublication> {
  const preview = await issuePreview(db, fixture);
  const attempt = await insertAttempt(db, fixture, preview);
  await completeAsyncRun(db, attempt.asyncRunId);

  const deliveryReceiptId = randomUUID();
  const changeReceiptId = randomUUID();
  const deliveredAt = new Date(Date.now() - 1000).toISOString();
  const verifiedAt = new Date().toISOString();
  const remoteScopeRef = "github:gengrowth/website:main";
  await db.query(
    `
      INSERT INTO app.publication_receipts (
        id, workspace_id, project_id, site_id,
        publication_attempt_id, receipt_kind,
        predecessor_delivery_receipt_id,
        provider_kind, provider_request_id, remote_scope_ref,
        remote_object_kind, remote_object_id, remote_revision,
        delivery_url, live_canonical_url,
        artifact_content_hash, content_checksum,
        verification_state, remote_facts, evidence_refs,
        limitation, observed_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5, 'delivery_receipt',
        NULL,
        'github', $6, $7,
        'github_pull_request', $8, $9,
        $10, NULL,
        $11, $12,
        'provider_accepted', $13, '[]'::jsonb,
        NULL, $14
      )
    `,
    [
      deliveryReceiptId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      attempt.id,
      `request-${randomUUID()}`,
      remoteScopeRef,
      `pr-${randomUUID()}`,
      "github-pr-head-fixture",
      "https://github.com/gengrowth/website/pull/101",
      fixture.artifactContentHash,
      preview.contentChecksum,
      { pullRequestState: "open" },
      deliveredAt,
    ],
  );
  await db.query(
    `
      INSERT INTO app.publication_receipts (
        id, workspace_id, project_id, site_id,
        publication_attempt_id, receipt_kind,
        predecessor_delivery_receipt_id,
        provider_kind, provider_request_id, remote_scope_ref,
        remote_object_kind, remote_object_id, remote_revision,
        delivery_url, live_canonical_url,
        artifact_content_hash, content_checksum,
        verification_state, remote_facts, evidence_refs,
        limitation, observed_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5, 'change_receipt',
        $6,
        'github', $7, $8,
        'github_merge', $9, $10,
        $11, $12,
        $13, $14,
        'verified_live', $15, $16,
        NULL, $17
      )
    `,
    [
      changeReceiptId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      attempt.id,
      deliveryReceiptId,
      `request-${randomUUID()}`,
      remoteScopeRef,
      `merge-${randomUUID()}`,
      "github-main-after-fixture",
      "https://github.com/gengrowth/website/pull/101",
      "https://example.test/blog/customer-onboarding/",
      fixture.artifactContentHash,
      preview.contentChecksum,
      { mergeState: "merged", liveFetch: "verified" },
      JSON.stringify([
        {
          kind: "live_fetch",
          url: "https://example.test/blog/customer-onboarding/",
        },
      ]),
      verifiedAt,
    ],
  );

  return { attempt, deliveryReceiptId, changeReceiptId };
}

async function waitForBackendLock(
  pool: Pool,
  backendPid: number,
  isSettled: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{
      wait_event_type: string | null;
    }>(
      `
        SELECT wait_event_type
        FROM pg_stat_activity
        WHERE pid = $1
      `,
      [backendPid],
    );
    if (result.rows[0]?.wait_event_type === "Lock") return;
    if (isSettled()) {
      throw new Error("Concurrent losing query settled before reaching a lock");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the concurrent preview-row lock");
}

describeDb("publication preview authority", () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    pool = new pg.Pool({
      connectionString: DATABASE_URL!,
      max: 12,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("accepts a valid issued publish preview with all authority facts frozen", async () => {
    const fixture = await createFixture(pool);
    const preview = await issuePreview(pool, fixture);

    const result = await pool.query<{
      event_kind: string;
      preview_kind: string;
      preview_checksum: string;
      facts_hash: string;
    }>(
      `
        SELECT event_kind, preview_kind, preview_checksum, facts_hash
        FROM app.publication_preview_events
        WHERE id = $1
      `,
      [preview.id],
    );
    expect(result.rows).toEqual([
      {
        event_kind: "issued",
        preview_kind: "publish",
        preview_checksum: fixture.artifactContentHash,
        facts_hash: preview.factsHash,
      },
    ]);
  });

  it("rejects wrong-scope, stale-destination, and terminated-approval previews", async () => {
    const wrongScopeFixture = await createFixture(pool);
    const foreignScope = await createFixture(pool);
    await expectPgCode(
      issuePreview(pool, wrongScopeFixture, {
        scope: {
          workspaceId: foreignScope.workspaceId,
          projectId: foreignScope.projectId,
          siteId: foreignScope.siteId,
        },
      }),
      "23514",
    );

    const staleDestinationFixture = await createFixture(pool);
    await createDestinationRevision(pool, staleDestinationFixture);
    await expectPgCode(
      issuePreview(pool, staleDestinationFixture),
      "23514",
    );

    const terminatedApprovalFixture = await createFixture(pool);
    await terminateApproval(pool, terminatedApprovalFixture);
    await expectPgCode(
      issuePreview(pool, terminatedApprovalFixture),
      "23514",
    );
  });

  it("prevents Attempt after a terminal Preview", async () => {
    const fixture = await createFixture(pool);
    const preview = await issuePreview(pool, fixture);
    await terminalPreview(pool, fixture, preview.id);

    await expectPgCode(insertAttempt(pool, fixture, preview), "23514");
  });

  it("prevents terminal Preview after Attempt and consumes a Preview only once", async () => {
    const terminalFixture = await createFixture(pool);
    const terminalPreviewSource = await issuePreview(pool, terminalFixture);
    await insertAttempt(pool, terminalFixture, terminalPreviewSource);
    await expectPgCode(
      terminalPreview(pool, terminalFixture, terminalPreviewSource.id),
      "23514",
    );

    const consumptionFixture = await createFixture(pool);
    const consumedPreview = await issuePreview(pool, consumptionFixture);
    const firstAttempt = await insertAttempt(
      pool,
      consumptionFixture,
      consumedPreview,
    );
    await completeAsyncRun(pool, firstAttempt.asyncRunId);
    await expectPgCode(
      insertAttempt(pool, consumptionFixture, consumedPreview),
      "23505",
    );
  });

  it(
    "serializes terminal-vs-Attempt concurrency with a strict single winner in both directions",
    async () => {
      const attemptWinnerFixture = await createFixture(pool);
      const attemptWinnerPreview = await issuePreview(
        pool,
        attemptWinnerFixture,
      );
      const attemptClient = await pool.connect();
      const terminalClient = await pool.connect();
      try {
        await attemptClient.query("BEGIN");
        await terminalClient.query("BEGIN");
        await insertAttempt(
          attemptClient,
          attemptWinnerFixture,
          attemptWinnerPreview,
        );
        const terminalPid = (
          await terminalClient.query<{ pid: number }>(
            "SELECT pg_backend_pid() AS pid",
          )
        ).rows[0]!.pid;
        let terminalSettled = false;
        const terminalOutcome = terminalPreview(
          terminalClient,
          attemptWinnerFixture,
          attemptWinnerPreview.id,
        ).then(
          () => {
            terminalSettled = true;
            return { ok: true as const, error: undefined };
          },
          (error: unknown) => {
            terminalSettled = true;
            return { ok: false as const, error };
          },
        );
        await waitForBackendLock(
          pool,
          terminalPid,
          () => terminalSettled,
        );
        await attemptClient.query("COMMIT");
        const terminalResult = await terminalOutcome;
        expect(terminalResult.ok).toBe(false);
        expect(pgCode(terminalResult.error)).toBe("23514");
        await terminalClient.query("ROLLBACK");
      } finally {
        await attemptClient.query("ROLLBACK").catch(() => undefined);
        attemptClient.release();
        await terminalClient.query("ROLLBACK").catch(() => undefined);
        terminalClient.release();
      }

      const terminalWinnerFixture = await createFixture(pool);
      const terminalWinnerPreview = await issuePreview(
        pool,
        terminalWinnerFixture,
      );
      const terminalWinnerClient = await pool.connect();
      const losingAttemptClient = await pool.connect();
      try {
        await terminalWinnerClient.query("BEGIN");
        await losingAttemptClient.query("BEGIN");
        await terminalPreview(
          terminalWinnerClient,
          terminalWinnerFixture,
          terminalWinnerPreview.id,
        );
        const attemptPid = (
          await losingAttemptClient.query<{ pid: number }>(
            "SELECT pg_backend_pid() AS pid",
          )
        ).rows[0]!.pid;
        let attemptSettled = false;
        const attemptOutcome = insertAttempt(
          losingAttemptClient,
          terminalWinnerFixture,
          terminalWinnerPreview,
        ).then(
          () => {
            attemptSettled = true;
            return { ok: true as const, error: undefined };
          },
          (error: unknown) => {
            attemptSettled = true;
            return { ok: false as const, error };
          },
        );
        await waitForBackendLock(pool, attemptPid, () => attemptSettled);
        await terminalWinnerClient.query("COMMIT");
        const attemptResult = await attemptOutcome;
        expect(attemptResult.ok).toBe(false);
        expect(pgCode(attemptResult.error)).toBe("23514");
        await losingAttemptClient.query("ROLLBACK");
      } finally {
        await terminalWinnerClient
          .query("ROLLBACK")
          .catch(() => undefined);
        terminalWinnerClient.release();
        await losingAttemptClient
          .query("ROLLBACK")
          .catch(() => undefined);
        losingAttemptClient.release();
      }
    },
    15_000,
  );

  it("blocks issue and Attempt for an archived project while allowing terminal authority reduction", async () => {
    const fixture = await createFixture(pool);
    const preview = await issuePreview(pool, fixture);
    const authorization = await createAttemptAuthorization(
      pool,
      fixture,
      "publish",
    );
    await pool.query(
      `
        UPDATE app.client_projects
        SET archived_at = now()
        WHERE id = $1 AND workspace_id = $2
      `,
      [fixture.projectId, fixture.workspaceId],
    );

    await expectPgCode(issuePreview(pool, fixture), "23514");
    await expectPgCode(
      insertAttempt(pool, fixture, preview, authorization),
      "23514",
    );
    await expect(
      terminalPreview(pool, fixture, preview.id),
    ).resolves.toEqual(expect.any(String));
  });

  it("rejects publish Attempt after the Artifact current revision changes", async () => {
    const fixture = await createFixture(pool);
    const preview = await issuePreview(pool, fixture);
    await advanceArtifact(pool, fixture);

    await expectPgCode(insertAttempt(pool, fixture, preview), "23514");
  });

  it("allows rollback of a historical Artifact only with the exact verified Change Receipt", async () => {
    const fixture = await createFixture(pool);
    const firstPublication = await createVerifiedPublication(pool, fixture);
    const secondPublication = await createVerifiedPublication(pool, fixture);
    await advanceArtifact(pool, fixture);

    await expectPgCode(
      issuePreview(pool, fixture, {
        kind: "rollback",
        sourcePublicationAttemptId: firstPublication.attempt.id,
        sourceChangeReceiptId: firstPublication.deliveryReceiptId,
        contentChecksum:
          firstPublication.attempt.preview.contentChecksum,
      }),
      "23514",
    );

    await expectPgCode(
      issuePreview(pool, fixture, {
        kind: "rollback",
        sourcePublicationAttemptId: firstPublication.attempt.id,
        sourceChangeReceiptId: secondPublication.changeReceiptId,
        contentChecksum:
          firstPublication.attempt.preview.contentChecksum,
      }),
      "23514",
    );

    const rollbackPreview = await issuePreview(pool, fixture, {
      kind: "rollback",
      sourcePublicationAttemptId: firstPublication.attempt.id,
      sourceChangeReceiptId: firstPublication.changeReceiptId,
      contentChecksum: firstPublication.attempt.preview.contentChecksum,
    });
    await expect(
      insertAttempt(pool, fixture, rollbackPreview),
    ).resolves.toMatchObject({
      preview: { id: rollbackPreview.id, kind: "rollback" },
    });
  });
});
