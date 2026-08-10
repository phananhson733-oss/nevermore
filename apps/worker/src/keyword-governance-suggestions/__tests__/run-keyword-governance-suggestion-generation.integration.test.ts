import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
  LLMError,
  prepareKeywordGovernanceSuggestionGeneration,
  type AnalysisInvocationRecord,
  type KeywordGovernanceSuggestionGenerationResult,
} from "@sf/artifacts";
import {
  CONTRACT_VERSION,
  type KeywordGovernanceSuggestionInputManifest,
} from "@sf/contracts";
import {
  AsyncRunsRepository,
  IcpProfilesRepository,
  KeywordGovernanceSuggestionGenerationRunsRepository,
  KeywordGovernanceRepository,
  KeywordOccurrencesRepository,
  ProjectsRepository,
  SitesRepository,
  TopicModelsRepository,
  contentHash,
  type Db,
  type ProjectScope,
} from "@sf/db";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { runMigrations } from "../../../../../packages/db/src/migrate.ts";
import { requireSafeTestDatabaseUrl } from "../../../../../packages/db/src/test-database-safety.ts";
import { freezeKeywordGovernanceSuggestionInput } from "../frozen-input.ts";
import { runKeywordGovernanceSuggestionGeneration } from "../run-keyword-governance-suggestion-generation.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const COLLECTED_AT = "2026-08-10T08:00:00.000Z";
const NOOP = (): void => undefined;
const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface Fixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly keywordId: string;
  readonly suggestionId: string;
  readonly manifest: KeywordGovernanceSuggestionInputManifest;
}

describeDb("Keyword governance suggestion generation worker", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);
  });

  afterAll(async () => {
    await handle?.end();
  });

  function scope(fixture: Fixture): ProjectScope {
    return {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
  }

  function context(db: Db = handle.db): WorkerContext {
    return {
      db,
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

  async function createFixture(label: string): Promise<Fixture> {
    const workspaceId = randomUUID();
    const actorId = randomUUID();
    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
      [workspaceId, `${label} ${workspaceId}`],
    );
    const project = await new ProjectsRepository(handle.db).insert({
      workspaceId,
      clientName: `${label} client`,
      projectName: `${label} project`,
      defaultDeliveryLocale: "en-US",
      createdBy: actorId,
    });
    const host = `${randomUUID()}.suggestion-worker.example`;
    await new SitesRepository(handle.db).insertPrimary({
      workspaceId,
      projectId: project.id,
      origin: `https://${host}`,
      host,
      marketCodes: ["US"],
      languageCodes: ["en-US"],
    });

    const storedProfile = { productName: `${label} product` };
    const profile = await new IcpProfilesRepository(handle.db).insertVersion({
      workspaceId,
      projectId: project.id,
      version: 1,
      status: "complete",
      profile: storedProfile,
      contentHash: contentHash({ status: "complete", profile: storedProfile }),
      createdBy: actorId,
    });
    const projects = new ProjectsRepository(handle.db);
    if (
      !(await projects.setCurrentIcpProfile(
        { workspaceId },
        project.id,
        profile.id,
      )) ||
      !(await projects.setConfirmedIcpProfile(
        { workspaceId },
        project.id,
        profile.id,
      ))
    ) {
      throw new Error("Keyword suggestion Product Profile fixture failed");
    }

    const selectedScope = { workspaceId, projectId: project.id };
    const topics = new TopicModelsRepository(handle.db);
    const draft = await topics.beginDraftFromLatestConfirmed(
      selectedScope,
      actorId,
      {
        expectedLatestConfirmedRevision: 0,
        reason: "Create the Keyword suggestion integration Topic.",
      },
    );
    const edited = await topics.patchDraft(selectedScope, actorId, {
      topicModelRevision: draft.topicModelRevision,
      expectedEditRevision: draft.editRevision,
      reason: "Add one confirmed Topic for suggestion authority.",
      intents: [
        {
          kind: "create",
          parentTopicNodeId: null,
          label: "Lifecycle Automation",
          description: "Confirmed Topic for Keyword suggestion integration.",
          intentEnvelope: ["Commercial"],
        },
      ],
    });
    await topics.confirmDraft(selectedScope, actorId, {
      topicModelRevision: edited.topicModelRevision,
      expectedEditRevision: edited.editRevision,
      reason: "Confirm the Keyword suggestion integration Topic.",
    });
    const [topic] = await queryRows<{
      id: string;
      revision: number;
      content_hash: string;
      root_topic_node_id: string;
    }>(
      `SELECT id, revision, content_hash, root_topic_node_id
         FROM app.topic_model_revisions
        WHERE workspace_id = $1 AND project_id = $2 AND status = 'confirmed'`,
      [workspaceId, project.id],
    );
    if (!topic) throw new Error("Keyword suggestion Topic fixture failed");

    const occurrenceId = randomUUID();
    const keyword = await new KeywordOccurrencesRepository(
      handle.db,
    ).upsertIntoLibrary(selectedScope, {
      manualEntryId: occurrenceId,
      dataSnapshotId: null,
      normalizedObservationId: null,
      displayKeyword: `${label} Automation`,
      normalizedKeyword: `${label.toLowerCase()} automation`,
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "manual",
      scopeBasis: "manual",
      sourcePointer: null,
      sourceRef: `manual:${occurrenceId}`,
      collectedAt: COLLECTED_AT,
      providerDataAsOf: null,
    });

    const frozen = freezeKeywordGovernanceSuggestionInput({
      workspaceId,
      projectId: project.id,
      marketCode: "US",
      languageTag: "en-US",
      primaryMarketCode: "US",
      primaryLanguageTag: "en-US",
      confirmedProductProfile: {
        state: "confirmed",
        productProfileId: profile.id,
        version: profile.version,
        contentHash: profile.content_hash,
        facts: {
          productName: `${label} product`,
          category: "Lifecycle automation",
          valueProposition: "Turn lifecycle signals into timely actions.",
          targetAudience: "B2B SaaS lifecycle teams",
          buyerRoles: ["VP Customer Success"],
          pains: ["Fragmented lifecycle signals"],
          outcomes: ["Faster customer activation"],
        },
      },
      confirmedTopicModel: {
        state: "confirmed",
        topicModelRevisionId: topic.id,
        revision: topic.revision,
        contentHash: topic.content_hash,
        topics: [
          {
            topicNodeId: topic.root_topic_node_id,
            label: "Lifecycle Automation",
          },
        ],
      },
      pages: [],
      keywords: [
        {
          keywordId: keyword.entityId,
          displayKeyword: `${label} Automation`,
          normalizedKeyword: `${label.toLowerCase()} automation`,
          marketCode: "US",
          languageTag: "en-US",
          queryKind: "search_query",
          status: "candidate",
          reviewState: "unreviewed",
          reviewOrigin: null,
          hasHumanDecision: false,
          governanceRevision: 0,
          topicNodeId: null,
          topicModelRevision: null,
          mappedSitePageId: null,
          occurrences: [
            {
              occurrenceId: keyword.occurrenceId,
              marketCode: "US",
              languageTag: "en-US",
              valid: true,
              sourceKind: "manual",
              providerSearchIntent: null,
            },
          ],
        },
      ],
    });
    const runId = randomUUID();
    await new AsyncRunsRepository(handle.db).insertQueued({
      runId,
      workspaceId,
      projectId: project.id,
      kind: "keyword_governance_suggestion_generation",
      activeKey: `keyword-governance-suggestion:${runId}`,
      initiatedBy: actorId,
      contractVersion: CONTRACT_VERSION,
      resultType: "keyword_governance_suggestion_generation_run",
      resultId: runId,
    });
    await new KeywordGovernanceSuggestionGenerationRunsRepository(
      handle.db,
    ).insertPlaceholder({
      runId,
      workspaceId,
      projectId: project.id,
      inputManifest: frozen.manifest,
      inputHash: frozen.inputHash,
    });
    return {
      actorId,
      workspaceId,
      projectId: project.id,
      runId,
      keywordId: keyword.entityId,
      suggestionId: randomUUID(),
      manifest: frozen.manifest,
    };
  }

  function resultFor(fixture: Fixture): KeywordGovernanceSuggestionGenerationResult {
    return {
      output: {
        schemaVersion: "keyword-governance-suggestion-output.v1",
        suggestions: [
          {
            keywordKey: "keyword-1",
            status: "approved",
            intent: "commercial",
            buyerStage: "consideration",
            topicKey: null,
            mappingDecision: "unassigned",
            pageKey: null,
            reason: "The confirmed profile supports this governance proposal.",
          },
        ],
      },
      invocation: {
        task: "keyword_governance_suggestion_generation",
        provider: "openai",
        model: "gpt-test",
        promptSetVersion: KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
        inputHash: prepareKeywordGovernanceSuggestionGeneration(fixture.manifest)
          .inputHash,
        outputHash: contentHash({ runId: fixture.runId, result: "accepted" }),
        status: "succeeded",
        inputTokens: 80,
        outputTokens: 30,
        costUsd: null,
        latencyMs: 20,
        errorCode: null,
      },
    };
  }

  function dependencies(
    generateKeywordGovernanceSuggestions: (
      manifest: KeywordGovernanceSuggestionInputManifest,
    ) => Promise<KeywordGovernanceSuggestionGenerationResult>,
    suggestionId: string,
  ) {
    return {
      createClient: () => ({ generateKeywordGovernanceSuggestions }),
      createSuggestionId: () => suggestionId,
    };
  }

  it("commits one complete batch after the paid reservation is durably visible", async () => {
    const fixture = await createFixture("Success");
    const generated = resultFor(fixture);
    const generate = vi.fn(
      async (
        manifest: KeywordGovernanceSuggestionInputManifest,
      ): Promise<KeywordGovernanceSuggestionGenerationResult> => {
        expect(manifest).toEqual(fixture.manifest);
        const [visibleReservation] = await queryRows<{
          status: string;
          invocation_count: string;
        }>(
          `SELECT attempt.status,
                  (SELECT count(*) FROM app.analysis_invocations invocation
                    WHERE invocation.async_run_id = attempt.generation_run_id)
                    AS invocation_count
             FROM app.keyword_governance_suggestion_invocation_attempts attempt
            WHERE attempt.generation_run_id = $1`,
          [fixture.runId],
        );
        expect(visibleReservation).toEqual({
          status: "reserved",
          invocation_count: "0",
        });
        return generated;
      },
    );

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        dependencies(generate, fixture.suggestionId),
      ),
    ).resolves.toEqual({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: fixture.actorId,
    });
    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        dependencies(generate, fixture.suggestionId),
      ),
    ).resolves.toEqual({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: fixture.actorId,
    });

    expect(generate).toHaveBeenCalledOnce();
    const [run] = await queryRows<{
      status: string;
      last_error_code: string | null;
      progress: unknown;
    }>(
      "SELECT status, last_error_code, progress FROM app.async_runs WHERE id = $1",
      [fixture.runId],
    );
    const [generation] = await queryRows<{ result_output_hash: string | null }>(
      `SELECT result_output_hash
         FROM app.keyword_governance_suggestion_generation_runs WHERE id = $1`,
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      analysis_invocation_id: string | null;
    }>(
      `SELECT status, analysis_invocation_id
         FROM app.keyword_governance_suggestion_invocation_attempts
        WHERE generation_run_id = $1`,
      [fixture.runId],
    );
    const [invocation] = await queryRows<{
      id: string;
      status: string;
      output_hash: string;
    }>(
      `SELECT id, status, output_hash
         FROM app.analysis_invocations WHERE async_run_id = $1`,
      [fixture.runId],
    );
    const suggestions = await queryRows<{
      id: string;
      status: string;
      suggested_intent: string | null;
      suggested_buyer_stage: string | null;
      intent_authority: string;
      analysis_invocation_id: string;
    }>(
      `SELECT id, status, suggested_intent, suggested_buyer_stage,
              intent_authority, analysis_invocation_id
         FROM app.keyword_review_suggestions
        WHERE generation_run_id = $1`,
      [fixture.runId],
    );
    expect(run).toEqual({
      status: "completed",
      last_error_code: null,
      progress: {
        schemaVersion: "keyword-governance-suggestion-generation-outcome.v1",
        candidateCount: 1,
        suggestionCount: 1,
        limitations: [],
        terminalDisposition: {
          kind: "completed",
          requestNextBatch: true,
        },
      },
    });
    expect(generation?.result_output_hash).toBe(generated.invocation.outputHash);
    expect(attempt).toEqual({
      status: "succeeded",
      analysis_invocation_id: invocation?.id,
    });
    expect(invocation).toMatchObject({
      status: "succeeded",
      output_hash: generated.invocation.outputHash,
    });
    expect(suggestions).toEqual([
      {
        id: fixture.suggestionId,
        status: "pending",
        suggested_intent: "commercial",
        suggested_buyer_stage: "consideration",
        intent_authority: "llm_generated",
        analysis_invocation_id: invocation?.id,
      },
    ]);
  });

  it("cancels a concurrent human batch without inserting a partial suggestion", async () => {
    const fixture = await createFixture("Concurrent Human");
    const generated = resultFor(fixture);
    const generate = vi.fn(async () => {
      await new KeywordGovernanceRepository(handle.db).reviewKeyword(
        scope(fixture),
        fixture.keywordId,
        fixture.actorId,
        {
          expectedGovernanceRevision: 0,
          status: "approved",
          intent: "transactional",
          buyerStage: "decision",
          topicNodeId: null,
          topicModelRevision: null,
          mappingDecision: "unassigned",
          mappedSitePageId: null,
          reason: "A human governed the Keyword while the provider was running.",
        },
      );
      return generated;
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        dependencies(generate, fixture.suggestionId),
      ),
    ).resolves.toEqual({
      kind: "reschedule",
      reason: "concurrent_human",
      requestNextBatch: true,
      initiatedBy: fixture.actorId,
    });
    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        dependencies(generate, fixture.suggestionId),
      ),
    ).resolves.toEqual({
      kind: "reschedule",
      reason: "concurrent_human",
      requestNextBatch: true,
      initiatedBy: fixture.actorId,
    });

    const [run] = await queryRows<{
      status: string;
      last_error_code: string;
      progress: unknown;
    }>(
      "SELECT status, last_error_code, progress FROM app.async_runs WHERE id = $1",
      [fixture.runId],
    );
    const counts = await queryRows<{
      suggestions: string;
      invocations: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.keyword_review_suggestions
           WHERE generation_run_id = $1) AS suggestions,
         (SELECT count(*) FROM app.analysis_invocations
           WHERE async_run_id = $1 AND status = 'succeeded') AS invocations`,
      [fixture.runId],
    );
    expect(run).toEqual({
      status: "cancelled",
      last_error_code: "KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN",
      progress: {
        schemaVersion: "keyword-governance-suggestion-generation-outcome.v1",
        candidateCount: 1,
        suggestionCount: 0,
        limitations: [],
        terminalDisposition: {
          kind: "reschedule",
          reason: "concurrent_human",
          requestNextBatch: true,
        },
      },
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(counts).toEqual([{ suggestions: "0", invocations: "1" }]);
  });

  it("cancels stale frozen authority without inserting a partial suggestion", async () => {
    const fixture = await createFixture("Stale Authority");
    const generated = resultFor(fixture);
    const generate = vi.fn(async () => {
      const replacementProfile = { productName: "Replacement product" };
      const profile = await new IcpProfilesRepository(handle.db).insertVersion({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        version: 2,
        status: "complete",
        profile: replacementProfile,
        contentHash: contentHash({
          status: "complete",
          profile: replacementProfile,
        }),
        createdBy: fixture.actorId,
      });
      const projects = new ProjectsRepository(handle.db);
      if (
        !(await projects.setCurrentIcpProfile(
          { workspaceId: fixture.workspaceId },
          fixture.projectId,
          profile.id,
        )) ||
        !(await projects.setConfirmedIcpProfile(
          { workspaceId: fixture.workspaceId },
          fixture.projectId,
          profile.id,
        ))
      ) {
        throw new Error("replacement Product Profile fixture failed");
      }
      return generated;
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        dependencies(generate, fixture.suggestionId),
      ),
    ).resolves.toEqual({
      kind: "reschedule",
      reason: "stale_authority",
      requestNextBatch: true,
      initiatedBy: fixture.actorId,
    });

    const [run] = await queryRows<{
      status: string;
      last_error_code: string;
    }>(
      "SELECT status, last_error_code FROM app.async_runs WHERE id = $1",
      [fixture.runId],
    );
    const [counts] = await queryRows<{
      suggestions: string;
      invocations: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.keyword_review_suggestions
           WHERE generation_run_id = $1) AS suggestions,
         (SELECT count(*) FROM app.analysis_invocations
           WHERE async_run_id = $1 AND status = 'succeeded') AS invocations`,
      [fixture.runId],
    );
    expect(run).toEqual({
      status: "cancelled",
      last_error_code: "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
    });
    expect(counts).toEqual({ suggestions: "0", invocations: "1" });
  });

  it("persists an invalid structured batch as rejected with zero suggestions", async () => {
    const fixture = await createFixture("Rejected Output");
    const generated = resultFor(fixture);
    const generate = vi.fn(async () => ({
      ...generated,
      output: { ...generated.output, suggestions: [] },
    }) as never);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        dependencies(generate, fixture.suggestionId),
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    const [run] = await queryRows<{
      status: string;
      last_error_code: string;
    }>(
      "SELECT status, last_error_code FROM app.async_runs WHERE id = $1",
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      terminal_error_code: string;
    }>(
      `SELECT status, terminal_error_code
         FROM app.keyword_governance_suggestion_invocation_attempts
        WHERE generation_run_id = $1`,
      [fixture.runId],
    );
    const [invocation] = await queryRows<{
      status: string;
      output_hash: string | null;
      error_code: string;
    }>(
      `SELECT status, output_hash, error_code
         FROM app.analysis_invocations WHERE async_run_id = $1`,
      [fixture.runId],
    );
    const [count] = await queryRows<{ count: string }>(
      "SELECT count(*) FROM app.keyword_review_suggestions WHERE generation_run_id = $1",
      [fixture.runId],
    );
    expect(run).toEqual({ status: "failed", last_error_code: "SCHEMA_INVALID" });
    expect(attempt).toEqual({
      status: "rejected",
      terminal_error_code: "SCHEMA_INVALID",
    });
    expect(invocation).toEqual({
      status: "rejected",
      output_hash: null,
      error_code: "SCHEMA_INVALID",
    });
    expect(count?.count).toBe("0");
  });

  it("atomically records a known HTTP transient invocation before rethrowing for retry", async () => {
    const fixture = await createFixture("Known Transient");
    const generated = resultFor(fixture);
    const failedInvocation: AnalysisInvocationRecord = {
      ...generated.invocation,
      outputHash: null,
      status: "failed",
      errorCode: "SERVER_ERROR",
    };
    const providerError = new LLMError(
      "SERVER_ERROR",
      "RAW_PROVIDER_RESPONSE_MUST_NOT_PERSIST",
      failedInvocation,
    );
    const generate = vi.fn(async (): Promise<KeywordGovernanceSuggestionGenerationResult> => {
      throw providerError;
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        dependencies(generate, fixture.suggestionId),
      ),
    ).rejects.toBe(providerError);

    const [run] = await queryRows<{
      status: string;
      attempt_count: number;
      started_at: string | null;
      last_error_code: string;
      last_error_summary: string;
    }>(
      `SELECT status, attempt_count, started_at,
              last_error_code, last_error_summary
         FROM app.async_runs WHERE id = $1`,
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      terminal_error_code: string;
    }>(
      `SELECT status, terminal_error_code
         FROM app.keyword_governance_suggestion_invocation_attempts
        WHERE generation_run_id = $1`,
      [fixture.runId],
    );
    const [invocation] = await queryRows<{
      status: string;
      error_code: string;
    }>(
      `SELECT status, error_code
         FROM app.analysis_invocations WHERE async_run_id = $1`,
      [fixture.runId],
    );
    expect(run).toEqual({
      status: "queued",
      attempt_count: 1,
      started_at: null,
      last_error_code: "SERVER_ERROR",
      last_error_summary:
        "Keyword governance suggestion generation will be retried.",
    });
    expect(attempt).toEqual({
      status: "failed",
      terminal_error_code: "SERVER_ERROR",
    });
    expect(invocation).toEqual({
      status: "failed",
      error_code: "SERVER_ERROR",
    });
    expect(JSON.stringify({ run, attempt, invocation })).not.toContain(
      "RAW_PROVIDER_RESPONSE_MUST_NOT_PERSIST",
    );
  });

  it("marks an attached timeout outcome unknown and a redelivery never pays again", async () => {
    const fixture = await createFixture("Ambiguous Timeout");
    const generated = resultFor(fixture);
    const failedInvocation: AnalysisInvocationRecord = {
      ...generated.invocation,
      outputHash: null,
      status: "failed",
      errorCode: "TIMEOUT",
    };
    const providerError = new LLMError(
      "TIMEOUT",
      "RAW_AMBIGUOUS_TIMEOUT_MUST_NOT_PERSIST",
      failedInvocation,
    );
    const generate = vi.fn(
      async (): Promise<KeywordGovernanceSuggestionGenerationResult> => {
        throw providerError;
      },
    );
    const runnerDependencies = dependencies(generate, fixture.suggestionId);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        runnerDependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });
    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        runnerDependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    const [run] = await queryRows<{
      status: string;
      last_error_code: string;
    }>(
      "SELECT status, last_error_code FROM app.async_runs WHERE id = $1",
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      terminal_error_code: string;
    }>(
      `SELECT status, terminal_error_code
         FROM app.keyword_governance_suggestion_invocation_attempts
        WHERE generation_run_id = $1`,
      [fixture.runId],
    );
    const [invocations] = await queryRows<{ count: string }>(
      "SELECT count(*) FROM app.analysis_invocations WHERE async_run_id = $1",
      [fixture.runId],
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(run).toEqual({
      status: "failed",
      last_error_code:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
    });
    expect(attempt).toEqual({
      status: "outcome_unknown",
      terminal_error_code: "PROVIDER_OUTCOME_UNKNOWN",
    });
    expect(invocations?.count).toBe("0");
    expect(JSON.stringify({ run, attempt })).not.toContain(
      "RAW_AMBIGUOUS_TIMEOUT_MUST_NOT_PERSIST",
    );
  });

  it("marks an opaque provider outcome unknown and a redelivery never pays again", async () => {
    const fixture = await createFixture("Opaque Failure");
    const generate = vi.fn(async (): Promise<KeywordGovernanceSuggestionGenerationResult> => {
      throw new Error("RAW_OPAQUE_PROVIDER_FAILURE");
    });
    const runnerDependencies = dependencies(generate, fixture.suggestionId);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        runnerDependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });
    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        runnerDependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    const [run] = await queryRows<{
      status: string;
      last_error_code: string;
    }>(
      "SELECT status, last_error_code FROM app.async_runs WHERE id = $1",
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      terminal_error_code: string;
    }>(
      `SELECT status, terminal_error_code
         FROM app.keyword_governance_suggestion_invocation_attempts
        WHERE generation_run_id = $1`,
      [fixture.runId],
    );
    const [invocations] = await queryRows<{ count: string }>(
      "SELECT count(*) FROM app.analysis_invocations WHERE async_run_id = $1",
      [fixture.runId],
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(run).toEqual({
      status: "failed",
      last_error_code:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
    });
    expect(attempt).toEqual({
      status: "outcome_unknown",
      terminal_error_code: "PROVIDER_OUTCOME_UNKNOWN",
    });
    expect(invocations?.count).toBe("0");
    expect(JSON.stringify({ run, attempt })).not.toContain(
      "RAW_OPAQUE_PROVIDER_FAILURE",
    );
  });

  it("recovers the durable continuation after a committed Tx B acknowledgement is lost", async () => {
    const fixture = await createFixture("Tx B Commit Acknowledgement");
    const generated = resultFor(fixture);
    const generate = vi.fn(async () => generated);
    const baseDb = handle.db;
    const committedButUnacknowledgedDb = new Proxy(baseDb, {
      get(target, property) {
        if (property === "transaction") {
          return async <T>(run: (tx: Db) => Promise<T>): Promise<T> => {
            await target.transaction((tx) => run(tx as Db));
            throw new Error("fixture Tx B commit acknowledgement lost");
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Db;
    const runnerDependencies = dependencies(generate, fixture.suggestionId);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(committedButUnacknowledgedDb),
        { runId: fixture.runId, ...scope(fixture) },
        runnerDependencies,
      ),
    ).resolves.toEqual({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: fixture.actorId,
    });
    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(),
        { runId: fixture.runId, ...scope(fixture) },
        runnerDependencies,
      ),
    ).resolves.toEqual({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: fixture.actorId,
    });

    const [run] = await queryRows<{ status: string; progress: unknown }>(
      "SELECT status, progress FROM app.async_runs WHERE id = $1",
      [fixture.runId],
    );
    const [counts] = await queryRows<{
      invocations: string;
      suggestions: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.analysis_invocations
           WHERE async_run_id = $1 AND status = 'succeeded') AS invocations,
         (SELECT count(*) FROM app.keyword_review_suggestions
           WHERE generation_run_id = $1) AS suggestions`,
      [fixture.runId],
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(run).toEqual({
      status: "completed",
      progress: {
        schemaVersion: "keyword-governance-suggestion-generation-outcome.v1",
        candidateCount: 1,
        suggestionCount: 1,
        limitations: [],
        terminalDisposition: {
          kind: "completed",
          requestNextBatch: true,
        },
      },
    });
    expect(counts).toEqual({ invocations: "1", suggestions: "1" });
  });

  it("rolls back every Tx B write and records ambiguity when commit cannot be proven", async () => {
    const fixture = await createFixture("Tx B Rollback");
    const generated = resultFor(fixture);
    const generate = vi.fn(async () => generated);
    const baseDb = handle.db;
    const ambiguousDb = new Proxy(baseDb, {
      get(target, property) {
        if (property === "transaction") {
          return async <T>(run: (tx: Db) => Promise<T>): Promise<T> =>
            target.transaction(async (tx) => {
              await run(tx as Db);
              throw new Error("fixture Tx B commit outcome unknown");
            });
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Db;

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        context(ambiguousDb),
        { runId: fixture.runId, ...scope(fixture) },
        dependencies(generate, fixture.suggestionId),
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    const [run] = await queryRows<{
      status: string;
      last_error_code: string;
      progress: unknown;
    }>(
      "SELECT status, last_error_code, progress FROM app.async_runs WHERE id = $1",
      [fixture.runId],
    );
    const [attempt] = await queryRows<{
      status: string;
      terminal_error_code: string;
    }>(
      `SELECT status, terminal_error_code
         FROM app.keyword_governance_suggestion_invocation_attempts
        WHERE generation_run_id = $1`,
      [fixture.runId],
    );
    const [counts] = await queryRows<{
      invocations: string;
      suggestions: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.analysis_invocations
           WHERE async_run_id = $1) AS invocations,
         (SELECT count(*) FROM app.keyword_review_suggestions
           WHERE generation_run_id = $1) AS suggestions`,
      [fixture.runId],
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(run).toEqual({
      status: "failed",
      last_error_code:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
      progress: {
        phase: "queued",
        current: 0,
        total: null,
        messageKey: "run.queued",
      },
    });
    expect(attempt).toEqual({
      status: "outcome_unknown",
      terminal_error_code: "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    });
    expect(counts).toEqual({ invocations: "0", suggestions: "0" });
  });
});
