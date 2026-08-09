import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import {
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  KeywordOccurrencesRepository,
  ProjectsRepository,
  contentHash,
  createDbHandle,
  normalizeKeywordIdentity,
  type CanonicalValue,
  type DbHandle,
  type DbTx,
} from "@sf/db";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  icpProfiles,
  normalizedObservations,
  sites,
  sourceConnections,
  workspaces,
} from "@sf/db/schema";
import {
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import {
  CRAWL_METHOD_VERSION,
  createDataForSeoSearchLandscapeV2Scope,
} from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDiagnosticFrozenInput } from "./diagnostics.ts";
import {
  getProjectAuditKeyword,
  listProjectAuditKeywords,
} from "./growth-map-keywords.ts";
import { publishDiagnosticGeneration } from "./__tests__/published-growth-map-fixture.ts";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const CAPTURED_AT = "2026-07-22T08:00:00.000Z";

interface KeywordFixture {
  readonly projectId: string;
  readonly keywordId: string;
  readonly occurrenceId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly privateRawObjectKey: string;
  readonly privateTaskId: string;
  readonly privateObservationPayload: string;
}

async function inRolledBackFixture(
  handle: DbHandle,
  test: (tx: DbTx) => Promise<void>,
): Promise<void> {
  const rollback = new Error(`rollback-keyword-fixture-${randomUUID()}`);
  try {
    await handle.db.transaction(async (tx) => {
      await test(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function seedDataForSeoKeyword(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly label: string;
    readonly displayKeyword: string;
  },
): Promise<KeywordFixture> {
  const actorId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const sourceConnectionId = randomUUID();
  const crawlSourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const observationId = randomUUID();
  const normalizedKeyword = normalizeKeywordIdentity(input.displayKeyword);
  const target = `${input.label.toLowerCase()}-${projectId}.example.com`;
  const privateTaskId = `private-task-${randomUUID()}`;
  const privateObservationPayload = `private-observation-${randomUUID()}`;
  const privateRawObjectKey = `private/dataforseo/${randomUUID()}.json`;
  const collectionScope = createDataForSeoSearchLandscapeV2Scope({
    target,
    marketCode: "US",
    languageTag: "en-US",
    locationCode: 2840,
    rankedKeywordsLimit: 200,
    competitorsDomainLimit: 100,
    serpCompetitorsLimit: 100,
    seeds: [],
  });

  await tx.insert(clientProjects).values({
    id: projectId,
    workspace_id: input.workspaceId,
    client_name: `${input.label} client`,
    project_name: `${input.label} project`,
    default_delivery_locale: "en-US",
    created_by: actorId,
  });
  await tx.insert(sites).values({
    id: siteId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    origin: `https://${target}`,
    host: target,
    market_codes: ["US"],
    language_codes: ["en-US"],
    is_primary: true,
  });
  const [icp] = await tx
    .insert(icpProfiles)
    .values({
      workspace_id: input.workspaceId,
      project_id: projectId,
      version: 1,
      status: "complete",
      profile: {
        productName: `${input.label} product`,
        oneLineDescription: `${input.label} keyword research product`,
        productType: "saas",
        businessModels: ["subscription"],
        marketCodes: ["US"],
        segments: ["Growth teams"],
        primaryMarket: "US",
        siteLanguageCodes: ["en-US"],
      },
      content_hash: contentHash({
        projectId,
        profile: `${input.label} keyword integration`,
      }),
      created_by: actorId,
    })
    .returning();
  const projects = new ProjectsRepository(tx);
  if (
    !(await projects.setCurrentIcpProfile(
      { workspaceId: input.workspaceId },
      projectId,
      icp!.id,
    )) ||
    !(await projects.setConfirmedIcpProfile(
      { workspaceId: input.workspaceId },
      projectId,
      icp!.id,
    ))
  ) {
    throw new Error("Keyword fixture could not confirm its Product Profile");
  }
  await tx.insert(sourceConnections).values({
    id: sourceConnectionId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    provider: "dataforseo",
    connection_type: "api_key_stub",
    state: "available",
    external_ref: target,
    limitation: "Disposable canonical DataForSEO integration fixture.",
    connected_at: CAPTURED_AT,
    created_by: actorId,
  });
  await tx.insert(sourceConnections).values({
    id: crawlSourceConnectionId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    provider: "crawl",
    connection_type: "public",
    state: "available",
    external_ref: `https://${target}`,
    limitation: "Deterministic public Crawl integration fixture.",
    connected_at: CAPTURED_AT,
    created_by: actorId,
  });
  await tx.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    kind: "collection",
    status: "completed",
    result_type: "collection_run",
    result_id: collectionRunId,
    initiated_by: actorId,
    started_at: CAPTURED_AT,
    completed_at: CAPTURED_AT,
  });
  await tx.insert(collectionRuns).values({
    id: collectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    operation: "search_landscape",
    method_version: "dataforseo.search_landscape.v2",
    parameters_hash: contentHash({
      projectId,
      collectionScope: collectionScope as unknown as CanonicalValue,
    }),
  });
  const dataForSeoSnapshot = await new DataSnapshotsRepository(tx).insert({
    workspaceId: input.workspaceId,
    projectId,
    siteId,
    collectionRunId,
    sourceConnectionId,
    provider: "dataforseo",
    datasetKey: "dataforseo.search_landscape.v2",
    schemaVersion: "dataforseo.search_landscape.v2",
    methodVersion: "dataforseo.search_landscape.v2",
    capturedAt: CAPTURED_AT,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Rows are bounded by the frozen provider collection scope.",
    rawObjectKey: privateRawObjectKey,
    rowCount: 1,
    checksum: contentHash({ collectionRunId, observationId }),
    summary: {
      collectionScope,
      timing: {
        collectedAt: CAPTURED_AT,
        dataAsOf: null,
        observedAt: null,
        freshness: "unknown",
      },
      privateRawTaskId: privateTaskId,
    },
  });
  await tx.insert(normalizedObservations).values({
    id: observationId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    snapshot_id: dataForSeoSnapshot.id,
    site_page_id: null,
    provider: "dataforseo",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: normalizedKeyword.replaceAll(" ", "-"),
    observed_at: CAPTURED_AT,
    availability: "available",
    value_json: {
      keyword: input.displayKeyword,
      clusterKey: normalizedKeyword.replaceAll(" ", "-"),
      searchVolume: 0,
      keywordDifficulty: 0,
      providerSearchIntent: "commercial",
      currentRank: 12.5,
      currentUrl: `https://${target}/customer-onboarding/`,
      competitorDomain: "confirmed-competitor.example",
      competitorRank: 3,
      marketCode: "US",
      languageCode: "en",
      privateProviderPayload: privateObservationPayload,
    },
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "context",
    limitation: "Rows are bounded by the frozen provider collection scope.",
  });

  const created = await new KeywordOccurrencesRepository(tx).upsertIntoLibrary(
    { workspaceId: input.workspaceId, projectId },
    {
      manualEntryId: null,
      dataSnapshotId: dataForSeoSnapshot.id,
      normalizedObservationId: observationId,
      displayKeyword: input.displayKeyword,
      normalizedKeyword,
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "dataforseo_ranked",
      scopeBasis: "provider_collection_scope",
      sourcePointer: "/valueJson/keyword",
      sourceRef: `observation:${observationId}#/valueJson/keyword`,
      collectedAt: CAPTURED_AT,
      providerDataAsOf: null,
    },
  );

  const crawlCollectionRunId = randomUUID();
  await tx.insert(asyncRuns).values({
    id: crawlCollectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    kind: "collection",
    status: "completed",
    result_type: "collection_run",
    result_id: crawlCollectionRunId,
    initiated_by: actorId,
    started_at: CAPTURED_AT,
    completed_at: CAPTURED_AT,
  });
  await tx.insert(collectionRuns).values({
    id: crawlCollectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    source_connection_id: crawlSourceConnectionId,
    provider: "crawl",
    operation: "site_graph",
    method_version: CRAWL_METHOD_VERSION,
    parameters_hash: contentHash({ projectId, crawlCollectionRunId }),
  });
  const crawlSnapshot = await new DataSnapshotsRepository(tx).insert({
    workspaceId: input.workspaceId,
    projectId,
    siteId,
    collectionRunId: crawlCollectionRunId,
    sourceConnectionId: crawlSourceConnectionId,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.3.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt: CAPTURED_AT,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Deterministic public Crawl integration fixture.",
    rawObjectKey: null,
    rowCount: 0,
    checksum: contentHash({ projectId, crawlCollectionRunId, rows: 0 }),
  });

  const frozen = buildDiagnosticFrozenInput({
    projectId,
    siteId,
    icp: {
      id: icp!.id,
      version: icp!.version,
      contentHash: icp!.content_hash,
      profile: icp!.profile,
    },
    siteLanguageCodes: ["en-US"],
    snapshots: [crawlSnapshot, dataForSeoSnapshot],
    deliveryLocale: "en-US",
    governance: {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [
        {
          clusterKey: normalizedKeyword,
          keywords: [
            {
              keywordEntityId: created.entityId,
              displayKeyword: input.displayKeyword,
              normalizedKeyword,
              marketCode: "US",
              languageTag: "en-US",
              revision: 0,
              status: "candidate",
              queryKind: "search_query",
              intent: null,
              buyerStage: null,
              clusterKey: null,
              mappingDecision: "unassigned",
              mappedSitePageId: null,
              mappingReviewState: "unreviewed",
              lastSeenAt: CAPTURED_AT,
              occurrenceRefs: [
                {
                  occurrenceId: created.occurrenceId,
                  snapshotId: dataForSeoSnapshot.id,
                  observationId,
                },
              ],
              metricRefs: [],
            },
          ],
        },
      ],
      competitors: [],
    },
  });
  const diagnosticRunId = randomUUID();
  await tx.insert(asyncRuns).values({
    id: diagnosticRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    kind: "diagnostic",
    status: "completed",
    result_type: "diagnostic_run",
    result_id: diagnosticRunId,
    initiated_by: actorId,
    started_at: CAPTURED_AT,
    completed_at: CAPTURED_AT,
  });
  await new DiagnosticRunsRepository(tx).insert({
    runId: diagnosticRunId,
    workspaceId: input.workspaceId,
    projectId,
    siteId,
    icpProfileId: icp!.id,
    icpProfileVersion: icp!.version,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: "en-US",
    inputManifest: frozen.manifest,
    inputHash: frozen.inputHash,
  });
  await publishDiagnosticGeneration(tx, {
    scope: { workspaceId: input.workspaceId, projectId },
    diagnosticRunId,
    actorId,
    completedAt: CAPTURED_AT,
  });

  return {
    projectId,
    keywordId: created.entityId,
    occurrenceId: created.occurrenceId,
    snapshotId: dataForSeoSnapshot.id,
    observationId,
    displayKeyword: input.displayKeyword,
    normalizedKeyword,
    privateRawObjectKey,
    privateTaskId,
    privateObservationPayload,
  };
}

describeDb("Growth Map Keyword Library real Postgres projection", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("returns exact DataForSEO lineage and observed zeros without leaking foreign or private raw data", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        plan_tier: "internal",
        id: workspaceId,
        name: `Keyword read integration ${workspaceId}`,
      });
      const local = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "Local",
        displayKeyword: "Customer Onboarding Software",
      });
      const foreign = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "Foreign",
        displayKeyword: "Foreign Only Keyword",
      });
      const scope = { workspaceId };

      const list = await listProjectAuditKeywords(
        scope,
        local.projectId,
        {
          limit: 50,
          cursor: null,
          now: new Date("2026-07-22T09:00:00.000Z"),
        },
        tx,
      );
      expect(list.projectId).toBe(local.projectId);
      expect(list.data).toHaveLength(1);
      const item = list.data[0]!;
      expect(item).toMatchObject({
        projectId: local.projectId,
        keywordId: local.keywordId,
        displayKeyword: local.displayKeyword,
        normalizedKeyword: local.normalizedKeyword,
        marketCode: "US",
        languageTag: "en-US",
        queryKind: "search_query",
        // Read at the EXACT frozen revision: ingestion wrote the r0 baseline
        // decision, and no human has touched this keyword.
        reviewOrigin: "system_suggestion",
        searchIntent: {
          value: "commercial",
          authority: "provider_observed",
          snapshotId: local.snapshotId,
          observationId: local.observationId,
          analysisInvocationId: null,
          observedAt: CAPTURED_AT,
          limitation: expect.any(String),
        },
        sourceOccurrences: [
          {
            occurrenceId: local.occurrenceId,
            sourceKind: "dataforseo_ranked",
            snapshotId: local.snapshotId,
            sourceObservationId: local.observationId,
            sourcePointer: "/valueJson/keyword",
            collectedAt: CAPTURED_AT,
            providerDataAsOf: null,
            freshness: "unknown",
            limitation: expect.stringMatching(/bounded.*collection scope/i),
            scopeBasis: "provider_collection_scope",
            scopeLimitation: expect.stringMatching(
              /market US.*language en-US.*location code 2840.*200 ranked-keyword rows/is,
            ),
            marketCode: "US",
            languageTag: "en-US",
          },
        ],
        metrics: {
          volume: {
            snapshotId: local.snapshotId,
            observationId: local.observationId,
            valuePointer: "/valueJson/searchVolume",
            value: 0,
            observedAt: CAPTURED_AT,
            freshness: "unknown",
            limitation: expect.any(String),
          },
          kd: {
            snapshotId: local.snapshotId,
            observationId: local.observationId,
            valuePointer: "/valueJson/keywordDifficulty",
            value: 0,
            observedAt: CAPTURED_AT,
            freshness: "unknown",
            limitation: expect.any(String),
          },
        },
      });

      const detail = await getProjectAuditKeyword(
        scope,
        local.projectId,
        local.keywordId,
        null,
        tx,
      );
      expect(detail).toEqual({
        projectId: local.projectId,
        data: {
          ...item,
          mappedTarget: {
            ...item.mappedTarget,
            reason: null,
          },
        },
      });

      const serialized = JSON.stringify({ list, detail });
      expect(serialized).not.toContain(foreign.projectId);
      expect(serialized).not.toContain(foreign.keywordId);
      expect(serialized).not.toContain(foreign.displayKeyword);
      expect(serialized).not.toContain(local.privateRawObjectKey);
      expect(serialized).not.toContain(local.privateTaskId);
      expect(serialized).not.toContain(local.privateObservationPayload);
      expect(serialized).not.toContain("privateRawTaskId");
      expect(serialized).not.toContain("privateProviderPayload");

      await expect(
        getProjectAuditKeyword(
          scope,
          local.projectId,
          foreign.keywordId,
          null,
          tx,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });
});
