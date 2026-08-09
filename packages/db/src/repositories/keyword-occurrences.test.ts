import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  KeywordOccurrencesRepository,
  MAX_KEYWORD_OCCURRENCE_BATCH_TOTAL,
  MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
  normalizeKeywordIdentity,
  type CanonicalKeywordOccurrenceInput,
  type KeywordOccurrenceInput,
  type ManualKeywordOccurrenceInput,
  type ProductProfileKeywordOccurrenceInput,
} from "./keyword-occurrences.ts";

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

function occurrence(
  overrides: Partial<
    Extract<CanonicalKeywordOccurrenceInput, { sourceKind: "dataforseo_ranked" }>
  > = {},
): Extract<
  CanonicalKeywordOccurrenceInput,
  { sourceKind: "dataforseo_ranked" }
> {
  return {
    manualEntryId: null,
    dataSnapshotId: "00000000-0000-4000-8000-000000000003",
    normalizedObservationId: "00000000-0000-4000-8000-000000000004",
    displayKeyword: "Customer Onboarding Software",
    normalizedKeyword: "customer onboarding software",
    market: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    sourceKind: "dataforseo_ranked",
    scopeBasis: "provider_collection_scope",
    sourcePointer: "/valueJson/keyword",
    sourceRef:
      "observation:00000000-0000-4000-8000-000000000004#/valueJson/keyword",
    collectedAt: "2026-07-22T08:00:00.000Z",
    providerDataAsOf: null,
    ...overrides,
  };
}

function productProfileOccurrence(
  overrides: Partial<ProductProfileKeywordOccurrenceInput> = {},
): ProductProfileKeywordOccurrenceInput {
  const productProfileId =
    overrides.productProfileId ?? "00000000-0000-4000-8000-000000000099";
  return {
    manualEntryId: null,
    dataSnapshotId: null,
    normalizedObservationId: null,
    productProfileId,
    displayKeyword: "best customer onboarding software for b2b saas",
    normalizedKeyword: "best customer onboarding software for b2b saas",
    market: "US",
    languageTag: "en-US",
    queryKind: "generative_query",
    sourceKind: "product_profile",
    scopeBasis: "project_context",
    sourcePointer: null,
    sourceRef:
      `product_profile:${productProfileId}#profile-generative-query.v1/best-category-audience`,
    collectedAt: "2026-08-09T09:30:00.000Z",
    providerDataAsOf: null,
    ...overrides,
  };
}

describe("normalizeKeywordIdentity", () => {
  it("uses NFKC, collapses whitespace and lowercases without losing words", () => {
    expect(normalizeKeywordIdentity("  Ｃustomer\tONBOARDING  ")).toBe(
      "customer onboarding",
    );
  });
});

describe("KeywordOccurrencesRepository", () => {
  it("converges 200 canonical keyword occurrences in one bounded database call", async () => {
    const db = new FakeExecutor();
    const inputs = Array.from({ length: 200 }, (_, index) => {
      const observationId = `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`;
      return occurrence({
        normalizedObservationId: observationId,
        displayKeyword: `Customer Onboarding Software ${index + 1}`,
        normalizedKeyword: `customer onboarding software ${index + 1}`,
        sourceRef: `observation:${observationId}#/valueJson/keyword`,
      });
    });
    const rows = inputs.map((_, index) => ({
      input_ordinal: index + 1,
      occurrence_id: `10000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
      entity_id: `20000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
    }));
    db.enqueue({ rows });
    const repo = new KeywordOccurrencesRepository(db as never) as unknown as {
      upsertManyIntoLibrary(
        selectedScope: typeof scope,
        selectedInputs: readonly CanonicalKeywordOccurrenceInput[],
      ): Promise<readonly { occurrenceId: string; entityId: string }[]>;
    };

    await expect(repo.upsertManyIntoLibrary(scope, inputs)).resolves.toHaveLength(
      200,
    );
    expect(db.calls.filter((call) => call.method === "execute")).toHaveLength(1);
    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toContain(
      "app.upsert_keyword_library_occurrences_batch",
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([scope.workspaceId, scope.projectId]),
    );
    const payload = JSON.parse(compiled.params[2] as string) as readonly {
      readonly productProfileId?: unknown;
    }[];
    expect(payload).toHaveLength(200);
    expect(payload.every((input) => input.productProfileId === null)).toBe(
      true,
    );
  });

  it("passes Product Profile ids through the exact batch JSON payload", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          input_ordinal: 1,
          occurrence_id: "00000000-0000-4000-8000-000000000013",
          entity_id: "00000000-0000-4000-8000-000000000014",
        },
      ],
    });
    const repo = new KeywordOccurrencesRepository(db as never);
    const input = productProfileOccurrence();

    await expect(repo.upsertManyIntoLibrary(scope, [input])).resolves.toEqual([
      {
        occurrenceId: "00000000-0000-4000-8000-000000000013",
        entityId: "00000000-0000-4000-8000-000000000014",
      },
    ]);

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(JSON.parse(compiled.params[2] as string)).toEqual([
      expect.objectContaining({ productProfileId: input.productProfileId }),
    ]);
  });

  it("atomically upserts an immutable occurrence, stable entity and provenance membership", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          occurrence_id: "00000000-0000-4000-8000-000000000010",
          entity_id: "00000000-0000-4000-8000-000000000011",
        },
      ],
    });
    const repo = new KeywordOccurrencesRepository(db as never);

    await expect(repo.upsertIntoLibrary(scope, occurrence())).resolves.toEqual({
      occurrenceId: "00000000-0000-4000-8000-000000000010",
      entityId: "00000000-0000-4000-8000-000000000011",
    });

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toContain("app.upsert_keyword_library_occurrence");
    expect(compiled.params).toContain(scope.workspaceId);
    expect(compiled.params).toContain(scope.projectId);
    expect(compiled.params).toContain("en-US");
    expect(compiled.params).toContain("provider_collection_scope");
    expect(compiled.params).toContain("/valueJson/keyword");
    expect(compiled.params[5]).toBeNull();
  });

  it("uses the caller manual entry UUID as the occurrence without fake provider lineage", async () => {
    const db = new FakeExecutor();
    const manualEntryId = "00000000-0000-4000-8000-000000000012";
    db.enqueue({
      rows: [
        {
          occurrence_id: manualEntryId,
          entity_id: "00000000-0000-4000-8000-000000000011",
        },
      ],
    });
    const repo = new KeywordOccurrencesRepository(db as never);
    const input: ManualKeywordOccurrenceInput = {
      manualEntryId,
      dataSnapshotId: null,
      normalizedObservationId: null,
      displayKeyword: "Customer Onboarding Platform",
      normalizedKeyword: "customer onboarding platform",
      market: "US",
      languageTag: "en-US",
      queryKind: "generative_query",
      sourceKind: "manual",
      scopeBasis: "manual",
      sourcePointer: null,
      sourceRef: `manual:${manualEntryId}`,
      collectedAt: "2026-07-22T08:00:00.000Z",
      providerDataAsOf: null,
    };

    await expect(repo.upsertIntoLibrary(scope, input)).resolves.toEqual({
      occurrenceId: manualEntryId,
      entityId: "00000000-0000-4000-8000-000000000011",
    });
    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([manualEntryId, "manual", null]),
    );
  });

  it("accepts Product Profile-derived GenerativeQueries without fake provider lineage", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          occurrence_id: "00000000-0000-4000-8000-000000000013",
          entity_id: "00000000-0000-4000-8000-000000000014",
        },
      ],
    });
    const repo = new KeywordOccurrencesRepository(db as never);
    const input = productProfileOccurrence();

    await expect(repo.upsertIntoLibrary(scope, input)).resolves.toEqual({
      occurrenceId: "00000000-0000-4000-8000-000000000013",
      entityId: "00000000-0000-4000-8000-000000000014",
    });
    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.params[5]).toBe(input.productProfileId);
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        "product_profile",
        "project_context",
        "product_profile:00000000-0000-4000-8000-000000000099#profile-generative-query.v1/best-category-audience",
        null,
      ]),
    );
  });

  it("rejects a non-canonical identity and always requires canonical Observation lineage", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordOccurrencesRepository(db as never);

    await expect(
      repo.upsertIntoLibrary(
        scope,
        occurrence({ normalizedKeyword: "Customer Onboarding Software" }),
      ),
    ).rejects.toThrow(/normalizedKeyword/i);
    await expect(
      repo.upsertIntoLibrary(
        scope,
        {
          ...occurrence(),
          normalizedObservationId: null,
        } as unknown as KeywordOccurrenceInput,
      ),
    ).rejects.toThrow(/normalizedObservationId/i);
    expect(db.calls).toEqual([]);
  });

  it("rejects non-canonical Product Profile language casing before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordOccurrencesRepository(db as never);

    await expect(
      repo.upsertIntoLibrary(
        scope,
        productProfileOccurrence({ languageTag: "en-us" }),
      ),
    ).rejects.toThrow(/canonical BCP-47/i);
    expect(db.calls).toEqual([]);
  });

  it("preserves legacy provider language-tag canonicalization", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          occurrence_id: "00000000-0000-4000-8000-000000000010",
          entity_id: "00000000-0000-4000-8000-000000000011",
        },
      ],
    });
    const repo = new KeywordOccurrencesRepository(db as never);

    await expect(
      repo.upsertIntoLibrary(scope, occurrence({ languageTag: "en-us" })),
    ).resolves.toEqual({
      occurrenceId: "00000000-0000-4000-8000-000000000010",
      entityId: "00000000-0000-4000-8000-000000000011",
    });

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.params).toContain("en-US");
  });

  it("rejects a manual source reference or provider lineage that does not match its occurrence UUID", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordOccurrencesRepository(db as never);
    const manualEntryId = "00000000-0000-4000-8000-000000000012";
    const base: ManualKeywordOccurrenceInput = {
      manualEntryId,
      dataSnapshotId: null,
      normalizedObservationId: null,
      displayKeyword: "Customer Onboarding Platform",
      normalizedKeyword: "customer onboarding platform",
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "manual",
      scopeBasis: "manual",
      sourcePointer: null,
      sourceRef: `manual:${manualEntryId}`,
      collectedAt: "2026-07-22T08:00:00.000Z",
      providerDataAsOf: null,
    };

    await expect(
      repo.upsertIntoLibrary(scope, {
        ...base,
        sourceRef: "manual:00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toThrow(/sourceRef/i);
    await expect(
      repo.upsertIntoLibrary(scope, {
        ...base,
        dataSnapshotId: "00000000-0000-4000-8000-000000000003",
      } as unknown as KeywordOccurrenceInput),
    ).rejects.toThrow(/provider lineage/i);
    expect(db.calls).toEqual([]);
  });

  it("rejects unsupported or incoherent source JSON pointers before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordOccurrencesRepository(db as never);

    await expect(
      repo.upsertIntoLibrary(
        scope,
        {
          ...occurrence(),
          sourcePointer: "/valueJson/topQueries/10/query",
        } as unknown as KeywordOccurrenceInput,
      ),
    ).rejects.toThrow(/sourcePointer/i);
    await expect(
      repo.upsertIntoLibrary(
        scope,
        {
          ...occurrence(),
          sourceKind: "gsc_top_query",
          scopeBasis: "project_context",
          sourcePointer: "/valueJson/topQueries/0/query",
        } as unknown as KeywordOccurrenceInput,
      ),
    ).rejects.toThrow(/sourceRef/i);
    expect(db.calls).toEqual([]);
  });

  it("preserves an unknown provider data timestamp as null without copying observation metrics", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          occurrence_id: "00000000-0000-4000-8000-000000000010",
          entity_id: "00000000-0000-4000-8000-000000000011",
        },
      ],
    });
    const repo = new KeywordOccurrencesRepository(db as never);

    await repo.upsertIntoLibrary(scope, occurrence());
    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.params).toContain(null);
    expect(compiled.sql).not.toMatch(/volume|rank|current_url|competitor_rank/i);
  });

  it("keeps interview summaries and public user reviews as distinct canonical occurrence kinds", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      {
        rows: [
          {
            occurrence_id: "00000000-0000-4000-8000-000000000013",
            entity_id: "00000000-0000-4000-8000-000000000011",
          },
        ],
      },
      {
        rows: [
          {
            occurrence_id: "00000000-0000-4000-8000-000000000014",
            entity_id: "00000000-0000-4000-8000-000000000011",
          },
        ],
      },
    );
    const repo = new KeywordOccurrencesRepository(db as never);
    const interviewObservationId =
      "00000000-0000-4000-8000-000000000021";
    const reviewObservationId =
      "00000000-0000-4000-8000-000000000022";

    await repo.upsertIntoLibrary(scope, {
      ...occurrence(),
      normalizedObservationId: interviewObservationId,
      sourceKind: "interview_summary",
      scopeBasis: "user_provided",
      sourceRef:
        `observation:${interviewObservationId}#/valueJson/keyword`,
      providerDataAsOf: "2026-07-20T00:00:00.000Z",
    });
    await repo.upsertIntoLibrary(scope, {
      ...occurrence(),
      normalizedObservationId: reviewObservationId,
      sourceKind: "user_review",
      scopeBasis: "provider_collection_scope",
      sourceRef:
        `observation:${reviewObservationId}#/valueJson/keyword`,
      providerDataAsOf: "2026-07-21T00:00:00.000Z",
    });

    const executeCalls = db.calls.filter(
      (call) => call.method === "execute",
    );
    expect(executeCalls).toHaveLength(2);
    const interviewSql = new PgDialect().sqlToQuery(
      executeCalls[0]?.args[0] as never,
    );
    const reviewSql = new PgDialect().sqlToQuery(
      executeCalls[1]?.args[0] as never,
    );
    expect(interviewSql.params).toEqual(
      expect.arrayContaining(["interview_summary", "user_provided"]),
    );
    expect(reviewSql.params).toEqual(
      expect.arrayContaining([
        "user_review",
        "provider_collection_scope",
      ]),
    );
  });

  it("rejects an interview or user-review occurrence that borrows the other source scope", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordOccurrencesRepository(db as never);

    await expect(
      repo.upsertIntoLibrary(scope, {
        ...occurrence(),
        sourceKind: "interview_summary",
        scopeBasis: "provider_collection_scope",
      } as unknown as KeywordOccurrenceInput),
    ).rejects.toThrow(/scopeBasis/i);
    await expect(
      repo.upsertIntoLibrary(scope, {
        ...occurrence(),
        sourceKind: "user_review",
        scopeBasis: "user_provided",
      } as unknown as KeywordOccurrenceInput),
    ).rejects.toThrow(/scopeBasis/i);
    expect(db.calls).toEqual([]);
  });

  it("returns a bounded project-scoped provenance page with an opaque cursor", async () => {
    const db = new FakeExecutor();
    const rows = [
      {
        id: "00000000-0000-4000-8000-000000000010",
        created_at: "2026-07-22T08:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000011",
        created_at: "2026-07-22T07:00:00.000Z",
      },
    ];
    db.enqueue(rows);
    const repo = new KeywordOccurrencesRepository(db as never);

    const page = await repo.listForEntity(
      scope,
      "00000000-0000-4000-8000-000000000020",
      { limit: 1, cursor: null },
    );

    expect(page.rows).toEqual([rows[0]]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(db.last("select").args[0]).toHaveProperty("product_profile_id");
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(db.last("limit").args).toEqual([2]);
  });

  it("batch-loads bounded occurrence history for many entities in one project-scoped query", async () => {
    const db = new FakeExecutor();
    const firstEntityId = "00000000-0000-4000-8000-000000000020";
    const secondEntityId = "00000000-0000-4000-8000-000000000021";
    const rows = [
      {
        keyword_entity_id: firstEntityId,
        id: "00000000-0000-4000-8000-000000000030",
      },
      {
        keyword_entity_id: secondEntityId,
        id: "00000000-0000-4000-8000-000000000031",
      },
    ];
    db.enqueue({ rows });
    const repo = new KeywordOccurrencesRepository(db as never);

    await expect(
      repo.listForEntityIds(scope, [secondEntityId, firstEntityId], {
        limitPerEntity: MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
        totalLimit: MAX_KEYWORD_OCCURRENCE_BATCH_TOTAL,
      }),
    ).resolves.toEqual(rows);

    const compiled = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(compiled.sql).toMatch(/row_number\(\) over\s*\(\s*partition by/iu);
    expect(compiled.sql).toContain('"workspace_id" = $');
    expect(compiled.sql).toContain('"project_id" = $');
    expect(compiled.sql).toContain('"archived_at" is null');
    expect(compiled.sql).toContain("product_profile_id");
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        firstEntityId,
        secondEntityId,
        MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
        MAX_KEYWORD_OCCURRENCE_BATCH_TOTAL + 1,
      ]),
    );
    expect(db.calls.filter((call) => call.method === "execute")).toHaveLength(1);
  });

  it("fails closed on invalid cursors and oversized pages before SQL", async () => {
    const db = new FakeExecutor();
    const repo = new KeywordOccurrencesRepository(db as never);

    await expect(
      repo.listForEntity(
        scope,
        "00000000-0000-4000-8000-000000000020",
        { limit: 20, cursor: "not-a-cursor" },
      ),
    ).resolves.toEqual({ rows: [], nextCursor: null });
    await expect(
      repo.listForEntity(
        scope,
        "00000000-0000-4000-8000-000000000020",
        { limit: MAX_KEYWORD_OCCURRENCE_PAGE_SIZE + 1, cursor: null },
      ),
    ).rejects.toThrow(/limit/i);
    await expect(
      repo.listForEntityIds(
        scope,
        [
          "00000000-0000-4000-8000-000000000020",
          "00000000-0000-4000-8000-000000000020",
        ],
        {
          limitPerEntity: 1,
          totalLimit: 2,
        },
      ),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      repo.listForEntityIds(
        scope,
        ["00000000-0000-4000-8000-000000000020"],
        {
          limitPerEntity: MAX_KEYWORD_OCCURRENCE_PAGE_SIZE + 1,
          totalLimit: 2,
        },
      ),
    ).rejects.toThrow(/limitPerEntity/i);
    expect(db.calls).toEqual([]);
  });
});
