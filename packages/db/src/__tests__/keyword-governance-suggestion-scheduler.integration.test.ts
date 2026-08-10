import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import {
  KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY,
  KEYWORD_GOVERNANCE_SUGGESTION_QUEUE,
  scheduleKeywordGovernanceSuggestions,
} from "../keyword-governance-suggestion-scheduler.ts";
import { contentHash, type CanonicalValue } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import {
  createBoss,
  enqueueRunInTx,
  startBoss,
  type PgBoss,
} from "../queue.ts";
import {
  AsyncRunsRepository,
  toRunAttempt,
} from "../repositories/async-runs.ts";
import { KeywordGovernanceSuggestionGenerationRunsRepository } from "../repositories/keyword-governance-suggestion-generation-runs.ts";
import { KeywordGovernanceSuggestionInvocationAttemptsRepository } from "../repositories/keyword-governance-suggestion-invocation-attempts.ts";
import { KeywordGovernanceRepository } from "../repositories/keyword-governance.ts";
import { KeywordOccurrencesRepository } from "../repositories/keyword-occurrences.ts";
import { KeywordReviewSuggestionsRepository } from "../repositories/keyword-review-suggestions.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import { TopicModelsRepository } from "../repositories/topic-models.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";
import type {
  KeywordReviewSuggestionBatchItem,
} from "../repositories/keyword-review-suggestions.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

interface SchedulerFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly sitePageId: string;
}

interface PendingSuggestionFixture {
  readonly suggestionId: string;
  readonly keywordId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
}

function confirmedProfile(siteId: string): Record<string, unknown> {
  const paths = [
    "/businessHint",
    "/productName",
    "/oneLiner",
    "/category",
    "/productType",
    "/businessModels",
    "/valueProposition",
    "/coreFeatures",
    "/targetMarkets",
    "/targetAudiences",
  ] as const;
  return {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: siteId,
    sourcePageUrl: "https://example.com/product",
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    businessHint: "B2B workflow software",
    productName: "RelayOps",
    oneLiner: "Evidence-grounded customer onboarding operations",
    category: "Customer onboarding",
    productType: "B2B SaaS",
    businessModels: ["subscription"],
    valueProposition: "Help teams standardize customer onboarding.",
    coreFeatures: ["Workflow automation", "Implementation tracking"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        candidateId: randomUUID(),
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize customer onboarding"],
        triggers: ["Onboarding volume increased"],
        pains: ["Manual handoffs"],
        jtbd: ["Reduce time to value"],
        outcomes: ["A repeatable onboarding process"],
        barriers: ["Fragmented tooling"],
        qualificationSignals: ["Owns onboarding operations"],
        disqualifiers: ["No onboarding workflow"],
      },
    ],
    competitorCandidates: [],
    fieldProvenance: paths.map((path) => ({
      path,
      derivation: "declared",
      confidence: "medium",
      evidenceRefs: [{ evidenceRefId: randomUUID(), kind: "userEdit" }],
      limitation: "Declared disposable fixture authority.",
      observedAt: null,
    })),
    missingFields: ["/competitorCandidates"],
    conflictingFields: [],
  };
}

describeDb("Keyword governance suggestion scheduler atomic queue", () => {
  let handle: DbHandle;
  let boss: PgBoss;

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);
    boss = createBoss(databaseUrl);
    await startBoss(boss);
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false }).catch(() => undefined);
    await handle?.end();
  });

  async function createFixture(): Promise<SchedulerFixture> {
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const siteId = randomUUID();
    const sitePageId = randomUUID();
    const profileId = randomUUID();
    const manualEntryId = randomUUID();
    const host = `${projectId}.scheduler.example`;
    const pageUrl = `https://${host}/customer-onboarding/`;
    const profile = confirmedProfile(siteId);

    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
      [workspaceId, `Scheduler ${workspaceId}`],
    );
    await handle.pool.query(
      `INSERT INTO app.client_projects (
         id, workspace_id, client_name, project_name,
         default_delivery_locale, created_by
       ) VALUES ($1,$2,'Client','Suggestion scheduler','en-US',$3)`,
      [projectId, workspaceId, actorId],
    );
    await handle.pool.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES ($1,$2,$3,$4,$5,ARRAY['US'],ARRAY['en-US'],true)`,
      [siteId, workspaceId, projectId, `https://${host}`, host],
    );
    await handle.pool.query(
      `INSERT INTO app.site_pages (
         id, workspace_id, project_id, site_id,
         normalized_url, normalized_url_hash
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        sitePageId,
        workspaceId,
        projectId,
        siteId,
        pageUrl,
        normalizedUrlHash(pageUrl),
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.icp_profiles (
         id, workspace_id, project_id, version, status, profile,
         content_hash, created_by
       ) VALUES ($1,$2,$3,1,'complete',$4::jsonb,$5,$6)`,
      [
        profileId,
        workspaceId,
        projectId,
        JSON.stringify(profile),
        contentHash({ status: "complete", profile } as CanonicalValue),
        actorId,
      ],
    );
    await handle.pool.query(
      `UPDATE app.client_projects
          SET current_icp_profile_id = $1,
              confirmed_icp_profile_id = $1
        WHERE workspace_id = $2 AND id = $3`,
      [profileId, workspaceId, projectId],
    );

    const scope = { workspaceId, projectId };
    const topics = new TopicModelsRepository(handle.db);
    const draft = await topics.beginDraftFromLatestConfirmed(scope, actorId, {
      expectedLatestConfirmedRevision: 0,
      reason: "Create scheduler Topic authority.",
    });
    const edited = await topics.patchDraft(scope, actorId, {
      topicModelRevision: draft.topicModelRevision,
      expectedEditRevision: draft.editRevision,
      reason: "Add the scheduler Topic.",
      intents: [
        {
          kind: "create",
          parentTopicNodeId: null,
          label: "Customer onboarding",
          description: "Confirmed Topic for scheduler verification.",
          intentEnvelope: ["Commercial"],
        },
      ],
    });
    await topics.confirmDraft(scope, actorId, {
      topicModelRevision: edited.topicModelRevision,
      expectedEditRevision: edited.editRevision,
      reason: "Confirm scheduler Topic authority.",
    });

    await new KeywordOccurrencesRepository(handle.db).upsertIntoLibrary(scope, {
      manualEntryId,
      dataSnapshotId: null,
      normalizedObservationId: null,
      displayKeyword: "Customer Onboarding Software",
      normalizedKeyword: "customer onboarding software",
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "manual",
      scopeBasis: "manual",
      sourcePointer: null,
      sourceRef: `manual:${manualEntryId}`,
      collectedAt: "2026-08-10T00:00:00.000Z",
      providerDataAsOf: null,
    });
    return { workspaceId, projectId, actorId, sitePageId };
  }

  async function createPendingBatch(
    fixture: SchedulerFixture,
  ): Promise<readonly PendingSuggestionFixture[]> {
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const scheduled = await scheduleKeywordGovernanceSuggestions(
      { db: handle.db, boss },
      { scope, initiatedBy: fixture.actorId },
    );
    if (scheduled.kind !== "queued") {
      throw new Error("initial scheduler fixture did not queue");
    }

    const claimed = await new AsyncRunsRepository(handle.db).claim(
      scope,
      scheduled.runId,
    );
    if (claimed === null) {
      throw new Error("queued scheduler fixture run was not claimable");
    }

    const generation =
      await new KeywordGovernanceSuggestionGenerationRunsRepository(
        handle.db,
      ).findById(scope, scheduled.runId);
    if (generation === null) {
      throw new Error("scheduler fixture generation row missing");
    }
    const candidates = generation.input_manifest.candidates;
    if (candidates.length === 0) {
      throw new Error("scheduler fixture candidates missing");
    }
    const activeTopic = await handle.pool.query<{
      topic_node_id: string;
      topic_model_revision: number;
    }>(
      `SELECT topic_node_id, topic_model_revision
         FROM app.topic_node_revisions
        WHERE workspace_id = $1
          AND project_id = $2
          AND lifecycle_state = 'active'
        ORDER BY topic_model_revision DESC, topic_node_id
        LIMIT 1`,
      [fixture.workspaceId, fixture.projectId],
    );
    const topic = activeTopic.rows[0];
    if (!topic) {
      throw new Error("scheduler fixture topic missing");
    }

    const promptHash = contentHash({
      runId: scheduled.runId,
      publicProviderProjection: true,
    } as CanonicalValue);
    const attempts = new KeywordGovernanceSuggestionInvocationAttemptsRepository(
      handle.db,
    );
    const reserved = await attempts.reserve(toRunAttempt(claimed), {
      provider: "openai",
      model: "gpt-5-mini",
      promptSetVersion: "keyword-governance-suggestion.prompt.v1",
      inputHash: promptHash,
    });
    if (reserved.kind !== "reserved") {
      throw new Error("scheduler fixture reservation missing");
    }
    const outputHash = contentHash({
      runId: scheduled.runId,
      output: "pending",
    } as CanonicalValue);
    const finalized = await attempts.finalizeWithInvocation(
      toRunAttempt(claimed),
      reserved.reservation.id,
      {
        provider: "openai",
        model: "gpt-5-mini",
        promptSetVersion: "keyword-governance-suggestion.prompt.v1",
        inputHash: promptHash,
        outputHash,
        status: "succeeded",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
        latencyMs: 25,
        errorCode: null,
      },
    );
    if (finalized.kind !== "finalized") {
      throw new Error("scheduler fixture invocation did not finalize");
    }

    const batch: KeywordReviewSuggestionBatchItem[] = candidates.map(
      (candidate) => ({
        suggestionId: randomUUID(),
        ordinal: candidate.ordinal,
        keywordId: candidate.keywordId,
        expectedGovernanceRevision: candidate.expectedGovernanceRevision,
        suggestionVersion: "keyword-governance-suggestion.v1",
        status: "approved",
        intent: "commercial",
        buyerStage: "decision",
        topicNodeId: topic.topic_node_id,
        topicModelRevision: topic.topic_model_revision,
        mappingDecision: "existing_page",
        mappedSitePageId: fixture.sitePageId,
        reason: "Confirmed authority supports this governed recommendation.",
        intentAuthority:
          candidate.deterministicEvidence.providerSearchIntent === null
            ? "llm_generated"
            : "provider_observed",
        intentSnapshotId:
          candidate.deterministicEvidence.providerSearchIntent?.snapshotId ?? null,
        intentObservationId:
          candidate.deterministicEvidence.providerSearchIntent?.observationId ??
          null,
        intentObservedAt:
          candidate.deterministicEvidence.providerSearchIntent?.observedAt ?? null,
      }),
    );
    const inserted = await new KeywordReviewSuggestionsRepository(
      handle.db,
    ).insertBatch(scope, {
      generationRunId: scheduled.runId,
      inputHash: scheduled.inputHash,
      outputHash,
      analysisInvocationId: finalized.invocationId,
      suggestions: batch,
    });
    expect(inserted).toMatchObject({ kind: "inserted" });
    if (inserted.kind !== "inserted") {
      throw new Error("scheduler fixture suggestions missing");
    }
    expect(inserted.suggestions).toHaveLength(candidates.length);
    expect(inserted.suggestions).toEqual(expect.arrayContaining(
      batch.map((item) => expect.objectContaining({
        id: item.suggestionId,
        keyword_entity_id: item.keywordId,
        generation_run_id: scheduled.runId,
        status: "pending",
        suggested_status: "approved",
      })),
    ));
    await expect(
      new KeywordGovernanceSuggestionGenerationRunsRepository(handle.db).terminalize(
        toRunAttempt(claimed),
        {
          status: "completed",
          resultOutputHash: outputHash,
          lastErrorCode: null,
          lastErrorSummary: null,
        },
      ),
    ).resolves.toMatchObject({ kind: "terminalized" });

    const candidateByKeywordId = new Map(
      candidates.map((candidate) => [candidate.keywordId, candidate]),
    );
    return inserted.suggestions.map((suggestion) => {
      const candidate = candidateByKeywordId.get(suggestion.keyword_entity_id);
      if (!candidate) {
        throw new Error("inserted scheduler suggestion candidate missing");
      }
      return {
        suggestionId: suggestion.id,
        keywordId: suggestion.keyword_entity_id,
        displayKeyword: candidate.displayKeyword,
        normalizedKeyword: candidate.normalizedKeyword,
      };
    });
  }

  async function createPendingSuggestion(
    fixture: SchedulerFixture,
  ): Promise<PendingSuggestionFixture> {
    const pending = await createPendingBatch(fixture);
    if (pending.length !== 1 || !pending[0]) {
      throw new Error("single scheduler suggestion fixture expected");
    }
    return pending[0];
  }

  it("atomically creates the typed run and job, reuses the active run, and rolls both back together", async () => {
    const fixture = await createFixture();
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const scheduled = await scheduleKeywordGovernanceSuggestions(
      { db: handle.db, boss },
      { scope, initiatedBy: fixture.actorId },
    );
    expect(scheduled).toMatchObject({
      kind: "queued",
      candidateCount: 1,
      hasMore: false,
    });
    if (scheduled.kind !== "queued") throw new Error("scheduler did not queue");

    await expect(
      new AsyncRunsRepository(handle.db).findById(scope, scheduled.runId),
    ).resolves.toMatchObject({
      status: "queued",
      active_key: KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY,
      result_type: "keyword_governance_suggestion_generation_run",
      result_id: scheduled.runId,
    });
    await expect(
      new KeywordGovernanceSuggestionGenerationRunsRepository(handle.db).findById(
        scope,
        scheduled.runId,
      ),
    ).resolves.toMatchObject({
      input_hash: scheduled.inputHash,
      input_manifest: { candidates: [{ ordinal: 1 }] },
    });
    await expect(
      boss.getJobById(KEYWORD_GOVERNANCE_SUGGESTION_QUEUE, scheduled.runId),
    ).resolves.toMatchObject({
      id: scheduled.runId,
      data: {
        runId: scheduled.runId,
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
      },
    });

    await expect(
      scheduleKeywordGovernanceSuggestions(
        { db: handle.db, boss },
        { scope, initiatedBy: fixture.actorId },
      ),
    ).resolves.toEqual({ kind: "active", runId: scheduled.runId });

    const claimed = await new AsyncRunsRepository(handle.db).claim(
      scope,
      scheduled.runId,
    );
    if (claimed === null) throw new Error("queued scheduler run was not claimable");
    await expect(
      new KeywordGovernanceSuggestionGenerationRunsRepository(
        handle.db,
      ).terminalize(toRunAttempt(claimed), {
        status: "cancelled",
        resultOutputHash: null,
        lastErrorCode: "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
        lastErrorSummary: "Retire the scheduler atomicity fixture.",
      }),
    ).resolves.toMatchObject({ kind: "terminalized" });

    const rollbackRunId = randomUUID();
    await expect(
      scheduleKeywordGovernanceSuggestions(
        { db: handle.db, boss },
        { scope, initiatedBy: fixture.actorId },
        {
          createRunId: () => rollbackRunId,
          enqueueRunInTx: async (...args) => {
            await enqueueRunInTx(...args);
            throw new Error("forced scheduler rollback");
          },
        },
      ),
    ).rejects.toThrow("forced scheduler rollback");
    await expect(
      new AsyncRunsRepository(handle.db).findById(scope, rollbackRunId),
    ).resolves.toBeNull();
    await expect(
      boss.getJobById(KEYWORD_GOVERNANCE_SUGGESTION_QUEUE, rollbackRunId),
    ).resolves.toBeNull();
  }, 120_000);

  it("supersedes stale pending suggestions before freezing the next batch", async () => {
    const fixture = await createFixture();
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const pending = await createPendingSuggestion(fixture);

    const staleEntryId = randomUUID();
    await new KeywordOccurrencesRepository(handle.db).upsertIntoLibrary(scope, {
      manualEntryId: staleEntryId,
      dataSnapshotId: null,
      normalizedObservationId: null,
      displayKeyword: "Customer Onboarding Software",
      normalizedKeyword: "customer onboarding software",
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "manual",
      scopeBasis: "manual",
      sourcePointer: null,
      sourceRef: `manual:${staleEntryId}`,
      collectedAt: "2026-08-10T01:00:00.000Z",
      providerDataAsOf: null,
    });

    const rollbackRunId = randomUUID();
    await expect(
      scheduleKeywordGovernanceSuggestions(
        { db: handle.db, boss },
        { scope, initiatedBy: fixture.actorId },
        {
          createRunId: () => rollbackRunId,
          enqueueRunInTx: async (_boss, tx) => {
            const cleanedInTransaction =
              await new KeywordReviewSuggestionsRepository(tx).findById(
                scope,
                pending.suggestionId,
              );
            expect(cleanedInTransaction).toMatchObject({
              keyword_entity_id: pending.keywordId,
              status: "superseded",
            });
            throw new Error("forced enqueue failure after stale cleanup");
          },
        },
      ),
    ).rejects.toThrow("forced enqueue failure after stale cleanup");
    await expect(
      new KeywordReviewSuggestionsRepository(handle.db).findById(
        scope,
        pending.suggestionId,
      ),
    ).resolves.toMatchObject({
      keyword_entity_id: pending.keywordId,
      status: "pending",
    });
    await expect(
      new AsyncRunsRepository(handle.db).findById(scope, rollbackRunId),
    ).resolves.toBeNull();
    await expect(
      new KeywordGovernanceSuggestionGenerationRunsRepository(
        handle.db,
      ).findById(scope, rollbackRunId),
    ).resolves.toBeNull();

    const rescheduled = await scheduleKeywordGovernanceSuggestions(
      { db: handle.db, boss },
      { scope, initiatedBy: fixture.actorId },
    );
    expect(rescheduled).toMatchObject({
      kind: "queued",
      candidateCount: 1,
      hasMore: false,
    });
    if (rescheduled.kind !== "queued") {
      throw new Error("stale scheduler fixture did not queue");
    }

    const pendingRow = await new KeywordReviewSuggestionsRepository(
      handle.db,
    ).findById(scope, pending.suggestionId);
    expect(pendingRow).toMatchObject({
      keyword_entity_id: pending.keywordId,
      status: "superseded",
    });
  }, 120_000);

  it("supersedes Topic-drifted pending authority and schedules the current revision", async () => {
    const fixture = await createFixture();
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const pending = await createPendingSuggestion(fixture);
    const topics = new TopicModelsRepository(handle.db);
    const latest = await topics.getLatestConfirmed(scope);
    if (latest?.rootTopicNodeId === null || latest === null) {
      throw new Error("confirmed Topic fixture missing");
    }
    const draft = await topics.beginDraftFromLatestConfirmed(
      scope,
      fixture.actorId,
      {
        expectedLatestConfirmedRevision: latest.topicModelRevision,
        reason: "Create a newer confirmed Topic authority.",
      },
    );
    const edited = await topics.patchDraft(scope, fixture.actorId, {
      topicModelRevision: draft.topicModelRevision,
      expectedEditRevision: draft.editRevision,
      reason: "Rename the current Topic under explicit governance.",
      intents: [{
        kind: "rename",
        topicNodeId: latest.rootTopicNodeId,
        label: "Customer onboarding automation",
      }],
    });
    await topics.confirmDraft(scope, fixture.actorId, {
      topicModelRevision: edited.topicModelRevision,
      expectedEditRevision: edited.editRevision,
      reason: "Confirm the newer Topic authority.",
    });

    const rescheduled = await scheduleKeywordGovernanceSuggestions(
      { db: handle.db, boss },
      { scope, initiatedBy: fixture.actorId },
    );
    expect(rescheduled).toMatchObject({ kind: "queued", candidateCount: 1 });
    await expect(
      new KeywordReviewSuggestionsRepository(handle.db).findById(
        scope,
        pending.suggestionId,
      ),
    ).resolves.toMatchObject({ status: "superseded" });
    if (rescheduled.kind !== "queued") {
      throw new Error("Topic drift did not schedule current authority");
    }
    await expect(
      new KeywordGovernanceSuggestionGenerationRunsRepository(
        handle.db,
      ).findById(scope, rescheduled.runId),
    ).resolves.toMatchObject({
      input_manifest: {
        confirmedTopicModel: {
          revision: latest.topicModelRevision + 1,
        },
      },
    });
  }, 120_000);

  it("supersedes Page-drifted pending authority and freezes the new primary Site", async () => {
    const fixture = await createFixture();
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const pending = await createPendingSuggestion(fixture);
    const replacementSiteId = randomUUID();
    const replacementPageId = randomUUID();
    const replacementHost = `${replacementSiteId}.scheduler.example`;
    const replacementUrl = `https://${replacementHost}/onboarding/`;
    await handle.pool.query(
      `UPDATE app.sites
          SET is_primary = false
        WHERE workspace_id = $1 AND project_id = $2 AND is_primary`,
      [fixture.workspaceId, fixture.projectId],
    );
    await handle.pool.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES ($1,$2,$3,$4,$5,ARRAY['US'],ARRAY['en-US'],true)`,
      [
        replacementSiteId,
        fixture.workspaceId,
        fixture.projectId,
        `https://${replacementHost}`,
        replacementHost,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.site_pages (
         id, workspace_id, project_id, site_id,
         normalized_url, normalized_url_hash
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        replacementPageId,
        fixture.workspaceId,
        fixture.projectId,
        replacementSiteId,
        replacementUrl,
        normalizedUrlHash(replacementUrl),
      ],
    );

    const rescheduled = await scheduleKeywordGovernanceSuggestions(
      { db: handle.db, boss },
      { scope, initiatedBy: fixture.actorId },
    );
    expect(rescheduled).toMatchObject({ kind: "queued", candidateCount: 1 });
    await expect(
      new KeywordReviewSuggestionsRepository(handle.db).findById(
        scope,
        pending.suggestionId,
      ),
    ).resolves.toMatchObject({ status: "superseded" });
    if (rescheduled.kind !== "queued") {
      throw new Error("Page drift did not schedule current authority");
    }
    await expect(
      new KeywordGovernanceSuggestionGenerationRunsRepository(
        handle.db,
      ).findById(scope, rescheduled.runId),
    ).resolves.toMatchObject({
      input_manifest: {
        pageAllowlist: [{ sitePageId: replacementPageId }],
      },
    });
  }, 120_000);

  it("supersedes governance-drifted pending authority without reopening a reviewed keyword", async () => {
    const fixture = await createFixture();
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const pending = await createPendingSuggestion(fixture);
    await expect(
      new KeywordGovernanceRepository(handle.db).applySystemApprovals(scope, [{
        keywordId: pending.keywordId,
        expectedGovernanceRevision: 0,
        clusterKey: "customer onboarding",
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "Provider evidence confirmed this keyword before review.",
      }]),
    ).resolves.toMatchObject([{ applied: true, governanceRevision: 1 }]);

    await expect(
      scheduleKeywordGovernanceSuggestions(
        { db: handle.db, boss },
        { scope, initiatedBy: fixture.actorId },
      ),
    ).resolves.toEqual({ kind: "no_candidates" });
    await expect(
      new KeywordReviewSuggestionsRepository(handle.db).findById(
        scope,
        pending.suggestionId,
      ),
    ).resolves.toMatchObject({ status: "superseded" });
    const authority = await handle.pool.query<{
      decision_origin: string;
      keyword_status: string;
      review_state: string;
    }>(
      `SELECT decision.decision_origin,
              keyword.status AS keyword_status,
              keyword.mapping_review_state AS review_state
         FROM app.keyword_entities keyword
         JOIN app.keyword_review_decisions decision
           ON decision.keyword_entity_id = keyword.id
          AND decision.governance_revision = keyword.mapping_revision
        WHERE keyword.workspace_id = $1
          AND keyword.project_id = $2
          AND keyword.id = $3`,
      [fixture.workspaceId, fixture.projectId, pending.keywordId],
    );
    expect(authority.rows).toEqual([{
      decision_origin: "system_suggestion",
      keyword_status: "approved",
      review_state: "confirmed",
    }]);
  }, 120_000);

  it("drains more than one bounded stale sweep before freezing the next batch", async () => {
    const fixture = await createFixture();
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const occurrences = new KeywordOccurrencesRepository(handle.db);
    await occurrences.upsertManyIntoLibrary(
      scope,
      Array.from({ length: 100 }, (_, index) => {
        const manualEntryId = randomUUID();
        const suffix = String(index + 1).padStart(3, "0");
        return {
          manualEntryId,
          dataSnapshotId: null,
          normalizedObservationId: null,
          displayKeyword: `Scheduler Stale Keyword ${suffix}`,
          normalizedKeyword: `scheduler stale keyword ${suffix}`,
          market: "US",
          languageTag: "en-US",
          queryKind: "search_query" as const,
          sourceKind: "manual" as const,
          scopeBasis: "manual" as const,
          sourcePointer: null,
          sourceRef: `manual:${manualEntryId}`,
          collectedAt: new Date(
            Date.UTC(2026, 7, 10, 2, 0, index),
          ).toISOString(),
          providerDataAsOf: null,
        };
      }),
    );

    const firstBatch = await createPendingBatch(fixture);
    const secondBatch = await createPendingBatch(fixture);
    expect(firstBatch).toHaveLength(100);
    expect(secondBatch).toHaveLength(1);
    const pending = [...firstBatch, ...secondBatch];

    await occurrences.upsertManyIntoLibrary(
      scope,
      pending.map((suggestion, index) => {
        const manualEntryId = randomUUID();
        return {
          manualEntryId,
          dataSnapshotId: null,
          normalizedObservationId: null,
          displayKeyword: suggestion.displayKeyword,
          normalizedKeyword: suggestion.normalizedKeyword,
          market: "US",
          languageTag: "en-US",
          queryKind: "search_query" as const,
          sourceKind: "manual" as const,
          scopeBasis: "manual" as const,
          sourcePointer: null,
          sourceRef: `manual:${manualEntryId}`,
          collectedAt: new Date(
            Date.UTC(2026, 7, 10, 3, 0, index),
          ).toISOString(),
          providerDataAsOf: null,
        };
      }),
    );

    const rescheduled = await scheduleKeywordGovernanceSuggestions(
      { db: handle.db, boss },
      { scope, initiatedBy: fixture.actorId },
    );
    expect(rescheduled).toMatchObject({
      kind: "queued",
      candidateCount: 100,
      hasMore: true,
    });
    const statuses = await handle.pool.query<{
      status: string;
      count: string;
    }>(
      `SELECT status, count(*)::text AS count
         FROM app.keyword_review_suggestions
        WHERE id = ANY($1::uuid[])
        GROUP BY status
        ORDER BY status`,
      [pending.map((suggestion) => suggestion.suggestionId)],
    );
    expect(statuses.rows).toEqual([{ status: "superseded", count: "101" }]);
  }, 120_000);
});
