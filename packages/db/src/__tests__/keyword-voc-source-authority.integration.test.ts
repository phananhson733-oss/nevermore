import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { KeywordOccurrencesRepository } from "../repositories/keyword-occurrences.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CAPTURED_AT = "2026-07-28T02:00:00.000Z";
const DATA_AS_OF = "2026-07-27T00:00:00.000Z";

type SourceKind = "interview_summary" | "user_review";

interface SourceFixture {
  readonly kind: SourceKind;
  readonly runId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly recordHash: string;
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

async function expectPgConstraint(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === "23514",
  );
}

describeDb("0029 Keyword VOC source authority", () => {
  let handle: DbHandle;
  const ids = {
    workspace: randomUUID(),
    project: randomUUID(),
    site: randomUUID(),
    actor: randomUUID(),
  };
  const fixtures = new Map<SourceKind, SourceFixture>();

  async function createSource(kind: SourceKind): Promise<SourceFixture> {
    const runId = randomUUID();
    const snapshotId = randomUUID();
    const observationId = randomUUID();
    const isInterview = kind === "interview_summary";
    const dataset = isInterview
      ? "voc.interview_summary.v1"
      : "voc.user_review.v1";
    const recordHash = isInterview ? "a".repeat(64) : "b".repeat(64);
    const keyword = isInterview
      ? "customer onboarding handoff"
      : "customer onboarding reporting";
    const evidenceScope = isInterview
      ? {
          sourceKind: kind,
          basis: "customer_research",
          marketCode: "US",
          languageTag: "en-US",
        }
      : {
          sourceKind: kind,
          basis: "public_review_platform",
          marketCode: "US",
          languageTag: "en-US",
          reviewPlatform: "g2",
        };
    const value = isInterview
      ? {
          keyword,
          marketCode: "US",
          languageCode: "en-US",
          providerDataAsOf: DATA_AS_OF,
          evidenceLabel: "已脱敏访谈摘要 · 客户运营负责人",
          sourceRecordHash: recordHash,
        }
      : {
          keyword,
          marketCode: "US",
          languageCode: "en-US",
          providerDataAsOf: DATA_AS_OF,
          evidenceLabel: "G2 用户评价摘要",
          sourceRecordHash: recordHash,
          reviewPlatform: "g2",
          sourceUrl: "https://www.g2.com/products/relayops/reviews",
        };

    await handle.pool.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status, active_key,
         contract_version, request_payload, initiated_by
       ) VALUES ($1,$2,$3,'collection','queued',$4,'voc-keyword-v1',$5,$6)`,
      [
        runId,
        ids.workspace,
        ids.project,
        `voc:${kind}:${runId}`,
        { siteId: ids.site, sourceKind: kind },
        ids.actor,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.collection_runs (
         id, workspace_id, project_id, site_id, provider, operation,
         method_version, parameters_hash
       ) VALUES (
         $1,$2,$3,$4,'voc','keyword_evidence_collection',$5,$6
       )`,
      [
        runId,
        ids.workspace,
        ids.project,
        ids.site,
        dataset,
        isInterview ? "1".repeat(64) : "2".repeat(64),
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.data_snapshots (
         id, workspace_id, project_id, site_id, collection_run_id,
         source_connection_id, provider, dataset_key, schema_version,
         method_version, captured_at, source_window, availability,
         limitation, row_count, checksum, summary
       ) VALUES (
         $1,$2,$3,$4,$5,NULL,'voc',$6,'1',$6,$7,
         '{"start":null,"end":null}'::jsonb,'available',$8,1,$9,$10
       )`,
      [
        snapshotId,
        ids.workspace,
        ids.project,
        ids.site,
        runId,
        dataset,
        CAPTURED_AT,
        isInterview
          ? "仅含脱敏访谈摘要抽取结果，不含访谈全文或参与者身份。"
          : "仅含公开评价的脱敏摘要证据，不代表全部用户评价。",
        isInterview ? "3".repeat(64) : "4".repeat(64),
        {
          keywordEvidenceScope: evidenceScope,
          timing: {
            collectedAt: CAPTURED_AT,
            dataAsOf: DATA_AS_OF,
          },
        },
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.normalized_observations (
         id, workspace_id, project_id, snapshot_id, provider, metric_key,
         subject_type, subject_ref, observed_at, availability, value_json,
         origin, grade, support, limitation
       ) VALUES (
         $1,$2,$3,$4,'voc','voc.keyword_evidence.v1',
         'keyword_cluster',$5,$6,'available',$7,$8,$9,'context',$10
       )`,
      [
        observationId,
        ids.workspace,
        ids.project,
        snapshotId,
        `voc:${recordHash}`,
        CAPTURED_AT,
        value,
        isInterview ? "user_provided" : "direct_public",
        isInterview ? "C" : "B",
        isInterview
          ? "脱敏访谈摘要只能证明该研究样本中的用语。"
          : "公开评价摘要只能证明本次采集范围中的用语。",
      ],
    );
    await handle.pool.query(
      "UPDATE app.collection_runs SET row_count = 1 WHERE id = $1",
      [runId],
    );

    const fixture = {
      kind,
      runId,
      snapshotId,
      observationId,
      recordHash,
    };
    fixtures.set(kind, fixture);
    return fixture;
  }

  beforeAll(async () => {
    handle = createDbHandle(requireSafeTestDatabaseUrl(DATABASE_URL));
    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
      [ids.workspace, `VOC Keyword ${ids.workspace}`],
    );
    await handle.pool.query(
      `INSERT INTO app.client_projects (
         id, workspace_id, client_name, project_name,
         default_delivery_locale, created_by
       ) VALUES ($1,$2,$3,$4,'zh-CN',$5)`,
      [
        ids.project,
        ids.workspace,
        "VOC Keyword client",
        `VOC Keyword project ${ids.project}`,
        ids.actor,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES (
         $1,$2,$3,'https://voc-keyword.example','voc-keyword.example',
         ARRAY['US'],ARRAY['en-US'],true
       )`,
      [ids.site, ids.workspace, ids.project],
    );
    await createSource("interview_summary");
    await createSource("user_review");
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("writes both built-in sources into one stable Keyword Library", async () => {
    const repo = new KeywordOccurrencesRepository(handle.db);
    const scope = {
      workspaceId: ids.workspace,
      projectId: ids.project,
    };
    const interview = fixtures.get("interview_summary")!;
    const review = fixtures.get("user_review")!;

    const interviewResult = await repo.upsertIntoLibrary(scope, {
      manualEntryId: null,
      dataSnapshotId: interview.snapshotId,
      normalizedObservationId: interview.observationId,
      displayKeyword: "customer onboarding handoff",
      normalizedKeyword: "customer onboarding handoff",
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "interview_summary",
      scopeBasis: "user_provided",
      sourcePointer: "/valueJson/keyword",
      sourceRef:
        `observation:${interview.observationId}#/valueJson/keyword`,
      collectedAt: CAPTURED_AT,
      providerDataAsOf: DATA_AS_OF,
    });
    const reviewResult = await repo.upsertIntoLibrary(scope, {
      manualEntryId: null,
      dataSnapshotId: review.snapshotId,
      normalizedObservationId: review.observationId,
      displayKeyword: "customer onboarding reporting",
      normalizedKeyword: "customer onboarding reporting",
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "user_review",
      scopeBasis: "provider_collection_scope",
      sourcePointer: "/valueJson/keyword",
      sourceRef: `observation:${review.observationId}#/valueJson/keyword`,
      collectedAt: CAPTURED_AT,
      providerDataAsOf: DATA_AS_OF,
    });

    expect(interviewResult.entityId).not.toBe(reviewResult.entityId);
    const stored = await handle.pool.query<{
      source_kind: string;
      scope_basis: string;
      source_pointer: string;
      normalized_observation_id: string;
      data_snapshot_id: string;
    }>(
      `SELECT source_kind, scope_basis, source_pointer,
              normalized_observation_id, data_snapshot_id
       FROM app.keyword_occurrences
       WHERE workspace_id = $1 AND project_id = $2
       ORDER BY source_kind`,
      [ids.workspace, ids.project],
    );
    expect(stored.rows).toEqual([
      {
        source_kind: "interview_summary",
        scope_basis: "user_provided",
        source_pointer: "/valueJson/keyword",
        normalized_observation_id: interview.observationId,
        data_snapshot_id: interview.snapshotId,
      },
      {
        source_kind: "user_review",
        scope_basis: "provider_collection_scope",
        source_pointer: "/valueJson/keyword",
        normalized_observation_id: review.observationId,
        data_snapshot_id: review.snapshotId,
      },
    ]);
  });

  it("rejects raw participant or review fields from customer-safe observations", async () => {
    const interview = fixtures.get("interview_summary")!;
    await expectPgConstraint(
      handle.pool.query(
        `INSERT INTO app.normalized_observations (
           id, workspace_id, project_id, snapshot_id, provider, metric_key,
           subject_type, subject_ref, observed_at, availability, value_json,
           origin, grade, support, limitation
         ) VALUES (
           $1,$2,$3,$4,'voc','voc.keyword_evidence.v1',
           'keyword_cluster',$5,$6,'available',$7,
           'user_provided','C','context','Must be rejected.'
         )`,
        [
          randomUUID(),
          ids.workspace,
          ids.project,
          interview.snapshotId,
          `voc:${"c".repeat(64)}`,
          CAPTURED_AT,
          {
            keyword: "private interview phrase",
            marketCode: "US",
            languageCode: "en-US",
            providerDataAsOf: DATA_AS_OF,
            evidenceLabel: "访谈摘要",
            sourceRecordHash: "c".repeat(64),
            participantEmail: "person@example.com",
            transcript: "raw interview text",
          },
        ],
      ),
    );
  });

  it("rejects cross-source occurrence lineage", async () => {
    const interview = fixtures.get("interview_summary")!;
    const repo = new KeywordOccurrencesRepository(handle.db);
    await expectPgConstraint(
      repo.upsertIntoLibrary(
        {
          workspaceId: ids.workspace,
          projectId: ids.project,
        },
        {
          manualEntryId: null,
          dataSnapshotId: interview.snapshotId,
          normalizedObservationId: interview.observationId,
          displayKeyword: "customer onboarding handoff",
          normalizedKeyword: "customer onboarding handoff",
          market: "US",
          languageTag: "en-US",
          queryKind: "search_query",
          sourceKind: "user_review",
          scopeBasis: "provider_collection_scope",
          sourcePointer: "/valueJson/keyword",
          sourceRef:
            `observation:${interview.observationId}#/valueJson/keyword`,
          collectedAt: CAPTURED_AT,
          providerDataAsOf: DATA_AS_OF,
        },
      ),
    );
  });
});
