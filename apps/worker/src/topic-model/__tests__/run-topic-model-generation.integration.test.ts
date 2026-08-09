import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LLMError,
  TOPIC_MODEL_PROMPT_SET_VERSION,
  prepareTopicModelGeneration,
  type AnalysisInvocationRecord,
  type TopicModelGenerationInput,
  type TopicModelGenerationResult,
} from "@sf/artifacts";
import {
  parseTopicModelGenerationInputManifest,
  type TopicModelGenerationInputManifest,
} from "@sf/contracts";
import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  IcpProfilesRepository,
  KeywordGovernanceRepository,
  ProjectsRepository,
  SitesRepository,
  TopicModelGenerationRunsRepository,
  TopicModelsRepository,
  contentHash,
  type CanonicalValue,
  type ProjectScope,
} from "@sf/db";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import {
  buildTopicModelGenerationClientInput,
  runTopicModelGeneration,
} from "../run-topic-model-generation.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CAPTURED_AT = "2026-08-09T08:00:00.000Z";

const NOOP = (): void => undefined;
const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface ProjectFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
}

interface KeywordFixture {
  readonly provider: string;
  readonly fallback: string;
  readonly human: string;
}

interface GenerationFixture {
  readonly project: ProjectFixture;
  readonly parentRunId: string;
  readonly runId: string;
  readonly initiatedBy: string;
  readonly keywords: KeywordFixture;
  readonly manifest: TopicModelGenerationInputManifest;
  readonly manifestInputHash: string;
}

describeDb("Topic Model generation worker", () => {
  let handle: DbHandle;

  beforeAll(() => {
    // The integration project setup validates DATABASE_URL and runs migrations
    // before this file opens a pool. Never log or interpolate the URL.
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  function scope(project: ProjectFixture): ProjectScope {
    return {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };
  }

  function context(): WorkerContext {
    return {
      db: handle.db,
      boss: {} as never,
      blobStore: {} as never,
      credentialKey: Buffer.alloc(32),
      appOrigin: "https://app.example.test",
      googleOAuth: { clientId: "test", clientSecret: "test" },
      openai: { apiKey: "test-key", model: "gpt-test" },
      findingSummariesEnabled: false,
      logger,
    };
  }

  async function queryRows<T extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<T[]> {
    const result = await handle.pool.query(text, [...values]);
    return result.rows as T[];
  }

  async function createProject(label: string): Promise<ProjectFixture> {
    const [workspace] = await queryRows<{ id: string }>(
      "INSERT INTO app.workspaces (name) VALUES ($1) RETURNING id",
      [`${label} ${randomUUID()}`],
    );
    if (!workspace) throw new Error("workspace fixture insert failed");
    const actorId = randomUUID();
    const project = await new ProjectsRepository(handle.db).insert({
      workspaceId: workspace.id,
      clientName: `${label} client`,
      projectName: `${label} project`,
      defaultDeliveryLocale: "en",
      createdBy: actorId,
    });
    const host = `${randomUUID()}.topic-worker.example`;
    const site = await new SitesRepository(handle.db).insertPrimary({
      workspaceId: workspace.id,
      projectId: project.id,
      origin: `https://${host}`,
      host,
      marketCodes: ["US"],
      languageCodes: ["en"],
    });
    const profile = { productName: `${label} product` };
    const icp = await new IcpProfilesRepository(handle.db).insertVersion({
      workspaceId: workspace.id,
      projectId: project.id,
      version: 1,
      status: "complete",
      profile,
      contentHash: contentHash({ status: "complete", profile }),
      createdBy: actorId,
    });
    const projects = new ProjectsRepository(handle.db);
    if (
      !(await projects.setCurrentIcpProfile(
        { workspaceId: workspace.id },
        project.id,
        icp.id,
      )) ||
      !(await projects.setConfirmedIcpProfile(
        { workspaceId: workspace.id },
        project.id,
        icp.id,
      ))
    ) {
      throw new Error("project ICP fixture binding failed");
    }
    return {
      actorId,
      workspaceId: workspace.id,
      projectId: project.id,
      siteId: site.id,
      icpProfileId: icp.id,
    };
  }

  async function createParent(project: ProjectFixture): Promise<string> {
    const runId = randomUUID();
    const runs = new AsyncRunsRepository(handle.db);
    await runs.insertQueued({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      kind: "analysis_refresh",
      activeKey: `topic-parent:${randomUUID()}`,
      initiatedBy: project.actorId,
      contractVersion: "2026-08-09",
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
    if (!(await runs.claim(scope(project), runId))) {
      throw new Error("Analysis Refresh parent fixture was not claimed");
    }
    return runId;
  }

  async function createKeyword(
    project: ProjectFixture,
    label: string,
  ): Promise<string> {
    const id = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.keyword_entities (
         id, workspace_id, project_id, display_keyword, normalized_keyword,
         market, language_tag, query_kind, first_seen_at, last_seen_at
       ) VALUES ($1,$2,$3,$4,$5,'US','en','search_query',$6,$6)`,
      [
        id,
        project.workspaceId,
        project.projectId,
        `${label} ${id}`,
        `${label.toLowerCase()} ${id}`,
        CAPTURED_AT,
      ],
    );
    return id;
  }

  async function createGenerationFixture(label: string): Promise<GenerationFixture> {
    const project = await createProject(label);
    const keywords = {
      provider: await createKeyword(project, "Provider intent"),
      fallback: await createKeyword(project, "Generated fallback"),
      human: await createKeyword(project, "Human decision"),
    };
    await new KeywordGovernanceRepository(handle.db).reviewKeyword(
      scope(project),
      keywords.human,
      project.actorId,
      {
        expectedGovernanceRevision: 0,
        status: "approved",
        intent: "transactional",
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "Keep this human decision authoritative during generation.",
      },
    );
    const parentRunId = await createParent(project);
    const manifest = parseTopicModelGenerationInputManifest({
      schemaVersion: "topic-model-generation-input.v1",
      analysisRefreshRunId: parentRunId,
      projectId: project.projectId,
      market: "US",
      language: "en",
      groups: [
        {
          groupKey: "revenue-operations",
          representativeKeywords: [
            "revenue operations software",
            "pipeline workflow automation",
          ],
          keywordCount: 3,
          aggregateSearchVolume: 1_200,
          providerIntentDistribution: {
            informational: 0,
            navigational: 0,
            commercial: 1,
            transactional: 0,
          },
          urls: ["https://example.test/revenue-operations"],
        },
      ],
      productProfile: {
        productName: "Acme",
        oneLiner: "Revenue operations software",
        category: "Software",
        valueProposition: "Connect revenue workflows",
        coreFeatures: ["Workflow automation"],
      },
      icp: {
        targetCompanyOrAudience: "B2B revenue teams",
        buyerRoles: ["VP Revenue"],
        userRoles: ["Revenue operations"],
        useCases: ["Automate handoffs"],
        pains: ["Fragmented workflows"],
        outcomes: ["Faster handoffs"],
      },
      keywords: [
        {
          keywordId: keywords.provider,
          expectedGovernanceRevision: 0,
          groupKey: "revenue-operations",
          providerSearchIntent: {
            value: "commercial",
            snapshotId: randomUUID(),
            observationId: randomUUID(),
            observedAt: CAPTURED_AT,
          },
        },
        {
          keywordId: keywords.fallback,
          expectedGovernanceRevision: 0,
          groupKey: "revenue-operations",
          providerSearchIntent: {
            value: null,
            snapshotId: randomUUID(),
            observationId: randomUUID(),
            observedAt: CAPTURED_AT,
          },
        },
        {
          keywordId: keywords.human,
          expectedGovernanceRevision: 1,
          groupKey: "revenue-operations",
          providerSearchIntent: null,
        },
      ],
    });
    const runId = randomUUID();
    const initiatedBy = randomUUID();
    await new AsyncRunsRepository(handle.db).insertQueued({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      kind: "topic_model_generation",
      activeKey: `topic-child:${randomUUID()}`,
      initiatedBy,
      contractVersion: "2026-08-09",
      resultType: "topic_model_generation_run",
      resultId: runId,
    });
    const manifestInputHash = contentHash(manifest as CanonicalValue);
    await new TopicModelGenerationRunsRepository(handle.db).insertPlaceholder({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      analysisRefreshRunId: parentRunId,
      generationVersion: "topic-model-generation.v1",
      promptSetVersion: TOPIC_MODEL_PROMPT_SET_VERSION,
      inputManifest: manifest,
      inputHash: manifestInputHash,
    });
    return {
      project,
      parentRunId,
      runId,
      initiatedBy,
      keywords,
      manifest,
      manifestInputHash,
    };
  }

  function resultFor(fixture: GenerationFixture): TopicModelGenerationResult {
    const input = buildTopicModelGenerationClientInput(fixture.manifest);
    return {
      rootIntent: {
        kind: "create_root",
        topicKey: "growth",
        label: "Growth",
        description: "Revenue growth topics",
        intentEnvelope: [],
      },
      childIntents: [
        {
          kind: "create_child",
          topicKey: "revenue-operations",
          parentTopicKey: "growth",
          label: "Revenue Operations",
          description: "Revenue operations workflows and software",
          intentEnvelope: ["informational"],
        },
      ],
      groupAssignments: [
        {
          groupKey: "revenue-operations",
          topicKey: "revenue-operations",
          generatedIntent: "informational",
        },
      ],
      unassignedGroupKeys: [],
      invocation: {
        task: "topic_model_generation",
        provider: "openai",
        model: "gpt-test",
        promptSetVersion: TOPIC_MODEL_PROMPT_SET_VERSION,
        inputHash: prepareTopicModelGeneration(input).inputHash,
        outputHash: contentHash({ runId: fixture.runId, output: "accepted" }),
        status: "succeeded",
        inputTokens: 120,
        outputTokens: 60,
        costUsd: null,
        latencyMs: 25,
        errorCode: null,
      },
    };
  }

  function knownErrorInvocation(
    fixture: GenerationFixture,
    status: "failed" | "rejected",
    errorCode: string,
  ): AnalysisInvocationRecord {
    return {
      ...resultFor(fixture).invocation,
      outputHash: null,
      status,
      errorCode,
    };
  }

  function dependencies(
    generateTopicModel: (
      input: TopicModelGenerationInput,
    ) => Promise<TopicModelGenerationResult>,
  ) {
    return {
      createClient: () => ({ generateTopicModel }),
    };
  }

  async function latestDecision(project: ProjectFixture, keywordId: string) {
    const [decision] = await queryRows<{
      governanceRevision: number;
      origin: string;
      intent: string | null;
      topicNodeId: string | null;
      topicModelRevision: number | null;
      invocationId: string | null;
      decidedBy: string | null;
    }>(
      `SELECT governance_revision AS "governanceRevision",
              decision_origin AS origin,
              intent,
              topic_node_id AS "topicNodeId",
              topic_model_revision AS "topicModelRevision",
              analysis_invocation_id AS "invocationId",
              decided_by AS "decidedBy"
         FROM app.keyword_review_decisions
        WHERE workspace_id = $1
          AND project_id = $2
          AND keyword_entity_id = $3
        ORDER BY governance_revision DESC
        LIMIT 1`,
      [project.workspaceId, project.projectId, keywordId],
    );
    if (!decision) throw new Error("keyword decision fixture was not found");
    return decision;
  }

  async function createManualTopic(
    fixture: GenerationFixture,
    state: "draft" | "confirmed",
  ): Promise<void> {
    const topics = new TopicModelsRepository(handle.db);
    const draft = await topics.beginDraftFromLatestConfirmed(
      scope(fixture.project),
      fixture.project.actorId,
      {
        expectedLatestConfirmedRevision: 0,
        reason: "Create a concurrent manual Topic revision.",
      },
    );
    if (state === "draft") return;
    const edited = await topics.patchDraft(
      scope(fixture.project),
      fixture.project.actorId,
      {
        topicModelRevision: draft.topicModelRevision,
        expectedEditRevision: draft.editRevision,
        reason: "Add the concurrent manual Topic root.",
        intents: [
          {
            kind: "create",
            parentTopicNodeId: null,
            label: "Manual Strategy",
            description: "A human-authored Topic revision.",
            intentEnvelope: ["commercial"],
          },
        ],
      },
    );
    await topics.confirmDraft(
      scope(fixture.project),
      fixture.project.actorId,
      {
        topicModelRevision: edited.topicModelRevision,
        expectedEditRevision: edited.editRevision,
        reason: "Confirm the concurrent manual Topic revision.",
      },
    );
  }

  it("atomically confirms revision 1, preserves provider precedence, and records exact generated lineage", async () => {
    const fixture = await createGenerationFixture("success");
    const generated = resultFor(fixture);
    const generateTopicModel = vi.fn(async (input: TopicModelGenerationInput) => {
      expect(input).toEqual(buildTopicModelGenerationClientInput(fixture.manifest));
      expect(input).not.toHaveProperty("keywords");
      return generated;
    });

    await runTopicModelGeneration(
      context(),
      { runId: fixture.runId, ...scope(fixture.project) },
      dependencies(generateTopicModel),
    );

    expect(generateTopicModel).toHaveBeenCalledOnce();
    const [run] = await queryRows<{
      status: string;
      last_error_code: string | null;
      progress: unknown;
    }>("SELECT status, last_error_code, progress FROM app.async_runs WHERE id = $1", [
      fixture.runId,
    ]);
    const [generation] = await queryRows<{
      result_topic_model_revision_id: string | null;
    }>(
      "SELECT result_topic_model_revision_id FROM app.topic_model_generation_runs WHERE id = $1",
      [fixture.runId],
    );
    const [invocation] = await queryRows<{
      id: string;
      task: string;
      status: string;
      input_hash: string;
    }>(
      "SELECT id, task, status, input_hash FROM app.analysis_invocations WHERE async_run_id = $1",
      [fixture.runId],
    );
    const [model] = await queryRows<{
      id: string;
      revision: number;
      status: string;
      created_by: string;
      confirmed_by: string | null;
      generation_basis: unknown;
    }>(
      `SELECT id, revision, status, created_by, confirmed_by, generation_basis
         FROM app.topic_model_revisions
        WHERE workspace_id = $1 AND project_id = $2`,
      [fixture.project.workspaceId, fixture.project.projectId],
    );
    expect(run).toMatchObject({ status: "completed", last_error_code: null });
    expect(generation?.result_topic_model_revision_id).toBe(model?.id);
    expect(invocation).toMatchObject({
      task: "topic_model_generation",
      status: "succeeded",
      input_hash: generated.invocation.inputHash,
    });
    expect(model).toMatchObject({
      revision: 1,
      status: "confirmed",
      created_by: fixture.initiatedBy,
      confirmed_by: null,
    });
    expect(model!.created_by).not.toBe(fixture.project.actorId);
    const nodeCreators = await queryRows<{ created_by: string }>(
      `SELECT DISTINCT created_by
         FROM app.topic_node_revisions
        WHERE workspace_id = $1 AND project_id = $2`,
      [fixture.project.workspaceId, fixture.project.projectId],
    );
    expect(nodeCreators).toEqual([{ created_by: fixture.initiatedBy }]);
    expect(Object.keys(model!.generation_basis as object).sort()).toEqual(
      [
        "analysisInvocationId",
        "baseTopicModelRevision",
        "generationVersion",
        "inputHash",
        "keywordCount",
        "keywordGroupCount",
        "origin",
        "promptSetVersion",
        "reason",
      ].sort(),
    );
    expect(model!.generation_basis).toEqual({
      origin: "llm_auto_confirmed",
      generationVersion: "topic-model-generation.v1",
      baseTopicModelRevision: null,
      analysisInvocationId: invocation!.id,
      promptSetVersion: TOPIC_MODEL_PROMPT_SET_VERSION,
      inputHash: fixture.manifestInputHash,
      keywordGroupCount: 1,
      keywordCount: 3,
      reason: "Initial model generated by Analysis Refresh",
    });

    const providerDecision = await latestDecision(
      fixture.project,
      fixture.keywords.provider,
    );
    const fallbackDecision = await latestDecision(
      fixture.project,
      fixture.keywords.fallback,
    );
    const humanDecision = await latestDecision(
      fixture.project,
      fixture.keywords.human,
    );
    expect(providerDecision).toMatchObject({
      governanceRevision: 1,
      origin: "system_suggestion",
      intent: "commercial",
      topicModelRevision: 1,
      invocationId: null,
      decidedBy: null,
    });
    expect(fallbackDecision).toMatchObject({
      governanceRevision: 1,
      origin: "system_suggestion",
      intent: "informational",
      topicModelRevision: 1,
      invocationId: invocation!.id,
      decidedBy: null,
    });
    expect(fallbackDecision.topicNodeId).toBe(providerDecision.topicNodeId);
    expect(humanDecision).toMatchObject({
      governanceRevision: 1,
      origin: "user",
      intent: "transactional",
      invocationId: null,
      decidedBy: fixture.project.actorId,
    });
    expect(run!.progress).toEqual({
      schemaVersion: "topic-model-generation-outcome.v1",
      keywordGroupCount: 1,
      keywordCount: 3,
      assignedCount: 2,
      skippedCount: 1,
      unassignedGroupCount: 0,
      skipReasons: {
        unknown_group: 0,
        topic_revision_moved: 0,
        topic_node_absent: 0,
        intent_unavailable: 0,
        keyword_absent: 0,
        human_decision_exists: 1,
        revision_moved: 0,
        revision_exhausted: 0,
        ledger_unreadable: 0,
        conflict: 0,
      },
      limitations: ["keyword_assignments_skipped"],
    });
    const serializedProgress = JSON.stringify(run!.progress);
    expect(serializedProgress).not.toContain("revenue-operations");
    expect(serializedProgress).not.toContain(fixture.keywords.provider);
  });

  it("rolls back invocation, Topic, and assignments together when Tx B fails", async () => {
    const fixture = await createGenerationFixture("rollback");
    const generateTopicModel = vi.fn(async () => resultFor(fixture));
    const failure = vi
      .spyOn(AsyncRunsRepository.prototype, "setProgress")
      .mockRejectedValueOnce(new Error("ROLLBACK_TOPIC_TX_B"));
    try {
      await runTopicModelGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture.project) },
        dependencies(generateTopicModel),
      );
    } finally {
      failure.mockRestore();
    }

    const modelRows = await queryRows<{ id: string }>(
      "SELECT id FROM app.topic_model_revisions WHERE project_id = $1",
      [fixture.project.projectId],
    );
    const invocationRows = await queryRows<{ id: string }>(
      "SELECT id FROM app.analysis_invocations WHERE async_run_id = $1",
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      analysis_invocation_id: string | null;
      terminal_error_code: string | null;
    }>(
      `SELECT status, analysis_invocation_id, terminal_error_code
         FROM app.topic_model_generation_invocation_attempts
        WHERE topic_model_generation_run_id = $1`,
      [fixture.runId],
    );
    const [run] = await queryRows<{
      status: string;
      last_error_code: string | null;
    }>("SELECT status, last_error_code FROM app.async_runs WHERE id = $1", [
      fixture.runId,
    ]);
    expect(modelRows).toEqual([]);
    expect(invocationRows).toEqual([]);
    expect(attempt).toMatchObject({
      status: "outcome_unknown",
      analysis_invocation_id: null,
      terminal_error_code: "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    });
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN",
    });
    expect(
      await latestDecision(fixture.project, fixture.keywords.provider),
    ).toMatchObject({
      governanceRevision: 0,
      origin: "system_suggestion",
      topicNodeId: null,
      topicModelRevision: null,
      invocationId: null,
    });
    expect(
      await latestDecision(fixture.project, fixture.keywords.fallback),
    ).toMatchObject({
      governanceRevision: 0,
      origin: "system_suggestion",
      topicNodeId: null,
      topicModelRevision: null,
      invocationId: null,
    });
  });

  it.each(["draft", "confirmed"] as const)(
    "maps a late manual %s to a safe no-op without overwriting it",
    async (state) => {
      const fixture = await createGenerationFixture(`late-${state}`);
      const generateTopicModel = vi.fn(async () => {
        await createManualTopic(fixture, state);
        return resultFor(fixture);
      });

      await runTopicModelGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture.project) },
        dependencies(generateTopicModel),
      );

      const [run] = await queryRows<{
        status: string;
        last_error_code: string | null;
      }>("SELECT status, last_error_code FROM app.async_runs WHERE id = $1", [
        fixture.runId,
      ]);
      const [generation] = await queryRows<{
        result_topic_model_revision_id: string | null;
      }>(
        "SELECT result_topic_model_revision_id FROM app.topic_model_generation_runs WHERE id = $1",
        [fixture.runId],
      );
      const models = await queryRows<{
        status: string;
        confirmed_by: string | null;
        generation_basis: unknown;
      }>(
        `SELECT status, confirmed_by, generation_basis
           FROM app.topic_model_revisions
          WHERE project_id = $1`,
        [fixture.project.projectId],
      );
      const invocations = await queryRows<{
        task: string;
        status: string;
      }>(
        "SELECT task, status FROM app.analysis_invocations WHERE async_run_id = $1",
        [fixture.runId],
      );
      expect(generateTopicModel).toHaveBeenCalledOnce();
      expect(run).toMatchObject({
        status: "cancelled",
        last_error_code: "TOPIC_MODEL_GENERATION_SUPERSEDED",
      });
      expect(generation?.result_topic_model_revision_id).toBeNull();
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        status: state,
        confirmed_by: state === "confirmed" ? fixture.project.actorId : null,
      });
      expect(
        (models[0]!.generation_basis as Record<string, unknown>)["origin"],
      ).not.toBe("llm_auto_confirmed");
      expect(invocations).toHaveLength(1);
      expect(invocations[0]).toMatchObject({
        task: "topic_model_generation",
        status: "succeeded",
      });
      expect(
        await latestDecision(fixture.project, fixture.keywords.provider),
      ).toMatchObject({
        governanceRevision: 0,
        origin: "system_suggestion",
        topicNodeId: null,
        topicModelRevision: null,
        invocationId: null,
      });
      expect(
        await latestDecision(fixture.project, fixture.keywords.fallback),
      ).toMatchObject({
        governanceRevision: 0,
        origin: "system_suggestion",
        topicNodeId: null,
        topicModelRevision: null,
        invocationId: null,
      });
    },
  );

  it("marks an unknown provider outcome and cannot replay the paid call", async () => {
    const fixture = await createGenerationFixture("outcome-unknown");
    const generateTopicModel = vi.fn(async (): Promise<TopicModelGenerationResult> => {
      throw new Error("opaque provider failure");
    });
    const payload = { runId: fixture.runId, ...scope(fixture.project) };

    await runTopicModelGeneration(
      context(),
      payload,
      dependencies(generateTopicModel),
    );
    await runTopicModelGeneration(
      context(),
      payload,
      dependencies(generateTopicModel),
    );

    const [attempt] = await queryRows<{
      status: string;
      analysis_invocation_id: string | null;
      terminal_error_code: string | null;
    }>(
      `SELECT status, analysis_invocation_id, terminal_error_code
         FROM app.topic_model_generation_invocation_attempts
        WHERE topic_model_generation_run_id = $1`,
      [fixture.runId],
    );
    const [run] = await queryRows<{
      status: string;
      last_error_code: string | null;
    }>("SELECT status, last_error_code FROM app.async_runs WHERE id = $1", [
      fixture.runId,
    ]);
    const invocations = await queryRows<{ id: string }>(
      "SELECT id FROM app.analysis_invocations WHERE async_run_id = $1",
      [fixture.runId],
    );
    const models = await queryRows<{ id: string }>(
      "SELECT id FROM app.topic_model_revisions WHERE project_id = $1",
      [fixture.project.projectId],
    );
    expect(generateTopicModel).toHaveBeenCalledOnce();
    expect(attempt).toMatchObject({
      status: "outcome_unknown",
      analysis_invocation_id: null,
      terminal_error_code: "PROVIDER_OUTCOME_UNKNOWN",
    });
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN",
    });
    expect(invocations).toEqual([]);
    expect(models).toEqual([]);
  });

  it("atomically persists a known rejection and failed child without domain writes", async () => {
    const fixture = await createGenerationFixture("known-rejected");
    const rawMarker = "RAW_REJECTION_MUST_NOT_PERSIST";
    const rejected = knownErrorInvocation(
      fixture,
      "rejected",
      "SCHEMA_INVALID",
    );
    const generateTopicModel = vi.fn(async (): Promise<TopicModelGenerationResult> => {
      throw new LLMError("SCHEMA_INVALID", rawMarker, rejected, rawMarker);
    });

    await runTopicModelGeneration(
      context(),
      { runId: fixture.runId, ...scope(fixture.project) },
      dependencies(generateTopicModel),
    );

    const [run] = await queryRows<{
      status: string;
      last_error_code: string | null;
      last_error_summary: string | null;
    }>(
      `SELECT status, last_error_code, last_error_summary
         FROM app.async_runs
        WHERE id = $1`,
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      analysis_invocation_id: string | null;
      terminal_error_code: string | null;
    }>(
      `SELECT status, analysis_invocation_id, terminal_error_code
         FROM app.topic_model_generation_invocation_attempts
        WHERE topic_model_generation_run_id = $1`,
      [fixture.runId],
    );
    const [invocation] = await queryRows<{
      id: string;
      status: string;
      output_hash: string | null;
      error_code: string | null;
    }>(
      `SELECT id, status, output_hash, error_code
         FROM app.analysis_invocations
        WHERE async_run_id = $1`,
      [fixture.runId],
    );
    const models = await queryRows<{ id: string }>(
      "SELECT id FROM app.topic_model_revisions WHERE project_id = $1",
      [fixture.project.projectId],
    );
    expect(generateTopicModel).toHaveBeenCalledOnce();
    expect(run).toEqual({
      status: "failed",
      last_error_code: "SCHEMA_INVALID",
      last_error_summary: "Topic Model generation failed.",
    });
    expect(attempt).toEqual({
      status: "rejected",
      analysis_invocation_id: invocation!.id,
      terminal_error_code: "SCHEMA_INVALID",
    });
    expect(invocation).toEqual({
      id: invocation!.id,
      status: "rejected",
      output_hash: null,
      error_code: "SCHEMA_INVALID",
    });
    expect(models).toEqual([]);
    expect(
      await latestDecision(fixture.project, fixture.keywords.provider),
    ).toMatchObject({
      governanceRevision: 0,
      topicNodeId: null,
      topicModelRevision: null,
      invocationId: null,
    });
    expect(JSON.stringify({ run, attempt, invocation })).not.toContain(rawMarker);
  });

  it("atomically persists a known transient failure and resets only the exact attempt", async () => {
    const fixture = await createGenerationFixture("known-transient");
    const rawMarker = "RAW_TIMEOUT_MUST_NOT_PERSIST";
    const failed = knownErrorInvocation(fixture, "failed", "TIMEOUT");
    const providerError = new LLMError("TIMEOUT", rawMarker, failed);
    const generateTopicModel = vi.fn(async (): Promise<TopicModelGenerationResult> => {
      throw providerError;
    });

    await expect(
      runTopicModelGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture.project) },
        dependencies(generateTopicModel),
      ),
    ).rejects.toBe(providerError);

    const [run] = await queryRows<{
      status: string;
      attempt_count: number;
      started_at: string | null;
      last_error_code: string | null;
      last_error_summary: string | null;
    }>(
      `SELECT status, attempt_count, started_at,
              last_error_code, last_error_summary
         FROM app.async_runs
        WHERE id = $1`,
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      async_attempt_count: number;
      analysis_invocation_id: string | null;
      terminal_error_code: string | null;
    }>(
      `SELECT status, async_attempt_count,
              analysis_invocation_id, terminal_error_code
         FROM app.topic_model_generation_invocation_attempts
        WHERE topic_model_generation_run_id = $1`,
      [fixture.runId],
    );
    const [invocation] = await queryRows<{
      id: string;
      status: string;
      output_hash: string | null;
      error_code: string | null;
    }>(
      `SELECT id, status, output_hash, error_code
         FROM app.analysis_invocations
        WHERE async_run_id = $1`,
      [fixture.runId],
    );
    const models = await queryRows<{ id: string }>(
      "SELECT id FROM app.topic_model_revisions WHERE project_id = $1",
      [fixture.project.projectId],
    );
    expect(generateTopicModel).toHaveBeenCalledOnce();
    expect(run).toEqual({
      status: "queued",
      attempt_count: 1,
      started_at: null,
      last_error_code: "TIMEOUT",
      last_error_summary: "Topic Model generation will be retried.",
    });
    expect(attempt).toEqual({
      status: "failed",
      async_attempt_count: 1,
      analysis_invocation_id: invocation!.id,
      terminal_error_code: "TIMEOUT",
    });
    expect(invocation).toEqual({
      id: invocation!.id,
      status: "failed",
      output_hash: null,
      error_code: "TIMEOUT",
    });
    expect(models).toEqual([]);
    expect(
      await latestDecision(fixture.project, fixture.keywords.fallback),
    ).toMatchObject({
      governanceRevision: 0,
      topicNodeId: null,
      topicModelRevision: null,
      invocationId: null,
    });
    expect(JSON.stringify({ run, attempt, invocation })).not.toContain(rawMarker);
  });
});
