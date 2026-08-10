import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
  MAX_POSTGRES_INTEGER_REVISION,
} from "@sf/contracts";
import {
  CompetitorsRepository,
  MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ,
  MAX_COMPETITOR_ORIGIN_BATCH_TOTAL,
  MAX_COMPETITOR_DISCOVERY_AI_ORIGIN_READ,
  MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
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
  it("converges 100 exact competitor origins in one bounded database call", async () => {
    const db = new FakeExecutor();
    const inputs = Array.from({ length: 100 }, (_, index) => {
      const observationId = `00000000-0000-4000-8002-${String(index + 1).padStart(12, "0")}`;
      return {
        originKind: "serp_overlap",
        domain: `rival-${index + 1}.example`,
        name: null,
        snapshotId: "00000000-0000-4000-8000-000000000060",
        observationId,
        sourcePointer: "/valueJson/competitorDomain",
      } as const;
    });
    db.enqueue({
      rows: inputs.map((_, index) => ({
        input_ordinal: index + 1,
        occurrence_id: `10000000-0000-4000-8002-${String(index + 1).padStart(12, "0")}`,
        competitor_id: `20000000-0000-4000-8002-${String(index + 1).padStart(12, "0")}`,
      })),
    });
    const repo = new CompetitorsRepository(db as never) as unknown as {
      upsertOrigins(
        selectedScope: typeof scope,
        selectedInputs: readonly CompetitorOriginInput[],
      ): Promise<readonly { occurrenceId: string; competitorId: string }[]>;
    };

    await expect(repo.upsertOrigins(scope, inputs)).resolves.toHaveLength(100);
    expect(db.calls.filter((call) => call.method === "execute")).toHaveLength(1);
    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toContain("app.upsert_competitor_origins_batch");
    expect(compiled.params).toEqual(
      expect.arrayContaining([scope.workspaceId, scope.projectId]),
    );
  });

  it("reads current non-excluded AI citation domains in deterministic order", async () => {
    const db = new FakeExecutor();
    const tracked = [{ id: entity.id, domain: entity.domain }];
    db.enqueue(tracked);
    const repo = new CompetitorsRepository(db as never);

    await expect(
      repo.listAiCitationTrackedDomains(scope, { limit: 501 }),
    ).resolves.toEqual(tracked);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.sql).toContain('"review_status" <> $');
    expect(predicate.params).toContain("excluded");
    expect(db.last("orderBy").args).toHaveLength(2);
    expect(db.last("limit").args).toEqual([501]);
  });

  it("accepts the UUIDv8 identity a Product Profile actually derives", async () => {
    // Every identity a Product Profile mints is UUIDv8: candidateId and
    // evidenceRefId are derived from the profile's own content so that
    // re-synthesising a site reproduces them. The fixtures above spell v4 by
    // hand, which is why a [1-5] version bound survived here while rejecting
    // every real confirmation. These two are genuine derived values.
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

    await expect(
      repo.upsertOrigin(
        scope,
        profileOrigin({
          candidateId: "d3b07384-d9a0-8f1e-9c2b-4a5e6f708192",
          evidenceRefs: [
            {
              evidenceRefId: "5f2c8a1b-6e3d-8c47-b91a-2d4e6f8a0b3c",
              kind: "userEdit",
            },
          ],
        }),
      ),
    ).resolves.toEqual({
      occurrenceId: "00000000-0000-4000-8000-000000000030",
      competitorId: entity.id,
    });
  });

  it("still rejects a version this codebase never mints", async () => {
    // Widening to [1-8] must not become "any hex in that position". Version 0
    // and version 9 are outside every format we produce or read.
    const repo = new CompetitorsRepository(new FakeExecutor() as never);

    for (const candidateId of [
      "d3b07384-d9a0-0f1e-9c2b-4a5e6f708192",
      "d3b07384-d9a0-9f1e-9c2b-4a5e6f708192",
    ]) {
      await expect(
        repo.upsertOrigin(scope, profileOrigin({ candidateId })),
      ).rejects.toThrow("candidateId must be a UUID");
    }
  });

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

  it("persists a SERP overlap only through the exact composite Observation pointer", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          occurrence_id: "00000000-0000-4000-8000-000000000032",
          competitor_id: entity.id,
        },
      ],
    });
    const repo = new CompetitorsRepository(db as never);
    const serp: CompetitorOriginInput = {
      originKind: "serp_overlap",
      domain: "example-competitor.com",
      name: null,
      snapshotId: "00000000-0000-4000-8000-000000000060",
      observationId: "00000000-0000-4000-8000-000000000061",
      sourcePointer: "/valueJson/competitorDomain",
    };

    await expect(repo.upsertOrigin(scope, serp)).resolves.toEqual({
      occurrenceId: "00000000-0000-4000-8000-000000000032",
      competitorId: entity.id,
    });
    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toContain(
      "app.upsert_serp_overlap_competitor_origin",
    );
    expect(compiled.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      serp.domain,
      serp.snapshotId,
      serp.observationId,
      "/valueJson/competitorDomain",
    ]);
    expect(compiled.params).not.toContain("keyword_gap_import");
  });

  it("persists an AI citation origin only through its exact aggregate Observation pointer", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          occurrence_id: "00000000-0000-4000-8000-000000000033",
          competitor_id: entity.id,
        },
      ],
    });
    const repo = new CompetitorsRepository(db as never);
    const aiCitation = {
      originKind: "ai_citation",
      domain: "example-competitor.com",
      name: null,
      snapshotId: "00000000-0000-4000-8000-000000000070",
      observationId: "00000000-0000-4000-8000-000000000071",
      sourcePointer: "/valueJson/competitorDomain",
    } as const;

    await expect(
      repo.upsertOrigin(scope, aiCitation as unknown as CompetitorOriginInput),
    ).resolves.toEqual({
      occurrenceId: "00000000-0000-4000-8000-000000000033",
      competitorId: entity.id,
    });
    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toContain(
      "app.upsert_ai_citation_competitor_origin",
    );
    expect(compiled.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      aiCitation.domain,
      aiCitation.snapshotId,
      aiCitation.observationId,
      "/valueJson/competitorDomain",
    ]);
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
        snapshotId: "00000000-0000-4000-8000-000000000060",
        observationId: "00000000-0000-4000-8000-000000000061",
        sourcePointer: "/valueJson/intersections",
      } as unknown as CompetitorOriginInput,
      {
        originKind: "ai_citation",
        domain: "example-competitor.com",
        name: null,
        snapshotId: "00000000-0000-4000-8000-000000000070",
        observationId: "00000000-0000-4000-8000-000000000071",
        sourcePointer: "/valueJson/citedQueries",
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

  it("pages one bounded frozen competitor id set with the canonical timestamp cursor", async () => {
    const db = new FakeExecutor();
    const newer = {
      ...entity,
      id: "00000000-0000-4000-8000-000000000099",
      created_at: "2026-07-23T08:00:00.000Z",
    };
    const older = {
      ...entity,
      id: "00000000-0000-4000-8000-000000000098",
      created_at: "2026-07-22T08:00:00.000Z",
    };
    db.enqueue([newer, older]);
    const repo = new CompetitorsRepository(db as never);

    const page = await repo.listByIdsPage(scope, [older.id, newer.id], {
      limit: 1,
      cursor: null,
    });

    expect(page.rows).toEqual([newer]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"id" in');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toEqual(
      expect.arrayContaining([scope.workspaceId, scope.projectId, older.id, newer.id]),
    );
  });

  it("reads only approved diagnostic competitor facts with one sentinel", async () => {
    const db = new FakeExecutor();
    const approved = {
      ...entity,
      review_status: "approved",
      relationship: "direct",
      revision: 1,
    } as const satisfies CompetitorEntityRow;
    db.enqueue([approved]);
    const repo = new CompetitorsRepository(db as never);

    await expect(
      repo.listDiagnosticEligible(scope, {
        limit: MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ,
      }),
    ).resolves.toEqual([approved]);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toContain("approved");
    expect(db.last("limit").args).toEqual([
      MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ,
    ]);
  });

  it("counts each full-library non-AI discovery route exactly once per competitor", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          customer_input: "7",
          serp_duplicate: "100",
          approved_corpus: "3",
        },
      ],
    });
    const repo = new CompetitorsRepository(db as never);

    await expect(repo.countDiscoveryOrigins(scope)).resolves.toEqual({
      customer_input: 7,
      serp_duplicate: 100,
      approved_corpus: 3,
    });

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toMatch(/count\(distinct[\s\S]*competitor_id/iu);
    expect(compiled.sql).toContain("'product_profile'");
    expect(compiled.sql).toContain("'manual'");
    expect(compiled.sql).toContain("'serp_overlap'");
    expect(compiled.sql).toContain("'csv_keyword_gap'");
    expect(compiled.sql).toContain('"workspace_id" = $');
    expect(compiled.sql).toContain('"project_id" = $');
    expect(compiled.sql).toContain('"archived_at" is null');
    expect(compiled.params).toEqual(
      expect.arrayContaining([scope.workspaceId, scope.projectId]),
    );
  });

  it.each([
    ["no aggregate row", { rows: [] }],
    [
      "more than one aggregate row",
      {
        rows: [
          { customer_input: "0", serp_duplicate: "0", approved_corpus: "0" },
          { customer_input: "0", serp_duplicate: "0", approved_corpus: "0" },
        ],
      },
    ],
    [
      "a negative count",
      {
        rows: [
          { customer_input: "-1", serp_duplicate: "0", approved_corpus: "0" },
        ],
      },
    ],
    [
      "a fractional count",
      {
        rows: [
          { customer_input: "0", serp_duplicate: "1.5", approved_corpus: "0" },
        ],
      },
    ],
    [
      "an unsafe count",
      {
        rows: [
          {
            customer_input: "0",
            serp_duplicate: "0",
            approved_corpus: String(Number.MAX_SAFE_INTEGER + 1),
          },
        ],
      },
    ],
  ])("fails closed when discovery counts return %s", async (_label, result) => {
    const db = new FakeExecutor();
    db.enqueue(result);
    const repo = new CompetitorsRepository(db as never);

    await expect(repo.countDiscoveryOrigins(scope)).rejects.toThrow(
      /discovery count/i,
    );
  });

  it("returns all AI candidates inside each entity's canonical top-100 origin window", async () => {
    const db = new FakeExecutor();
    const rows = [
      {
        id: "00000000-0000-4000-8000-000000000070",
        competitor_id: entity.id,
        origin_kind: "ai_citation",
      },
      {
        id: "00000000-0000-4000-8000-000000000071",
        competitor_id: entity.id,
        origin_kind: "ai_citation",
      },
    ];
    db.enqueue({ rows });
    const repo = new CompetitorsRepository(db as never);

    await expect(repo.listAiCitationDiscoveryOrigins(scope)).resolves.toEqual(
      rows,
    );

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toMatch(/row_number\(\) over\s*\(\s*partition by/iu);
    expect(compiled.sql).toMatch(/observed_at[^,]*desc nulls last/iu);
    expect(compiled.sql).toMatch(/created_at[^,]*desc/iu);
    expect(compiled.sql).toMatch(/entity_row_number\s*<=/iu);
    expect(compiled.sql).toMatch(/origin_kind\s*=\s*'ai_citation'/iu);
    expect(compiled.sql).not.toMatch(/distinct\s+on/iu);
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
        MAX_COMPETITOR_DISCOVERY_AI_ORIGIN_READ + 1,
      ]),
    );
  });

  it("batch-loads bounded origins for many competitors in one project-scoped query", async () => {
    const db = new FakeExecutor();
    const secondId = "00000000-0000-4000-8000-000000000011";
    const rows = [
      {
        id: "00000000-0000-4000-8000-000000000030",
        competitor_id: entity.id,
      },
      {
        id: "00000000-0000-4000-8000-000000000031",
        competitor_id: secondId,
      },
    ];
    db.enqueue({ rows });
    const repo = new CompetitorsRepository(db as never);

    await expect(
      repo.listOriginsForCompetitorIds(scope, [secondId, entity.id], {
        limitPerEntity: MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
        totalLimit: MAX_COMPETITOR_ORIGIN_BATCH_TOTAL,
      }),
    ).resolves.toEqual(rows);

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toMatch(/row_number\(\) over\s*\(\s*partition by/iu);
    expect(compiled.sql).toContain('"workspace_id" = $');
    expect(compiled.sql).toContain('"project_id" = $');
    expect(compiled.sql).toContain('"archived_at" is null');
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        entity.id,
        secondId,
        MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
        MAX_COMPETITOR_ORIGIN_BATCH_TOTAL + 1,
      ]),
    );
    expect(db.calls.filter((call) => call.method === "execute")).toHaveLength(1);
  });

  it("reads only exact frozen origin occurrence ids without widening current history", async () => {
    const db = new FakeExecutor();
    const firstOrigin = {
      id: "00000000-0000-4000-8000-000000000060",
      competitor_id: entity.id,
    };
    const secondOrigin = {
      id: "00000000-0000-4000-8000-000000000061",
      competitor_id: entity.id,
    };
    db.enqueue([firstOrigin, secondOrigin]);
    const repo = new CompetitorsRepository(db as never);

    await expect(
      repo.listOriginsByIds(scope, [secondOrigin.id, firstOrigin.id]),
    ).resolves.toEqual([firstOrigin, secondOrigin]);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $');
    expect(predicate.sql).toContain('"project_id" = $');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(predicate.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        secondOrigin.id,
        firstOrigin.id,
      ]),
    );
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

  it("applies Product Profile defaults only to revision-zero governance", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      {
        ...entity,
        name: "Profile competitor",
        review_status: "approved",
        relationship: "direct",
        analysis_scope: ["keyword_gap", "serp_visibility"],
        revision: 1,
      },
    ]);
    const repo = new CompetitorsRepository(db as never);

    const result = await repo.applyProductProfileDefaultGovernance(
      scope,
      entity.id,
      {
        name: "Profile competitor",
        reviewStatus: "approved",
        relationship: "direct",
        analysisScope: ["keyword_gap", "serp_visibility"],
      },
    );

    expect(result).toMatchObject({
      review_status: "approved",
      relationship: "direct",
      revision: 1,
    });
    expect(db.last("set").args[0]).toEqual({
      name: "Profile competitor",
      review_status: "approved",
      relationship: "direct",
      analysis_scope: ["keyword_gap", "serp_visibility"],
      revision: 1,
    });
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"revision" = $');
    expect(predicate.params).toContain(0);
    expect(predicate.sql).toContain('"archived_at" is null');
  });

  it("rejects incomplete Product Profile default classifications before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new CompetitorsRepository(db as never);

    await expect(
      repo.applyProductProfileDefaultGovernance(scope, entity.id, {
        name: "Profile competitor",
        reviewStatus: "approved",
        relationship: null,
        analysisScope: [],
      }),
    ).rejects.toThrow(/default governance/iu);
    await expect(
      repo.applyProductProfileDefaultGovernance(scope, entity.id, {
        name: "Profile competitor",
        reviewStatus: "excluded",
        relationship: "direct",
        analysisScope: ["keyword_gap"],
      }),
    ).rejects.toThrow(/default governance/iu);
    expect(db.calls).toEqual([]);
  });

  it("allows only the final incrementable competitor CAS revision", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      {
        ...entity,
        revision: MAX_POSTGRES_INTEGER_REVISION,
      },
    ]);
    const repo = new CompetitorsRepository(db as never);

    await expect(
      repo.review(scope, entity.id, {
        expectedRevision:
          MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
        name: null,
        reviewStatus: "candidate",
        relationship: null,
        analysisScope: [],
      }),
    ).resolves.toMatchObject({
      revision: MAX_POSTGRES_INTEGER_REVISION,
    });
    expect(db.last("set").args[0]).toMatchObject({
      revision: MAX_POSTGRES_INTEGER_REVISION,
    });

    const rejected = new FakeExecutor();
    const rejectedRepo = new CompetitorsRepository(rejected as never);
    await expect(
      rejectedRepo.review(scope, entity.id, {
        expectedRevision: MAX_POSTGRES_INTEGER_REVISION,
        name: null,
        reviewStatus: "candidate",
        relationship: null,
        analysisScope: [],
      }),
    ).rejects.toThrow(/incrementable PostgreSQL integer range/u);
    expect(rejected.calls).toEqual([]);
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
    await expect(
      repo.listOriginsForCompetitorIds(scope, [entity.id, entity.id], {
        limitPerEntity: 1,
        totalLimit: 2,
      }),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      repo.listOriginsForCompetitorIds(scope, [entity.id], {
        limitPerEntity: MAX_COMPETITOR_ORIGIN_PAGE_SIZE + 1,
        totalLimit: 2,
      }),
    ).rejects.toThrow(/limitPerEntity/i);
    await expect(
      repo.listByIdsPage(scope, [entity.id, entity.id], {
        limit: 1,
        cursor: null,
      }),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      repo.listOriginsByIds(scope, [entity.id, entity.id]),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      repo.listDiagnosticEligible(scope, {
        limit: MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ + 1,
      }),
    ).rejects.toThrow(/limit/i);
    expect(db.calls).toEqual([]);
  });
});
