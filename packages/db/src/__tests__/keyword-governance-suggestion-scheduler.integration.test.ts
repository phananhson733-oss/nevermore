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
import { KeywordOccurrencesRepository } from "../repositories/keyword-occurrences.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import { TopicModelsRepository } from "../repositories/topic-models.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

interface SchedulerFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
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
    return { workspaceId, projectId, actorId };
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
});
