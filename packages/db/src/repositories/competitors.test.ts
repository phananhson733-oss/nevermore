import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  CompetitorsRepository,
  MAX_COMPETITOR_PAGE_SIZE,
  type CompetitorEntityRow,
  type CompetitorOriginInput,
  type ProductProfileCompetitorOriginInput,
} from "./competitors.ts";

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

  enqueue(...results: unknown[]): void {
    this.results.push(...results);
  }

  take(): unknown {
    return this.results.length > 0 ? this.results.shift() : [];
  }

  execute(...args: unknown[]): unknown {
    this.calls.push({ method: "execute", args });
    return this.take();
  }

  select(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "select", args });
    return new FakeQuery(this);
  }

  update(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "update", args });
    return new FakeQuery(this);
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
  domain: "example-competitor.com",
  name: "Example Competitor",
  review_status: "candidate",
  relationship: null,
  analysis_scope: [],
  revision: 0,
  last_observed_at: null,
  origin_count: 1,
  created_at: "2026-07-22T08:00:00.000Z",
  updated_at: "2026-07-22T08:00:00.000Z",
} as const satisfies CompetitorEntityRow;

const profileOrigin = (
  overrides: Partial<ProductProfileCompetitorOriginInput> = {},
): ProductProfileCompetitorOriginInput => ({
  originKind: "product_profile",
  domain: "example-competitor.com",
  name: "Example Competitor",
  productProfileId: "00000000-0000-4000-8000-000000000020",
  profileVersion: 3,
  candidateId: "00000000-0000-4000-8000-000000000021",
  fieldProvenancePath: "/competitorCandidates/0",
  evidenceRefs: [
    {
      evidenceRefId: "00000000-0000-4000-8000-000000000022",
      kind: "userEdit",
    },
  ],
  sourceReviewStatus: "approved",
  sourceRelationship: "direct",
  sourceAnalysisScope: ["keyword_gap", "positioning"],
  ...overrides,
});

describe("CompetitorsRepository", () => {
  it("atomically converges a confirmed Product Profile origin and stable domain entity", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          occurrence_id: "00000000-0000-4000-8000-000000000030",
          competitor_id: entity.id,
        },
      ],
    });
    const repo = new CompetitorsRepository(db as never);

    await expect(repo.upsertOrigin(scope, profileOrigin())).resolves.toEqual({
      occurrenceId: "00000000-0000-4000-8000-000000000030",
      competitorId: entity.id,
    });

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toContain("app.upsert_competitor_origin");
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "example-competitor.com",
        "product_profile",
        "00000000-0000-4000-8000-000000000020",
        "/competitorCandidates/0",
        "approved",
        "direct",
      ]),
    );
    expect(compiled.params).toContainEqual(["keyword_gap", "positioning"]);
    expect(compiled.params).toContain(JSON.stringify(profileOrigin().evidenceRefs));
  });

  it("persists a CSV origin only through its canonical Observation pointer", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          occurrence_id: "00000000-0000-4000-8000-000000000031",
          competitor_id: entity.id,
        },
      ],
    });
    const repo = new CompetitorsRepository(db as never);
    const csv: CompetitorOriginInput = {
      originKind: "csv_keyword_gap",
      domain: "example-competitor.com",
      name: null,
      snapshotId: "00000000-0000-4000-8000-000000000040",
      observationId: "00000000-0000-4000-8000-000000000041",
      importPreviewId: "00000000-0000-4000-8000-000000000042",
      sourcePointer: "/valueJson/competitorDomain",
    };

    await expect(repo.upsertOrigin(scope, csv)).resolves.toEqual({
      occurrenceId: "00000000-0000-4000-8000-000000000031",
      competitorId: entity.id,
    });
    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        "csv_keyword_gap",
        csv.snapshotId,
        csv.observationId,
        csv.importPreviewId,
        "/valueJson/competitorDomain",
      ]),
    );
    expect(compiled.params).not.toContain("dataforseo");
  });

  it("uses the manual entry UUID without fabricating Snapshot lineage", async () => {
    const db = new FakeExecutor();
    const manualEntryId = "00000000-0000-4000-8000-000000000050";
    db.enqueue({
      rows: [{ occurrence_id: manualEntryId, competitor_id: entity.id }],
    });
    const repo = new CompetitorsRepository(db as never);

    await expect(
      repo.upsertOrigin(scope, {
        originKind: "manual",
        domain: "example-competitor.com",
        name: "Example Competitor",
        manualEntryId,
      }),
    ).resolves.toEqual({ occurrenceId: manualEntryId, competitorId: entity.id });

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining(["manual", manualEntryId, null]),
    );
  });

  it("rejects noncanonical domains and incomplete or invented source lineage before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new CompetitorsRepository(db as never);

    for (const input of [
      profileOrigin({ domain: "Example-Competitor.com" }),
      profileOrigin({ fieldProvenancePath: "/competitorCandidates/01" }),
      profileOrigin({ evidenceRefs: [] }),
      profileOrigin({ sourceRelationship: "status_quo" as "direct" }),
      {
        originKind: "csv_keyword_gap",
        domain: "example-competitor.com",
        name: null,
        snapshotId: "00000000-0000-4000-8000-000000000040",
        observationId: "00000000-0000-4000-8000-000000000041",
        importPreviewId: "00000000-0000-4000-8000-000000000042",
        sourcePointer: "/valueJson/competitorRank",
      } as unknown as CompetitorOriginInput,
      {
        originKind: "serp_overlap",
        domain: "example-competitor.com",
        name: null,
      } as unknown as CompetitorOriginInput,
    ]) {
      await expect(repo.upsertOrigin(scope, input)).rejects.toThrow();
    }
    expect(db.calls).toEqual([]);
  });

  it("lists only an active scoped project with a bounded cursor and derived observation time", async () => {
    const db = new FakeExecutor();
    db.enqueue([entity, { ...entity, id: "00000000-0000-4000-8000-000000000011" }]);
    const repo = new CompetitorsRepository(db as never);

    const page = await repo.listByProject(scope, {
      limit: 1,
      cursor: null,
      reviewStatus: "candidate",
    });

    expect(page.rows).toEqual([entity]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toContain("candidate");
  });

  it("reviews governance at the expected revision without writing any source column", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      {
        ...entity,
        review_status: "approved",
        relationship: "benchmark",
        analysis_scope: ["positioning"],
        revision: 1,
      },
    ]);
    const repo = new CompetitorsRepository(db as never);

    const result = await repo.review(scope, entity.id, {
      expectedRevision: 0,
      name: "Reviewed name",
      reviewStatus: "approved",
      relationship: "benchmark",
      analysisScope: ["positioning"],
    });

    expect(result?.revision).toBe(1);
    expect(db.last("set").args[0]).toEqual({
      name: "Reviewed name",
      review_status: "approved",
      relationship: "benchmark",
      analysis_scope: ["positioning"],
      revision: 1,
    });
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"revision" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
  });

  it("rejects invalid governance and unbounded reads before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new CompetitorsRepository(db as never);

    await expect(
      repo.review(scope, entity.id, {
        expectedRevision: 0,
        name: null,
        reviewStatus: "approved",
        relationship: null,
        analysisScope: [],
      }),
    ).rejects.toThrow(/approved/i);
    await expect(
      repo.review(scope, entity.id, {
        expectedRevision: 0,
        name: null,
        reviewStatus: "candidate",
        relationship: "direct",
        analysisScope: ["keyword_gap"],
      }),
    ).rejects.toThrow(/candidate/i);
    await expect(
      repo.review(scope, entity.id, {
        expectedRevision: 0,
        name: null,
        reviewStatus: "approved",
        relationship: "serp_competitor" as "direct",
        analysisScope: ["keyword_gap"],
      }),
    ).rejects.toThrow(/relationship/i);
    await expect(
      repo.listByProject(scope, {
        limit: MAX_COMPETITOR_PAGE_SIZE + 1,
        cursor: null,
      }),
    ).rejects.toThrow(/limit/i);
    expect(db.calls).toEqual([]);
  });
});
