import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  KeywordRelationConflictError,
  KeywordRelationIntegrityError,
  KeywordRelationsRepository,
  MAX_KEYWORD_RELATION_KEYWORD_LOOKUP,
  MAX_KEYWORD_RELATION_REFRESH_PAIRS,
} from "./keyword-relations.ts";

interface Call {
  readonly method: "execute" | "transaction";
  readonly statement?: unknown;
}

class FakeExecutor {
  readonly calls: Call[] = [];
  private readonly results: unknown[][] = [];

  enqueue(...rows: unknown[][]): void {
    this.results.push(...rows);
  }

  async execute(statement: unknown): Promise<{ rows: unknown[] }> {
    this.calls.push({ method: "execute", statement });
    return { rows: this.results.shift() ?? [] };
  }

  async transaction<T>(run: (tx: never) => Promise<T>): Promise<T> {
    this.calls.push({ method: "transaction" });
    return run(this as never);
  }

  compiledExecute(index: number) {
    const call = this.calls.filter(
      (candidate) => candidate.method === "execute",
    )[index];
    if (!call?.statement) {
      throw new Error(`No execute call exists at index ${index}.`);
    }
    return new PgDialect().sqlToQuery(call.statement as never);
  }
}

const ids = {
  workspace: "82000000-0000-4000-8000-000000000001",
  project: "82000000-0000-4000-8000-000000000002",
  relation: "82000000-0000-4000-8000-000000000003",
  relation2: "82000000-0000-4000-8000-000000000004",
  candidate: "82000000-0000-4000-8000-000000000005",
  candidate2: "82000000-0000-4000-8000-000000000006",
  keywordA: "82000000-0000-4000-8000-000000000007",
  keywordB: "82000000-0000-4000-8000-000000000008",
  page: "82000000-0000-4000-8000-000000000009",
  topic: "82000000-0000-4000-8000-000000000010",
  decision: "82000000-0000-4000-8000-000000000011",
  actor: "82000000-0000-4000-8000-000000000012",
} as const;

const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};
const decidedAt = "2026-07-28T04:05:00.000Z";
const clock = {
  newId: () => ids.decision,
  now: () => decidedAt,
};

function relationRow(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: ids.workspace,
    project_id: ids.project,
    relation_id: ids.relation,
    relation_keyword_a_id: ids.keywordA,
    relation_keyword_b_id: ids.keywordB,
    candidate_id: ids.candidate,
    candidate_revision: 1,
    rule_version: "keyword-relation.1.0.0",
    keyword_a_id: ids.keywordA,
    keyword_a_display_keyword: "Customer Onboarding",
    keyword_a_normalized_keyword: "customer onboarding",
    keyword_a_governance_revision: 3,
    keyword_a_topic_node_id: ids.topic,
    keyword_a_topic_model_revision: 2,
    keyword_b_id: ids.keywordB,
    keyword_b_display_keyword: "Customer Onboarding Automation",
    keyword_b_normalized_keyword: "customer onboarding automation",
    keyword_b_governance_revision: 4,
    keyword_b_topic_node_id: ids.topic,
    // A stable Topic identity can legitimately survive a new confirmed model.
    keyword_b_topic_model_revision: 3,
    mapped_site_page_id: ids.page,
    normalized_intent: "commercial",
    market: "US",
    language_tag: "en-US",
    same_confirmed_topic: true,
    lexical_token_overlap: "0.66667",
    serp_overlap_availability: "unavailable",
    serp_overlap: null,
    serp_overlap_limitation:
      "Canonical SERP-overlap observations are not available yet.",
    evidence_hash: "a".repeat(64),
    candidate_generated_at: "2026-07-28T04:00:00.000Z",
    stale_reasons: [],
    decision_id: null,
    decision_candidate_id: null,
    relation_revision: null,
    decision_kind: null,
    primary_keyword_id: null,
    supporting_keyword_id: null,
    reason: null,
    decided_by: null,
    decided_at: null,
    ...overrides,
  };
}

function decidedRow(
  overrides: Record<string, unknown> = {},
) {
  return relationRow({
    decision_id: ids.decision,
    decision_candidate_id: ids.candidate,
    relation_revision: 1,
    decision_kind: "keep_separate",
    primary_keyword_id: null,
    supporting_keyword_id: null,
    reason: "Keep both Keywords visible for distinct editorial intent.",
    decided_by: ids.actor,
    decided_at: decidedAt,
    ...overrides,
  });
}

describe("KeywordRelationsRepository.refreshCandidates", () => {
  it("detects and appends the complete project pair set in one scoped SQL statement", async () => {
    const db = new FakeExecutor();
    db.enqueue([], [{
      project_exists: true,
      eligible_pair_count: "3",
      created_relation_count: "2",
      created_candidate_count: "3",
    }]);
    const repository = new KeywordRelationsRepository(db as never, clock);

    await expect(repository.refreshCandidates(scope)).resolves.toEqual({
      eligiblePairCount: 3,
      createdRelationCount: 2,
      createdCandidateCount: 3,
    });

    expect(
      db.calls.filter((call) => call.method === "transaction"),
    ).toHaveLength(1);
    const lock = db.compiledExecute(0);
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.params).toEqual([
      `topic-governance:${ids.workspace}:${ids.project}`,
    ]);

    const refresh = db.compiledExecute(1);
    expect(refresh.sql).toContain("eligible_keywords as materialized");
    expect(refresh.sql).toContain("candidate_pairs as materialized");
    expect(refresh.sql).toContain(
      "keyword_a.mapped_site_page_id =\n           keyword_b.mapped_site_page_id",
    );
    expect(refresh.sql).toContain(
      "keyword_a.market = keyword_b.market",
    );
    expect(refresh.sql).toContain(
      "keyword_a.language_tag = keyword_b.language_tag",
    );
    expect(refresh.sql).toContain(
      "insert into app.keyword_relation_identities",
    );
    expect(refresh.sql).toContain(
      "insert into app.keyword_relation_candidates",
    );
    expect(refresh.sql).toContain(
      "on conflict (\n          workspace_id,\n          project_id,\n          relation_id,\n          evidence_hash",
    );
    expect(refresh.params).toContain(ids.workspace);
    expect(refresh.params).toContain(ids.project);
    expect(
      db.calls.filter((call) => call.method === "execute"),
    ).toHaveLength(2);
  });

  it("fails closed before any candidate write can survive an excessive pair set", async () => {
    const db = new FakeExecutor();
    db.enqueue([], [{
      project_exists: true,
      eligible_pair_count:
        MAX_KEYWORD_RELATION_REFRESH_PAIRS + 1,
      created_relation_count: 0,
      created_candidate_count: 0,
    }]);

    await expect(
      new KeywordRelationsRepository(db as never).refreshCandidates(
        scope,
      ),
    ).rejects.toMatchObject({
      name: "KeywordRelationIntegrityError",
      code: "PAIR_LIMIT_EXCEEDED",
    });
  });
});

describe("KeywordRelationsRepository read projection", () => {
  it("lists current candidates with keyset pagination and keeps stable Topic identity across revisions", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      relationRow(),
      relationRow({
        relation_id: ids.relation2,
        candidate_id: ids.candidate2,
        candidate_generated_at: "2026-07-28T03:00:00.000Z",
      }),
    ]);
    const repository = new KeywordRelationsRepository(db as never);

    const page = await repository.listByProject(scope, {
      limit: 1,
      cursor: null,
    });

    expect(page.rows).toEqual([
      expect.objectContaining({
        relationId: ids.relation,
        candidateState: "current",
        decisionState: "none",
        displayState: "possible_duplicate",
        candidate: expect.objectContaining({
          signals: expect.objectContaining({
            sameConfirmedTopic: true,
          }),
        }),
      }),
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const query = db.compiledExecute(0);
    expect(query.sql).toContain(
      "app.keyword_relation_candidate_stale_reasons",
    );
    expect(query.sql).toContain(
      "left join lateral (\n      select latest.*\n      from app.keyword_relation_decisions",
    );
    expect(query.params).toContain(ids.workspace);
    expect(query.params).toContain(ids.project);
  });

  it("returns stale decisions without hiding the formerly supporting Keyword", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      decidedRow({
        stale_reasons: ["mapping_changed"],
        decision_kind: "primary_supporting",
        primary_keyword_id: ids.keywordA,
        supporting_keyword_id: ids.keywordB,
      }),
    ]);

    await expect(
      new KeywordRelationsRepository(db as never).findById(
        scope,
        ids.relation,
      ),
    ).resolves.toMatchObject({
      candidateState: "stale",
      staleReasons: ["mapping_changed"],
      decisionState: "stale",
      displayState: "stale",
      isEffectivelyFolded: false,
      primaryKeywordId: null,
      supportingKeywordId: null,
    });
  });

  it("loads relation badges for one bounded Keyword page in a single project-scoped query", async () => {
    const db = new FakeExecutor();
    db.enqueue([relationRow()]);
    const repository = new KeywordRelationsRepository(db as never);

    await expect(
      repository.listByProject(scope, {
        limit: 50,
        cursor: null,
        keywordIds: [ids.keywordA, ids.keywordB],
      }),
    ).resolves.toMatchObject({
      rows: [{ relationId: ids.relation }],
    });

    const query = db.compiledExecute(0);
    expect(query.sql).toContain(
      "relation.keyword_a_id in",
    );
    expect(query.sql).toContain(
      "or relation.keyword_b_id in",
    );
    expect(query.params.filter((value) => value === ids.keywordA))
      .toHaveLength(2);
    expect(query.params.filter((value) => value === ids.keywordB))
      .toHaveLength(2);
    expect(
      db.calls.filter((call) => call.method === "execute"),
    ).toHaveLength(1);
  });

  it("rejects duplicate, malformed, empty, or oversized Keyword lookup sets before SQL", async () => {
    for (const keywordIds of [
      [],
      [ids.keywordA, ids.keywordA],
      ["not-a-uuid"],
      Array.from(
        { length: MAX_KEYWORD_RELATION_KEYWORD_LOOKUP + 1 },
        (_, index) =>
          `82000000-0000-4000-8001-${String(index).padStart(12, "0")}`,
      ),
    ]) {
      const db = new FakeExecutor();
      await expect(
        new KeywordRelationsRepository(db as never).listByProject(
          scope,
          {
            limit: 50,
            cursor: null,
            keywordIds,
          },
        ),
      ).rejects.toBeInstanceOf(RangeError);
      expect(db.calls).toEqual([]);
    }
  });

  it("fails closed on malformed evidence rather than projecting an invented relation", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      relationRow({
        lexical_token_overlap: "1.25",
      }),
    ]);

    await expect(
      new KeywordRelationsRepository(db as never).findById(
        scope,
        ids.relation,
      ),
    ).rejects.toBeInstanceOf(KeywordRelationIntegrityError);
  });
});

describe("KeywordRelationsRepository.decide", () => {
  const keepSeparate = {
    expectedRelationRevision: 0,
    candidateId: ids.candidate,
    decisionKind: "keep_separate",
    primaryKeywordId: null,
    supportingKeywordId: null,
    reason: "Keep both Keywords visible for distinct editorial intent.",
  } as const;

  it("writes one server-owned decision under the shared lock and returns the active projection", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [],
      [relationRow()],
      [{ id: ids.decision, relation_revision: 1 }],
      [decidedRow()],
    );
    const repository = new KeywordRelationsRepository(
      db as never,
      clock,
    );

    await expect(
      repository.decide(
        scope,
        ids.relation,
        ids.actor,
        keepSeparate,
      ),
    ).resolves.toMatchObject({
      replayed: false,
      data: {
        currentRelationRevision: 1,
        decisionState: "active",
        displayState: "kept_separate",
        decision: {
          decisionId: ids.decision,
          decidedBy: ids.actor,
          decidedAt,
        },
      },
    });

    const insert = db.compiledExecute(2);
    expect(insert.sql).toContain(
      "insert into app.keyword_relation_decisions",
    );
    expect(insert.params).toContain(ids.decision);
    expect(insert.params).toContain(ids.actor);
    expect(insert.params).toContain(decidedAt);
    expect(
      db.calls.filter((call) => call.method === "transaction"),
    ).toHaveLength(1);
  });

  it("returns an exact retry without appending another decision", async () => {
    const db = new FakeExecutor();
    db.enqueue([], [decidedRow()]);
    const repository = new KeywordRelationsRepository(
      db as never,
      clock,
    );

    await expect(
      repository.decide(
        scope,
        ids.relation,
        ids.actor,
        keepSeparate,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      data: {
        currentRelationRevision: 1,
      },
    });
    expect(
      db.calls.filter((call) => call.method === "execute"),
    ).toHaveLength(2);
  });

  it("rejects stale candidate evidence before generating server facts", async () => {
    const db = new FakeExecutor();
    db.enqueue([], [
      relationRow({
        stale_reasons: ["intent_changed"],
      }),
    ]);

    await expect(
      new KeywordRelationsRepository(db as never, {
        newId: () => {
          throw new Error("clock must not be called");
        },
        now: () => {
          throw new Error("clock must not be called");
        },
      }).decide(scope, ids.relation, ids.actor, keepSeparate),
    ).rejects.toMatchObject({
      name: "KeywordRelationConflictError",
      code: "CANDIDATE_STALE",
      currentCandidateId: ids.candidate,
    });
  });

  it("requires a fold to name the exact primary/supporting pair", async () => {
    const db = new FakeExecutor();
    db.enqueue([], [relationRow()]);

    await expect(
      new KeywordRelationsRepository(db as never).decide(
        scope,
        ids.relation,
        ids.actor,
        {
          ...keepSeparate,
          decisionKind: "primary_supporting",
          primaryKeywordId: ids.keywordA,
          supportingKeywordId: ids.topic,
        },
      ),
    ).rejects.toBeInstanceOf(KeywordRelationConflictError);
  });
});

describe("0025 Keyword Relation stable Topic authority", () => {
  it("derives sameConfirmedTopic from the stable node identity, not one model revision", () => {
    const migration = readFileSync(
      new URL(
        "../../migrations/0025_keyword_relation_governance.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      "keyword_a_topic_node_id = keyword_b_topic_node_id",
    );
    expect(migration).toContain(
      "decision_a.topic_node_id = decision_b.topic_node_id",
    );
    expect(migration).toContain(
      "btrim(normalize(selected_value, NFKC))",
    );
    expect(migration).not.toMatch(
      /keyword_a_topic_model_revision\s*=\s*keyword_b_topic_model_revision/u,
    );
  });
});
