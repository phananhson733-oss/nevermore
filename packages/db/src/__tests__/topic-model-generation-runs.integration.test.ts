import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash, type CanonicalValue } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import {
  AnalysisRefreshRunsRepository,
  analysisRefreshPlanHash,
  analysisRefreshPlanManifest,
} from "../repositories/analysis-refresh-runs.ts";
import {
  AsyncRunsRepository,
  toRunAttempt,
  type RunAttempt,
} from "../repositories/async-runs.ts";
import { IcpProfilesRepository } from "../repositories/icp-profiles.ts";
import { ProjectsRepository } from "../repositories/projects.ts";
import { SitesRepository } from "../repositories/sites.ts";
import { TopicModelGenerationInvocationAttemptsRepository } from "../repositories/topic-model-generation-invocation-attempts.ts";
import { TopicModelGenerationRunsRepository } from "../repositories/topic-model-generation-runs.ts";
import { TopicModelsRepository } from "../repositories/topic-models.ts";
import {
  analysisInvocations,
  asyncRuns,
  topicModelGenerationInvocationAttempts,
  topicModelGenerationRuns,
  topicModelRevisions,
  workspaces,
} from "../schema.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const PLAN_V3_HASH =
  "fc527bb7203d61ce126625a0b2bb4bffb59fe5999d9f6b78e5aa05409918368b";
const CAPTURED_AT = "2026-08-09T08:00:00.000Z";

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { readonly code?: unknown; readonly cause?: unknown };
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

interface ProjectFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
}

interface GenerationFixture {
  readonly project: ProjectFixture;
  readonly parentRunId: string;
  readonly runId: string;
  readonly inputManifest: Record<string, unknown>;
  readonly inputHash: string;
}

interface ConfirmedTopicFixture {
  readonly revisionId: string;
  readonly revision: number;
  readonly rootTopicNodeId: string;
}

interface GeneratedTopicDraftFixture extends ConfirmedTopicFixture {
  readonly contentHash: string;
}

describeDb("Topic Model generation persistence", () => {
  let handle: DbHandle;
  let secondMigrationReplay: readonly string[];

  beforeAll(async () => {
    // Resolve the safety policy before opening a pool. A hosted, shared, or
    // ordinary developer database therefore fails closed without a probe.
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    await runMigrations(databaseUrl);
    secondMigrationReplay = await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);
  });

  afterAll(async () => {
    await handle?.end();
  });

  function scope(project: ProjectFixture) {
    return {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };
  }

  async function createWorkspace(label: string): Promise<string> {
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `${label} ${randomUUID()}` })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("workspace fixture insert failed");
    return workspace.id;
  }

  async function createProject(
    label: string,
    workspaceId?: string,
  ): Promise<ProjectFixture> {
    const resolvedWorkspaceId =
      workspaceId ?? (await createWorkspace(`${label} workspace`));
    const actorId = randomUUID();
    const project = await new ProjectsRepository(handle.db).insert({
      workspaceId: resolvedWorkspaceId,
      clientName: `${label} client`,
      projectName: `${label} project`,
      defaultDeliveryLocale: "en",
      createdBy: actorId,
    });
    const host = `${randomUUID()}.topic-generation.example`;
    const site = await new SitesRepository(handle.db).insertPrimary({
      workspaceId: resolvedWorkspaceId,
      projectId: project.id,
      origin: `https://${host}`,
      host,
      marketCodes: ["US"],
      languageCodes: ["en"],
    });
    const profile = { productName: `${label} product` };
    const icpProfile = await new IcpProfilesRepository(handle.db).insertVersion({
      workspaceId: resolvedWorkspaceId,
      projectId: project.id,
      version: 1,
      status: "complete",
      profile,
      contentHash: contentHash({ status: "complete", profile }),
      createdBy: actorId,
    });
    const projects = new ProjectsRepository(handle.db);
    await expect(
      projects.setCurrentIcpProfile(
        { workspaceId: resolvedWorkspaceId },
        project.id,
        icpProfile.id,
      ),
    ).resolves.toBe(true);
    await expect(
      projects.setConfirmedIcpProfile(
        { workspaceId: resolvedWorkspaceId },
        project.id,
        icpProfile.id,
      ),
    ).resolves.toBe(true);
    return {
      actorId,
      workspaceId: resolvedWorkspaceId,
      projectId: project.id,
      siteId: site.id,
      icpProfileId: icpProfile.id,
    };
  }

  async function createRefreshParent(project: ProjectFixture): Promise<string> {
    const runId = randomUUID();
    const asyncRunsRepository = new AsyncRunsRepository(handle.db);
    await asyncRunsRepository.insertQueued({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      kind: "analysis_refresh",
      activeKey: `topic-parent:${randomUUID()}`,
      initiatedBy: project.actorId,
      contractVersion: "2026-07-21",
      resultType: "analysis_refresh_run",
      resultId: runId,
    });
    await new AnalysisRefreshRunsRepository(handle.db).create({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      siteId: project.siteId,
      icpProfileId: project.icpProfileId,
    });
    const claimed = await asyncRunsRepository.claim(scope(project), runId);
    if (!claimed) throw new Error("Analysis Refresh parent was not claimed");
    return runId;
  }

  function generationManifest(
    project: ProjectFixture,
    parentRunId: string,
  ): Record<string, unknown> {
    return {
      schemaVersion: "topic-model-generation-input.v1",
      analysisRefreshRunId: parentRunId,
      projectId: project.projectId,
      market: "US",
      language: "en",
      groups: [
        {
          groupKey: "customer-onboarding",
          representativeKeywords: [
            "customer onboarding software",
            "onboarding automation",
          ],
          keywordCount: 2,
          aggregateSearchVolume: 2_600,
          providerIntentDistribution: {
            informational: 0,
            navigational: 0,
            commercial: 1,
            transactional: 0,
          },
          urls: ["https://example.test/customer-onboarding"],
        },
      ],
      productProfile: {
        productName: "Disposable Topic generation fixture",
        oneLiner: null,
        category: null,
        valueProposition: null,
        coreFeatures: [],
      },
      icp: null,
      keywords: [
        {
          keywordId: randomUUID(),
          expectedGovernanceRevision: 0,
          groupKey: "customer-onboarding",
          providerSearchIntent: {
            value: "commercial",
            snapshotId: randomUUID(),
            observationId: randomUUID(),
            observedAt: CAPTURED_AT,
          },
        },
        {
          keywordId: randomUUID(),
          expectedGovernanceRevision: 0,
          groupKey: "customer-onboarding",
          providerSearchIntent: null,
        },
      ],
    };
  }

  async function insertChildRun(
    project: ProjectFixture,
    kind: "topic_model_generation" | "diagnostic" =
      "topic_model_generation",
  ): Promise<string> {
    const runId = randomUUID();
    const run = await new AsyncRunsRepository(handle.db).insertQueued({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      kind,
      activeKey: `topic-child:${randomUUID()}`,
      initiatedBy: project.actorId,
      contractVersion: "2026-07-21",
      requestPayload: { command: "topic_model_generation" },
      ...(kind === "topic_model_generation"
        ? {
            resultType: "topic_model_generation_run",
            resultId: runId,
          }
        : {}),
    });
    return run.id;
  }

  async function createGenerationRun(
    project: ProjectFixture,
  ): Promise<GenerationFixture> {
    const parentRunId = await createRefreshParent(project);
    const runId = await insertChildRun(project);
    const inputManifest = generationManifest(project, parentRunId);
    const inputHash = contentHash(inputManifest as CanonicalValue);
    await new TopicModelGenerationRunsRepository(handle.db).insertPlaceholder({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      analysisRefreshRunId: parentRunId,
      generationVersion: "topic-model-generation.v1",
      promptSetVersion: "topic-model.prompt.v1",
      inputManifest,
      inputHash,
    });
    const started = await new AnalysisRefreshRunsRepository(handle.db).startStep(
      scope(project),
      parentRunId,
      "topic_model",
      runId,
    );
    if (started === null) {
      throw new Error("Topic Model generation parent step did not start");
    }
    return { project, parentRunId, runId, inputManifest, inputHash };
  }

  async function claimGenerationRun(
    fixture: GenerationFixture,
  ): Promise<RunAttempt> {
    const claimed = await new AsyncRunsRepository(handle.db).claim(
      scope(fixture.project),
      fixture.runId,
    );
    if (!claimed) throw new Error("Topic Model generation run was not claimed");
    return toRunAttempt(claimed);
  }

  const invocationPreflight = {
    provider: "openai",
    model: "gpt-5-mini",
    promptSetVersion: "topic-model.prompt.v1",
    inputHash: contentHash({ fixture: "bounded-redacted-topic-prompt" }),
  } as const;

  const failedInvocation = {
    ...invocationPreflight,
    outputHash: null,
    status: "failed" as const,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    latencyMs: 25,
    errorCode: "SERVER_ERROR",
  } as const;

  function succeededInvocation(runId: string) {
    return {
      ...invocationPreflight,
      outputHash: contentHash({ runId, output: "validated topic result" }),
      status: "succeeded" as const,
      inputTokens: 120,
      outputTokens: 60,
      costUsd: 0.01,
      latencyMs: 25,
      errorCode: null,
    };
  }

  async function createGeneratedTopicDraft(
    fixture: GenerationFixture,
    invocationId: string,
    generationInputHash = fixture.inputHash,
  ): Promise<GeneratedTopicDraftFixture> {
    const topics = new TopicModelsRepository(handle.db);
    const draft = await topics.beginDraftFromLatestConfirmed(
      scope(fixture.project),
      fixture.project.actorId,
      {
        expectedLatestConfirmedRevision: 0,
        reason: "Create the disposable generated Topic Model result.",
      },
    );
    await handle.db
      .update(topicModelRevisions)
      .set({
        generation_basis: {
          origin: "llm_auto_confirmed",
          generationVersion: "topic-model-generation.v1",
          baseTopicModelRevision: null,
          analysisInvocationId: invocationId,
          promptSetVersion: "topic-model.prompt.v1",
          inputHash: generationInputHash,
          keywordGroupCount: 1,
          keywordCount: 2,
          reason: "Initial model generated by Analysis Refresh",
        },
      })
      .where(
        and(
          eq(topicModelRevisions.workspace_id, fixture.project.workspaceId),
          eq(topicModelRevisions.project_id, fixture.project.projectId),
          eq(topicModelRevisions.revision, draft.topicModelRevision),
        ),
      );
    const edited = await topics.patchDraft(
      scope(fixture.project),
      fixture.project.actorId,
      {
        topicModelRevision: draft.topicModelRevision,
        expectedEditRevision: draft.editRevision,
        reason: "Add the generated Topic root.",
        intents: [
          {
            kind: "create",
            parentTopicNodeId: null,
            label: "Customer onboarding",
            description: "Generated from bounded keyword evidence.",
            intentEnvelope: ["commercial"],
          },
        ],
      },
    );
    if (edited.rootTopicNodeId === null) {
      throw new Error("generated Topic Model root was not found");
    }
    const [row] = await handle.db
      .select({ id: topicModelRevisions.id })
      .from(topicModelRevisions)
      .where(
        and(
          eq(topicModelRevisions.workspace_id, fixture.project.workspaceId),
          eq(topicModelRevisions.project_id, fixture.project.projectId),
          eq(topicModelRevisions.revision, edited.topicModelRevision),
        ),
    );
    if (!row) throw new Error("generated Topic Model draft was not found");
    return {
      revisionId: row.id,
      revision: edited.topicModelRevision,
      rootTopicNodeId: edited.rootTopicNodeId,
      contentHash: contentHash({
        topicModelRevision: edited.topicModelRevision,
        rootTopicNodeId: edited.rootTopicNodeId,
      }),
    };
  }

  async function confirmGeneratedTopicDraft(
    fixture: GenerationFixture,
    draft: GeneratedTopicDraftFixture,
    confirmedBy: string | null,
  ): Promise<ConfirmedTopicFixture> {
    const client = await handle.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{
        id: string;
        revision: number;
        root_topic_node_id: string;
      }>(
        `UPDATE app.topic_model_revisions
         SET status = 'confirmed',
             content_hash = $4,
             confirmed_by = $5,
             confirmed_at = greatest(clock_timestamp(), created_at)
         WHERE workspace_id = $1
           AND project_id = $2
           AND id = $3
           AND status = 'draft'
         RETURNING id, revision, root_topic_node_id`,
        [
          fixture.project.workspaceId,
          fixture.project.projectId,
          draft.revisionId,
          draft.contentHash,
          confirmedBy,
        ],
      );
      const row = updated.rows[0];
      if (updated.rowCount !== 1 || !row) {
        throw new Error("generated Topic Model confirmation did not update");
      }
      await client.query("COMMIT");
      return {
        revisionId: row.id,
        revision: row.revision,
        rootTopicNodeId: row.root_topic_node_id,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function createConfirmedResult(
    fixture: GenerationFixture,
    invocationId: string,
  ): Promise<ConfirmedTopicFixture> {
    const draft = await createGeneratedTopicDraft(fixture, invocationId);
    return confirmGeneratedTopicDraft(fixture, draft, null);
  }

  function reviewedProjection(
    project: ProjectFixture,
    keywordId: string,
    input: {
      readonly status: "candidate" | "approved";
      readonly intent: string | null;
      readonly reviewState: "unreviewed" | "confirmed";
      readonly topic?: ConfirmedTopicFixture;
    },
  ) {
    return {
      projectId: project.projectId,
      keywordId,
      governanceRevision: 1,
      status: input.status,
      intent: input.intent,
      buyerStage: null,
      topicNodeId: input.topic?.rootTopicNodeId ?? null,
      topicModelRevision: input.topic?.revision ?? null,
      clusterKey:
        input.topic === undefined ? null : "Customer onboarding",
      mappingDecision: "unassigned",
      mappedSitePageId: null,
      mappingReviewState: input.reviewState,
      assignmentInvalidatedBy: null,
      earlierHistoryAvailable: false,
    };
  }

  async function createKeyword(project: ProjectFixture): Promise<string> {
    const keywordId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.keyword_entities (
         id, workspace_id, project_id, display_keyword, normalized_keyword,
         market, language_tag, query_kind, first_seen_at, last_seen_at
       ) VALUES ($1,$2,$3,$4,$5,'US','en','search_query',$6,$6)`,
      [
        keywordId,
        project.workspaceId,
        project.projectId,
        `Topic Keyword ${keywordId}`,
        `topic keyword ${keywordId}`,
        CAPTURED_AT,
      ],
    );
    return keywordId;
  }

  async function insertKeywordDecision(
    project: ProjectFixture,
    input: {
      readonly keywordId: string;
      readonly decisionOrigin: "system_suggestion" | "user";
      readonly status: "candidate" | "approved";
      readonly intent: string | null;
      readonly reviewState: "unreviewed" | "confirmed";
      readonly analysisInvocationId: string | null;
      readonly topic?: ConfirmedTopicFixture;
    },
  ): Promise<void> {
    const client = await handle.pool.connect();
    try {
      await client.query("BEGIN");
      const clusterKey =
        input.topic === undefined ? null : "Customer onboarding";
      const updated = await client.query<{ updated_at: Date }>(
        `UPDATE app.keyword_entities
         SET status = $4,
             intent = $5,
             buyer_stage = NULL,
             cluster_key = $6,
             mapping_decision = 'unassigned',
             mapped_site_page_id = NULL,
             mapping_review_state = $7,
             mapping_revision = 1,
             updated_at = greatest(
               clock_timestamp(),
               updated_at + interval '1 microsecond'
             )
         WHERE workspace_id = $1
           AND project_id = $2
           AND id = $3
           AND mapping_revision = 0
         RETURNING updated_at`,
        [
          project.workspaceId,
          project.projectId,
          input.keywordId,
          input.status,
          input.intent,
          clusterKey,
          input.reviewState,
        ],
      );
      if (updated.rowCount !== 1 || !updated.rows[0]) {
        throw new Error("keyword decision fixture failed to advance revision");
      }
      await client.query(
        `INSERT INTO app.keyword_review_decisions (
           workspace_id, project_id, keyword_entity_id, governance_revision,
           decision_origin, status, intent, buyer_stage, topic_node_id,
           topic_model_revision, cluster_key_at_decision, mapping_decision,
           mapped_site_page_id, review_state, assignment_invalidated_by,
           analysis_invocation_id, decided_by, reason, decided_at,
           reviewed_projection
         ) VALUES (
           $1,$2,$3,1,$4,$5,$6,NULL,$7,$8,$9,'unassigned',NULL,$10,NULL,
           $11,$12,$13,$14,$15
         )`,
        [
          project.workspaceId,
          project.projectId,
          input.keywordId,
          input.decisionOrigin,
          input.status,
          input.intent,
          input.topic?.rootTopicNodeId ?? null,
          input.topic?.revision ?? null,
          clusterKey,
          input.reviewState,
          input.analysisInvocationId,
          input.decisionOrigin === "user" ? project.actorId : null,
          "Record the exact generated intent lineage.",
          updated.rows[0].updated_at,
          reviewedProjection(project, input.keywordId, input),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  it("replays migration twice and freezes one v3-parented, project-scoped run without prompt text", async () => {
    expect(secondMigrationReplay).toEqual([]);
    const workspaceId = await createWorkspace("Topic scope");
    const primary = await createProject("Primary Topic", workspaceId);
    const sameWorkspaceForeign = await createProject(
      "Same workspace foreign Topic",
      workspaceId,
    );
    const foreignWorkspace = await createProject("Foreign workspace Topic");
    const fixture = await createGenerationRun(primary);
    const repository = new TopicModelGenerationRunsRepository(handle.db);
    const persisted = await repository.findById(scope(primary), fixture.runId);

    expect(analysisRefreshPlanHash(analysisRefreshPlanManifest())).toBe(
      PLAN_V3_HASH,
    );
    const parent = await new AnalysisRefreshRunsRepository(handle.db).findById(
      scope(primary),
      fixture.parentRunId,
    );
    expect(parent).toMatchObject({
      plan_hash: PLAN_V3_HASH,
      plan_manifest: {
        version: "analysis-refresh.plan.v3",
        steps: expect.arrayContaining([
          { ordinal: 6, stepKey: "topic_model", required: false },
          { ordinal: 7, stepKey: "growth_audit", required: true },
        ]),
      },
    });
    expect(persisted).toMatchObject({
      id: fixture.runId,
      workspace_id: primary.workspaceId,
      project_id: primary.projectId,
      analysis_refresh_run_id: fixture.parentRunId,
      generation_version: "topic-model-generation.v1",
      prompt_set_version: "topic-model.prompt.v1",
      input_manifest: fixture.inputManifest,
      input_hash: fixture.inputHash,
      prompt_input_hash: null,
      result_topic_model_revision_id: null,
    });
    await expect(
      repository.findById(scope(sameWorkspaceForeign), fixture.runId),
    ).resolves.toBeNull();
    await expect(
      repository.findById(scope(foreignWorkspace), fixture.runId),
    ).resolves.toBeNull();

    const wrongParentRunId = await createRefreshParent(sameWorkspaceForeign);
    const wrongParentChildId = await insertChildRun(primary);
    const wrongParentManifest = generationManifest(primary, wrongParentRunId);
    await expectPgCode(
      repository.insertPlaceholder({
        runId: wrongParentChildId,
        workspaceId: primary.workspaceId,
        projectId: primary.projectId,
        analysisRefreshRunId: wrongParentRunId,
        generationVersion: "topic-model-generation.v1",
        promptSetVersion: "topic-model.prompt.v1",
        inputManifest: wrongParentManifest,
        inputHash: contentHash(wrongParentManifest as CanonicalValue),
      }),
      "23514",
    );

    const wrongKindRunId = await insertChildRun(primary, "diagnostic");
    const wrongKindManifest = generationManifest(primary, fixture.parentRunId);
    await expectPgCode(
      repository.insertPlaceholder({
        runId: wrongKindRunId,
        workspaceId: primary.workspaceId,
        projectId: primary.projectId,
        analysisRefreshRunId: fixture.parentRunId,
        generationVersion: "topic-model-generation.v1",
        promptSetVersion: "topic-model.prompt.v1",
        inputManifest: wrongKindManifest,
        inputHash: contentHash(wrongKindManifest as CanonicalValue),
      }),
      "23514",
    );

    await expectPgCode(
      handle.db
        .update(topicModelGenerationRuns)
        .set({ input_hash: "0".repeat(64) })
        .where(eq(topicModelGenerationRuns.id, fixture.runId)),
      "23514",
    );
    await expectPgCode(
      handle.db
        .update(topicModelGenerationRuns)
        .set({ prompt_set_version: "topic-model.prompt.drift" })
        .where(eq(topicModelGenerationRuns.id, fixture.runId)),
      "23514",
    );
    await expectPgCode(
      handle.db
        .delete(topicModelGenerationRuns)
        .where(eq(topicModelGenerationRuns.id, fixture.runId)),
      "23514",
    );

    const columns = await handle.pool.query<{ readonly column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'app'
          AND table_name IN (
            'topic_model_generation_runs',
            'topic_model_generation_invocation_attempts'
          )`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining([
        "raw_prompt",
        "raw_response",
        "prompt_text",
        "response_text",
      ]),
    );
    const invocationForeignKey = await handle.pool.query<{
      constraint_name: string;
      definition: string;
      delete_action: string;
      validated: boolean;
    }>(
      `SELECT
         constraint_def.conname AS constraint_name,
         pg_get_constraintdef(constraint_def.oid) AS definition,
         constraint_def.confdeltype AS delete_action,
         constraint_def.convalidated AS validated
       FROM pg_constraint constraint_def
       WHERE constraint_def.conrelid =
           'app.keyword_review_decisions'::regclass
         AND constraint_def.conname =
           'keyword_review_decisions_analysis_invocation_fk'`,
    );
    expect(invocationForeignKey.rows).toEqual([
      {
        constraint_name: "keyword_review_decisions_analysis_invocation_fk",
        definition: expect.stringMatching(
          /FOREIGN KEY \(analysis_invocation_id\) REFERENCES app\.analysis_invocations\(id\) ON DELETE RESTRICT/iu,
        ),
        delete_action: "r",
        validated: true,
      },
    ]);
  });

  it("serializes an existing reservation, rejects configuration drift, and blocks retries behind unresolved delivery", async () => {
    const project = await createProject("Reservation fencing");
    const fixture = await createGenerationRun(project);
    const attempt = await claimGenerationRun(fixture);
    const repository =
      new TopicModelGenerationInvocationAttemptsRepository(handle.db);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.reserve(attempt, invocationPreflight),
      ),
    );
    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.kind === "existing")).toHaveLength(
      7,
    );
    const reserved = results.find((result) => result.kind === "reserved");
    if (!reserved || reserved.kind !== "reserved") {
      throw new Error("Topic invocation reservation missing");
    }
    await expect(
      repository.reserve(attempt, {
        ...invocationPreflight,
        model: "gpt-5-mini-drift",
      }),
    ).resolves.toEqual({ kind: "configuration_mismatch" });

    const asyncRunsRepository = new AsyncRunsRepository(handle.db);
    await expect(asyncRunsRepository.resetToQueued(attempt)).resolves.toBe(true);
    const nextAttempt = await claimGenerationRun(fixture);
    await expect(
      repository.reserve(attempt, invocationPreflight),
    ).resolves.toEqual({ kind: "stale" });
    await expect(
      repository.reserve(nextAttempt, invocationPreflight),
    ).resolves.toMatchObject({
      kind: "unresolved",
      reservation: { id: reserved.reservation.id, status: "reserved" },
    });
    await expect(
      repository.markOutcomeUnknown(
        attempt,
        reserved.reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toEqual({ kind: "stale_reservation" });
    await expect(
      repository.markOutcomeUnknown(
        attempt,
        reserved.reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toEqual({ kind: "stale_reservation" });
    await expect(
      repository.reserve(nextAttempt, invocationPreflight),
    ).resolves.toMatchObject({
      kind: "unresolved",
      reservation: { id: reserved.reservation.id, status: "reserved" },
    });
  });

  it("marks outcome unknown idempotently and refuses later finalization", async () => {
    const project = await createProject("Unknown invocation outcome");
    const fixture = await createGenerationRun(project);
    const attempt = await claimGenerationRun(fixture);
    const repository =
      new TopicModelGenerationInvocationAttemptsRepository(handle.db);
    const reserved = await repository.reserve(
      attempt,
      invocationPreflight,
    );
    if (reserved.kind !== "reserved") {
      throw new Error("Topic invocation reservation missing");
    }
    const marked = await repository.markOutcomeUnknown(
      attempt,
      reserved.reservation.id,
      "INVOCATION_PERSISTENCE_UNKNOWN",
    );
    expect(marked).toMatchObject({
      kind: "marked",
      reservation: {
        status: "outcome_unknown",
        analysis_invocation_id: null,
      },
    });
    await expect(
      repository.markOutcomeUnknown(
        attempt,
        reserved.reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toEqual(marked);
    await expect(
      repository.finalizeWithInvocation(
        attempt,
        reserved.reservation.id,
        succeededInvocation(fixture.runId),
      ),
    ).resolves.toMatchObject({
      kind: "conflict",
      reservation: {
        status: "outcome_unknown",
        analysis_invocation_id: null,
      },
    });
    await expect(
      handle.db
        .select({ id: analysisInvocations.id })
        .from(analysisInvocations)
        .where(
          eq(
            analysisInvocations.id,
            reserved.reservation.planned_analysis_invocation_id,
          ),
        ),
    ).resolves.toEqual([]);
  });

  it("counts every finalized provider call once and never allocates beyond the three-call budget", async () => {
    const project = await createProject("Invocation budget");
    const fixture = await createGenerationRun(project);
    const asyncRunsRepository = new AsyncRunsRepository(handle.db);
    const repository =
      new TopicModelGenerationInvocationAttemptsRepository(handle.db);
    let attempt = await claimGenerationRun(fixture);

    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const reserved = await repository.reserve(attempt, invocationPreflight);
      expect(reserved).toMatchObject({
        kind: "reserved",
        reservation: { ordinal, async_attempt_count: attempt.attemptCount },
      });
      if (reserved.kind !== "reserved") {
        throw new Error("Topic invocation reservation missing");
      }
      const finalized = await repository.finalizeWithInvocation(
        attempt,
        reserved.reservation.id,
        failedInvocation,
      );
      expect(finalized).toMatchObject({
        kind: "finalized",
        reservation: { ordinal, status: "failed" },
      });
      await expect(
        repository.finalizeWithInvocation(
          attempt,
          reserved.reservation.id,
          failedInvocation,
        ),
      ).resolves.toEqual(finalized);
      await expect(
        repository.markOutcomeUnknown(
          attempt,
          reserved.reservation.id,
          "INVOCATION_PERSISTENCE_UNKNOWN",
        ),
      ).resolves.toMatchObject({ kind: "finalized" });
      await expect(asyncRunsRepository.resetToQueued(attempt)).resolves.toBe(
        true,
      );
      attempt = await claimGenerationRun(fixture);
    }

    await expect(
      repository.reserve(attempt, invocationPreflight),
    ).resolves.toEqual({ kind: "budget_exhausted" });
    const rows = await handle.db
      .select()
      .from(topicModelGenerationInvocationAttempts)
      .where(
        eq(
          topicModelGenerationInvocationAttempts.topic_model_generation_run_id,
          fixture.runId,
        ),
      );
    expect(rows.map((row) => row.ordinal)).toEqual([1, 2, 3]);
  });

  it("fences reservation identity and rolls invocation persistence back atomically", async () => {
    const project = await createProject("Invocation rollback");
    const fixture = await createGenerationRun(project);
    const asyncRunsRepository = new AsyncRunsRepository(handle.db);
    const repository =
      new TopicModelGenerationInvocationAttemptsRepository(handle.db);
    const firstAttempt = await claimGenerationRun(fixture);
    const reserved = await repository.reserve(
      firstAttempt,
      invocationPreflight,
    );
    if (reserved.kind !== "reserved") {
      throw new Error("Topic invocation reservation missing");
    }
    const rollbackSentinel = new Error("ROLLBACK_TOPIC_INVOCATION");
    await expect(
      handle.db.transaction(async (tx) => {
        await expect(
          new TopicModelGenerationInvocationAttemptsRepository(
            tx,
          ).finalizeWithInvocation(
            firstAttempt,
            reserved.reservation.id,
            succeededInvocation(fixture.runId),
          ),
        ).resolves.toMatchObject({
          kind: "finalized",
          invocationId: reserved.reservation.planned_analysis_invocation_id,
        });
        throw rollbackSentinel;
      }),
    ).rejects.toBe(rollbackSentinel);

    await expect(
      handle.db
        .select({ id: analysisInvocations.id })
        .from(analysisInvocations)
        .where(
          eq(
            analysisInvocations.id,
            reserved.reservation.planned_analysis_invocation_id,
          ),
        ),
    ).resolves.toEqual([]);
    const [rolledBack] = await handle.db
      .select()
      .from(topicModelGenerationInvocationAttempts)
      .where(
        eq(
          topicModelGenerationInvocationAttempts.id,
          reserved.reservation.id,
        ),
      );
    expect(rolledBack).toMatchObject({
      status: "reserved",
      analysis_invocation_id: null,
    });

    await expect(asyncRunsRepository.resetToQueued(firstAttempt)).resolves.toBe(
      true,
    );
    const secondAttempt = await claimGenerationRun(fixture);
    await expect(
      repository.finalizeWithInvocation(
        secondAttempt,
        reserved.reservation.id,
        succeededInvocation(fixture.runId),
      ),
    ).resolves.toEqual({ kind: "stale_reservation" });
    await expect(
      repository.finalizeWithInvocation(
        firstAttempt,
        reserved.reservation.id,
        succeededInvocation(fixture.runId),
      ),
    ).resolves.toEqual({ kind: "stale_reservation" });
    await expect(
      repository.markOutcomeUnknown(
        firstAttempt,
        reserved.reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toEqual({ kind: "stale_reservation" });
    await expect(
      handle.db
        .select({ id: analysisInvocations.id })
        .from(analysisInvocations)
        .where(
          eq(
            analysisInvocations.id,
            reserved.reservation.planned_analysis_invocation_id,
          ),
        ),
    ).resolves.toEqual([]);
    const [stillReserved] = await handle.db
      .select()
      .from(topicModelGenerationInvocationAttempts)
      .where(
        eq(
          topicModelGenerationInvocationAttempts.id,
          reserved.reservation.id,
        ),
      );
    expect(stillReserved).toMatchObject({
      status: "reserved",
      analysis_invocation_id: null,
      terminal_error_code: null,
      provider_returned_at: null,
      finalized_at: null,
    });
    await expect(
      repository.reserve(secondAttempt, invocationPreflight),
    ).resolves.toMatchObject({
      kind: "unresolved",
      reservation: {
        id: reserved.reservation.id,
        status: "reserved",
        async_attempt_count: firstAttempt.attemptCount,
      },
    });
  });

  it("allows only exact successful actorless Topic confirmation and preserves manual actors", async () => {
    const manualProject = await createProject("Manual Topic confirmation");
    const manualTopics = new TopicModelsRepository(handle.db);
    const manualDraft = await manualTopics.beginDraftFromLatestConfirmed(
      scope(manualProject),
      manualProject.actorId,
      {
        expectedLatestConfirmedRevision: 0,
        reason: "Create a manual Topic Model draft.",
      },
    );
    const editedManual = await manualTopics.patchDraft(
      scope(manualProject),
      manualProject.actorId,
      {
        topicModelRevision: manualDraft.topicModelRevision,
        expectedEditRevision: manualDraft.editRevision,
        reason: "Add a manually curated Topic root.",
        intents: [
          {
            kind: "create",
            parentTopicNodeId: null,
            label: "Manual customer journey",
            description: null,
            intentEnvelope: ["commercial"],
          },
        ],
      },
    );
    await expect(
      manualTopics.confirmDraft(
        scope(manualProject),
        manualProject.actorId,
        {
          topicModelRevision: editedManual.topicModelRevision,
          expectedEditRevision: editedManual.editRevision,
          reason: "Confirm the manually curated Topic Model.",
        },
      ),
    ).resolves.toMatchObject({
      state: "confirmed",
      confirmedBy: manualProject.actorId,
    });

    async function finalizeSuccessfulInvocation(
      fixture: GenerationFixture,
    ): Promise<string> {
      const attempt = await claimGenerationRun(fixture);
      const attempts =
        new TopicModelGenerationInvocationAttemptsRepository(handle.db);
      const reserved = await attempts.reserve(attempt, invocationPreflight);
      if (reserved.kind !== "reserved") {
        throw new Error("Topic invocation reservation missing");
      }
      const finalized = await attempts.finalizeWithInvocation(
        attempt,
        reserved.reservation.id,
        succeededInvocation(fixture.runId),
      );
      if (finalized.kind !== "finalized") {
        throw new Error("Topic invocation finalization missing");
      }
      return finalized.invocationId;
    }

    async function confirmationState(revisionId: string) {
      const result = await handle.pool.query<{
        status: string;
        confirmed_by: string | null;
        confirmed_at: Date | null;
        content_hash: string | null;
      }>(
        `SELECT status, confirmed_by, confirmed_at, content_hash
         FROM app.topic_model_revisions
         WHERE id = $1`,
        [revisionId],
      );
      return result.rows[0];
    }

    const generatedProject = await createProject(
      "System Topic confirmation",
    );
    const generatedFixture = await createGenerationRun(generatedProject);
    const invocationId = await finalizeSuccessfulInvocation(generatedFixture);
    const generatedDraft = await createGeneratedTopicDraft(
      generatedFixture,
      invocationId,
    );
    await expectPgCode(
      confirmGeneratedTopicDraft(
        generatedFixture,
        generatedDraft,
        generatedProject.actorId,
      ),
      "23514",
    );
    await expect(confirmationState(generatedDraft.revisionId)).resolves.toEqual(
      {
        status: "draft",
        confirmed_by: null,
        confirmed_at: null,
        content_hash: null,
      },
    );
    const autoConfirmed = await confirmGeneratedTopicDraft(
      generatedFixture,
      generatedDraft,
      null,
    );
    await expect(confirmationState(autoConfirmed.revisionId)).resolves.toEqual({
      status: "confirmed",
      confirmed_by: null,
      confirmed_at: expect.any(Date),
      content_hash: generatedDraft.contentHash,
    });

    const mismatchProject = await createProject(
      "Mismatched system Topic confirmation",
    );
    const mismatchFixture = await createGenerationRun(mismatchProject);
    const mismatchInvocationId =
      await finalizeSuccessfulInvocation(mismatchFixture);
    const mismatchDraft = await createGeneratedTopicDraft(
      mismatchFixture,
      mismatchInvocationId,
      contentHash({ mismatch: "generation input hash" }),
    );
    await expectPgCode(
      confirmGeneratedTopicDraft(mismatchFixture, mismatchDraft, null),
      "23514",
    );
    await expect(confirmationState(mismatchDraft.revisionId)).resolves.toEqual({
      status: "draft",
      confirmed_by: null,
      confirmed_at: null,
      content_hash: null,
    });
  });

  it("allows generated Keyword intent only from the matching successful Topic invocation", async () => {
    const project = await createProject("Keyword invocation lineage");
    const fixture = await createGenerationRun(project);
    const attempt = await claimGenerationRun(fixture);
    const attempts =
      new TopicModelGenerationInvocationAttemptsRepository(handle.db);
    const reserved = await attempts.reserve(attempt, invocationPreflight);
    if (reserved.kind !== "reserved") {
      throw new Error("Topic invocation reservation missing");
    }
    const finalized = await attempts.finalizeWithInvocation(
      attempt,
      reserved.reservation.id,
      succeededInvocation(fixture.runId),
    );
    if (finalized.kind !== "finalized") {
      throw new Error("Topic invocation finalization missing");
    }
    const generatedTopic = await createConfirmedResult(
      fixture,
      finalized.invocationId,
    );

    const generatedKeywordId = await createKeyword(project);
    await expect(
      insertKeywordDecision(project, {
        keywordId: generatedKeywordId,
        decisionOrigin: "system_suggestion",
        status: "approved",
        intent: "commercial",
        reviewState: "confirmed",
        analysisInvocationId: finalized.invocationId,
        topic: generatedTopic,
      }),
    ).resolves.toBeUndefined();

    const asyncRunsRepository = new AsyncRunsRepository(handle.db);
    await expect(asyncRunsRepository.resetToQueued(attempt)).resolves.toBe(true);
    const retryAttempt = await claimGenerationRun(fixture);
    const failedReservation = await attempts.reserve(
      retryAttempt,
      invocationPreflight,
    );
    if (failedReservation.kind !== "reserved") {
      throw new Error("failed Topic invocation reservation missing");
    }
    const failedFinalization = await attempts.finalizeWithInvocation(
      retryAttempt,
      failedReservation.reservation.id,
      failedInvocation,
    );
    if (failedFinalization.kind !== "finalized") {
      throw new Error("failed Topic invocation finalization missing");
    }
    await expectPgCode(
      insertKeywordDecision(project, {
        keywordId: await createKeyword(project),
        decisionOrigin: "system_suggestion",
        status: "approved",
        intent: "commercial",
        reviewState: "confirmed",
        analysisInvocationId: failedFinalization.invocationId,
        topic: generatedTopic,
      }),
      "23514",
    );

    const missingInvocationKeywordId = await createKeyword(project);
    await expectPgCode(
      insertKeywordDecision(project, {
        keywordId: missingInvocationKeywordId,
        decisionOrigin: "system_suggestion",
        status: "approved",
        intent: "commercial",
        reviewState: "confirmed",
        analysisInvocationId: randomUUID(),
        topic: generatedTopic,
      }),
      "23503",
    );
    const missingInvocationEntity = await handle.pool.query<{
      mapping_revision: number;
    }>(
      `SELECT mapping_revision
       FROM app.keyword_entities
       WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [project.workspaceId, project.projectId, missingInvocationKeywordId],
    );
    expect(missingInvocationEntity.rows).toEqual([{ mapping_revision: 0 }]);
    const missingInvocationDecisions = await handle.pool.query<{
      governance_revision: number;
    }>(
      `SELECT governance_revision
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3
       ORDER BY governance_revision`,
      [project.workspaceId, project.projectId, missingInvocationKeywordId],
    );
    expect(missingInvocationDecisions.rows).toEqual([
      { governance_revision: 0 },
    ]);

    await expectPgCode(
      insertKeywordDecision(project, {
        keywordId: await createKeyword(project),
        decisionOrigin: "user",
        status: "approved",
        intent: "commercial",
        reviewState: "confirmed",
        analysisInvocationId: finalized.invocationId,
        topic: generatedTopic,
      }),
      "23514",
    );

    await expect(
      insertKeywordDecision(project, {
        keywordId: await createKeyword(project),
        decisionOrigin: "system_suggestion",
        status: "approved",
        intent: "commercial",
        reviewState: "confirmed",
        analysisInvocationId: null,
      }),
    ).resolves.toBeUndefined();
    await expect(
      insertKeywordDecision(project, {
        keywordId: await createKeyword(project),
        decisionOrigin: "user",
        status: "approved",
        intent: "commercial",
        reviewState: "confirmed",
        analysisInvocationId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("atomically terminalizes the exact attempt and rolls back both ledgers together", async () => {
    const project = await createProject("Terminalization rollback");
    const fixture = await createGenerationRun(project);
    const attempt = await claimGenerationRun(fixture);
    const attempts =
      new TopicModelGenerationInvocationAttemptsRepository(handle.db);
    const reserved = await attempts.reserve(attempt, invocationPreflight);
    if (reserved.kind !== "reserved") {
      throw new Error("Topic invocation reservation missing");
    }
    const finalized = await attempts.finalizeWithInvocation(
      attempt,
      reserved.reservation.id,
      succeededInvocation(fixture.runId),
    );
    if (finalized.kind !== "finalized") {
      throw new Error("Topic invocation finalization missing");
    }
    const resultRevision = await createConfirmedResult(
      fixture,
      finalized.invocationId,
    );
    const runs = new TopicModelGenerationRunsRepository(handle.db);

    const staleAttempt = { ...attempt, attemptCount: attempt.attemptCount + 1 };
    await expect(
      runs.terminalize(staleAttempt, {
        status: "completed",
        resultTopicModelRevisionId: resultRevision.revisionId,
        lastErrorCode: null,
        lastErrorSummary: null,
      }),
    ).resolves.toEqual({ kind: "stale" });

    const rollbackSentinel = new Error("ROLLBACK_TOPIC_TERMINALIZATION");
    await expect(
      handle.db.transaction(async (tx) => {
        await expect(
          new TopicModelGenerationRunsRepository(tx).terminalize(attempt, {
            status: "completed",
            resultTopicModelRevisionId: resultRevision.revisionId,
            lastErrorCode: null,
            lastErrorSummary: null,
          }),
        ).resolves.toMatchObject({
          kind: "terminalized",
          run: {
            result_topic_model_revision_id: resultRevision.revisionId,
          },
        });
        throw rollbackSentinel;
      }),
    ).rejects.toBe(rollbackSentinel);

    await expect(runs.findById(scope(project), fixture.runId)).resolves.toMatchObject(
      { result_topic_model_revision_id: null },
    );
    await expect(
      new AsyncRunsRepository(handle.db).findById(
        scope(project),
        fixture.runId,
      ),
    ).resolves.toMatchObject({
      status: "running",
      result_type: "topic_model_generation_run",
      result_id: fixture.runId,
    });

    const terminalized = await runs.terminalize(attempt, {
      status: "completed",
      resultTopicModelRevisionId: resultRevision.revisionId,
      lastErrorCode: null,
      lastErrorSummary: null,
    });
    expect(terminalized).toMatchObject({
      kind: "terminalized",
      run: { result_topic_model_revision_id: resultRevision.revisionId },
    });
    await expect(
      runs.terminalize(attempt, {
        status: "completed",
        resultTopicModelRevisionId: resultRevision.revisionId,
        lastErrorCode: null,
        lastErrorSummary: null,
      }),
    ).resolves.toEqual(terminalized);
    await expect(
      new AsyncRunsRepository(handle.db).findById(
        scope(project),
        fixture.runId,
      ),
    ).resolves.toMatchObject({
      kind: "topic_model_generation",
      status: "completed",
      result_type: "topic_model_generation_run",
      result_id: fixture.runId,
    });
  });

  it("terminalizes failures without inventing a Topic result", async () => {
    const project = await createProject("Failed terminalization");
    const fixture = await createGenerationRun(project);
    const attempt = await claimGenerationRun(fixture);
    const runs = new TopicModelGenerationRunsRepository(handle.db);

    await expect(
      runs.terminalize(attempt, {
        status: "failed",
        resultTopicModelRevisionId: null,
        lastErrorCode: "TOPIC_MODEL_GENERATION_FAILED",
        lastErrorSummary: "No confirmed Topic Model revision was persisted.",
      }),
    ).resolves.toMatchObject({
      kind: "terminalized",
      run: { result_topic_model_revision_id: null },
    });
    await expect(
      new AsyncRunsRepository(handle.db).findById(
        scope(project),
        fixture.runId,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      result_type: "topic_model_generation_run",
      result_id: fixture.runId,
      last_error_code: "TOPIC_MODEL_GENERATION_FAILED",
    });
    await expectPgCode(
      handle.db
        .update(asyncRuns)
        .set({
          result_type: "topic_model_generation_run",
          result_id: randomUUID(),
        })
        .where(eq(asyncRuns.id, fixture.runId)),
      "23514",
    );
  });
});
