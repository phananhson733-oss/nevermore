import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  contentHash,
  KeywordGovernanceRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  normalizedUrlHash,
  type CanonicalKeywordOccurrenceInput,
} from "@sf/db";
import { runAutoKeywordGovernance } from "../auto-keyword-governance.ts";

// The integration project already refuses any unsafe database in its global
// setup before this file can open a pool.
const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const CAPTURED_AT = "2026-08-07T08:00:00.000Z";

interface Fixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly siteId: string;
  readonly snapshotId: string;
  readonly gscSnapshotId: string;
  readonly dataForSeoObservationId: string;
  readonly gscObservationId: string;
  readonly sitePageId: string;
  readonly origin: string;
}

/**
 * One disposable project carrying exactly the immutable lineage automated
 * governance is allowed to reason about: a ranked DataForSEO Observation and a
 * page-attributed Search Console Observation.
 */
async function createFixture(handle: DbHandle): Promise<Fixture> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const siteId = randomUUID();
  const sourceConnectionId = randomUUID();
  const gscSourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const gscCollectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const gscSnapshotId = randomUUID();
  const dataForSeoObservationId = randomUUID();
  const gscObservationId = randomUUID();
  const sitePageId = randomUUID();
  const host = `${projectId}.auto-governance.example`;
  const origin = `https://${host}`;
  const normalizedUrl = `${origin}/customer-onboarding/`;

  await handle.pool.query(
    "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
    [workspaceId, `Auto governance ${workspaceId}`],
  );
  await handle.pool.query(
    `INSERT INTO app.client_projects (
       id, workspace_id, client_name, project_name,
       default_delivery_locale, created_by
     ) VALUES ($1,$2,$3,$4,'en-US',$5)`,
    [projectId, workspaceId, `Client ${projectId}`, `Project ${projectId}`, actorId],
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
    [sourceConnectionId, workspaceId, projectId, siteId, host, CAPTURED_AT, actorId],
  );
  await handle.pool.query(
    `INSERT INTO app.source_connections (
       id, workspace_id, project_id, site_id, provider,
       connection_type, state, external_ref, limitation,
       connected_at, created_by
     ) VALUES (
       $1,$2,$3,$4,'gsc','oauth','available',
       $5,'Disposable Search Console integration fixture.',$6,$7
     )`,
    [gscSourceConnectionId, workspaceId, projectId, siteId, host, CAPTURED_AT, actorId],
  );
  await handle.pool.query(
    `INSERT INTO app.async_runs (
       id, workspace_id, project_id, kind, status, initiated_by, started_at
     ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
    [collectionRunId, workspaceId, projectId, actorId, CAPTURED_AT],
  );
  await handle.pool.query(
    `INSERT INTO app.async_runs (
       id, workspace_id, project_id, kind, status, initiated_by, started_at
     ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
    [gscCollectionRunId, workspaceId, projectId, actorId, CAPTURED_AT],
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
    `INSERT INTO app.collection_runs (
       id, workspace_id, project_id, site_id, source_connection_id,
       provider, operation, method_version, parameters_hash
     ) VALUES (
       $1,$2,$3,$4,$5,'gsc','search_analytics','fixture.gsc.v1',$6
     )`,
    [
      gscCollectionRunId,
      workspaceId,
      projectId,
      siteId,
      gscSourceConnectionId,
      contentHash({ gscCollectionRunId }),
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
       'Provider data timestamp may be unavailable.',2,$8,$9
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
        timing: { dataAsOf: null, freshness: "unknown" },
      },
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.data_snapshots (
       id, workspace_id, project_id, site_id, collection_run_id,
       source_connection_id, provider, dataset_key, schema_version,
       method_version, captured_at, source_window, availability,
       limitation, row_count, checksum, summary
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'gsc','gsc.page_query_daily.v1','1',
       'fixture.gsc.v1',$7,'{"start":"2026-07-10","end":"2026-08-06"}'::jsonb,
       'available','Search Console 28 day window.',1,$8,$9
     )`,
    [
      gscSnapshotId,
      workspaceId,
      projectId,
      siteId,
      gscCollectionRunId,
      gscSourceConnectionId,
      CAPTURED_AT,
      contentHash({ gscSnapshotId }),
      {
        property: { siteUrl: `sc-domain:${host}` },
        keywordLibraryContext: {
          basis: "project_context",
          marketCode: "US",
          languageTag: "en-US",
        },
      },
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.site_pages (
       id, workspace_id, project_id, site_id, normalized_url, normalized_url_hash
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
  await handle.pool.query(
    `INSERT INTO app.normalized_observations (
       id, workspace_id, project_id, snapshot_id, provider,
       metric_key, subject_type, subject_ref, observed_at,
       availability, value_json, origin, grade, support, limitation
     ) VALUES (
       $1,$2,$3,$4,'dataforseo','csv.keyword_gap.v1',
       'keyword_cluster','customer onboarding',$5,'available',$6,
       'vendor_observation','B','context','Provider timestamp unavailable.'
     )`,
    [
      dataForSeoObservationId,
      workspaceId,
      projectId,
      snapshotId,
      CAPTURED_AT,
      {
        keyword: "Customer Onboarding Software",
        clusterKey: "customer onboarding",
        searchVolume: 2400,
        currentUrl: normalizedUrl,
        currentRank: 12,
        competitorDomain: null,
        competitorRank: null,
        marketCode: "US",
        languageCode: "en",
      },
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.normalized_observations (
       id, workspace_id, project_id, snapshot_id, site_page_id, provider,
       metric_key, subject_type, subject_ref, observed_at,
       availability, value_json, origin, grade, support, limitation
     ) VALUES (
       $1,$2,$3,$4,$5,'gsc','gsc.page.v1','url',$6,$7,'available',$8,
       'first_party','A','supports','Search Console 28 day window.'
     )`,
    [
      gscObservationId,
      workspaceId,
      projectId,
      gscSnapshotId,
      sitePageId,
      normalizedUrl,
      CAPTURED_AT,
      {
        current28d: { clicks: 4, impressions: 900, position: 12.4 },
        previous28d: { clicks: 2, impressions: 700, position: 14.1 },
        topQueries: [
          { query: "onboarding checklist", clicks: 4, impressions: 900, position: 12.4 },
          // A zero-impression row is a real Search Console fact and must never
          // count as evidence.
          { query: "onboarding checklist template", clicks: 0, impressions: 0, position: null },
        ],
      },
    ],
  );

  return {
    workspaceId,
    projectId,
    actorId,
    siteId,
    snapshotId,
    gscSnapshotId,
    dataForSeoObservationId,
    gscObservationId,
    sitePageId,
    origin,
  };
}

function dataForSeoOccurrence(
  fixture: Fixture,
): CanonicalKeywordOccurrenceInput {
  return {
    manualEntryId: null,
    dataSnapshotId: fixture.snapshotId,
    normalizedObservationId: fixture.dataForSeoObservationId,
    displayKeyword: "Customer Onboarding Software",
    normalizedKeyword: "customer onboarding software",
    market: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    sourceKind: "dataforseo_ranked",
    scopeBasis: "provider_collection_scope",
    sourcePointer: "/valueJson/keyword",
    sourceRef: `observation:${fixture.dataForSeoObservationId}#/valueJson/keyword`,
    collectedAt: CAPTURED_AT,
    providerDataAsOf: null,
  } as CanonicalKeywordOccurrenceInput;
}

function gscOccurrence(
  fixture: Fixture,
  index: 0 | 1,
): CanonicalKeywordOccurrenceInput {
  const pointer = `/valueJson/topQueries/${index}/query`;
  return {
    manualEntryId: null,
    dataSnapshotId: fixture.gscSnapshotId,
    normalizedObservationId: fixture.gscObservationId,
    displayKeyword:
      index === 0 ? "onboarding checklist" : "onboarding checklist template",
    normalizedKeyword:
      index === 0 ? "onboarding checklist" : "onboarding checklist template",
    market: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    sourceKind: "gsc_top_query",
    scopeBasis: "project_context",
    sourcePointer: pointer,
    sourceRef: `observation:${fixture.gscObservationId}#${pointer}`,
    collectedAt: CAPTURED_AT,
    providerDataAsOf: null,
  } as CanonicalKeywordOccurrenceInput;
}

describeDb("automated keyword governance against a real PostgreSQL", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("makes an ingested candidate library diagnostic-eligible, idempotently", async () => {
    const fixture = await createFixture(handle);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const occurrences = new KeywordOccurrencesRepository(handle.db);
    const dfs = await occurrences.upsertIntoLibrary(
      scope,
      dataForSeoOccurrence(fixture),
    );
    const gscRanked = await occurrences.upsertIntoLibrary(
      scope,
      gscOccurrence(fixture, 0),
    );
    const gscZero = await occurrences.upsertIntoLibrary(
      scope,
      gscOccurrence(fixture, 1),
    );
    const keywords = new KeywordsRepository(handle.db);

    // Before governance the ingested library is completely invisible to the
    // diagnostic freeze. This is the production symptom being fixed.
    await expect(
      keywords.listDiagnosticEligible(scope, { limit: 100 }),
    ).resolves.toEqual([]);

    const candidates = await keywords.listAutoGovernanceCandidates(scope, {
      limit: 100,
    });
    // The zero-impression Search Console keyword proves nothing was served, so
    // it is not even returned as a candidate.
    expect(candidates.map((row) => row.id)).not.toContain(gscZero.entityId);
    expect(
      candidates.map((row) => ({
        id: row.id,
        dfs: row.dataforseo_ranked_evidence,
        gsc: row.gsc_impression_evidence,
        pages: row.gsc_attributed_site_page_count,
      })),
    ).toEqual(
      expect.arrayContaining([
        { id: dfs.entityId, dfs: 1, gsc: 0, pages: 0 },
        { id: gscRanked.entityId, dfs: 0, gsc: 1, pages: 1 },
      ]),
    );
    expect(candidates).toHaveLength(2);

    const first = await runAutoKeywordGovernance(
      handle.db as never,
      scope,
      { enabled: true },
    );
    expect(first).toMatchObject({
      enabled: true,
      considered: 2,
      proposed: 2,
      approved: 2,
      rejected: { insufficient_evidence: 0, no_cluster_key: 0 },
    });

    // The core assertion: the freeze now sees exactly the auto-governed rows.
    const eligible = await keywords.listDiagnosticEligible(scope, {
      limit: 100,
    });
    expect(eligible.map((row) => row.id).sort()).toEqual(
      [dfs.entityId, gscRanked.entityId].sort(),
    );
    expect(
      eligible.map((row) => ({
        id: row.id,
        status: row.status,
        review: row.mapping_review_state,
        cluster: row.cluster_key,
        mapping: row.mapping_decision,
        page: row.mapped_site_page_id,
        revision: row.mapping_revision,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          id: dfs.entityId,
          status: "approved",
          review: "confirmed",
          cluster: "customer onboarding",
          // DataForSEO keyword lineage carries no proven page attribution.
          mapping: "unassigned",
          page: null,
          revision: 1,
        },
        {
          id: gscRanked.entityId,
          status: "approved",
          review: "confirmed",
          cluster: "onboarding checklist",
          mapping: "existing_page",
          page: fixture.sitePageId,
          revision: 1,
        },
      ]),
    );

    // Every automated decision is recorded as an actorless system suggestion.
    const decisions = await handle.pool.query<{
      decision_origin: string;
      decided_by: string | null;
      topic_node_id: string | null;
      governance_revision: number;
    }>(
      `SELECT decision_origin, decided_by, topic_node_id, governance_revision
         FROM app.keyword_review_decisions
        WHERE project_id = $1 AND governance_revision = 1
        ORDER BY keyword_entity_id`,
      [fixture.projectId],
    );
    expect(decisions.rows).toHaveLength(2);
    for (const row of decisions.rows) {
      expect(row).toMatchObject({
        decision_origin: "system_suggestion",
        decided_by: null,
        topic_node_id: null,
        governance_revision: 1,
      });
    }

    // Idempotency: a second Analysis Refresh writes nothing new.
    const second = await runAutoKeywordGovernance(
      handle.db as never,
      scope,
      { enabled: true },
    );
    expect(second).toMatchObject({
      considered: 0,
      proposed: 0,
      approved: 0,
      rejected: { insufficient_evidence: 0 },
    });
    const decisionCount = await handle.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.keyword_review_decisions
        WHERE project_id = $1`,
      [fixture.projectId],
    );
    // 3 ingestion baselines at revision 0 plus the 2 automated approvals.
    expect(decisionCount.rows[0]?.count).toBe("5");
    await expect(
      keywords.listDiagnosticEligible(scope, { limit: 100 }),
    ).resolves.toHaveLength(2);
  });

  it("never revisits or overwrites a keyword a human has decided", async () => {
    const fixture = await createFixture(handle);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const occurrences = new KeywordOccurrencesRepository(handle.db);
    const dfs = await occurrences.upsertIntoLibrary(
      scope,
      dataForSeoOccurrence(fixture),
    );
    await new KeywordGovernanceRepository(handle.db).reviewKeyword(
      scope,
      dfs.entityId,
      fixture.actorId,
      {
        expectedGovernanceRevision: 0,
        status: "excluded",
        intent: null,
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "The operator excluded this query from the product scope.",
      },
    );

    const report = await runAutoKeywordGovernance(
      handle.db as never,
      scope,
      { enabled: true },
    );

    expect(report).toMatchObject({ considered: 0, proposed: 0, approved: 0 });
    const keyword = await new KeywordsRepository(handle.db).findById(
      scope,
      dfs.entityId,
    );
    expect(keyword).toMatchObject({
      status: "excluded",
      cluster_key: null,
      mapping_revision: 1,
    });
  });
});
