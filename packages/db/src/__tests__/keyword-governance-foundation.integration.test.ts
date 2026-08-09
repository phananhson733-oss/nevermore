import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { listMigrationFiles } from "../migrate.ts";
import { TopicClusterResolverRepository } from "../repositories/topic-cluster-resolver.ts";
import {
  TopicModelConflictError,
  TopicModelsRepository,
} from "../repositories/topic-models.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const SHARED_DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = SHARED_DATABASE_URL ? describe : describe.skip;
const DATABASE_NAME =
  `signalframe_ci_keyword_governance_${randomBytes(6).toString("hex")}`;
const DATABASE_NAME_PATTERN =
  /^signalframe_ci_keyword_governance_[a-f0-9]{12}$/u;
const MIGRATION_FILE = "0024_keyword_governance_foundation.sql";
const MIGRATION_SQL = readFileSync(
  new URL(`../../migrations/${MIGRATION_FILE}`, import.meta.url),
  "utf8",
);
const LEGACY_TIME = "2026-07-23T08:00:00.000Z";

function databaseIdentifier(): string {
  if (!DATABASE_NAME_PATTERN.test(DATABASE_NAME)) {
    throw new Error("generated database name failed the disposable-name policy");
  }
  return `"${DATABASE_NAME}"`;
}

function sharedDatabaseUrl(): string {
  return requireSafeTestDatabaseUrl(
    SHARED_DATABASE_URL,
    "DATABASE_URL",
  );
}

function disposableDatabaseUrl(): string {
  const url = new URL(sharedDatabaseUrl());
  url.pathname = `/${DATABASE_NAME}`;
  return requireSafeTestDatabaseUrl(
    url.toString(),
    "keyword governance database URL",
  );
}

function maintenanceUrl(): string {
  const url = new URL(sharedDatabaseUrl());
  url.pathname = "/postgres";
  return url.toString();
}

async function withMaintenanceClient(
  run: (client: pg.Client) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString: maintenanceUrl() });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

async function applyMigration(
  client: pg.Client | pg.Pool,
  migrationFile: string,
): Promise<void> {
  await client.query(
    readFileSync(
      new URL(`../../migrations/${migrationFile}`, import.meta.url),
      "utf8",
    ),
  );
}

async function applyMigrationsAfter(
  client: pg.Client | pg.Pool,
  migrationFile: string,
): Promise<void> {
  const migrationFiles = listMigrationFiles();
  const migrationIndex = migrationFiles.indexOf(migrationFile);
  if (migrationIndex < 0) {
    throw new Error(`migration is not in the ordered set: ${migrationFile}`);
  }
  for (const remainingMigration of migrationFiles.slice(migrationIndex + 1)) {
    await applyMigration(client, remainingMigration);
  }
}

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly sitePageId: string | null;
}

interface KeywordFixture {
  readonly id: string;
  readonly project: ProjectFixture;
  readonly status: "candidate" | "approved" | "excluded" | "parked";
  readonly intent: string | null;
  readonly buyerStage: string | null;
  readonly clusterKey: string | null;
  readonly mappingDecision: "unassigned" | "existing_page" | "new_asset";
  readonly mappedSitePageId: string | null;
  readonly reviewState: "unreviewed" | "confirmed";
  readonly mappingRevision: number;
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function createProject(
  handle: DbHandle,
  options: {
    readonly workspaceId?: string;
    readonly withPage?: boolean;
  } = {},
): Promise<ProjectFixture> {
  const workspaceId = options.workspaceId ?? randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  if (!options.workspaceId) {
    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
      [workspaceId, `Keyword governance ${workspaceId}`],
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
      `Project ${projectId}`,
      actorId,
    ],
  );

  if (options.withPage !== true) {
    return { workspaceId, projectId, actorId, sitePageId: null };
  }

  const siteId = randomUUID();
  const sitePageId = randomUUID();
  const host = `${projectId}.keyword-governance.example`;
  const normalizedUrl = `https://${host}/customer-onboarding/`;
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
      normalizedUrl,
      sha256(normalizedUrl),
    ],
  );
  return { workspaceId, projectId, actorId, sitePageId };
}

async function createLegacyKeyword(
  handle: DbHandle,
  project: ProjectFixture,
  values: Omit<KeywordFixture, "id" | "project"> & {
    readonly displayKeyword: string;
  },
): Promise<KeywordFixture> {
  const id = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.keyword_entities (
       id, workspace_id, project_id, display_keyword, normalized_keyword,
       market, language_tag, query_kind, status, intent, buyer_stage,
       cluster_key, mapping_decision, mapped_site_page_id,
       mapping_review_state, mapping_revision, first_seen_at, last_seen_at,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,'US','en-US','search_query',$6,$7,$8,$9,$10,$11,
       $12,$13,$14,$14,$14,$14
     )`,
    [
      id,
      project.workspaceId,
      project.projectId,
      values.displayKeyword,
      values.displayKeyword.toLowerCase(),
      values.status,
      values.intent,
      values.buyerStage,
      values.clusterKey,
      values.mappingDecision,
      values.mappedSitePageId,
      values.reviewState,
      values.mappingRevision,
      LEGACY_TIME,
    ],
  );
  return {
    id,
    project,
    status: values.status,
    intent: values.intent,
    buyerStage: values.buyerStage,
    clusterKey: values.clusterKey,
    mappingDecision: values.mappingDecision,
    mappedSitePageId: values.mappedSitePageId,
    reviewState: values.reviewState,
    mappingRevision: values.mappingRevision,
  };
}

describeDb("0024 keyword governance foundation", () => {
  let handle: DbHandle;
  let databaseCreated = false;
  let primary: ProjectFixture;
  let sameWorkspaceProject: ProjectFixture;
  let otherWorkspaceProject: ProjectFixture;
  let onlyUnreviewedProject: ProjectFixture;
  let primaryKeywords: readonly KeywordFixture[];
  let sameWorkspaceKeyword: KeywordFixture;
  let otherWorkspaceKeyword: KeywordFixture;
  let onlyUnreviewedKeyword: KeywordFixture;
  let revisionTwoSourceIdentityId: string;
  let revisionTwoIdentityId: string;
  let revisionTwoSecondIdentityId: string;

  beforeAll(async () => {
    await withMaintenanceClient(async (client) => {
      await client.query(
        `CREATE DATABASE ${databaseIdentifier()} TEMPLATE template0`,
      );
      databaseCreated = true;
    });

    const migrationFiles = listMigrationFiles();
    const migrationIndex = migrationFiles.indexOf(MIGRATION_FILE);
    expect(migrationIndex).toBeGreaterThan(0);
    expect(migrationFiles[migrationIndex - 1]).toBe(
      "0023_measurement_windows.sql",
    );

    const migrationClient = new pg.Client({
      connectionString: disposableDatabaseUrl(),
    });
    await migrationClient.connect();
    try {
      for (const migrationFile of migrationFiles.slice(0, migrationIndex)) {
        await applyMigration(migrationClient, migrationFile);
      }
      await expect(
        migrationClient.query<{ migration_version: string }>(
          "SELECT migration_version FROM app.schema_migration_version",
        ),
      ).resolves.toMatchObject({
        rows: [{ migration_version: "0023_measurement_windows" }],
      });
    } finally {
      await migrationClient.end();
    }

    handle = createDbHandle(disposableDatabaseUrl());

    primary = await createProject(handle, { withPage: true });
    sameWorkspaceProject = await createProject(handle, {
      workspaceId: primary.workspaceId,
    });
    otherWorkspaceProject = await createProject(handle);
    onlyUnreviewedProject = await createProject(handle);

    primaryKeywords = [
      await createLegacyKeyword(handle, primary, {
        displayKeyword: "customer onboarding software",
        status: "approved",
        intent: "commercial",
        buyerStage: "decision",
        clusterKey: "customer-onboarding",
        mappingDecision: "existing_page",
        mappedSitePageId: primary.sitePageId,
        reviewState: "confirmed",
        mappingRevision: 7,
      }),
      await createLegacyKeyword(handle, primary, {
        displayKeyword: "customer onboarding automation",
        status: "approved",
        intent: "informational",
        buyerStage: "consideration",
        clusterKey: "customer-onboarding",
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        reviewState: "confirmed",
        mappingRevision: 3,
      }),
      await createLegacyKeyword(handle, primary, {
        displayKeyword: "sales enablement workflow",
        status: "candidate",
        intent: "commercial",
        buyerStage: "consideration",
        clusterKey: "sales-enablement",
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        reviewState: "confirmed",
        mappingRevision: 2,
      }),
      await createLegacyKeyword(handle, primary, {
        displayKeyword: "legacy unreviewed cluster suggestion",
        status: "candidate",
        intent: "informational",
        buyerStage: "awareness",
        clusterKey: "unreviewed-legacy-label",
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        reviewState: "unreviewed",
        mappingRevision: 6,
      }),
      await createLegacyKeyword(handle, primary, {
        displayKeyword: "uncategorized operations query",
        status: "parked",
        intent: null,
        buyerStage: null,
        clusterKey: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reviewState: "unreviewed",
        mappingRevision: 4,
      }),
    ];
    sameWorkspaceKeyword = await createLegacyKeyword(
      handle,
      sameWorkspaceProject,
      {
        displayKeyword: "same workspace onboarding",
        status: "approved",
        intent: "commercial",
        buyerStage: "decision",
        clusterKey: "customer-onboarding",
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        reviewState: "confirmed",
        mappingRevision: 1,
      },
    );
    otherWorkspaceKeyword = await createLegacyKeyword(
      handle,
      otherWorkspaceProject,
      {
        displayKeyword: "other workspace onboarding",
        status: "approved",
        intent: "commercial",
        buyerStage: "decision",
        clusterKey: "customer-onboarding",
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        reviewState: "confirmed",
        mappingRevision: 5,
      },
    );
    onlyUnreviewedKeyword = await createLegacyKeyword(
      handle,
      onlyUnreviewedProject,
      {
        displayKeyword: "only unreviewed legacy topic",
        status: "candidate",
        intent: "informational",
        buyerStage: "awareness",
        clusterKey: "only-unreviewed-legacy-label",
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        reviewState: "unreviewed",
        mappingRevision: 8,
      },
    );

    // Apply 0024 exactly once over an authentic 0023 schema populated with
    // legacy fixtures. The suite owns this database, so proving the backfill
    // cannot downgrade the shared integration database's migration projection.
    await handle.pool.query(MIGRATION_SQL);
    await expect(
      handle.pool.query<{ migration_version: string }>(
        "SELECT migration_version FROM app.schema_migration_version",
      ),
    ).resolves.toMatchObject({
      rows: [{ migration_version: "0024_keyword_governance_foundation" }],
    });
  });

  afterAll(async () => {
    try {
      await handle?.end();
    } finally {
      if (databaseCreated) {
        await withMaintenanceClient(async (client) => {
          await client.query(
            `DROP DATABASE IF EXISTS ${databaseIdentifier()} WITH (FORCE)`,
          );
        });
      }
    }
  });

  it("backfills one stable Topic identity per distinct reviewed cluster label", async () => {
    const identities = await handle.pool.query<{
      id: string;
      initial_cluster_key: string;
    }>(
      `SELECT id, initial_cluster_key
       FROM app.topic_node_identities
       WHERE workspace_id = $1 AND project_id = $2
       ORDER BY initial_cluster_key`,
      [primary.workspaceId, primary.projectId],
    );
    expect(identities.rows.map((row) => row.initial_cluster_key)).toEqual([
      "customer-onboarding",
      "sales-enablement",
    ]);

    const customerIdentity = identities.rows.find(
      (row) => row.initial_cluster_key === "customer-onboarding",
    );
    expect(customerIdentity).toBeDefined();

    const crossProject = await handle.pool.query<{ id: string }>(
      `SELECT id
       FROM app.topic_node_identities
       WHERE workspace_id = $1
         AND project_id = $2
         AND initial_cluster_key = 'customer-onboarding'`,
      [sameWorkspaceProject.workspaceId, sameWorkspaceProject.projectId],
    );
    expect(crossProject.rows).toHaveLength(1);
    expect(crossProject.rows[0]!.id).not.toBe(customerIdentity!.id);
  });

  it("creates one initial confirmed Topic Model revision with every mapped node", async () => {
    const models = await handle.pool.query<{
      revision: number;
      status: string;
      content_hash: string;
      generation_basis: Record<string, unknown>;
    }>(
      `SELECT revision, status, content_hash, generation_basis
       FROM app.topic_model_revisions
       WHERE workspace_id = $1 AND project_id = $2`,
      [primary.workspaceId, primary.projectId],
    );
    expect(models.rows).toEqual([
      {
        revision: 1,
        status: "confirmed",
        content_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        generation_basis: {
          origin: "migration_baseline",
          source: "reviewed keyword_entities.cluster_key",
          projectionVersion: "topic-model.1.0.0",
          contentHashMethod:
            "postgres-jsonb-sha256.migration-baseline.v1",
          earlierHistoryAvailable: false,
        },
      },
    ]);

    const nodes = await handle.pool.query<{
      topic_model_revision: number;
      label: string;
    }>(
      `SELECT topic_model_revision, label
       FROM app.topic_node_revisions
       WHERE workspace_id = $1 AND project_id = $2
       ORDER BY label`,
      [primary.workspaceId, primary.projectId],
    );
    expect(nodes.rows).toEqual([
      { topic_model_revision: 1, label: "customer-onboarding" },
      { topic_model_revision: 1, label: "sales-enablement" },
    ]);
  });

  it("does not promote an unreviewed legacy label into canonical Topic truth", async () => {
    const keyword = primaryKeywords.find(
      (candidate) => candidate.clusterKey === "unreviewed-legacy-label",
    )!;
    const identity = await handle.pool.query<{ id: string }>(
      `SELECT id
       FROM app.topic_node_identities
       WHERE workspace_id = $1
         AND project_id = $2
         AND initial_cluster_key = $3`,
      [primary.workspaceId, primary.projectId, keyword.clusterKey],
    );
    expect(identity.rows).toEqual([]);

    const baseline = await handle.pool.query<{
      cluster_key_at_decision: string | null;
      topic_node_id: string | null;
      topic_model_revision: number | null;
      review_state: string;
    }>(
      `SELECT
         cluster_key_at_decision,
         topic_node_id,
         topic_model_revision,
         review_state
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3`,
      [primary.workspaceId, primary.projectId, keyword.id],
    );
    expect(baseline.rows).toEqual([
      {
        cluster_key_at_decision: "unreviewed-legacy-label",
        topic_node_id: null,
        topic_model_revision: null,
        review_state: "unreviewed",
      },
    ]);
  });

  it("does not fabricate an empty confirmed model for an unreviewed-only project", async () => {
    const models = await handle.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.topic_model_revisions
       WHERE workspace_id = $1 AND project_id = $2`,
      [onlyUnreviewedProject.workspaceId, onlyUnreviewedProject.projectId],
    );
    expect(models.rows).toEqual([{ count: "0" }]);

    const baseline = await handle.pool.query<{
      cluster_key_at_decision: string;
      topic_node_id: string | null;
      topic_model_revision: number | null;
      governance_revision: number;
    }>(
      `SELECT
         cluster_key_at_decision,
         topic_node_id,
         topic_model_revision,
         governance_revision
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3`,
      [
        onlyUnreviewedProject.workspaceId,
        onlyUnreviewedProject.projectId,
        onlyUnreviewedKeyword.id,
      ],
    );
    expect(baseline.rows).toEqual([
      {
        cluster_key_at_decision: "only-unreviewed-legacy-label",
        topic_node_id: null,
        topic_model_revision: null,
        governance_revision: 8,
      },
    ]);
  });

  it("retains a current legacy alias for every pre-migration cluster label", async () => {
    const aliases = await handle.pool.query<{
      legacy_cluster_key: string;
      valid_from_revision: number;
      valid_to_revision: number | null;
      is_current: boolean;
      initial_cluster_key: string;
    }>(
      `SELECT
         alias.legacy_cluster_key,
         alias.valid_from_revision,
         alias.valid_to_revision,
         alias.is_current,
         identity.initial_cluster_key
       FROM app.topic_cluster_aliases alias
       JOIN app.topic_node_identities identity
         ON identity.workspace_id = alias.workspace_id
        AND identity.project_id = alias.project_id
        AND identity.id = alias.topic_node_id
       WHERE alias.workspace_id = $1 AND alias.project_id = $2
       ORDER BY alias.legacy_cluster_key`,
      [primary.workspaceId, primary.projectId],
    );
    expect(aliases.rows).toEqual([
      {
        legacy_cluster_key: "customer-onboarding",
        valid_from_revision: 1,
        valid_to_revision: null,
        is_current: true,
        initial_cluster_key: "customer-onboarding",
      },
      {
        legacy_cluster_key: "sales-enablement",
        valid_from_revision: 1,
        valid_to_revision: null,
        is_current: true,
        initial_cluster_key: "sales-enablement",
      },
    ]);
  });

  it("writes exactly one migration baseline that preserves each current review projection", async () => {
    const decisions = await handle.pool.query<{
      keyword_entity_id: string;
      governance_revision: number;
      decision_origin: string;
      status: string;
      intent: string | null;
      buyer_stage: string | null;
      cluster_key_at_decision: string | null;
      mapping_decision: string;
      mapped_site_page_id: string | null;
      review_state: string;
      topic_node_id: string | null;
      topic_model_revision: number | null;
      assignment_invalidated_by: string | null;
      reviewed_projection: Record<string, unknown>;
    }>(
      `SELECT
         keyword_entity_id,
         governance_revision,
         decision_origin,
         status,
         intent,
         buyer_stage,
         cluster_key_at_decision,
         mapping_decision,
         mapped_site_page_id,
         review_state,
         topic_node_id,
         topic_model_revision,
         assignment_invalidated_by,
         reviewed_projection
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1 AND project_id = $2
       ORDER BY keyword_entity_id`,
      [primary.workspaceId, primary.projectId],
    );
    expect(decisions.rows).toHaveLength(primaryKeywords.length);

    for (const keyword of primaryKeywords) {
      const decision = decisions.rows.find(
        (row) => row.keyword_entity_id === keyword.id,
      );
      expect(decision).toMatchObject({
        governance_revision: keyword.mappingRevision,
        decision_origin: "migration_baseline",
        status: keyword.status,
        intent: keyword.intent,
        buyer_stage: keyword.buyerStage,
        cluster_key_at_decision: keyword.clusterKey,
        mapping_decision: keyword.mappingDecision,
        mapped_site_page_id: keyword.mappedSitePageId,
        review_state: keyword.reviewState,
        topic_model_revision:
          keyword.reviewState === "confirmed" &&
          keyword.clusterKey !== null
            ? 1
            : null,
        assignment_invalidated_by: null,
      });
      expect(decision!.reviewed_projection).toEqual({
        projectId: primary.projectId,
        keywordId: keyword.id,
        status: keyword.status,
        intent: keyword.intent,
        buyerStage: keyword.buyerStage,
        topicNodeId: decision!.topic_node_id,
        topicModelRevision: decision!.topic_model_revision,
        clusterKey: keyword.clusterKey,
        mappingDecision: keyword.mappingDecision,
        mappedSitePageId: keyword.mappedSitePageId,
        mappingReviewState: keyword.reviewState,
        governanceRevision: keyword.mappingRevision,
        assignmentInvalidatedBy: null,
        earlierHistoryAvailable: false,
      });
    }
  });

  it("does not invent lost intermediate review decisions", async () => {
    const keyword = primaryKeywords[0]!;
    const revisions = await handle.pool.query<{
      governance_revision: number;
      decision_origin: string;
    }>(
      `SELECT governance_revision, decision_origin
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3
       ORDER BY governance_revision`,
      [primary.workspaceId, primary.projectId, keyword.id],
    );
    expect(revisions.rows).toEqual([
      {
        governance_revision: keyword.mappingRevision,
        decision_origin: "migration_baseline",
      },
    ]);
  });

  it("baselines a null cluster without fabricating a Topic Node", async () => {
    const keyword = primaryKeywords.find(
      (candidate) => candidate.clusterKey === null,
    )!;
    const result = await handle.pool.query<{
      topic_node_id: string | null;
      cluster_key_at_decision: string | null;
      governance_revision: number;
    }>(
      `SELECT topic_node_id, cluster_key_at_decision, governance_revision
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3`,
      [primary.workspaceId, primary.projectId, keyword.id],
    );
    expect(result.rows).toEqual([
      {
        topic_node_id: null,
        cluster_key_at_decision: null,
        governance_revision: keyword.mappingRevision,
      },
    ]);
  });

  it("rejects audit projections with fields outside the governed contract", async () => {
    const keyword = primaryKeywords.find(
      (candidate) => candidate.clusterKey === null,
    )!;
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_review_decisions (
           id, workspace_id, project_id, keyword_entity_id,
           governance_revision, decision_origin, status, intent, buyer_stage,
           topic_node_id, topic_model_revision, cluster_key_at_decision,
           mapping_decision, mapped_site_page_id, review_state,
           decided_by, reason, decided_at, reviewed_projection
         ) VALUES (
           $1,$2,$3,$4,$5,'system_suggestion',$6,$7,$8,
           NULL,NULL,NULL,$9,NULL,$10,$11,
           'Projection with an undeclared field must fail.',$12,$13
         )`,
        [
          randomUUID(),
          primary.workspaceId,
          primary.projectId,
          keyword.id,
          keyword.mappingRevision + 1,
          keyword.status,
          keyword.intent,
          keyword.buyerStage,
          keyword.mappingDecision,
          keyword.reviewState,
          primary.actorId,
          LEGACY_TIME,
          {
            projectId: primary.projectId,
            keywordId: keyword.id,
            status: keyword.status,
            intent: keyword.intent,
            buyerStage: keyword.buyerStage,
            topicNodeId: null,
            topicModelRevision: null,
            clusterKey: null,
            mappingDecision: keyword.mappingDecision,
            mappedSitePageId: null,
            mappingReviewState: keyword.reviewState,
            governanceRevision: keyword.mappingRevision + 1,
            assignmentInvalidatedBy: null,
            earlierHistoryAvailable: false,
            shadowAuthority: true,
          },
        ],
      ),
      "23514",
    );

  });

  it("rejects stringified revisions in the audit projection", async () => {
    const keyword = primaryKeywords.find(
      (candidate) => candidate.clusterKey === null,
    )!;
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_review_decisions (
           id, workspace_id, project_id, keyword_entity_id,
           governance_revision, decision_origin, status, intent, buyer_stage,
           topic_node_id, topic_model_revision, cluster_key_at_decision,
           mapping_decision, mapped_site_page_id, review_state,
           decided_by, reason, decided_at, reviewed_projection
         ) VALUES (
           $1,$2,$3,$4,$5,'system_suggestion',$6,$7,$8,
           NULL,NULL,NULL,$9,NULL,$10,$11,
           'Stringified revision must fail.',$12,$13
         )`,
        [
          randomUUID(),
          primary.workspaceId,
          primary.projectId,
          keyword.id,
          keyword.mappingRevision + 2,
          keyword.status,
          keyword.intent,
          keyword.buyerStage,
          keyword.mappingDecision,
          keyword.reviewState,
          primary.actorId,
          LEGACY_TIME,
          {
            projectId: primary.projectId,
            keywordId: keyword.id,
            status: keyword.status,
            intent: keyword.intent,
            buyerStage: keyword.buyerStage,
            topicNodeId: null,
            topicModelRevision: null,
            clusterKey: null,
            mappingDecision: keyword.mappingDecision,
            mappedSitePageId: null,
            mappingReviewState: keyword.reviewState,
            governanceRevision: String(keyword.mappingRevision + 2),
            assignmentInvalidatedBy: null,
            earlierHistoryAvailable: false,
          },
        ],
      ),
      "23514",
    );

  });

  it("rejects a stringified history-availability flag", async () => {
    const keyword = primaryKeywords.find(
      (candidate) => candidate.clusterKey === null,
    )!;
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_review_decisions (
           id, workspace_id, project_id, keyword_entity_id,
           governance_revision, decision_origin, status, intent, buyer_stage,
           topic_node_id, topic_model_revision, cluster_key_at_decision,
           mapping_decision, mapped_site_page_id, review_state,
           decided_by, reason, decided_at, reviewed_projection
         ) VALUES (
           $1,$2,$3,$4,$5,'system_suggestion',$6,$7,$8,
           NULL,NULL,NULL,$9,NULL,$10,$11,
           'Stringified history flag must fail.',$12,$13
         )`,
        [
          randomUUID(),
          primary.workspaceId,
          primary.projectId,
          keyword.id,
          keyword.mappingRevision + 3,
          keyword.status,
          keyword.intent,
          keyword.buyerStage,
          keyword.mappingDecision,
          keyword.reviewState,
          primary.actorId,
          LEGACY_TIME,
          {
            projectId: primary.projectId,
            keywordId: keyword.id,
            status: keyword.status,
            intent: keyword.intent,
            buyerStage: keyword.buyerStage,
            topicNodeId: null,
            topicModelRevision: null,
            clusterKey: null,
            mappingDecision: keyword.mappingDecision,
            mappedSitePageId: null,
            mappingReviewState: keyword.reviewState,
            governanceRevision: keyword.mappingRevision + 3,
            assignmentInvalidatedBy: null,
            earlierHistoryAvailable: "false",
          },
        ],
      ),
      "23514",
    );
  });

  it("rejects keyword and Topic references spliced across project scopes", async () => {
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_review_decisions (
           id, workspace_id, project_id, keyword_entity_id,
           governance_revision, decision_origin, status, intent, buyer_stage,
           topic_node_id, topic_model_revision, cluster_key_at_decision,
           mapping_decision, mapped_site_page_id, review_state,
           decided_by, reason, decided_at, reviewed_projection
         ) VALUES (
           $1,$2,$3,$4,6,'user','approved','commercial','decision',
           NULL,NULL,NULL,'unassigned',NULL,'confirmed',$5,
           'Cross-scope write must fail.',$6,$7
         )`,
        [
          randomUUID(),
          primary.workspaceId,
          primary.projectId,
          otherWorkspaceKeyword.id,
          primary.actorId,
          LEGACY_TIME,
          {
            projectId: primary.projectId,
            keywordId: otherWorkspaceKeyword.id,
            status: "approved",
            intent: "commercial",
            buyerStage: "decision",
            topicNodeId: null,
            topicModelRevision: null,
            clusterKey: null,
            mappingDecision: "unassigned",
            mappedSitePageId: null,
            mappingReviewState: "confirmed",
            governanceRevision: 6,
            assignmentInvalidatedBy: null,
            earlierHistoryAvailable: false,
          },
        ],
      ),
      "23503",
    );

    const foreignIdentity = await handle.pool.query<{ id: string }>(
      `SELECT id
       FROM app.topic_node_identities
       WHERE workspace_id = $1 AND project_id = $2
       LIMIT 1`,
      [sameWorkspaceProject.workspaceId, sameWorkspaceProject.projectId],
    );
    const scopedDraftProject = await createProject(handle, {
      workspaceId: primary.workspaceId,
    });
    await handle.pool.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         root_topic_node_id, generation_basis, evidence_refs, created_by
       ) VALUES (
         $1,$2,$3,10,'draft',NULL,'{"origin":"scope-test"}'::jsonb,
         '[]'::jsonb,$4
       )`,
      [
        randomUUID(),
        scopedDraftProject.workspaceId,
        scopedDraftProject.projectId,
        scopedDraftProject.actorId,
      ],
    );
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_node_revisions (
           id, workspace_id, project_id, topic_node_id,
           topic_model_revision, parent_topic_node_id, label,
           description, intent_envelope, lifecycle_state, created_by
         ) VALUES (
           $1,$2,$3,$4,10,NULL,'spliced-topic',NULL,'[]'::jsonb,
           'active',$5
         )`,
        [
          randomUUID(),
          scopedDraftProject.workspaceId,
          scopedDraftProject.projectId,
          foreignIdentity.rows[0]!.id,
          scopedDraftProject.actorId,
        ],
      ),
      "23503",
    );

    // Sanity: the source row used by the first assertion really belongs to a
    // different workspace, while this keyword proves same-workspace/project
    // isolation independently.
    expect(otherWorkspaceKeyword.project.workspaceId).not.toBe(
      primary.workspaceId,
    );
    expect(sameWorkspaceKeyword.project.workspaceId).toBe(primary.workspaceId);
    expect(sameWorkspaceKeyword.project.projectId).not.toBe(primary.projectId);
  });

  it("makes confirmed model and node revisions immutable", async () => {
    await expectPgCode(
      handle.pool.query(
        `UPDATE app.topic_model_revisions
         SET generation_basis = '{"changed":true}'::jsonb
         WHERE workspace_id = $1 AND project_id = $2 AND revision = 1`,
        [primary.workspaceId, primary.projectId],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        `UPDATE app.topic_node_revisions
         SET label = 'mutated-label'
         WHERE workspace_id = $1
           AND project_id = $2
           AND topic_model_revision = 1
           AND label = 'customer-onboarding'`,
        [primary.workspaceId, primary.projectId],
      ),
      "55000",
    );
  });

  it("requires a root and every parent to exist in the same model revision", async () => {
    const legacyIdentity = await handle.pool.query<{ id: string }>(
      `SELECT id
       FROM app.topic_node_identities
       WHERE workspace_id = $1
         AND project_id = $2
         AND initial_cluster_key = 'customer-onboarding'`,
      [primary.workspaceId, primary.projectId],
    );
    const rootScopeProject = await createProject(handle, {
      workspaceId: primary.workspaceId,
    });
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_model_revisions (
           id, workspace_id, project_id, revision, status,
           root_topic_node_id, generation_basis, evidence_refs, created_by
         ) VALUES (
           $1,$2,$3,11,'draft',$4,'{"origin":"root-scope-test"}'::jsonb,
           '[]'::jsonb,$5
         )`,
        [
          randomUUID(),
          rootScopeProject.workspaceId,
          rootScopeProject.projectId,
          legacyIdentity.rows[0]!.id,
          rootScopeProject.actorId,
        ],
      ),
      "23503",
    );

    const childIdentityId = randomUUID();
    const parentScopeProject = await createProject(handle, {
      workspaceId: primary.workspaceId,
    });
    await handle.pool.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         root_topic_node_id, generation_basis, evidence_refs, created_by
       ) VALUES (
         $1,$2,$3,12,'draft',NULL,'{"origin":"parent-scope-test"}'::jsonb,
         '[]'::jsonb,$4
       )`,
      [
        randomUUID(),
        parentScopeProject.workspaceId,
        parentScopeProject.projectId,
        parentScopeProject.actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.topic_node_identities (
         id, workspace_id, project_id, created_in_revision,
         initial_cluster_key, created_by
       ) VALUES ($1,$2,$3,12,'parent-scope-child',$4)`,
      [
        childIdentityId,
        parentScopeProject.workspaceId,
        parentScopeProject.projectId,
        parentScopeProject.actorId,
      ],
    );
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_node_revisions (
           id, workspace_id, project_id, topic_node_id,
           topic_model_revision, parent_topic_node_id, label,
           description, intent_envelope, lifecycle_state, created_by
         ) VALUES (
           $1,$2,$3,$4,12,$5,'parent-scope-child',NULL,
           '[]'::jsonb,'active',$6
         )`,
        [
          randomUUID(),
          parentScopeProject.workspaceId,
          parentScopeProject.projectId,
          childIdentityId,
          legacyIdentity.rows[0]!.id,
          parentScopeProject.actorId,
        ],
      ),
      "23503",
    );
  });

  it("rejects cycles in the parent hierarchy within one model revision", async () => {
    const cycleProject = await createProject(handle);
    const firstIdentityId = randomUUID();
    const secondIdentityId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         root_topic_node_id, generation_basis, evidence_refs, created_by
       ) VALUES (
         $1,$2,$3,13,'draft',NULL,'{"origin":"parent-cycle-test"}'::jsonb,
         '[]'::jsonb,$4
       )`,
      [
        randomUUID(),
        cycleProject.workspaceId,
        cycleProject.projectId,
        cycleProject.actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.topic_node_identities (
         id, workspace_id, project_id, created_in_revision,
         initial_cluster_key, created_by
       ) VALUES
         ($1,$2,$3,13,'parent-cycle-a',$4),
         ($5,$2,$3,13,'parent-cycle-b',$4)`,
      [
        firstIdentityId,
        cycleProject.workspaceId,
        cycleProject.projectId,
        cycleProject.actorId,
        secondIdentityId,
      ],
    );

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_node_revisions (
           id, workspace_id, project_id, topic_node_id,
           topic_model_revision, parent_topic_node_id, label,
           description, intent_envelope, lifecycle_state, created_by
         ) VALUES
           (
             $1,$2,$3,$4,13,$5,'parent-cycle-a',NULL,
             '[]'::jsonb,'active',$6
           ),
           (
             $7,$2,$3,$5,13,$4,'parent-cycle-b',NULL,
             '[]'::jsonb,'active',$6
           )`,
        [
          randomUUID(),
          cycleProject.workspaceId,
          cycleProject.projectId,
          firstIdentityId,
          secondIdentityId,
          cycleProject.actorId,
          randomUUID(),
        ],
      ),
      "23514",
    );
  });

  it("refuses to confirm an empty Topic Model", async () => {
    const emptyProject = await createProject(handle);
    await handle.pool.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         root_topic_node_id, generation_basis, evidence_refs, created_by
       ) VALUES (
         $1,$2,$3,14,'draft',NULL,'{"origin":"empty-model-test"}'::jsonb,
         '[]'::jsonb,$4
       )`,
      [
        randomUUID(),
        emptyProject.workspaceId,
        emptyProject.projectId,
        emptyProject.actorId,
      ],
    );
    await expectPgCode(
      handle.pool.query(
        `UPDATE app.topic_model_revisions
         SET
           status = 'confirmed',
           content_hash = $1,
           confirmed_by = $2,
           confirmed_at = statement_timestamp()
         WHERE workspace_id = $3 AND project_id = $4 AND revision = 14`,
        [
          "b".repeat(64),
          emptyProject.actorId,
          emptyProject.workspaceId,
          emptyProject.projectId,
        ],
      ),
      "23514",
    );
  });

  it("rejects confirmation timestamps earlier than model creation", async () => {
    const confirmationProject = await createProject(handle);
    const identityId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         root_topic_node_id, generation_basis, evidence_refs,
         created_by, created_at
       ) VALUES (
         $1,$2,$3,15,'draft',NULL,'{"origin":"confirmation-time-test"}'::jsonb,
         '[]'::jsonb,$4,'2026-07-24T08:00:00.000Z'
       )`,
      [
        randomUUID(),
        confirmationProject.workspaceId,
        confirmationProject.projectId,
        confirmationProject.actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.topic_node_identities (
         id, workspace_id, project_id, created_in_revision,
         initial_cluster_key, created_by
       ) VALUES ($1,$2,$3,15,'confirmation-time-test',$4)`,
      [
        identityId,
        confirmationProject.workspaceId,
        confirmationProject.projectId,
        confirmationProject.actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.topic_node_revisions (
         id, workspace_id, project_id, topic_node_id,
         topic_model_revision, parent_topic_node_id, label,
         description, intent_envelope, lifecycle_state, created_by
       ) VALUES (
         $1,$2,$3,$4,15,NULL,'confirmation-time-test',NULL,
         '[]'::jsonb,'active',$5
       )`,
      [
        randomUUID(),
        confirmationProject.workspaceId,
        confirmationProject.projectId,
        identityId,
        confirmationProject.actorId,
      ],
    );
    await expectPgCode(
      handle.pool.query(
        `UPDATE app.topic_model_revisions
         SET
           status = 'confirmed',
           content_hash = $1,
           confirmed_by = $2,
           confirmed_at = $3
         WHERE workspace_id = $4 AND project_id = $5 AND revision = 15`,
        [
          "c".repeat(64),
          confirmationProject.actorId,
          LEGACY_TIME,
          confirmationProject.workspaceId,
          confirmationProject.projectId,
        ],
      ),
      "23514",
    );
  });

  it("rejects duplicate current aliases even at a later model revision", async () => {
    const source = await handle.pool.query<{ id: string }>(
      `SELECT id
       FROM app.topic_node_identities
       WHERE workspace_id = $1
         AND project_id = $2
         AND initial_cluster_key = 'customer-onboarding'`,
      [primary.workspaceId, primary.projectId],
    );
    revisionTwoSourceIdentityId = source.rows[0]!.id;
    revisionTwoIdentityId = randomUUID();
    revisionTwoSecondIdentityId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         root_topic_node_id, generation_basis, evidence_refs,
         created_by
       ) VALUES (
         $1,$2,$3,2,'draft',NULL,'{"origin":"test"}'::jsonb,
         '[]'::jsonb,$4
       )`,
      [
        randomUUID(),
        primary.workspaceId,
        primary.projectId,
        primary.actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.topic_node_identities (
         id, workspace_id, project_id, created_in_revision,
         initial_cluster_key, created_by
       ) VALUES
         ($1,$2,$3,2,'replacement-onboarding',$4),
         ($5,$2,$3,2,'onboarding-operations',$4)`,
      [
        revisionTwoIdentityId,
        primary.workspaceId,
        primary.projectId,
        primary.actorId,
        revisionTwoSecondIdentityId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.topic_node_revisions (
         id, workspace_id, project_id, topic_node_id,
         topic_model_revision, parent_topic_node_id, label,
         description, intent_envelope, lifecycle_state, created_by
       ) VALUES
         (
           $1,$2,$3,$4,2,NULL,'customer-onboarding',NULL,
           '[]'::jsonb,'superseded',$5
         ),
         (
           $6,$2,$3,$7,2,NULL,'replacement-onboarding',NULL,
           '[]'::jsonb,'active',$5
         ),
         (
           $8,$2,$3,$9,2,NULL,'onboarding-operations',NULL,
           '[]'::jsonb,'active',$5
         )`,
      [
        randomUUID(),
        primary.workspaceId,
        primary.projectId,
        revisionTwoSourceIdentityId,
        primary.actorId,
        randomUUID(),
        revisionTwoIdentityId,
        randomUUID(),
        revisionTwoSecondIdentityId,
      ],
    );
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_cluster_aliases (
           id, workspace_id, project_id, topic_node_id,
           legacy_cluster_key, valid_from_revision, valid_to_revision,
           alias_kind, is_current, created_by
         ) VALUES (
           $1,$2,$3,$4,'customer-onboarding',2,NULL,'rename',true,$5
         )`,
        [
          randomUUID(),
          primary.workspaceId,
          primary.projectId,
          revisionTwoIdentityId,
          primary.actorId,
        ],
      ),
      "23514",
    );

    // Revision two must remain one reachable tree when it is confirmed later
    // in this suite. The superseded predecessor stays in the frozen projection
    // for historical decisions, beneath the active replacement root.
    await handle.pool.query(
      `UPDATE app.topic_node_revisions
       SET parent_topic_node_id = $1
       WHERE workspace_id = $2
         AND project_id = $3
         AND topic_model_revision = 2
         AND topic_node_id <> $1`,
      [
        revisionTwoIdentityId,
        primary.workspaceId,
        primary.projectId,
      ],
    );
    await handle.pool.query(
      `UPDATE app.topic_model_revisions
       SET root_topic_node_id = $1
       WHERE workspace_id = $2
         AND project_id = $3
         AND revision = 2
         AND status = 'draft'`,
      [
        revisionTwoIdentityId,
        primary.workspaceId,
        primary.projectId,
      ],
    );
  });

  it("closes an old alias immediately before a draft rename revision", async () => {
    await handle.pool.query(
      `UPDATE app.topic_cluster_aliases
       SET valid_to_revision = 1, is_current = false
       WHERE workspace_id = $1
         AND project_id = $2
         AND legacy_cluster_key = 'customer-onboarding'
         AND valid_from_revision = 1
         AND is_current`,
      [primary.workspaceId, primary.projectId],
    );
    await handle.pool.query(
      `INSERT INTO app.topic_cluster_aliases (
         id, workspace_id, project_id, topic_node_id,
         legacy_cluster_key, valid_from_revision, valid_to_revision,
         alias_kind, is_current, created_by
       ) VALUES (
         $1,$2,$3,$4,'customer-onboarding',2,NULL,'rename',true,$5
       )`,
      [
        randomUUID(),
        primary.workspaceId,
        primary.projectId,
        revisionTwoIdentityId,
        primary.actorId,
      ],
    );

    const aliases = await handle.pool.query<{
      topic_node_id: string;
      valid_from_revision: number;
      valid_to_revision: number | null;
      is_current: boolean;
    }>(
      `SELECT
         topic_node_id,
         valid_from_revision,
         valid_to_revision,
         is_current
       FROM app.topic_cluster_aliases
       WHERE workspace_id = $1
         AND project_id = $2
         AND legacy_cluster_key = 'customer-onboarding'
       ORDER BY valid_from_revision`,
      [primary.workspaceId, primary.projectId],
    );
    expect(aliases.rows).toEqual([
      {
        topic_node_id: revisionTwoSourceIdentityId,
        valid_from_revision: 1,
        valid_to_revision: 1,
        is_current: false,
      },
      {
        topic_node_id: revisionTwoIdentityId,
        valid_from_revision: 2,
        valid_to_revision: null,
        is_current: true,
      },
    ]);
  });

  it("enforces at most one draft Topic Model per project", async () => {
    const draftProject = await createProject(handle);
    await handle.pool.query(
      `INSERT INTO app.topic_model_revisions (
         id, workspace_id, project_id, revision, status,
         root_topic_node_id, generation_basis, evidence_refs, created_by
       ) VALUES (
         $1,$2,$3,1,'draft',NULL,'{"origin":"one-draft-test"}'::jsonb,
         '[]'::jsonb,$4
       )`,
      [
        randomUUID(),
        draftProject.workspaceId,
        draftProject.projectId,
        draftProject.actorId,
      ],
    );
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_model_revisions (
           id, workspace_id, project_id, revision, status,
           root_topic_node_id, generation_basis, evidence_refs, created_by
         ) VALUES (
           $1,$2,$3,2,'draft',NULL,'{"origin":"second-draft-test"}'::jsonb,
           '[]'::jsonb,$4
         )`,
        [
          randomUUID(),
          draftProject.workspaceId,
          draftProject.projectId,
          draftProject.actorId,
        ],
      ),
      "23505",
    );
  });

  it("prevents split and merge successor relationships from forming cycles", async () => {
    await handle.pool.query(
      `INSERT INTO app.topic_node_successors (
         id, workspace_id, project_id, predecessor_topic_node_id,
         successor_topic_node_id, topic_model_revision, successor_kind,
         created_by, reason
       ) VALUES
         ($1,$2,$3,$4,$5,2,'split_into',$6,'Split test edge.'),
         ($7,$2,$3,$5,$8,2,'merged_into',$6,'Merge test edge.')`,
      [
        randomUUID(),
        primary.workspaceId,
        primary.projectId,
        revisionTwoSourceIdentityId,
        revisionTwoIdentityId,
        primary.actorId,
        randomUUID(),
        revisionTwoSecondIdentityId,
      ],
    );

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_node_successors (
           id, workspace_id, project_id, predecessor_topic_node_id,
           successor_topic_node_id, topic_model_revision, successor_kind,
           created_by, reason
         ) VALUES (
           $1,$2,$3,$4,$5,2,'merged_into',$6,'Cycle must fail.'
         )`,
        [
          randomUUID(),
          primary.workspaceId,
          primary.projectId,
          revisionTwoSecondIdentityId,
          revisionTwoSourceIdentityId,
          primary.actorId,
        ],
      ),
      "23514",
    );

    await handle.pool.query(
      `UPDATE app.topic_model_revisions
       SET
         status = 'confirmed',
         content_hash = $1,
         confirmed_by = $2,
         confirmed_at = statement_timestamp()
       WHERE workspace_id = $3 AND project_id = $4 AND revision = 2`,
      [
        "a".repeat(64),
        primary.actorId,
        primary.workspaceId,
        primary.projectId,
      ],
    );
  });

  it("rejects aliases and successors appended after model confirmation", async () => {
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_cluster_aliases (
           id, workspace_id, project_id, topic_node_id,
           legacy_cluster_key, valid_from_revision, valid_to_revision,
           alias_kind, is_current, created_by
         ) VALUES (
           $1,$2,$3,$4,'post-confirmation-alias',2,NULL,'canonical',true,$5
         )`,
        [
          randomUUID(),
          primary.workspaceId,
          primary.projectId,
          revisionTwoIdentityId,
          primary.actorId,
        ],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.topic_node_successors (
           id, workspace_id, project_id, predecessor_topic_node_id,
           successor_topic_node_id, topic_model_revision, successor_kind,
           created_by, reason
         ) VALUES (
           $1,$2,$3,$4,$5,2,'split_into',$6,
           'Post-confirmation append must fail.'
         )`,
        [
          randomUUID(),
          primary.workspaceId,
          primary.projectId,
          revisionTwoSourceIdentityId,
          revisionTwoSecondIdentityId,
          primary.actorId,
        ],
      ),
      "55000",
    );
  });

  it("retains aliases referenced by frozen baseline decisions", async () => {
    await expectPgCode(
      handle.pool.query(
        `DELETE FROM app.topic_cluster_aliases
         WHERE workspace_id = $1
           AND project_id = $2
           AND legacy_cluster_key = 'customer-onboarding'
           AND is_current`,
        [primary.workspaceId, primary.projectId],
      ),
      "55000",
    );
    const retained = await handle.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.topic_cluster_aliases
       WHERE workspace_id = $1
         AND project_id = $2
         AND legacy_cluster_key = 'customer-onboarding'`,
      [primary.workspaceId, primary.projectId],
    );
    expect(retained.rows).toEqual([{ count: "2" }]);
  });

  it("runs begin, CAS patch, split invalidation, alias isolation, and confirmation atomically", async () => {
    const project = await createProject(handle);
    const keyword = await createLegacyKeyword(handle, project, {
      displayKeyword: "customer onboarding automation platform",
      status: "approved",
      intent: "commercial",
      buyerStage: "decision",
      clusterKey: "customer-onboarding",
      mappingDecision: "new_asset",
      mappedSitePageId: null,
      reviewState: "confirmed",
      mappingRevision: 0,
    });

    // The assertions above intentionally exercise the authentic 0024 schema.
    // Current repository code must instead run against the complete ordered
    // production schema; seed this non-default legacy row before 0032 installs
    // the initial-candidate trigger, then upgrade through the current head.
    await applyMigrationsAfter(handle.pool, MIGRATION_FILE);

    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };
    const repository = new TopicModelsRepository(handle.db);
    const resolver = new TopicClusterResolverRepository(handle.db);

    const initialDraft = await repository.beginDraftFromLatestConfirmed(
      scope,
      project.actorId,
      {
        expectedLatestConfirmedRevision: 0,
        reason: "Create the initial governed Topic tree.",
      },
    );
    expect(initialDraft).toMatchObject({
      state: "draft",
      topicModelRevision: 1,
      editRevision: 0,
      rootTopicNodeId: null,
      nodes: [],
    });

    const withRoot = await repository.patchDraft(
      scope,
      project.actorId,
      {
        topicModelRevision: 1,
        expectedEditRevision: 0,
        reason: "Create the server-owned Topic root.",
        intents: [
          {
            kind: "create",
            parentTopicNodeId: null,
            label: "Customer onboarding",
            description: "Primary customer onboarding demand.",
            intentEnvelope: ["commercial"],
          },
        ],
      },
    );
    const root = withRoot.nodes[0]!;
    expect(root.topicNodeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(withRoot).toMatchObject({
      editRevision: 1,
      rootTopicNodeId: root.topicNodeId,
    });

    const withChild = await repository.patchDraft(
      scope,
      project.actorId,
      {
        topicModelRevision: 1,
        expectedEditRevision: 1,
        reason: "Attach the first child Topic.",
        intents: [
          {
            kind: "create",
            parentTopicNodeId: root.topicNodeId,
            label: "Onboarding checklist",
            description: null,
            intentEnvelope: ["informational"],
          },
        ],
      },
    );
    expect(withChild.editRevision).toBe(2);

    const firstConfirmed = await repository.confirmDraft(
      scope,
      project.actorId,
      {
        topicModelRevision: 1,
        expectedEditRevision: 2,
        reason: "Confirm the initial Topic tree.",
      },
    );
    expect(firstConfirmed).toMatchObject({
      state: "confirmed",
      topicModelRevision: 1,
      editRevision: 2,
      rootTopicNodeId: root.topicNodeId,
    });
    await expect(
      resolver.resolveAliasAtConfirmedRevision(
        scope,
        "customer-onboarding",
        1,
      ),
    ).resolves.toMatchObject({
      version: 2,
      topicNodeId: root.topicNodeId,
      topicModelRevision: 1,
    });

    await handle.pool.query(
      `INSERT INTO app.keyword_review_decisions (
         id, workspace_id, project_id, keyword_entity_id,
         governance_revision, decision_origin, status, intent, buyer_stage,
         topic_node_id, topic_model_revision, cluster_key_at_decision,
         mapping_decision, mapped_site_page_id, review_state,
         assignment_invalidated_by, decided_by, reason, decided_at,
         reviewed_projection
       ) VALUES (
         $1,$2,$3,$4,0,'migration_baseline','approved','commercial',
         'decision',$5,1,'customer-onboarding','new_asset',NULL,'confirmed',
         NULL,NULL,'Seed current governed assignment.',$6,$7
       )`,
      [
        randomUUID(),
        project.workspaceId,
        project.projectId,
        keyword.id,
        root.topicNodeId,
        LEGACY_TIME,
        {
          projectId: project.projectId,
          keywordId: keyword.id,
          governanceRevision: 0,
          status: "approved",
          intent: "commercial",
          buyerStage: "decision",
          topicNodeId: root.topicNodeId,
          topicModelRevision: 1,
          clusterKey: "customer-onboarding",
          mappingDecision: "new_asset",
          mappedSitePageId: null,
          mappingReviewState: "confirmed",
          assignmentInvalidatedBy: null,
          earlierHistoryAvailable: false,
        },
      ],
    );

    const splitDraft = await repository.beginDraftFromLatestConfirmed(
      scope,
      project.actorId,
      {
        expectedLatestConfirmedRevision: 1,
        reason: "Split the broad Topic into executable paths.",
      },
    );
    expect(splitDraft).toMatchObject({
      topicModelRevision: 2,
      editRevision: 0,
    });
    await expect(
      repository.beginDraftFromLatestConfirmed(
        scope,
        project.actorId,
        {
          expectedLatestConfirmedRevision: 1,
          reason: "A second draft must not be admitted.",
        },
      ),
    ).rejects.toMatchObject({
      name: "TopicModelConflictError",
      code: "DRAFT_EXISTS",
    });

    const split = await repository.patchDraft(
      scope,
      project.actorId,
      {
        topicModelRevision: 2,
        expectedEditRevision: 0,
        reason: "Split after keyword and SERP review.",
        intents: [
          {
            kind: "split",
            sourceTopicNodeId: root.topicNodeId,
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
      },
    );
    expect(split.editRevision).toBe(1);
    expect(split.nodes.filter((node) => node.lifecycleState === "active"))
      .toHaveLength(3);

    await expect(
      repository.patchDraft(scope, project.actorId, {
        topicModelRevision: 2,
        expectedEditRevision: 0,
        reason: "A stale draft edit must fail.",
        intents: [
          {
            kind: "rename",
            topicNodeId: root.topicNodeId,
            label: "Stale rename",
          },
        ],
      }),
    ).rejects.toMatchObject({
      name: "TopicModelConflictError",
      code: "EDIT_REVISION_CONFLICT",
      expectedRevision: 0,
      currentRevision: 1,
    } satisfies Partial<TopicModelConflictError>);
    await expect(
      repository.confirmDraft(scope, project.actorId, {
        topicModelRevision: 2,
        expectedEditRevision: 0,
        reason: "A stale confirmation must fail.",
      }),
    ).rejects.toMatchObject({
      name: "TopicModelConflictError",
      code: "EDIT_REVISION_CONFLICT",
    });

    const successor = split.nodes.find(
      (node) => node.label === "Onboarding automation",
    )!;
    await expect(
      resolver.resolveAliasAtConfirmedRevision(
        scope,
        "onboarding-automation",
        2,
      ),
    ).resolves.toBeNull();
    await expect(repository.getLatestConfirmed(scope)).resolves.toMatchObject({
      topicModelRevision: 1,
      rootTopicNodeId: root.topicNodeId,
    });

    const confirmedSplit = await repository.confirmDraft(
      scope,
      project.actorId,
      {
        topicModelRevision: 2,
        expectedEditRevision: 1,
        reason: "Confirm the reviewed split and invalidate old assignments.",
      },
    );
    expect(confirmedSplit).toMatchObject({
      state: "confirmed",
      topicModelRevision: 2,
      editRevision: 1,
      rootTopicNodeId: successor.topicNodeId,
    });
    await expect(
      resolver.resolveAliasAtConfirmedRevision(
        scope,
        "onboarding-automation",
        2,
      ),
    ).resolves.toMatchObject({
      version: 2,
      topicNodeId: successor.topicNodeId,
      topicModelRevision: 2,
    });

    const mirror = await handle.pool.query<{
      mapping_review_state: string;
      mapping_revision: number;
    }>(
      `SELECT mapping_review_state, mapping_revision
       FROM app.keyword_entities
       WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [project.workspaceId, project.projectId, keyword.id],
    );
    expect(mirror.rows).toEqual([
      {
        mapping_review_state: "unreviewed",
        mapping_revision: 1,
      },
    ]);
    const decisions = await handle.pool.query<{
      governance_revision: number;
      decision_origin: string;
      review_state: string;
      assignment_invalidated_by: string | null;
    }>(
      `SELECT
         governance_revision,
         decision_origin,
         review_state,
         assignment_invalidated_by
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3
       ORDER BY governance_revision`,
      [project.workspaceId, project.projectId, keyword.id],
    );
    expect(decisions.rows).toEqual([
      {
        governance_revision: 0,
        decision_origin: "migration_baseline",
        review_state: "confirmed",
        assignment_invalidated_by: null,
      },
      {
        governance_revision: 1,
        decision_origin: "system_suggestion",
        review_state: "unreviewed",
        assignment_invalidated_by: "topic_split",
      },
    ]);
  });
});
