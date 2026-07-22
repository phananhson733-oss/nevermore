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
  KeywordOccurrencesRepository,
  contentHash,
  createDbHandle,
  normalizeKeywordIdentity,
  type DbHandle,
  type DbTx,
} from "@sf/db";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  dataSnapshots,
  normalizedObservations,
  sites,
  sourceConnections,
  workspaces,
} from "@sf/db/schema";
import { createDataForSeoCollectionScope } from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getProjectAuditKeyword,
  listProjectAuditKeywords,
} from "./growth-map-keywords.ts";

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
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  const normalizedKeyword = normalizeKeywordIdentity(input.displayKeyword);
  const target = `${input.label.toLowerCase()}-${projectId}.example.com`;
  const privateTaskId = `private-task-${randomUUID()}`;
  const privateObservationPayload = `private-observation-${randomUUID()}`;
  const privateRawObjectKey = `private/dataforseo/${randomUUID()}.json`;
  const collectionScope = createDataForSeoCollectionScope({
    target,
    marketCode: "US",
    languageTag: "en-US",
    locationCode: 2840,
    limit: 200,
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
  await tx.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    kind: "collection",
    status: "running",
    initiated_by: actorId,
    started_at: CAPTURED_AT,
  });
  await tx.insert(collectionRuns).values({
    id: collectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    operation: "keyword_gap_import",
    method_version: "dataforseo.ranked_keywords.v1",
    parameters_hash: contentHash({ projectId, collectionScope }),
  });
  await tx.insert(dataSnapshots).values({
    id: snapshotId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    collection_run_id: collectionRunId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    dataset_key: "dataforseo.ranked_keywords.v1",
    schema_version: "dataforseo.ranked_keywords.v1",
    method_version: "dataforseo.ranked_keywords.v1",
    captured_at: CAPTURED_AT,
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "Rows are bounded by the frozen provider collection scope.",
    raw_object_key: privateRawObjectKey,
    row_count: 1,
    checksum: contentHash({ snapshotId, observationId }),
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
    snapshot_id: snapshotId,
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
      dataSnapshotId: snapshotId,
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

  return {
    projectId,
    keywordId: created.entityId,
    occurrenceId: created.occurrenceId,
    snapshotId,
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
              /market US.*language en-US.*location code 2840.*200 rows/is,
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
        tx,
      );
      expect(detail).toEqual({ projectId: local.projectId, data: item });

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
          tx,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });
});
