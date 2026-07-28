import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { TopicModelsRepository } from "../repositories/topic-models.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const NOW = "2026-07-27T10:00:00.000Z";

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly pageAId: string;
  readonly pageBId: string;
  readonly topicNodeId: string;
  readonly topicModelRevision: number;
  readonly topicLabel: string;
}

interface KeywordFixture {
  readonly id: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
}

interface RelationFixture {
  readonly relationId: string;
  readonly candidateId: string;
  readonly keywordAId: string;
  readonly keywordBId: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

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

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

async function createProject(
  handle: DbHandle,
): Promise<ProjectFixture> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const siteId = randomUUID();
  const pageAId = randomUUID();
  const pageBId = randomUUID();
  const host = `${projectId}.keyword-relations.example`;
  const origin = `https://${host}`;
  const pageAUrl = `${origin}/customer-onboarding/`;
  const pageBUrl = `${origin}/customer-success/`;

  await handle.pool.query(
    "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
    [workspaceId, `Keyword relations ${workspaceId}`],
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
    `INSERT INTO app.sites (
       id, workspace_id, project_id, origin, host,
       market_codes, language_codes, is_primary
     ) VALUES ($1,$2,$3,$4,$5,ARRAY['US'],ARRAY['en-US'],true)`,
    [siteId, workspaceId, projectId, origin, host],
  );
  await handle.pool.query(
    `INSERT INTO app.site_pages (
       id, workspace_id, project_id, site_id,
       normalized_url, normalized_url_hash
     ) VALUES
       ($1,$3,$4,$5,$6,$7),
       ($2,$3,$4,$5,$8,$9)`,
    [
      pageAId,
      pageBId,
      workspaceId,
      projectId,
      siteId,
      pageAUrl,
      sha256(pageAUrl),
      pageBUrl,
      sha256(pageBUrl),
    ],
  );
  const topicRepository = new TopicModelsRepository(handle.db);
  const draft = await topicRepository.beginDraftFromLatestConfirmed(
    { workspaceId, projectId },
    actorId,
    {
      expectedLatestConfirmedRevision: 0,
      reason: "Create the reviewed Topic used by Keyword relations.",
    },
  );
  const edited = await topicRepository.patchDraft(
    { workspaceId, projectId },
    actorId,
    {
      topicModelRevision: draft.topicModelRevision,
      expectedEditRevision: draft.editRevision,
      reason: "Add the canonical customer onboarding Topic.",
      intents: [
        {
          kind: "create",
          parentTopicNodeId: null,
          label: "Customer onboarding",
          description: "Reviewed customer onboarding search demand.",
          intentEnvelope: ["Commercial"],
        },
      ],
    },
  );
  const topic = await topicRepository.confirmDraft(
    { workspaceId, projectId },
    actorId,
    {
      topicModelRevision: edited.topicModelRevision,
      expectedEditRevision: edited.editRevision,
      reason: "Confirm the Topic before mapping Keywords.",
    },
  );
  if (topic.rootTopicNodeId === null) {
    throw new Error("Confirmed Topic fixture did not produce a root.");
  }
  return {
    workspaceId,
    projectId,
    actorId,
    pageAId,
    pageBId,
    topicNodeId: topic.rootTopicNodeId,
    topicModelRevision: topic.topicModelRevision,
    topicLabel: "Customer onboarding",
  };
}

async function createKeyword(
  handle: DbHandle,
  project: ProjectFixture,
  displayKeyword: string,
  mappedSitePageId = project.pageAId,
): Promise<KeywordFixture> {
  const id = randomUUID();
  const normalizedKeyword = displayKeyword
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  await handle.pool.query(
    `INSERT INTO app.keyword_entities (
       id, workspace_id, project_id, display_keyword, normalized_keyword,
       market, language_tag, query_kind, status, intent, buyer_stage,
       cluster_key, mapping_decision, mapped_site_page_id,
       mapping_review_state, mapping_revision,
       first_seen_at, last_seen_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,'US','en-US','search_query','approved',
       'Commercial','consideration',$8,'existing_page',$6,
       'confirmed',0,$7,$7,$7,$7
     )`,
    [
      id,
      project.workspaceId,
      project.projectId,
      displayKeyword,
      normalizedKeyword,
      mappedSitePageId,
      NOW,
      project.topicLabel,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.keyword_review_decisions (
       id, workspace_id, project_id, keyword_entity_id,
       governance_revision, decision_origin, status, intent, buyer_stage,
       topic_node_id, topic_model_revision, cluster_key_at_decision,
       mapping_decision, mapped_site_page_id, review_state,
       assignment_invalidated_by, decided_by, reason, decided_at,
       reviewed_projection
     ) VALUES (
       $1,$2,$3,$4,0,'user','approved','Commercial','consideration',
       $9,$10,$11,'existing_page',$5,'confirmed',NULL,$6,
       'Initial reviewed Keyword mapping.', $7, $8::jsonb
     )`,
    [
      randomUUID(),
      project.workspaceId,
      project.projectId,
      id,
      mappedSitePageId,
      project.actorId,
      NOW,
      JSON.stringify({
        projectId: project.projectId,
        keywordId: id,
        governanceRevision: 0,
        status: "approved",
        intent: "Commercial",
        buyerStage: "consideration",
        topicNodeId: project.topicNodeId,
        topicModelRevision: project.topicModelRevision,
        clusterKey: project.topicLabel,
        mappingDecision: "existing_page",
        mappedSitePageId,
        mappingReviewState: "confirmed",
        assignmentInvalidatedBy: null,
        earlierHistoryAvailable: true,
      }),
      project.topicNodeId,
      project.topicModelRevision,
      project.topicLabel,
    ],
  );
  return { id, displayKeyword, normalizedKeyword };
}

async function createCandidate(
  handle: DbHandle,
  project: ProjectFixture,
  left: KeywordFixture,
  right: KeywordFixture,
): Promise<RelationFixture> {
  const [keywordA, keywordB] =
    left.id < right.id ? [left, right] : [right, left];
  const relationId = randomUUID();
  const candidateId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.keyword_relation_identities (
       id, workspace_id, project_id, keyword_a_id, keyword_b_id
     ) VALUES ($1,$2,$3,$4,$5)`,
    [
      relationId,
      project.workspaceId,
      project.projectId,
      keywordA.id,
      keywordB.id,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.keyword_relation_candidates (
       id, workspace_id, project_id, relation_id, candidate_revision,
       rule_version,
       keyword_a_id, keyword_a_display_keyword,
       keyword_a_normalized_keyword, keyword_a_governance_revision,
       keyword_a_topic_node_id, keyword_a_topic_model_revision,
       keyword_b_id, keyword_b_display_keyword,
       keyword_b_normalized_keyword, keyword_b_governance_revision,
       keyword_b_topic_node_id, keyword_b_topic_model_revision,
       mapped_site_page_id, normalized_intent, market, language_tag,
       same_confirmed_topic, lexical_token_overlap,
       serp_overlap_availability, serp_overlap,
       serp_overlap_limitation, generated_at
     ) VALUES (
       $1,$2,$3,$4,1,'keyword-relation.1.0.0',
       $5,$6,$7,0,$13,$14,
       $8,$9,$10,0,$13,$14,
       $11,'commercial','US','en-US',true,
       app.keyword_relation_token_overlap($7,$10),
       'unavailable',NULL,
       'Canonical SERP-overlap observations are not available yet.',$12
     )`,
    [
      candidateId,
      project.workspaceId,
      project.projectId,
      relationId,
      keywordA.id,
      keywordA.displayKeyword,
      keywordA.normalizedKeyword,
      keywordB.id,
      keywordB.displayKeyword,
      keywordB.normalizedKeyword,
      project.pageAId,
      NOW,
      project.topicNodeId,
      project.topicModelRevision,
    ],
  );
  return {
    relationId,
    candidateId,
    keywordAId: keywordA.id,
    keywordBId: keywordB.id,
  };
}

async function fold(
  handle: DbHandle,
  project: ProjectFixture,
  relation: RelationFixture,
  primaryKeywordId: string,
  supportingKeywordId: string,
): Promise<string> {
  const decisionId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.keyword_relation_decisions (
       id, workspace_id, project_id, relation_id, candidate_id,
       relation_revision, decision_kind, primary_keyword_id,
       supporting_keyword_id, reason, decided_by, decided_at
     ) VALUES (
       $1,$2,$3,$4,$5,1,'primary_supporting',$6,$7,
       'Retain one primary Keyword while preserving all supporting data.',
       $8,$9
     )`,
    [
      decisionId,
      project.workspaceId,
      project.projectId,
      relation.relationId,
      relation.candidateId,
      primaryKeywordId,
      supportingKeywordId,
      project.actorId,
      NOW,
    ],
  );
  return decisionId;
}

describeDb("0025 Keyword Relation governance", () => {
  let handle: DbHandle;

  beforeAll(() => {
    requireSafeTestDatabaseUrl(DATABASE_URL);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("persists immutable candidate evidence and folds only the list presentation", async () => {
    const project = await createProject(handle);
    const primary = await createKeyword(
      handle,
      project,
      "customer onboarding automation",
    );
    const supporting = await createKeyword(
      handle,
      project,
      "automate customer onboarding",
    );
    const relation = await createCandidate(
      handle,
      project,
      primary,
      supporting,
    );
    const decisionId = await fold(
      handle,
      project,
      relation,
      primary.id,
      supporting.id,
    );

    const candidate = await handle.pool.query<{
      candidate_revision: number;
      evidence_hash: string;
      stale_reasons: string[];
    }>(
      `SELECT
         candidate_revision,
         evidence_hash,
         app.keyword_relation_candidate_stale_reasons(id)
           AS stale_reasons
       FROM app.keyword_relation_candidates
       WHERE id = $1`,
      [relation.candidateId],
    );
    expect(candidate.rows).toEqual([
      {
        candidate_revision: 1,
        evidence_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        stale_reasons: [],
      },
    ]);

    const retained = await handle.pool.query<{ id: string }>(
      `SELECT id
       FROM app.keyword_entities
       WHERE workspace_id = $1 AND project_id = $2
         AND id IN ($3,$4)
       ORDER BY id`,
      [
        project.workspaceId,
        project.projectId,
        primary.id,
        supporting.id,
      ],
    );
    expect(retained.rows.map((row) => row.id)).toEqual(
      [primary.id, supporting.id].sort(),
    );

    await expectPgCode(
      handle.pool.query(
        `UPDATE app.keyword_relation_candidates
         SET evidence_hash = $2
         WHERE id = $1`,
        [relation.candidateId, "b".repeat(64)],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "DELETE FROM app.keyword_relation_decisions WHERE id = $1",
        [decisionId],
      ),
      "55000",
    );
  });

  it("rejects candidates that are not on the same current reviewed page", async () => {
    const project = await createProject(handle);
    const left = await createKeyword(
      handle,
      project,
      "customer onboarding software",
    );
    const right = await createKeyword(
      handle,
      project,
      "customer onboarding guide",
      project.pageBId,
    );
    const [keywordA, keywordB] =
      left.id < right.id ? [left, right] : [right, left];
    const relationId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.keyword_relation_identities (
         id, workspace_id, project_id, keyword_a_id, keyword_b_id
       ) VALUES ($1,$2,$3,$4,$5)`,
      [
        relationId,
        project.workspaceId,
        project.projectId,
        keywordA.id,
        keywordB.id,
      ],
    );

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_relation_candidates (
           id, workspace_id, project_id, relation_id, candidate_revision,
           rule_version,
           keyword_a_id, keyword_a_display_keyword,
           keyword_a_normalized_keyword, keyword_a_governance_revision,
           keyword_b_id, keyword_b_display_keyword,
           keyword_b_normalized_keyword, keyword_b_governance_revision,
           mapped_site_page_id, normalized_intent, market, language_tag,
           same_confirmed_topic, lexical_token_overlap,
           serp_overlap_availability, serp_overlap_limitation
         ) VALUES (
           $1,$2,$3,$4,1,'keyword-relation.1.0.0',
           $5,$6,$7,0,$8,$9,$10,0,$11,'commercial','US','en-US',
           false,app.keyword_relation_token_overlap($7,$10),
           'unavailable','SERP overlap is unavailable.'
         )`,
        [
          randomUUID(),
          project.workspaceId,
          project.projectId,
          relationId,
          keywordA.id,
          keywordA.displayKeyword,
          keywordA.normalizedKeyword,
          keywordB.id,
          keywordB.displayKeyword,
          keywordB.normalizedKeyword,
          project.pageAId,
        ],
      ),
      "23514",
    );
  });

  it("rejects fold chains and cycles at the database boundary", async () => {
    const project = await createProject(handle);
    const first = await createKeyword(
      handle,
      project,
      "customer onboarding platform",
    );
    const second = await createKeyword(
      handle,
      project,
      "customer onboarding tool",
    );
    const third = await createKeyword(
      handle,
      project,
      "customer onboarding system",
    );
    const firstRelation = await createCandidate(
      handle,
      project,
      first,
      second,
    );
    await fold(
      handle,
      project,
      firstRelation,
      first.id,
      second.id,
    );

    const chainedRelation = await createCandidate(
      handle,
      project,
      second,
      third,
    );
    await expectPgCode(
      fold(
        handle,
        project,
        chainedRelation,
        second.id,
        third.id,
      ),
      "23514",
    );
  });

  it("makes an old fold ineffective after canonical mapping drift", async () => {
    const project = await createProject(handle);
    const primary = await createKeyword(
      handle,
      project,
      "best customer onboarding software",
    );
    const supporting = await createKeyword(
      handle,
      project,
      "customer onboarding software",
    );
    const relation = await createCandidate(
      handle,
      project,
      primary,
      supporting,
    );
    await fold(
      handle,
      project,
      relation,
      primary.id,
      supporting.id,
    );

    const client = await handle.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE app.keyword_entities
         SET mapped_site_page_id = $4,
             mapping_revision = 1,
             updated_at = $5
         WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
        [
          project.workspaceId,
          project.projectId,
          supporting.id,
          project.pageBId,
          "2026-07-27T11:00:00.000Z",
        ],
      );
      await client.query(
        `INSERT INTO app.keyword_review_decisions (
           id, workspace_id, project_id, keyword_entity_id,
           governance_revision, decision_origin, status, intent,
           buyer_stage, topic_node_id, topic_model_revision,
           cluster_key_at_decision, mapping_decision,
           mapped_site_page_id, review_state,
           assignment_invalidated_by, decided_by, reason, decided_at,
           reviewed_projection
         ) VALUES (
           $1,$2,$3,$4,1,'user','approved','Commercial',
           'consideration',$5,$6,$7,'existing_page',$8,'confirmed',
           NULL,$9,'The reviewed owner page changed after relation review.',
           $10,$11::jsonb
         )`,
        [
          randomUUID(),
          project.workspaceId,
          project.projectId,
          supporting.id,
          project.topicNodeId,
          project.topicModelRevision,
          project.topicLabel,
          project.pageBId,
          project.actorId,
          "2026-07-27T11:00:00.000Z",
          JSON.stringify({
            projectId: project.projectId,
            keywordId: supporting.id,
            governanceRevision: 1,
            status: "approved",
            intent: "Commercial",
            buyerStage: "consideration",
            topicNodeId: project.topicNodeId,
            topicModelRevision: project.topicModelRevision,
            clusterKey: project.topicLabel,
            mappingDecision: "existing_page",
            mappedSitePageId: project.pageBId,
            mappingReviewState: "confirmed",
            assignmentInvalidatedBy: null,
            earlierHistoryAvailable: true,
          }),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const stale = await handle.pool.query<{ reasons: string[] }>(
      `SELECT app.keyword_relation_candidate_stale_reasons($1)
         AS reasons`,
      [relation.candidateId],
    );
    expect(stale.rows[0]?.reasons).toEqual(
      expect.arrayContaining([
        "governance_revision_changed",
        "mapping_changed",
      ]),
    );

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.keyword_relation_decisions (
           id, workspace_id, project_id, relation_id, candidate_id,
           relation_revision, decision_kind, primary_keyword_id,
           supporting_keyword_id, reason, decided_by, decided_at
         ) VALUES (
           $1,$2,$3,$4,$5,2,'keep_separate',NULL,NULL,
           'Re-review the stale candidate evidence before deciding.',
           $6,$7
         )`,
        [
          randomUUID(),
          project.workspaceId,
          project.projectId,
          relation.relationId,
          relation.candidateId,
          project.actorId,
          NOW,
        ],
      ),
      "55000",
    );
  });
});
