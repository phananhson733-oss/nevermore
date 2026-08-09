import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { MAX_KEYWORD_OCCURRENCE_PAGE_SIZE } from "./keyword-occurrences.ts";
import { encodeNumericTimestampUuidCursor } from "./cursor.ts";
import {
  MAX_AI_CITATION_COHORT_CANDIDATE_READ,
  MAX_FROZEN_KEYWORD_ENTITY_BATCH,
  KeywordsRepository,
  LegacyKeywordReviewDisabledError,
  MAX_AUTO_GOVERNANCE_CANDIDATE_READ,
  MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ,
  MAX_KEYWORD_ENTITY_PAGE_SIZE,
  type KeywordEntityRow,
} from "./keywords.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

class FakeQuery {
  constructor(private readonly owner: FakeExecutor) {}

  private chain(method: string, args: readonly unknown[]): this {
    this.owner.calls.push({ method, args });
    return this;
  }

  from(...args: unknown[]): this {
    return this.chain("from", args);
  }

  innerJoin(...args: unknown[]): this {
    return this.chain("innerJoin", args);
  }

  where(...args: unknown[]): this {
    return this.chain("where", args);
  }

  orderBy(...args: unknown[]): this {
    return this.chain("orderBy", args);
  }

  limit(...args: unknown[]): this {
    return this.chain("limit", args);
  }

  set(...args: unknown[]): this {
    return this.chain("set", args);
  }

  returning(...args: unknown[]): this {
    return this.chain("returning", args);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.owner.take()).then(onFulfilled, onRejected);
  }
}

class FakeExecutor {
  readonly calls: RecordedCall[] = [];
  private readonly results: unknown[] = [];
  private readonly executeResults: unknown[] = [];

  enqueue(...results: unknown[]): void {
    this.results.push(...results);
  }

  enqueueExecute(...results: unknown[]): void {
    this.executeResults.push(...results);
  }

  async execute(...args: unknown[]): Promise<unknown> {
    this.calls.push({ method: "execute", args });
    return this.executeResults.length > 0
      ? this.executeResults.shift()
      : { rows: [] };
  }

  take(): unknown {
    return this.results.length > 0 ? this.results.shift() : [];
  }

  private query(method: string, args: readonly unknown[]): FakeQuery {
    this.calls.push({ method, args });
    return new FakeQuery(this);
  }

  select(...args: unknown[]): FakeQuery {
    return this.query("select", args);
  }

  update(...args: unknown[]): FakeQuery {
    return this.query("update", args);
  }

  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call was recorded`);
    return call;
  }
}

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
};

const entity = {
  id: "00000000-0000-4000-8000-000000000010",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  normalized_keyword: "customer onboarding software",
  display_keyword: "Customer Onboarding Software",
  market: "US",
  language_tag: "en-US",
  query_kind: "search_query",
  status: "candidate",
  intent: null,
  buyer_stage: null,
  cluster_key: null,
  mapping_decision: "unassigned",
  mapped_site_page_id: null,
  mapping_review_state: "unreviewed",
  mapping_revision: 0,
  first_seen_at: "2026-07-22T08:00:00.000Z",
  last_seen_at: "2026-07-22T08:00:00.000Z",
  created_at: "2026-07-22T08:00:00.000Z",
  updated_at: "2026-07-22T08:00:00.000Z",
} as const satisfies KeywordEntityRow;

describe("KeywordsRepository", () => {
  it("reads only the exact approved and confirmed GenerativeQuery cohort with one overflow sentinel", async () => {
    const db = new FakeExecutor();
    const candidate = {
      entityId: entity.id,
      revision: 4,
      query: "Which customer onboarding platform is best?",
      normalizedQuery: "which customer onboarding platform is best?",
      marketCode: "US",
      languageTag: "en-US",
    } as const;
    db.enqueue([candidate]);
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.listAiCitationCohortCandidates(scope, {
        market: "US",
        languageTag: "en-US",
        limit: MAX_AI_CITATION_COHORT_CANDIDATE_READ,
      }),
    ).resolves.toEqual([candidate]);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toEqual(
      expect.arrayContaining([
        "approved",
        "confirmed",
        "generative_query",
        "US",
        "en-US",
      ]),
    );
    const ordering = db.last("orderBy").args;
    expect(ordering).toHaveLength(2);
    expect(db.last("limit").args).toEqual([
      MAX_AI_CITATION_COHORT_CANDIDATE_READ,
    ]);
  });

  it("rejects a client attempt to expand the fixed AI citation cohort read", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.listAiCitationCohortCandidates(scope, {
        market: "US",
        languageTag: "en-US",
        limit: MAX_AI_CITATION_COHORT_CANDIDATE_READ + 1,
      }),
    ).rejects.toThrow(/limit/iu);
    expect(db.calls).toEqual([]);
  });

  it("lists the customer library ordered by newest canonical search volume", async () => {
    const db = new FakeExecutor();
    db.enqueueExecute({
      rows: [
        { ...entity, sort_volume_text: "2400" },
        {
          ...entity,
          id: "00000000-0000-4000-8000-000000000011",
          sort_volume_text: null,
        },
      ],
    });
    const repo = new KeywordsRepository(db as never);

    const page = await repo.listByProject(scope, {
      limit: 1,
      cursor: null,
      status: "candidate",
      queryKind: "search_query",
      market: "US",
      sourceKind: "csv_import",
    });

    expect(page.rows).toEqual([entity]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const query = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(query.sql).toContain("order by ranked.sort_volume desc nulls last");
    expect(query.sql).toContain("value_json ? 'searchVolume'");
    expect(query.sql).toContain("when jsonb_typeof");
    expect(query.sql).toContain(
      "source_kind in ('csv_import', 'dataforseo_ranked')",
    );
    expect(query.sql).toContain("project.archived_at is null");
    expect(query.sql).toContain("created_at::text");
    expect(query.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "candidate",
        "search_query",
        "US",
        "csv_import",
      ]),
    );
  });

  it("counts Product Profile entities from their real occurrence source", async () => {
    const db = new FakeExecutor();
    db.enqueueExecute({
      rows: [
        {
          all_count: 23,
          csv_import: 1,
          dataforseo_ranked: 2,
          gsc_top_query: 3,
          product_profile: 20,
          interview_summary: 4,
          user_review: 5,
          manual: 6,
        },
      ],
    });
    const repo = new KeywordsRepository(db as never);

    await expect(repo.countBySourceKind(scope)).resolves.toEqual({
      all: 23,
      csv_import: 1,
      dataforseo_ranked: 2,
      gsc_top_query: 3,
      product_profile: 20,
      interview_summary: 4,
      user_review: 5,
      manual: 6,
    });

    const query = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(query.sql).toContain("source_kind = 'product_profile'");
    expect(query.params).toEqual([
      scope.projectId,
      scope.workspaceId,
      scope.projectId,
      scope.workspaceId,
    ]);
  });

  it("resumes the value-ordered keyset from an exact opaque cursor", async () => {
    const db = new FakeExecutor();
    db.enqueueExecute({ rows: [{ ...entity, sort_volume_text: null }] });
    const repo = new KeywordsRepository(db as never);
    const cursor = encodeNumericTimestampUuidCursor(
      "2400",
      "2026-07-22T08:00:00.000Z",
      entity.id,
    );

    const page = await repo.listByProject(scope, { limit: 5, cursor });

    expect(page.rows).toEqual([entity]);
    expect(page.nextCursor).toBeNull();
    const query = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(query.sql).toContain("ranked.sort_volume < ");
    expect(query.sql).toContain("ranked.sort_volume is null");
    expect(query.params).toEqual(
      expect.arrayContaining(["2400", "2026-07-22T08:00:00.000Z", entity.id]),
    );
  });

  it("returns an empty page for a cursor in the retired intake-time language", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordsRepository(db as never);
    const legacyCursor = Buffer.from(
      `2026-07-22T08:00:00.000Z ${entity.id}`,
      "utf8",
    ).toString("base64url");

    await expect(
      repo.listByProject(scope, { limit: 5, cursor: legacyCursor }),
    ).resolves.toEqual({ rows: [], nextCursor: null });
    expect(db.calls).toEqual([]);
  });

  it("reads only approved, confirmed, clustered diagnostic facts with one sentinel", async () => {
    const db = new FakeExecutor();
    const approved = {
      ...entity,
      status: "approved",
      mapping_review_state: "confirmed",
      cluster_key: "customer-onboarding",
      mapping_revision: 1,
    } as const satisfies KeywordEntityRow;
    db.enqueue([approved]);
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.listDiagnosticEligible(scope, {
        limit: MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ,
      }),
    ).resolves.toEqual([approved]);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"cluster_key" is not null');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toEqual(
      expect.arrayContaining(["approved", "confirmed"]),
    );
    expect(db.last("limit").args).toEqual([
      MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ,
    ]);
  });

  it("reads untouched candidates with their immutable provider evidence only", async () => {
    const db = new FakeExecutor();
    const row = {
      id: entity.id,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      display_keyword: entity.display_keyword,
      normalized_keyword: entity.normalized_keyword,
      market: "US",
      language_tag: "en-US",
      query_kind: "search_query",
      mapping_revision: 0,
      dataforseo_ranked_evidence: 3,
      gsc_impression_evidence: 0,
      gsc_attributed_site_page_count: 0,
      gsc_attributed_site_page_id: null,
      occurrence_count: 4,
    };
    db.enqueueExecute({ rows: [row] });
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.listAutoGovernanceCandidates(scope, {
        limit: MAX_AUTO_GOVERNANCE_CANDIDATE_READ,
      }),
    ).resolves.toEqual([row]);

    const query = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(query.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        MAX_AUTO_GOVERNANCE_CANDIDATE_READ,
      ]),
    );
    // Membership rules a caller must not be able to weaken.
    expect(query.sql).toContain("keyword.status = 'candidate'");
    expect(query.sql).toContain(
      "keyword.mapping_review_state = 'unreviewed'",
    );
    expect(query.sql).toContain("project.archived_at is null");
    expect(query.sql).toContain("decision.decision_origin = 'user'");
    expect(query.sql).toContain("not exists");
    // Evidence rules: a zero-impression GSC row and a rankless DataForSEO row
    // are never evidence.
    expect(query.sql).toContain("evidence.gsc_impressions >= 1");
    expect(query.sql).toContain("evidence.dataforseo_rank >= 1");
    // Evidence-free candidates are dropped BEFORE the page limit, so a block of
    // low-id evidence-free rows can never starve evidence-bearing keywords.
    const filterIndex = query.sql.indexOf(
      "scored.dataforseo_ranked_evidence >= 1",
    );
    expect(filterIndex).toBeGreaterThan(-1);
    expect(query.sql.indexOf("limit", filterIndex)).toBeGreaterThan(
      filterIndex,
    );
    expect(query.sql.slice(0, filterIndex)).not.toContain("limit");
    // The caller must be able to spend the diagnostic freeze's occurrence
    // budget, so every candidate carries the occurrence count it would add.
    expect(query.sql).toContain("occurrence_counts");
    expect(query.sql).toContain("as occurrence_count");
  });

  it("counts the eligible library the way the diagnostic freeze counts it", async () => {
    const db = new FakeExecutor();
    db.enqueueExecute({
      rows: [{ eligible_entities: 4_900, occurrence_refs: 9_800 }],
    });
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.readDiagnosticGovernanceLoad(scope),
    ).resolves.toEqual({ eligibleEntities: 4_900, occurrenceRefs: 9_800 });

    const query = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    // Exactly the freeze's own eligibility rule.
    expect(query.sql).toContain("keyword.status = 'approved'");
    expect(query.sql).toContain(
      "keyword.mapping_review_state = 'confirmed'",
    );
    expect(query.sql).toContain("keyword.cluster_key is not null");
    expect(query.sql).toContain("project.archived_at is null");
    // Project isolation inside the one statement, never in memory.
    expect(query.sql).toContain("keyword.workspace_id = $1::uuid");
    expect(query.sql).toContain("keyword.project_id = $2::uuid");
    // The freeze reads at most one occurrence page per entity, so the budget
    // read applies the same clamp instead of the raw history length.
    expect(query.sql).toContain("least(occurrence_count");
    expect(query.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
    ]);
  });

  it("fails closed rather than reporting an invented governance load", async () => {
    const db = new FakeExecutor();
    db.enqueueExecute({ rows: [] });
    const repo = new KeywordsRepository(db as never);

    await expect(repo.readDiagnosticGovernanceLoad(scope)).rejects.toThrow(
      /invalid result/u,
    );
    await expect(
      repo.readDiagnosticGovernanceLoad({
        workspaceId: "not-a-uuid",
        projectId: scope.projectId,
      }),
    ).rejects.toThrow(/UUID/iu);
  });

  it("rejects an unbounded or non-canonical automated governance read before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.listAutoGovernanceCandidates(scope, {
        limit: MAX_AUTO_GOVERNANCE_CANDIDATE_READ + 1,
      }),
    ).rejects.toThrow(/limit/iu);
    await expect(
      repo.listAutoGovernanceCandidates(
        { workspaceId: "not-a-uuid", projectId: scope.projectId },
        { limit: 1 },
      ),
    ).rejects.toThrow(/UUID/iu);
    expect(db.calls).toEqual([]);
  });

  it("returns null for a foreign, archived or absent detail within the SQL scope", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);
    const repo = new KeywordsRepository(db as never);

    await expect(repo.findById(scope, entity.id)).resolves.toBeNull();
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toContain(entity.id);
  });

  it("pages only the exact frozen keyword IDs while preserving the customer cursor shape", async () => {
    const db = new FakeExecutor();
    db.enqueue([entity, { ...entity, id: "00000000-0000-4000-8000-000000000011" }]);
    const repo = new KeywordsRepository(db as never);

    const page = await repo.listByIdsPage(
      scope,
      [entity.id, "00000000-0000-4000-8000-000000000011"],
      {
        limit: 1,
        cursor: null,
      },
    );

    expect(page.rows).toEqual([entity]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"id" in ($');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        entity.id,
        "00000000-0000-4000-8000-000000000011",
      ]),
    );
  });

  it("rejects an oversized frozen keyword ID set before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.listByIdsPage(
        scope,
        Array.from({ length: MAX_FROZEN_KEYWORD_ENTITY_BATCH + 1 }, (_value, index) =>
          `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        ),
        { limit: 1, cursor: null },
      ),
    ).rejects.toThrow(/entityIds/i);
    expect(db.calls).toEqual([]);
  });

  it("fails closed for the retired ledger-less review command", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.reviewAndMap(scope, entity.id, {
        expectedRevision: 0,
        status: "approved",
        intent: "commercial",
        buyerStage: "consideration",
        clusterKey: "customer-onboarding",
        mappingDecision: "existing_page",
        mappedSitePageId: "00000000-0000-4000-8000-000000000030",
        mappingReviewState: "confirmed",
      }),
    ).rejects.toEqual(expect.any(LegacyKeywordReviewDisabledError));
    await expect(
      repo.reviewAndMap(scope, entity.id, {
        expectedRevision: 4,
        status: "approved",
        intent: null,
        buyerStage: null,
        clusterKey: null,
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        mappingReviewState: "confirmed",
      }),
    ).rejects.toMatchObject({
      code: "LEGACY_KEYWORD_REVIEW_DISABLED",
      message: expect.stringMatching(
        /KeywordGovernanceRepository\.reviewKeyword/u,
      ),
    });
    expect(db.calls).toEqual([]);
  });

  it("rejects unbounded read filters before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordsRepository(db as never);

    await expect(
      repo.listByProject(scope, {
        limit: MAX_KEYWORD_ENTITY_PAGE_SIZE + 1,
        cursor: null,
      }),
    ).rejects.toThrow(/limit/i);
    await expect(
      repo.listDiagnosticEligible(scope, {
        limit: MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ + 1,
      }),
    ).rejects.toThrow(/limit/i);
    expect(db.calls).toEqual([]);
  });
});
