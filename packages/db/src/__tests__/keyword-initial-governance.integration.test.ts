import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { listMigrationFiles } from "../migrate.ts";
import {
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
} from "../repositories/keyword-governance.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const SHARED_DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = SHARED_DATABASE_URL ? describe : describe.skip;
const MIGRATION_FILE = "0032_keyword_initial_governance.sql";
const DATABASE_NAME =
  `signalframe_ci_keyword_initial_${randomBytes(6).toString("hex")}`;
const DATABASE_NAME_PATTERN =
  /^signalframe_ci_keyword_initial_[a-f0-9]{12}$/u;
const UPGRADE_DATABASE_NAME =
  `signalframe_ci_keyword_upgrade_${randomBytes(6).toString("hex")}`;
const UPGRADE_DATABASE_NAME_PATTERN =
  /^signalframe_ci_keyword_upgrade_[a-f0-9]{12}$/u;

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
    "keyword initial governance database URL",
  );
}

function upgradeDatabaseIdentifier(): string {
  if (!UPGRADE_DATABASE_NAME_PATTERN.test(UPGRADE_DATABASE_NAME)) {
    throw new Error(
      "generated upgrade database name failed the disposable-name policy",
    );
  }
  return `"${UPGRADE_DATABASE_NAME}"`;
}

function upgradeDatabaseUrl(): string {
  const url = new URL(sharedDatabaseUrl());
  url.pathname = `/${UPGRADE_DATABASE_NAME}`;
  return requireSafeTestDatabaseUrl(
    url.toString(),
    "keyword upgrade database URL",
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

async function waitForRelationLock(
  observer: pg.Client,
  backendPid: number,
  relationName: string,
  mode: string,
  granted: boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 2_048; attempt += 1) {
    const result = await observer.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_locks
         WHERE pid = $1
           AND relation = $2::regclass
           AND mode = $3
           AND granted = $4
       ) AS present`,
      [backendPid, relationName, mode, granted],
    );
    if (result.rows[0]?.present === true) {
      return;
    }
  }

  const observed = await observer.query<{
    relation_name: string | null;
    mode: string;
    granted: boolean;
  }>(
    `SELECT
       relation::regclass::text AS relation_name,
       mode,
       granted
     FROM pg_locks
     WHERE pid = $1
     ORDER BY relation_name, mode, granted`,
    [backendPid],
  );
  throw new Error(
    `backend did not reach the expected ${granted ? "granted" : "waiting"} relation lock: ${JSON.stringify(observed.rows)}`,
  );
}

describeDb("0032 initial Keyword Review authority", () => {
  let handle: DbHandle;
  let databaseCreated = false;
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const defaultKeywordId = randomUUID();
  const nonzeroKeywordId = randomUUID();
  const nondefaultKeywordId = randomUUID();
  const postMigrationKeywordId = randomUUID();

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
      "0031_pgcrypto_digest_compatibility.sql",
    );

    const migrationClient = new pg.Client({
      connectionString: disposableDatabaseUrl(),
    });
    await migrationClient.connect();
    try {
      for (const migrationFile of migrationFiles.slice(0, migrationIndex)) {
        await applyMigration(migrationClient, migrationFile);
      }
    } finally {
      await migrationClient.end();
    }

    handle = createDbHandle(disposableDatabaseUrl());
    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
      [workspaceId, `Keyword initial governance ${workspaceId}`],
    );
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
    await handle.pool.query(
      `INSERT INTO app.keyword_entities (
         id, workspace_id, project_id, display_keyword, normalized_keyword,
         market, language_tag, query_kind, status, mapping_revision,
         first_seen_at, last_seen_at
       ) VALUES
         ($1,$4,$5,'Initial Candidate','initial candidate',
          'US','en-US','search_query','candidate',0,now(),now()),
         ($2,$4,$5,'Lost Nonzero History','lost nonzero history',
          'US','en-US','search_query','candidate',3,now(),now()),
         ($3,$4,$5,'Nondefault Revision Zero','nondefault revision zero',
          'US','en-US','search_query','approved',0,now(),now())`,
      [
        defaultKeywordId,
        nonzeroKeywordId,
        nondefaultKeywordId,
        workspaceId,
        projectId,
      ],
    );

    await applyMigration(handle.pool, MIGRATION_FILE);
    await applyMigration(handle.pool, MIGRATION_FILE);
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

  it("idempotently backfills the exact default revision-zero state as one readable current decision", async () => {
    const rows = await handle.pool.query<{
      governance_revision: number;
      decision_origin: string;
      status: string;
      intent: string | null;
      buyer_stage: string | null;
      topic_node_id: string | null;
      topic_model_revision: number | null;
      cluster_key_at_decision: string | null;
      mapping_decision: string;
      mapped_site_page_id: string | null;
      review_state: string;
      assignment_invalidated_by: string | null;
      decided_by: string | null;
      reason: string;
      reviewed_projection: Record<string, unknown>;
    }>(
      `SELECT
         governance_revision,
         decision_origin,
         status,
         intent,
         buyer_stage,
         topic_node_id,
         topic_model_revision,
         cluster_key_at_decision,
         mapping_decision,
         mapped_site_page_id,
         review_state,
         assignment_invalidated_by,
         decided_by,
         reason,
         reviewed_projection
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3`,
      [workspaceId, projectId, defaultKeywordId],
    );
    expect(rows.rows).toEqual([
      {
        governance_revision: 0,
        decision_origin: "system_suggestion",
        status: "candidate",
        intent: null,
        buyer_stage: null,
        topic_node_id: null,
        topic_model_revision: null,
        cluster_key_at_decision: null,
        mapping_decision: "unassigned",
        mapped_site_page_id: null,
        review_state: "unreviewed",
        assignment_invalidated_by: null,
        decided_by: null,
        reason: "Keyword ingestion generated the initial candidate decision.",
        reviewed_projection: {
          projectId,
          keywordId: defaultKeywordId,
          status: "candidate",
          intent: null,
          buyerStage: null,
          topicNodeId: null,
          topicModelRevision: null,
          clusterKey: null,
          mappingDecision: "unassigned",
          mappedSitePageId: null,
          mappingReviewState: "unreviewed",
          governanceRevision: 0,
          assignmentInvalidatedBy: null,
          earlierHistoryAvailable: false,
        },
      },
    ]);
    await expect(
      new KeywordGovernanceRepository(handle.db).findCurrent(
        { workspaceId, projectId },
        defaultKeywordId,
      ),
    ).resolves.toMatchObject({
      decision: {
        governanceRevision: 0,
        decisionOrigin: "system_suggestion",
        decidedBy: null,
      },
      reviewedProjection: {
        earlierHistoryAvailable: false,
      },
    });
  });

  it.each([
    ["nonzero", nonzeroKeywordId],
    ["nondefault", nondefaultKeywordId],
  ])(
    "leaves the corrupt %s missing-ledger state visible to fail-closed readers",
    async (_label, keywordId) => {
      const rows = await handle.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM app.keyword_review_decisions
         WHERE workspace_id = $1
           AND project_id = $2
           AND keyword_entity_id = $3`,
        [workspaceId, projectId, keywordId],
      );
      expect(rows.rows).toEqual([{ count: "0" }]);
      await expect(
        new KeywordGovernanceRepository(handle.db).findCurrent(
          { workspaceId, projectId },
          keywordId,
        ),
      ).rejects.toMatchObject(
        new KeywordGovernanceIntegrityError("CURRENT_DECISION_MISSING"),
      );
    },
  );

  it("atomically initializes every post-migration default insert with one actorless system decision", async () => {
    await handle.pool.query(
      `INSERT INTO app.keyword_entities (
         id, workspace_id, project_id, display_keyword, normalized_keyword,
         market, language_tag, query_kind, first_seen_at, last_seen_at
       ) VALUES (
         $1,$2,$3,'Post Migration Candidate','post migration candidate',
         'US','en-US','search_query',
         '2026-07-28T08:00:00.000Z','2026-07-28T08:00:00.000Z'
       )`,
      [postMigrationKeywordId, workspaceId, projectId],
    );

    const rows = await handle.pool.query<{
      count: string;
      decision_origin: string;
      decided_by: string | null;
    }>(
      `SELECT
         count(*)::text AS count,
         min(decision_origin) AS decision_origin,
         min(decided_by::text) AS decided_by
       FROM app.keyword_review_decisions
       WHERE workspace_id = $1
         AND project_id = $2
         AND keyword_entity_id = $3`,
      [workspaceId, projectId, postMigrationKeywordId],
    );
    expect(rows.rows).toEqual([
      {
        count: "1",
        decision_origin: "system_suggestion",
        decided_by: null,
      },
    ]);
  });

  it("preserves one explicit governed instant and rejects review mutation without a monotonic instant", async () => {
    await expect(
      handle.pool.query(
        `UPDATE app.keyword_entities
         SET status = 'parked', mapping_revision = 1
         WHERE workspace_id = $1
           AND project_id = $2
           AND id = $3`,
        [workspaceId, projectId, postMigrationKeywordId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const decidedAt = "2030-07-28T08:00:01.000Z";
    const reviewed = await new KeywordGovernanceRepository(handle.db, {
      newId: randomUUID,
      now: () => decidedAt,
    }).reviewKeyword(
      { workspaceId, projectId },
      postMigrationKeywordId,
      actorId,
      {
        expectedGovernanceRevision: 0,
        status: "excluded",
        intent: null,
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "Exclude the deterministic ingestion candidate.",
      },
    );

    expect(reviewed).toMatchObject({
      decision: {
        governanceRevision: 1,
        decisionOrigin: "user",
        decidedAt,
      },
      projection: {
        governanceRevision: 1,
        updatedAt: decidedAt,
      },
    });
    const instants = await handle.pool.query<{
      entity_updated_at: string;
      decision_decided_at: string;
    }>(
      `SELECT
         entity.updated_at::text AS entity_updated_at,
         decision.decided_at::text AS decision_decided_at
       FROM app.keyword_entities entity
       JOIN app.keyword_review_decisions decision
         ON decision.workspace_id = entity.workspace_id
        AND decision.project_id = entity.project_id
        AND decision.keyword_entity_id = entity.id
        AND decision.governance_revision = entity.mapping_revision
       WHERE entity.workspace_id = $1
         AND entity.project_id = $2
         AND entity.id = $3`,
      [workspaceId, projectId, postMigrationKeywordId],
    );
    expect(instants.rows).toHaveLength(1);
    expect(instants.rows[0]?.entity_updated_at).toBe(
      instants.rows[0]?.decision_decided_at,
    );
  });
});

describeDb("0031 to 0032 Keyword ingestion upgrade fence", () => {
  let databaseCreated = false;
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const beforeFenceKeywordId = randomUUID();
  const afterFenceKeywordId = randomUUID();

  beforeAll(async () => {
    await withMaintenanceClient(async (client) => {
      await client.query(
        `CREATE DATABASE ${upgradeDatabaseIdentifier()} TEMPLATE template0`,
      );
      databaseCreated = true;
    });

    const migrationFiles = listMigrationFiles();
    const migrationIndex = migrationFiles.indexOf(MIGRATION_FILE);
    expect(migrationIndex).toBeGreaterThan(0);
    expect(migrationFiles[migrationIndex - 1]).toBe(
      "0031_pgcrypto_digest_compatibility.sql",
    );

    const setupClient = new pg.Client({
      connectionString: upgradeDatabaseUrl(),
    });
    await setupClient.connect();
    try {
      for (const migrationFile of migrationFiles.slice(0, migrationIndex)) {
        await applyMigration(setupClient, migrationFile);
      }
      await setupClient.query(
        "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
        [workspaceId, `Keyword upgrade fence ${workspaceId}`],
      );
      await setupClient.query(
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
    } finally {
      await setupClient.end();
    }
  });

  afterAll(async () => {
    if (databaseCreated) {
      await withMaintenanceClient(async (client) => {
        await client.query(
          `DROP DATABASE IF EXISTS ${upgradeDatabaseIdentifier()} WITH (FORCE)`,
        );
      });
    }
  });

  it("fences old and queued writers across the live 0032 trigger upgrade", async () => {
    const writer = new pg.Client({ connectionString: upgradeDatabaseUrl() });
    const migrator = new pg.Client({ connectionString: upgradeDatabaseUrl() });
    const observer = new pg.Client({ connectionString: upgradeDatabaseUrl() });
    let beforeFenceTransactionOpen = false;
    let observerTransactionOpen = false;
    let migrationOutcome:
      | Promise<
        | { readonly ok: true }
        | { readonly ok: false; readonly error: unknown }
      >
      | undefined;
    let queuedWriterOutcome:
      | Promise<
        | { readonly ok: true }
        | { readonly ok: false; readonly error: unknown }
      >
      | undefined;

    await Promise.all([
      writer.connect(),
      migrator.connect(),
      observer.connect(),
    ]);

    try {
      const writerPidResult = await writer.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const migratorPidResult = await migrator.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const writerPid = writerPidResult.rows[0]?.pid;
      const migratorPid = migratorPidResult.rows[0]?.pid;
      if (writerPid === undefined || migratorPid === undefined) {
        throw new Error("database backend pid is unavailable");
      }

      // Hold the view that 0032 replaces at its transaction boundary. This
      // keeps the DDL transaction open after it owns the keyword table fence,
      // giving the test a deterministic point at which to queue the next
      // writer and inspect both lock states without timing sleeps.
      await observer.query("BEGIN");
      observerTransactionOpen = true;
      await observer.query(
        "SELECT migration_version FROM app.schema_migration_version",
      );

      await writer.query("BEGIN");
      beforeFenceTransactionOpen = true;
      await writer.query(
        `INSERT INTO app.keyword_entities (
           id, workspace_id, project_id, display_keyword, normalized_keyword,
           market, language_tag, query_kind, first_seen_at, last_seen_at
         ) VALUES (
           $1,$2,$3,'Before Fence Candidate','before fence candidate',
           'US','en-US','search_query',
           '2026-07-28T08:00:00.000Z','2026-07-28T08:00:00.000Z'
         )`,
        [beforeFenceKeywordId, workspaceId, projectId],
      );

      migrationOutcome = applyMigration(migrator, MIGRATION_FILE).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await waitForRelationLock(
        observer,
        migratorPid,
        "app.keyword_entities",
        "ShareRowExclusiveLock",
        false,
      );

      await writer.query("COMMIT");
      beforeFenceTransactionOpen = false;

      await waitForRelationLock(
        observer,
        migratorPid,
        "app.keyword_entities",
        "ShareRowExclusiveLock",
        true,
      );
      await waitForRelationLock(
        observer,
        migratorPid,
        "app.schema_migration_version",
        "AccessExclusiveLock",
        false,
      );

      queuedWriterOutcome = writer.query(
        `INSERT INTO app.keyword_entities (
           id, workspace_id, project_id, display_keyword, normalized_keyword,
           market, language_tag, query_kind, first_seen_at, last_seen_at
         ) VALUES (
           $1,$2,$3,'After Fence Candidate','after fence candidate',
           'US','en-US','search_query',
           '2026-07-28T08:00:01.000Z','2026-07-28T08:00:01.000Z'
         )`,
        [afterFenceKeywordId, workspaceId, projectId],
      ).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await waitForRelationLock(
        observer,
        writerPid,
        "app.keyword_entities",
        "RowExclusiveLock",
        false,
      );

      await observer.query("COMMIT");
      observerTransactionOpen = false;

      expect(await migrationOutcome).toEqual({ ok: true });
      expect(await queuedWriterOutcome).toEqual({ ok: true });
    } finally {
      if (observerTransactionOpen) {
        await observer.query("ROLLBACK").catch(() => undefined);
      }
      if (beforeFenceTransactionOpen) {
        await writer.query("ROLLBACK").catch(() => undefined);
      }
      await migrationOutcome?.catch(() => undefined);
      await queuedWriterOutcome?.catch(() => undefined);
      await Promise.all([
        writer.end(),
        migrator.end(),
        observer.end(),
      ]);
    }

    const readHandle = createDbHandle(upgradeDatabaseUrl());
    try {
      const repository = new KeywordGovernanceRepository(readHandle.db);
      for (const keywordId of [
        beforeFenceKeywordId,
        afterFenceKeywordId,
      ]) {
        const rows = await readHandle.pool.query<{
          count: string;
          minimum_revision: number;
          maximum_revision: number;
          decision_origin: string;
          decided_by: string | null;
        }>(
          `SELECT
             count(*)::text AS count,
             min(governance_revision) AS minimum_revision,
             max(governance_revision) AS maximum_revision,
             min(decision_origin) AS decision_origin,
             min(decided_by::text) AS decided_by
           FROM app.keyword_review_decisions
           WHERE workspace_id = $1
             AND project_id = $2
             AND keyword_entity_id = $3`,
          [workspaceId, projectId, keywordId],
        );
        expect(rows.rows).toEqual([
          {
            count: "1",
            minimum_revision: 0,
            maximum_revision: 0,
            decision_origin: "system_suggestion",
            decided_by: null,
          },
        ]);
        await expect(
          repository.findCurrent(
            { workspaceId, projectId },
            keywordId,
          ),
        ).resolves.toMatchObject({
          decision: {
            governanceRevision: 0,
            decisionOrigin: "system_suggestion",
            decidedBy: null,
          },
          reviewedProjection: {
            earlierHistoryAvailable: false,
          },
        });
      }
    } finally {
      await readHandle.end();
    }
  });
});
