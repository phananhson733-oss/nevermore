import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import {
  KeywordOccurrencesRepository,
  type CanonicalKeywordOccurrenceInput,
  type ManualKeywordOccurrenceInput,
} from "../repositories/keyword-occurrences.ts";
import {
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
} from "../repositories/keyword-governance.ts";
import {
  KeywordsRepository,
  LegacyKeywordReviewDisabledError,
} from "../repositories/keywords.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import { TopicModelsRepository } from "../repositories/topic-models.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CAPTURED_AT = "2026-07-22T08:00:00.000Z";

interface SourceFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly siteId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly sitePageId: string;
}

interface BareProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
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

async function createSourceFixture(
  handle: DbHandle,
  options: {
    readonly workspaceId?: string;
    readonly projectName?: string;
    readonly providerDataAsOf?: string | null;
  } = {},
): Promise<SourceFixture> {
  const workspaceId = options.workspaceId ?? randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const sourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  const sitePageId = randomUUID();
  const actorId = randomUUID();
  const host = `${projectId}.keyword.example`;
  const origin = `https://${host}`;

  if (!options.workspaceId) {
    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
      [workspaceId, `Keyword library ${workspaceId}`],
    );
  }
  await handle.pool.query(
    `INSERT INTO app.client_projects (
       id, workspace_id, client_name, project_name,
       default_delivery_locale, created_by
     ) VALUES ($1,$2,$3,$4,'en-US',$5)`,
    [
      projectId,
      workspaceId,
      `Client ${projectId}`,
      options.projectName ?? `Project ${projectId}`,
      actorId,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.sites (
       id, workspace_id, project_id, origin, host,
       market_codes, language_codes, is_primary
     ) VALUES ($1,$2,$3,$4,$5,ARRAY['US'],ARRAY['en-US'],true)`,
    [siteId, workspaceId, projectId, origin, host],
  );
  await handle.pool.query(
    `INSERT INTO app.source_connections (
       id, workspace_id, project_id, site_id, provider,
       connection_type, state, external_ref, limitation,
       connected_at, created_by
     ) VALUES (
       $1,$2,$3,$4,'dataforseo','api_key_stub','available',
       $5,'Disposable DataForSEO integration fixture.',$6,$7
     )`,
    [
      sourceConnectionId,
      workspaceId,
      projectId,
      siteId,
      host,
      CAPTURED_AT,
      actorId,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.async_runs (
       id, workspace_id, project_id, kind, status,
       initiated_by, started_at
     ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
    [collectionRunId, workspaceId, projectId, actorId, CAPTURED_AT],
  );
  await handle.pool.query(
    `INSERT INTO app.collection_runs (
       id, workspace_id, project_id, site_id, source_connection_id,
       provider, operation, method_version, parameters_hash
     ) VALUES (
       $1,$2,$3,$4,$5,'dataforseo','keyword_gap_import',
       'dataforseo.ranked_keywords.v1',$6
     )`,
    [
      collectionRunId,
      workspaceId,
      projectId,
      siteId,
      sourceConnectionId,
      contentHash({ collectionRunId }),
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.data_snapshots (
       id, workspace_id, project_id, site_id, collection_run_id,
       source_connection_id, provider, dataset_key, schema_version,
       method_version, captured_at, source_window, availability,
       limitation, row_count, checksum, summary
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'dataforseo','dataforseo.ranked_keywords.v1',
       'dataforseo.ranked_keywords.v1','dataforseo.ranked_keywords.v1',
       $7,'{"start":null,"end":null}'::jsonb,'available',
       'Provider data timestamp may be unavailable.',1,$8,$9
     )`,
    [
      snapshotId,
      workspaceId,
      projectId,
      siteId,
      collectionRunId,
      sourceConnectionId,
      CAPTURED_AT,
      contentHash({ snapshotId }),
      {
        collectionScope: { marketCode: "US", languageTag: "en-US" },
        timing: {
          dataAsOf: options.providerDataAsOf ?? null,
          freshness: "unknown",
        },
      },
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.normalized_observations (
       id, workspace_id, project_id, snapshot_id, provider,
       metric_key, subject_type, subject_ref, observed_at,
       availability, value_json, origin, grade, support, limitation
     ) VALUES (
       $1,$2,$3,$4,'dataforseo','csv.keyword_gap.v1',
       'keyword_cluster','customer-onboarding',$5,'available',$6,
       'vendor_observation','B','context','Provider timestamp unavailable.'
     )`,
    [
      observationId,
      workspaceId,
      projectId,
      snapshotId,
      CAPTURED_AT,
      {
        keyword: "customer onboarding software",
        clusterKey: "customer-onboarding",
        searchVolume: 2400,
        currentUrl: `${origin}/customer-onboarding/`,
        currentRank: 12.8,
        competitorDomain: null,
        competitorRank: null,
        marketCode: "US",
        languageCode: "en",
      },
    ],
  );
  const normalizedUrl = `${origin}/customer-onboarding/`;
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
      normalizedUrl,
      normalizedUrlHash(normalizedUrl),
    ],
  );
  return {
    workspaceId,
    projectId,
    actorId,
    siteId,
    snapshotId,
    observationId,
    sitePageId,
  };
}

async function createBareProjectFixture(
  handle: DbHandle,
): Promise<BareProjectFixture> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  await handle.pool.query(
    "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
    [workspaceId, `Manual keyword library ${workspaceId}`],
  );
  await handle.pool.query(
    `INSERT INTO app.client_projects (
       id, workspace_id, client_name, project_name,
       default_delivery_locale, created_by
     ) VALUES ($1,$2,$3,$4,'en-US',$5)`,
    [
      projectId,
      workspaceId,
      `Manual client ${projectId}`,
      `Manual project ${projectId}`,
      actorId,
    ],
  );
  return { workspaceId, projectId };
}

async function addGscTopQueryObservation(
  handle: DbHandle,
  fixture: SourceFixture,
  options: { readonly includeKeywordLibraryContext?: boolean } = {},
): Promise<{ readonly snapshotId: string; readonly observationId: string }> {
  const actorId = randomUUID();
  const sourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  const page = await handle.pool.query<{ normalized_url: string }>(
    "SELECT normalized_url FROM app.site_pages WHERE id = $1",
    [fixture.sitePageId],
  );
  const pageUrl = page.rows[0]!.normalized_url;

  await handle.pool.query(
    `INSERT INTO app.source_connections (
       id, workspace_id, project_id, site_id, provider,
       connection_type, state, external_ref, limitation,
       connected_at, created_by
     ) VALUES (
       $1,$2,$3,$4,'gsc','oauth','connected',
       $5,'Disposable GSC integration fixture.',$6,$7
     )`,
    [
      sourceConnectionId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      pageUrl,
      CAPTURED_AT,
      actorId,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.async_runs (
       id, workspace_id, project_id, kind, status,
       initiated_by, started_at
     ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
    [
      collectionRunId,
      fixture.workspaceId,
      fixture.projectId,
      actorId,
      CAPTURED_AT,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.collection_runs (
       id, workspace_id, project_id, site_id, source_connection_id,
       provider, operation, method_version, parameters_hash
     ) VALUES (
       $1,$2,$3,$4,$5,'gsc','search_analytics',
       'gsc.search_analytics.v1',$6
     )`,
    [
      collectionRunId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      sourceConnectionId,
      contentHash({ collectionRunId }),
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.data_snapshots (
       id, workspace_id, project_id, site_id, collection_run_id,
       source_connection_id, provider, dataset_key, schema_version,
       method_version, captured_at, source_window, availability,
       limitation, row_count, checksum, summary
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'gsc','gsc.page_query_daily.v1',
       '0.3.0','gsc.search_analytics.v1',$7,
       '{"start":"2026-06-24","end":"2026-07-21"}'::jsonb,
       'available','GSC top queries are capped at ten.',1,$8,$9
     )`,
    [
      snapshotId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.siteId,
      collectionRunId,
      sourceConnectionId,
      CAPTURED_AT,
      contentHash({ snapshotId }),
      {
        ...(options.includeKeywordLibraryContext === false
          ? {}
          : {
              keywordLibraryContext: {
                basis: "project_context",
                marketCode: "US",
                languageTag: "en-US",
              },
            }),
        timing: { dataAsOf: null },
      },
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.normalized_observations (
       id, workspace_id, project_id, snapshot_id, site_page_id, provider,
       metric_key, subject_type, subject_ref, observed_at,
       availability, value_json, origin, grade, support, limitation
     ) VALUES (
       $1,$2,$3,$4,$5,'gsc','gsc.page.v1','url',$6,$7,
       'available',$8,'first_party','A','context',
       'GSC top queries are capped at ten.'
     )`,
    [
      observationId,
      fixture.workspaceId,
      fixture.projectId,
      snapshotId,
      fixture.sitePageId,
      pageUrl,
      CAPTURED_AT,
      {
        current28d: { clicks: 20, impressions: 100, position: 8.5 },
        previous28d: { clicks: 10, impressions: 80, position: 10.2 },
        topQueries: [
          {
            query: "customer onboarding",
            clicks: 12,
            impressions: 60,
            position: 7.1,
          },
          {
            query: "onboarding automation",
            clicks: 8,
            impressions: 40,
            position: 10.6,
          },
        ],
      },
    ],
  );
  return { snapshotId, observationId };
}

function occurrence(
  fixture: SourceFixture,
  overrides: Partial<
    Extract<CanonicalKeywordOccurrenceInput, { sourceKind: "dataforseo_ranked" }>
  > = {},
): Extract<
  CanonicalKeywordOccurrenceInput,
  { sourceKind: "dataforseo_ranked" }
> {
  return {
    manualEntryId: null,
    dataSnapshotId: fixture.snapshotId,
    normalizedObservationId: fixture.observationId,
    displayKeyword: "Customer Onboarding Software",
    normalizedKeyword: "customer onboarding software",
    market: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    sourceKind: "dataforseo_ranked",
    scopeBasis: "provider_collection_scope",
    sourcePointer: "/valueJson/keyword",
    sourceRef: `observation:${fixture.observationId}#/valueJson/keyword`,
    collectedAt: CAPTURED_AT,
    providerDataAsOf: null,
    ...overrides,
  };
}

async function createConfirmedKeywordTopic(
  handle: DbHandle,
  fixture: SourceFixture,
  label: string,
): Promise<{
  readonly topicNodeId: string;
  readonly topicModelRevision: number;
}> {
  const scope = {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
  };
  const topics = new TopicModelsRepository(handle.db);
  const draft = await topics.beginDraftFromLatestConfirmed(
    scope,
    fixture.actorId,
    {
      expectedLatestConfirmedRevision: 0,
      reason: "Create the reviewed Topic for the Keyword library fixture.",
    },
  );
  const edited = await topics.patchDraft(scope, fixture.actorId, {
    topicModelRevision: draft.topicModelRevision,
    expectedEditRevision: draft.editRevision,
    reason: "Add the canonical Keyword library Topic.",
    intents: [
      {
        kind: "create",
        parentTopicNodeId: null,
        label,
        description: "Confirmed Topic for Keyword governance integration.",
        intentEnvelope: ["Commercial"],
      },
    ],
  });
  const confirmed = await topics.confirmDraft(
    scope,
    fixture.actorId,
    {
      topicModelRevision: edited.topicModelRevision,
      expectedEditRevision: edited.editRevision,
      reason: "Confirm the Topic before reviewing the Keyword.",
    },
  );
  if (confirmed.rootTopicNodeId === null) {
    throw new Error("Keyword library fixture did not produce a Topic root");
  }
  return {
    topicNodeId: confirmed.rootTopicNodeId,
    topicModelRevision: confirmed.topicModelRevision,
  };
}

async function reviewAsNewAsset(
  handle: DbHandle,
  fixture: SourceFixture,
  keywordEntityId: string,
  clusterKey: string,
): Promise<void> {
  const topic = await createConfirmedKeywordTopic(
    handle,
    fixture,
    clusterKey,
  );
  await new KeywordGovernanceRepository(handle.db).reviewKeyword(
    {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    },
    keywordEntityId,
    fixture.actorId,
    {
      expectedGovernanceRevision: 0,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: topic.topicNodeId,
      topicModelRevision: topic.topicModelRevision,
      mappingDecision: "new_asset",
      mappedSitePageId: null,
      reason: "Approve the Keyword as a governed new content asset.",
    },
  );
}

describeDb("keyword library database foundation", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(requireSafeTestDatabaseUrl(DATABASE_URL));
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("batches duplicate/retry-safe keyword writes and rolls back a corrupted lineage atomically", async () => {
    const fixture = await createSourceFixture(handle);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    let executeCount = 0;
    const executor = {
      execute(query: unknown) {
        executeCount += 1;
        return handle.db.execute(query as never);
      },
    };
    const repository = new KeywordOccurrencesRepository(
      executor as never,
    ) as unknown as {
      upsertManyIntoLibrary(
        selectedScope: typeof scope,
        selectedInputs: readonly CanonicalKeywordOccurrenceInput[],
      ): Promise<readonly { occurrenceId: string; entityId: string }[]>;
    };

    await expect(repository.upsertManyIntoLibrary(scope, [])).resolves.toEqual(
      [],
    );
    expect(executeCount).toBe(0);

    const canonical = occurrence(fixture);
    const missingObservationId = randomUUID();
    await expect(
      repository.upsertManyIntoLibrary(scope, [
        canonical,
        occurrence(fixture, {
          normalizedObservationId: missingObservationId,
          sourceRef: `observation:${missingObservationId}#/valueJson/keyword`,
        }),
      ]),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    expect(executeCount).toBe(1);
    const rolledBack = await handle.pool.query<{ count: string }>(
      "SELECT count(*) FROM app.keyword_occurrences WHERE project_id = $1",
      [fixture.projectId],
    );
    expect(rolledBack.rows[0]?.count).toBe("0");

    executeCount = 0;
    const first = await repository.upsertManyIntoLibrary(scope, [
      canonical,
      canonical,
    ]);
    expect(executeCount).toBe(1);
    expect(first).toHaveLength(2);
    expect(first[0]).toEqual(first[1]);
    executeCount = 0;
    await expect(
      repository.upsertManyIntoLibrary(scope, [canonical, canonical]),
    ).resolves.toEqual(first);
    expect(executeCount).toBe(1);

    await expect(
      repository.upsertManyIntoLibrary(
        { ...scope, projectId: randomUUID() },
        [canonical],
      ),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    const counts = await handle.pool.query<{
      occurrences: string;
      memberships: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.keyword_occurrences WHERE project_id = $1) AS occurrences,
         (SELECT count(*) FROM app.keyword_entity_sources WHERE project_id = $1) AS memberships`,
      [fixture.projectId],
    );
    expect(counts.rows[0]).toEqual({ occurrences: "1", memberships: "1" });
  });

  it("concurrently and idempotently creates one occurrence, stable entity and membership", async () => {
    const fixture = await createSourceFixture(handle);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const repo = new KeywordOccurrencesRepository(handle.db);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        repo.upsertIntoLibrary(scope, occurrence(fixture)),
      ),
    );
    expect(new Set(results.map((result) => result.occurrenceId)).size).toBe(1);
    expect(new Set(results.map((result) => result.entityId)).size).toBe(1);

    const counts = await handle.pool.query<{
      occurrences: string;
      entities: string;
      memberships: string;
      decisions: string;
      provider_data_as_of: string | null;
    }>(
      `SELECT
         (SELECT count(*) FROM app.keyword_occurrences
           WHERE project_id = $1) AS occurrences,
         (SELECT count(*) FROM app.keyword_entities
           WHERE project_id = $1) AS entities,
         (SELECT count(*) FROM app.keyword_entity_sources
           WHERE project_id = $1) AS memberships,
         (SELECT count(*) FROM app.keyword_review_decisions
           WHERE project_id = $1) AS decisions,
         (SELECT provider_data_as_of::text FROM app.keyword_occurrences
           WHERE project_id = $1 LIMIT 1) AS provider_data_as_of`,
      [fixture.projectId],
    );
    expect(counts.rows).toEqual([
      {
        occurrences: "1",
        entities: "1",
        memberships: "1",
        decisions: "1",
        provider_data_as_of: null,
      },
    ]);

    const current = await new KeywordGovernanceRepository(
      handle.db,
    ).findCurrent(scope, results[0]!.entityId);
    expect(current).toMatchObject({
      decision: {
        governanceRevision: 0,
        decisionOrigin: "system_suggestion",
        status: "candidate",
        intent: null,
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: null,
        decidedBy: null,
      },
      clusterKey: null,
      reviewedProjection: {
        governanceRevision: 0,
        status: "candidate",
        intent: null,
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        clusterKey: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: null,
        earlierHistoryAvailable: false,
      },
    });

    const columns = await handle.pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'app'
          AND table_name = 'keyword_occurrences'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toEqual(
      expect.arrayContaining([
        "volume",
        "search_volume",
        "rank",
        "current_rank",
        "current_url",
        "competitor_rank",
        "keyword_difficulty",
      ]),
    );
  });

  it("keeps Topic invalidation decisions monotonic when the governed Keyword instant is ahead of every host clock", async () => {
    const fixture = await createSourceFixture(handle, {
      projectName: "Future Keyword invalidation",
    });
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const topic = await createConfirmedKeywordTopic(
      handle,
      fixture,
      "customer-onboarding",
    );
    const keywordId = randomUUID();
    const futureGovernedInstant = "2999-07-28T08:00:00.000Z";
    await handle.pool.query(
      `INSERT INTO app.keyword_entities (
         id, workspace_id, project_id, display_keyword, normalized_keyword,
         market, language_tag, query_kind, first_seen_at, last_seen_at,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,'Future Topic Assignment','future topic assignment',
         'US','en-US','search_query',$4,$4,$5,$5
       )`,
      [
        keywordId,
        fixture.workspaceId,
        fixture.projectId,
        CAPTURED_AT,
        futureGovernedInstant,
      ],
    );

    const reviewed = await new KeywordGovernanceRepository(
      handle.db,
    ).reviewKeyword(scope, keywordId, fixture.actorId, {
      expectedGovernanceRevision: 0,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: topic.topicNodeId,
      topicModelRevision: topic.topicModelRevision,
      mappingDecision: "new_asset",
      mappedSitePageId: null,
      reason: "Govern the future-dated Keyword before a Topic split.",
    });
    expect(reviewed).toMatchObject({
      replayed: false,
      decision: { governanceRevision: 1 },
      projection: { governanceRevision: 1 },
    });

    const topics = new TopicModelsRepository(handle.db);
    const draft = await topics.beginDraftFromLatestConfirmed(
      scope,
      fixture.actorId,
      {
        expectedLatestConfirmedRevision: topic.topicModelRevision,
        reason: "Split the future-dated governed Keyword Topic.",
      },
    );
    const split = await topics.patchDraft(scope, fixture.actorId, {
      topicModelRevision: draft.topicModelRevision,
      expectedEditRevision: draft.editRevision,
      reason: "Create two executable successor Topics.",
      intents: [
        {
          kind: "split",
          sourceTopicNodeId: topic.topicNodeId,
          affectedKeywordReviewState: "unreviewed",
          successors: [
            {
              parentTopicNodeId: null,
              label: "Onboarding automation",
              description: "Automation-led onboarding demand.",
              intentEnvelope: ["commercial"],
            },
            {
              parentTopicNodeId: null,
              label: "Onboarding operations",
              description: "Operational onboarding demand.",
              intentEnvelope: ["informational"],
            },
          ],
        },
      ],
    });
    await expect(
      topics.confirmDraft(scope, fixture.actorId, {
        topicModelRevision: split.topicModelRevision,
        expectedEditRevision: split.editRevision,
        reason: "Confirm the split and invalidate the old assignment.",
      }),
    ).resolves.toMatchObject({
      state: "confirmed",
      topicModelRevision: split.topicModelRevision,
    });

    const decisions = await handle.pool.query<{
      governance_revision: number;
      decision_origin: string;
      assignment_invalidated_by: string | null;
      decision_decided_at: string;
      advances: boolean | null;
    }>(
      `SELECT
         governance_revision,
         decision_origin,
         assignment_invalidated_by,
         decided_at::text AS decision_decided_at,
         decided_at > lag(decided_at) OVER (
           ORDER BY governance_revision
         ) AS advances
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3
       ORDER BY governance_revision`,
      [fixture.workspaceId, fixture.projectId, keywordId],
    );
    expect(decisions.rows.map((row) => ({
      governanceRevision: row.governance_revision,
      decisionOrigin: row.decision_origin,
      assignmentInvalidatedBy: row.assignment_invalidated_by,
      advances: row.advances,
    }))).toEqual([
      {
        governanceRevision: 0,
        decisionOrigin: "system_suggestion",
        assignmentInvalidatedBy: null,
        advances: null,
      },
      {
        governanceRevision: 1,
        decisionOrigin: "user",
        assignmentInvalidatedBy: null,
        advances: true,
      },
      {
        governanceRevision: 2,
        decisionOrigin: "system_suggestion",
        assignmentInvalidatedBy: "topic_split",
        advances: true,
      },
    ]);

    const entity = await handle.pool.query<{
      mapping_revision: number;
      mapping_review_state: string;
      entity_updated_at: string;
    }>(
      `SELECT
         mapping_revision,
         mapping_review_state,
         updated_at::text AS entity_updated_at
       FROM app.keyword_entities
       WHERE workspace_id = $1
         AND project_id = $2
         AND id = $3`,
      [fixture.workspaceId, fixture.projectId, keywordId],
    );
    expect(entity.rows).toHaveLength(1);
    expect(entity.rows[0]).toMatchObject({
      mapping_revision: 2,
      mapping_review_state: "unreviewed",
    });
    expect(entity.rows[0]?.entity_updated_at).toBe(
      decisions.rows[2]?.decision_decided_at,
    );
  });

  it("keeps cluster outside stable identity and retains every source occurrence", async () => {
    const fixture = await createSourceFixture(handle);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const occurrences = new KeywordOccurrencesRepository(handle.db);
    const keywords = new KeywordsRepository(handle.db);
    const first = await occurrences.upsertIntoLibrary(scope, occurrence(fixture));
    await reviewAsNewAsset(
      handle,
      fixture,
      first.entityId,
      "customer-onboarding",
    );
    const mapped = await keywords.findById(scope, first.entityId);
    expect(mapped).toMatchObject({
      cluster_key: "customer-onboarding",
      mapping_decision: "new_asset",
      mapped_site_page_id: null,
      mapping_revision: 1,
    });

    const secondObservationId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.normalized_observations (
         id, workspace_id, project_id, snapshot_id, provider,
         metric_key, subject_type, subject_ref, observed_at,
         availability, value_json, origin, grade, support, limitation
       ) VALUES (
         $1,$2,$3,$4,'dataforseo','csv.keyword_gap.v1',
         'keyword_cluster','alternate-cluster',$5,'available',$6,
         'vendor_observation','B','context','Second source observation.'
       )`,
      [
        secondObservationId,
        fixture.workspaceId,
        fixture.projectId,
        fixture.snapshotId,
        CAPTURED_AT,
        {
          keyword: "customer onboarding software",
          clusterKey: "alternate-cluster",
          searchVolume: null,
          currentUrl: null,
          currentRank: null,
          competitorDomain: null,
          competitorRank: null,
          marketCode: "US",
          languageCode: "en",
        },
      ],
    );
    const second = await occurrences.upsertIntoLibrary(
      scope,
      occurrence(fixture, {
        normalizedObservationId: secondObservationId,
        sourceRef: `observation:${secondObservationId}#/valueJson/keyword`,
      }),
    );
    expect(second.entityId).toBe(first.entityId);
    expect(second.occurrenceId).not.toBe(first.occurrenceId);
    await expect(keywords.findById(scope, first.entityId)).resolves.toMatchObject({
      cluster_key: "customer-onboarding",
      mapping_revision: 1,
    });
    const page = await occurrences.listForEntity(scope, first.entityId, {
      limit: 1,
      cursor: null,
    });
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
  });

  it("supports multiple strict top-query pointers from one canonical GSC Observation", async () => {
    const fixture = await createSourceFixture(handle);
    const gsc = await addGscTopQueryObservation(handle, fixture);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const repo = new KeywordOccurrencesRepository(handle.db);
    const common = {
      manualEntryId: null,
      dataSnapshotId: gsc.snapshotId,
      normalizedObservationId: gsc.observationId,
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query" as const,
      sourceKind: "gsc_top_query" as const,
      scopeBasis: "project_context" as const,
      collectedAt: CAPTURED_AT,
      providerDataAsOf: null,
    };

    const first = await repo.upsertIntoLibrary(scope, {
      ...common,
      displayKeyword: "Customer Onboarding",
      normalizedKeyword: "customer onboarding",
      sourcePointer: "/valueJson/topQueries/0/query",
      sourceRef: `observation:${gsc.observationId}#/valueJson/topQueries/0/query`,
    });
    const second = await repo.upsertIntoLibrary(scope, {
      ...common,
      displayKeyword: "Onboarding Automation",
      normalizedKeyword: "onboarding automation",
      sourcePointer: "/valueJson/topQueries/1/query",
      sourceRef: `observation:${gsc.observationId}#/valueJson/topQueries/1/query`,
    });
    const replay = await repo.upsertIntoLibrary(scope, {
      ...common,
      displayKeyword: "Customer Onboarding",
      normalizedKeyword: "customer onboarding",
      sourcePointer: "/valueJson/topQueries/0/query",
      sourceRef: `observation:${gsc.observationId}#/valueJson/topQueries/0/query`,
    });

    expect(first.occurrenceId).not.toBe(second.occurrenceId);
    expect(first.entityId).not.toBe(second.entityId);
    expect(replay).toEqual(first);
    const count = await handle.pool.query<{ count: string }>(
      `SELECT count(*) FROM app.keyword_occurrences
        WHERE normalized_observation_id = $1`,
      [gsc.observationId],
    );
    expect(count.rows).toEqual([{ count: "2" }]);
  });

  it("fails closed when a GSC snapshot has no explicit immutable project-context scope", async () => {
    const fixture = await createSourceFixture(handle);
    const gsc = await addGscTopQueryObservation(handle, fixture, {
      includeKeywordLibraryContext: false,
    });
    const repo = new KeywordOccurrencesRepository(handle.db);

    await expectPgCode(
      repo.upsertIntoLibrary(
        {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
        },
        {
          manualEntryId: null,
          dataSnapshotId: gsc.snapshotId,
          normalizedObservationId: gsc.observationId,
          displayKeyword: "Customer Onboarding",
          normalizedKeyword: "customer onboarding",
          market: "US",
          languageTag: "en-US",
          queryKind: "search_query",
          sourceKind: "gsc_top_query",
          scopeBasis: "project_context",
          sourcePointer: "/valueJson/topQueries/0/query",
          sourceRef: `observation:${gsc.observationId}#/valueJson/topQueries/0/query`,
          collectedAt: CAPTURED_AT,
          providerDataAsOf: null,
        },
      ),
      "23514",
    );
  });

  it("stores manual input as its own append-only occurrence without fabricated provider lineage", async () => {
    const fixture = await createBareProjectFixture(handle);
    const manualEntryId = randomUUID();
    const repo = new KeywordOccurrencesRepository(handle.db);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const input: ManualKeywordOccurrenceInput = {
      manualEntryId,
      dataSnapshotId: null,
      normalizedObservationId: null,
      displayKeyword: "Customer onboarding platform",
      normalizedKeyword: "customer onboarding platform",
      market: "US",
      languageTag: "en-US",
      queryKind: "generative_query",
      sourceKind: "manual",
      scopeBasis: "manual",
      sourcePointer: null,
      sourceRef: `manual:${manualEntryId}`,
      collectedAt: CAPTURED_AT,
      providerDataAsOf: null,
    };

    const created = await repo.upsertIntoLibrary(scope, input);
    const replay = await repo.upsertIntoLibrary(scope, input);
    expect(created.occurrenceId).toBe(manualEntryId);
    expect(replay).toEqual(created);
    await expectPgCode(
      repo.upsertIntoLibrary(scope, {
        ...input,
        collectedAt: "2026-07-22T08:00:01.000Z",
      }),
      "23514",
    );

    const stored = await handle.pool.query<{
      id: string;
      data_snapshot_id: string | null;
      normalized_observation_id: string | null;
      source_pointer: string | null;
      source_ref: string;
      scope_basis: string;
    }>(
      `SELECT id, data_snapshot_id, normalized_observation_id,
              source_pointer, source_ref, scope_basis
         FROM app.keyword_occurrences
        WHERE id = $1`,
      [manualEntryId],
    );
    expect(stored.rows).toEqual([
      {
        id: manualEntryId,
        data_snapshot_id: null,
        normalized_observation_id: null,
        source_pointer: null,
        source_ref: `manual:${manualEntryId}`,
        scope_basis: "manual",
      },
    ]);
    const decisionCount = await handle.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.keyword_review_decisions
       WHERE keyword_entity_id = $1`,
      [created.entityId],
    );
    expect(decisionCount.rows).toEqual([{ count: "1" }]);

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_occurrences (
           workspace_id, project_id, data_snapshot_id,
           normalized_observation_id, display_keyword, normalized_keyword,
           market, language_tag, query_kind, source_kind, scope_basis,
           source_pointer, source_ref, collected_at, provider_data_as_of
         ) VALUES (
           $1,$2,null,null,'CSV without lineage','csv without lineage',
           'US','en-US','search_query','csv_import','user_provided',
           null,'observation:missing#/valueJson/keyword',$3,null
         )`,
        [fixture.workspaceId, fixture.projectId, CAPTURED_AT],
      ),
      "23514",
    );
  });

  it("enforces append-only occurrences and immutable stable identity in the database", async () => {
    const fixture = await createSourceFixture(handle);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const created = await new KeywordOccurrencesRepository(
      handle.db,
    ).upsertIntoLibrary(scope, occurrence(fixture));

    await expectPgCode(
      handle.pool.query(
        "UPDATE app.keyword_occurrences SET display_keyword = 'changed' WHERE id = $1",
        [created.occurrenceId],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "DELETE FROM app.keyword_occurrences WHERE id = $1",
        [created.occurrenceId],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.keyword_entities SET normalized_keyword = 'changed' WHERE id = $1",
        [created.entityId],
      ),
      "23514",
    );
    await expectPgCode(
      handle.pool.query(
        "DELETE FROM app.keyword_entities WHERE id = $1",
        [created.entityId],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.keyword_entities SET cluster_key = 'bypass' WHERE id = $1",
        [created.entityId],
      ),
      "23514",
    );
  });

  it("does not disguise a nonzero entity with a missing ledger as an initial ingestion decision", async () => {
    const fixture = await createSourceFixture(handle);
    const corruptEntityId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.keyword_entities (
         id, workspace_id, project_id, display_keyword, normalized_keyword,
         market, language_tag, query_kind, mapping_revision,
         first_seen_at, last_seen_at
       ) VALUES ($1,$2,$3,$4,$5,'US','en-US','search_query',3,$6,$6)`,
      [
        corruptEntityId,
        fixture.workspaceId,
        fixture.projectId,
        "Customer Onboarding Software",
        "customer onboarding software",
        CAPTURED_AT,
      ],
    );

    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    await expect(
      new KeywordOccurrencesRepository(handle.db).upsertIntoLibrary(
        scope,
        occurrence(fixture),
      ),
    ).resolves.toMatchObject({ entityId: corruptEntityId });

    const decisions = await handle.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3`,
      [fixture.workspaceId, fixture.projectId, corruptEntityId],
    );
    expect(decisions.rows).toEqual([{ count: "0" }]);
    await expect(
      new KeywordGovernanceRepository(handle.db).findCurrent(
        scope,
        corruptEntityId,
      ),
    ).rejects.toMatchObject(
      new KeywordGovernanceIntegrityError("CURRENT_DECISION_MISSING"),
    );
  });

  it("fails closed for cross-project provenance, mapping and archived projects", async () => {
    const local = await createSourceFixture(handle);
    const foreign = await createSourceFixture(handle, {
      workspaceId: local.workspaceId,
      projectName: "Foreign project",
    });
    const localScope = {
      workspaceId: local.workspaceId,
      projectId: local.projectId,
    };
    const occurrences = new KeywordOccurrencesRepository(handle.db);
    const keywords = new KeywordsRepository(handle.db);

    await expectPgCode(
      occurrences.upsertIntoLibrary(
        localScope,
        occurrence(local, {
          dataSnapshotId: foreign.snapshotId,
          normalizedObservationId: foreign.observationId,
          sourceRef: `observation:${foreign.observationId}#/valueJson/keyword`,
        }),
      ),
      "23514",
    );

    const created = await occurrences.upsertIntoLibrary(
      localScope,
      occurrence(local),
    );
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_entity_sources (
           workspace_id, project_id, keyword_entity_id, keyword_occurrence_id
         ) VALUES ($1,$2,$3,$4)`,
        [
          local.workspaceId,
          foreign.projectId,
          created.entityId,
          created.occurrenceId,
        ],
      ),
      "23514",
    );
    const topic = await createConfirmedKeywordTopic(
      handle,
      local,
      "customer-onboarding",
    );
    await expect(
      new KeywordGovernanceRepository(handle.db).reviewKeyword(
        localScope,
        created.entityId,
        local.actorId,
        {
          expectedGovernanceRevision: 0,
          status: "approved",
          intent: null,
          buyerStage: null,
          topicNodeId: topic.topicNodeId,
          topicModelRevision: topic.topicModelRevision,
          mappingDecision: "existing_page",
          mappedSitePageId: foreign.sitePageId,
          reason: "Attempt a governed mapping to a foreign project page.",
        },
      ),
    ).rejects.toMatchObject({
      code: "SITE_PAGE_NOT_FOUND",
    });

    await expect(
      keywords.reviewAndMap(localScope, created.entityId, {
        expectedRevision: 0,
        status: "approved",
        intent: null,
        buyerStage: null,
        clusterKey: null,
        mappingDecision: "existing_page",
        mappedSitePageId: foreign.sitePageId,
        mappingReviewState: "confirmed",
      }),
    ).rejects.toEqual(expect.any(LegacyKeywordReviewDisabledError));

    await handle.pool.query(
      "UPDATE app.client_projects SET archived_at = now() WHERE id = $1",
      [local.projectId],
    );
    await expect(
      keywords.findById(localScope, created.entityId),
    ).resolves.toBeNull();
    await expect(
      keywords.listByProject(localScope, { limit: 20, cursor: null }),
    ).resolves.toEqual({ rows: [], nextCursor: null });
    await expectPgCode(
      occurrences.upsertIntoLibrary(
        localScope,
        occurrence(local),
      ),
      "23514",
    );
  });

  it("requires a full language tag and never turns new_asset into a SitePage", async () => {
    const fixture = await createSourceFixture(handle);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const occurrences = new KeywordOccurrencesRepository(handle.db);
    const keywords = new KeywordsRepository(handle.db);
    const before = await handle.pool.query<{ count: string }>(
      "SELECT count(*) FROM app.site_pages WHERE project_id = $1",
      [fixture.projectId],
    );
    const created = await occurrences.upsertIntoLibrary(
      scope,
      occurrence(fixture),
    );
    await reviewAsNewAsset(
      handle,
      fixture,
      created.entityId,
      "customer-onboarding",
    );
    await expect(
      keywords.findById(scope, created.entityId),
    ).resolves.toMatchObject({
      mapping_decision: "new_asset",
      mapped_site_page_id: null,
    });
    const after = await handle.pool.query<{ count: string }>(
      "SELECT count(*) FROM app.site_pages WHERE project_id = $1",
      [fixture.projectId],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_occurrences (
           workspace_id, project_id, data_snapshot_id,
           normalized_observation_id, display_keyword, normalized_keyword,
           market, language_tag, query_kind, source_kind, scope_basis, source_pointer,
           source_ref,
           collected_at, provider_data_as_of
         ) VALUES (
           $1,$2,$3,$4,'bad language','bad language',
           'US','en_US','search_query','dataforseo_ranked',
           'provider_collection_scope','/valueJson/keyword','invalid-language',$5,null
         )`,
        [
          fixture.workspaceId,
          fixture.projectId,
          fixture.snapshotId,
          fixture.observationId,
          CAPTURED_AT,
        ],
      ),
      "23514",
    );
  });

  it("rejects an invented provider data timestamp absent from canonical provenance", async () => {
    const fixture = await createSourceFixture(handle);
    await expectPgCode(
      new KeywordOccurrencesRepository(handle.db).upsertIntoLibrary(
        {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
        },
        occurrence(fixture, {
          providerDataAsOf: "2026-07-20T00:00:00.000Z",
        }),
      ),
      "23514",
    );
  });

  it("requires a real canonical provider timestamp to be copied exactly rather than omitted", async () => {
    const providerDataAsOf = "2026-07-20T00:00:00.000Z";
    const fixture = await createSourceFixture(handle, { providerDataAsOf });
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const repo = new KeywordOccurrencesRepository(handle.db);

    await expectPgCode(
      repo.upsertIntoLibrary(scope, occurrence(fixture)),
      "23514",
    );
    await expect(
      repo.upsertIntoLibrary(
        scope,
        occurrence(fixture, { providerDataAsOf }),
      ),
    ).resolves.toEqual({
      occurrenceId: expect.any(String),
      entityId: expect.any(String),
    });
  });
});
