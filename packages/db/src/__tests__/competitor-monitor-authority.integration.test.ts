import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDbHandle,
  type DbHandle,
  type PoolClient,
} from "../client.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const NOW = "2026-07-28T00:00:00.000Z";

function pgCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

async function expectRejectedInsert(
  client: PoolClient,
  values: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly competitorId: string;
    readonly analysisScopes: readonly string[];
    readonly topicModelRevision: number;
    readonly market: string;
  },
): Promise<void> {
  await client.query("SAVEPOINT expected_monitor_rejection");
  let rejection: unknown;
  try {
    await insertMonitorRun(client, values);
  } catch (error) {
    rejection = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT expected_monitor_rejection");
  await client.query("RELEASE SAVEPOINT expected_monitor_rejection");
  expect(pgCode(rejection)).toBe("23514");
}

async function insertMonitorRun(
  client: PoolClient,
  values: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly competitorId: string;
    readonly analysisScopes: readonly string[];
    readonly topicModelRevision: number;
    readonly market: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO app.competitor_monitor_runs (
       id, workspace_id, project_id, competitor_id, analysis_scopes,
       settings_revision, topic_model_revision, target_domain,
       market, language_tag, scheduled_for,
       previous_monitor_run_id, previous_snapshot_id
     ) VALUES (
       $1,$2,$3,$4,$5::text[],3,$6,'competitor.example',
       $7,'en-US',$8,NULL,NULL
     )`,
    [
      values.runId,
      values.workspaceId,
      values.projectId,
      values.competitorId,
      [...values.analysisScopes],
      values.topicModelRevision,
      values.market,
      NOW,
    ],
  );
}

describeDb("competitor monitor database authority", () => {
  let handle: DbHandle | undefined;
  let client: PoolClient | undefined;
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const secondarySiteId = randomUUID();
  const sourceId = randomUUID();
  const competitorId = randomUUID();
  const actorId = randomUUID();
  const topicModelId = randomUUID();
  const topicNodeId = randomUUID();
  const topicNodeRevisionId = randomUUID();
  const draftTopicModelId = randomUUID();
  const runId = randomUUID();

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    handle = createDbHandle(databaseUrl);
    client = await handle.pool.connect();
    await client.query("BEGIN");

    await client.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
      [workspaceId, `Competitor monitor ${workspaceId}`],
    );
    await client.query(
      `INSERT INTO app.client_projects (
         id, workspace_id, client_name, project_name,
         default_delivery_locale, created_by
       ) VALUES ($1,$2,$3,$4,'zh-CN',$5)`,
      [
        projectId,
        workspaceId,
        `Client ${projectId}`,
        `Project ${projectId}`,
        actorId,
      ],
    );
    await client.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES (
         $1,$2,$3,'https://customer.example','customer.example',
         ARRAY['US'],ARRAY['en-US'],true
       )`,
      [siteId, workspaceId, projectId],
    );
    await client.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES (
         $1,$2,$3,'https://secondary.example','secondary.example',
         ARRAY['US'],ARRAY['en-US'],false
       )`,
      [secondarySiteId, workspaceId, projectId],
    );
    await client.query(
      `INSERT INTO app.source_connections (
         id, workspace_id, project_id, site_id, provider,
         connection_type, state, scopes, limitation,
         connected_at, created_by
       ) VALUES (
         $1,$2,$3,$4,'dataforseo','api_key_stub','connected',
         '{}'::text[],'DataForSEO 已连接。',$5,$6
       )`,
      [sourceId, workspaceId, projectId, siteId, NOW, actorId],
    );
    await client.query(
      `INSERT INTO app.competitor_entities (
         id, workspace_id, project_id, domain, name,
         review_status, relationship, analysis_scope, revision
       ) VALUES (
         $1,$2,$3,'competitor.example','Competitor',
         'approved','direct',ARRAY['content','serp_visibility'],0
       )`,
      [competitorId, workspaceId, projectId],
    );
    await client.query(
      `INSERT INTO app.competitor_monitor_settings (
         project_id, workspace_id, enabled, frequency,
         revision, updated_by
       ) VALUES ($1,$2,true,'monthly',3,$3)`,
      [projectId, workspaceId, actorId],
    );

    await client.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         generation_basis, evidence_refs, created_by,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,1,'draft','{}'::jsonb,'[]'::jsonb,$4,$5,$5
       )`,
      [topicModelId, workspaceId, projectId, actorId, NOW],
    );
    await client.query(
      `INSERT INTO app.topic_node_identities (
         id, workspace_id, project_id, created_in_revision,
         initial_cluster_key, created_by, created_at
       ) VALUES ($1,$2,$3,1,'customer onboarding',$4,$5)`,
      [topicNodeId, workspaceId, projectId, actorId, NOW],
    );
    await client.query(
      `INSERT INTO app.topic_node_revisions (
         id, workspace_id, project_id, topic_node_id,
         topic_model_revision, parent_topic_node_id, label,
         description, intent_envelope, lifecycle_state,
         created_by, created_at
       ) VALUES (
         $1,$2,$3,$4,1,NULL,'Customer onboarding',
         'Confirmed customer-onboarding demand.','["Commercial"]'::jsonb,
         'active',$5,$6
       )`,
      [
        topicNodeRevisionId,
        workspaceId,
        projectId,
        topicNodeId,
        actorId,
        NOW,
      ],
    );
    await client.query(
      `UPDATE app.topic_model_revisions
       SET root_topic_node_id = $1
       WHERE id = $2`,
      [topicNodeId, topicModelId],
    );
    await client.query(
      `UPDATE app.topic_model_revisions
       SET status = 'confirmed',
           confirmed_by = $1,
           confirmed_at = $2,
           content_hash = repeat('a',64)
       WHERE id = $3`,
      [actorId, NOW, topicModelId],
    );
    await client.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         generation_basis, evidence_refs, created_by,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,2,'draft','{}'::jsonb,'[]'::jsonb,$4,$5,$5
       )`,
      [draftTopicModelId, workspaceId, projectId, actorId, NOW],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    const requestPayload = JSON.stringify({
      provider: "dataforseo",
      operation: "keyword_gap_import",
      collectionScope: {
        target: "competitor.example",
        marketCode: "US",
        languageTag: "en-US",
      },
    });
    await client.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status, active_key,
         contract_version, request_payload, initiated_by,
         queued_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,'collection','queued',$4,'0.3.0',$5::jsonb,$6,$7,$7,$7
       )`,
      [
        runId,
        workspaceId,
        projectId,
        `monitor:competitor:${competitorId}`,
        requestPayload,
        actorId,
        NOW,
      ],
    );
    await client.query(
      `INSERT INTO app.collection_runs (
         id, workspace_id, project_id, site_id, source_connection_id,
         provider, operation, method_version, parameters_hash
       ) VALUES (
         $1,$2,$3,$4,$5,'dataforseo','keyword_gap_import',
         'dataforseo.ranked_keywords.v1',repeat('b',64)
       )`,
      [runId, workspaceId, projectId, siteId, sourceId],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    await handle?.end();
  });

  it("rejects stale authority and accepts only the exact approved frozen scope", async () => {
    if (!client) throw new Error("database client is unavailable");
    const common = {
      runId,
      workspaceId,
      projectId,
      competitorId,
    };

    await expectRejectedInsert(client, {
      ...common,
      analysisScopes: ["content"],
      topicModelRevision: 1,
      market: "US",
    });
    await expectRejectedInsert(client, {
      ...common,
      analysisScopes: ["content", "serp_visibility"],
      topicModelRevision: 1,
      market: "CA",
    });
    await expectRejectedInsert(client, {
      ...common,
      analysisScopes: ["content", "serp_visibility"],
      topicModelRevision: 2,
      market: "US",
    });
    await client.query("SAVEPOINT expected_source_site_rejection");
    await client.query(
      `UPDATE app.source_connections
       SET site_id = $1
       WHERE id = $2`,
      [secondarySiteId, sourceId],
    );
    let siteError: unknown;
    try {
      await insertMonitorRun(client, {
        ...common,
        analysisScopes: ["content", "serp_visibility"],
        topicModelRevision: 1,
        market: "US",
      });
    } catch (error) {
      siteError = error;
    }
    await client.query("ROLLBACK TO SAVEPOINT expected_source_site_rejection");
    await client.query("RELEASE SAVEPOINT expected_source_site_rejection");
    expect(pgCode(siteError)).toBe("23514");

    await insertMonitorRun(client, {
      ...common,
      analysisScopes: ["content", "serp_visibility"],
      topicModelRevision: 1,
      market: "US",
    });
    const result = await client.query<{
      analysis_scopes: string[];
      topic_model_revision: number;
      market: string;
      language_tag: string;
    }>(
      `SELECT analysis_scopes, topic_model_revision, market, language_tag
       FROM app.competitor_monitor_runs
       WHERE id = $1`,
      [runId],
    );
    expect(result.rows).toEqual([
      {
        analysis_scopes: ["content", "serp_visibility"],
        topic_model_revision: 1,
        market: "US",
        language_tag: "en-US",
      },
    ]);
  });
});
