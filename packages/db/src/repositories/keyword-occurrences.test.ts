import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  KeywordOccurrencesRepository,
  MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
  normalizeKeywordIdentity,
  type CanonicalKeywordOccurrenceInput,
  type KeywordOccurrenceInput,
  type ManualKeywordOccurrenceInput,
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

describe("normalizeKeywordIdentity", () => {
  it("uses NFKC, collapses whitespace and lowercases without losing words", () => {
    expect(normalizeKeywordIdentity("  Ｃustomer\tONBOARDING  ")).toBe(
      "customer onboarding",
    );
  });
});

describe("KeywordOccurrencesRepository", () => {
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
    expect(compiled.params).toContain(null);
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
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"archived_at" is null');
    expect(db.last("limit").args).toEqual([2]);
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
    expect(db.calls).toEqual([]);
  });
});
