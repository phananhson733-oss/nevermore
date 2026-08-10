import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompetitorsRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  type CompetitorEntityRow,
  type CompetitorOriginKind,
  type CompetitorOriginRow,
  type KeywordEntityRow,
  type KeywordOccurrenceForEntityRow,
  type ProjectScope,
} from "@sf/db";
import { freezeDiagnosticGovernance } from "./governance.ts";

const scope = {
  workspaceId: "71000000-0000-4000-8000-000000000001",
  projectId: "71000000-0000-4000-8000-000000000002",
} satisfies ProjectScope;

const ids = {
  competitor: "71000000-0000-4000-8000-000000000003",
  origin: "71000000-0000-4000-8000-000000000004",
  snapshot: "71000000-0000-4000-8000-000000000005",
  observation: "71000000-0000-4000-8000-000000000006",
} as const;

const instant = "2026-07-29T08:00:00.000Z";

function competitor(): CompetitorEntityRow {
  return {
    id: ids.competitor,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    domain: "competitor.example",
    name: null,
    review_status: "approved",
    relationship: "direct",
    analysis_scope: ["serp_visibility"],
    revision: 1,
    last_observed_at: instant,
    origin_count: 1,
    created_at: instant,
    updated_at: instant,
  };
}

function origin(
  originKind: CompetitorOriginKind,
  overrides: Partial<CompetitorOriginRow> = {},
): CompetitorOriginRow {
  return {
    id: ids.origin,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    competitor_id: ids.competitor,
    origin_kind: originKind,
    source_name: null,
    product_profile_id: null,
    profile_version: null,
    candidate_id: null,
    field_provenance_path: null,
    evidence_refs: null,
    source_review_status: null,
    source_relationship: null,
    source_analysis_scope: null,
    data_snapshot_id:
      originKind === "csv_keyword_gap" ||
      originKind === "serp_overlap" ||
      originKind === "ai_citation"
        ? ids.snapshot
        : null,
    normalized_observation_id:
      originKind === "csv_keyword_gap" ||
      originKind === "serp_overlap" ||
      originKind === "ai_citation"
        ? ids.observation
        : null,
    import_preview_id:
      originKind === "csv_keyword_gap"
        ? "71000000-0000-4000-8000-000000000007"
        : null,
    source_pointer:
      originKind === "csv_keyword_gap" ||
      originKind === "serp_overlap" ||
      originKind === "ai_citation"
        ? "/valueJson/competitorDomain"
        : null,
    manual_entry_id:
      originKind === "manual"
        ? "71000000-0000-4000-8000-000000000008"
        : null,
    observed_at:
      originKind === "csv_keyword_gap" ||
      originKind === "serp_overlap" ||
      originKind === "ai_citation"
        ? instant
        : null,
    created_at: instant,
    ...overrides,
  };
}

function mockLibraryReads(row: CompetitorOriginRow): void {
  vi.spyOn(
    KeywordsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([]);
  vi.spyOn(
    KeywordOccurrencesRepository.prototype,
    "listForEntityIds",
  ).mockResolvedValue([]);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([competitor()]);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listOriginsForCompetitorIds",
  ).mockResolvedValue([row]);
}

const keywordEntityId = "71000000-0000-4000-8000-000000000010";

function keywordEntity(
  overrides: Partial<KeywordEntityRow> = {},
): KeywordEntityRow {
  return {
    id: keywordEntityId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    display_keyword: "www.astrologywiki.com",
    normalized_keyword: "www.astrologywiki.com",
    market: "US",
    language_tag: "en",
    query_kind: "search_query",
    status: "approved",
    intent: null,
    buyer_stage: null,
    cluster_key: "www-astrologywiki-com",
    mapping_decision: "unassigned",
    mapped_site_page_id: null,
    mapping_review_state: "confirmed",
    mapping_revision: 1,
    first_seen_at: instant,
    last_seen_at: instant,
    created_at: instant,
    updated_at: instant,
    ...overrides,
  } as unknown as KeywordEntityRow;
}

function keywordOccurrence(index: number): KeywordOccurrenceForEntityRow {
  const suffix = String(index).padStart(12, "0");
  return {
    keyword_entity_id: keywordEntityId,
    id: `71000000-0000-4000-9000-${suffix}`,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    product_profile_id: null,
    data_snapshot_id: `71000000-0000-4000-a000-${suffix}`,
    normalized_observation_id: `71000000-0000-4000-b000-${suffix}`,
    display_keyword: "www.astrologywiki.com",
    normalized_keyword: "www.astrologywiki.com",
    market: "US",
    language_tag: "en",
    query_kind: "search_query",
    source_kind: "gsc_top_query",
    scope_basis: "project_context",
    source_pointer: "/valueJson/topQueries/0/query",
    source_ref: `observation:71000000-0000-4000-b000-${suffix}#/valueJson/topQueries/0/query`,
    collected_at: instant,
    provider_data_as_of: null,
    created_at: instant,
  } as unknown as KeywordOccurrenceForEntityRow;
}

function libraryKeywordEntity(index: number): KeywordEntityRow {
  const suffix = index.toString(16).padStart(12, "0");
  return {
    ...keywordEntity(),
    id: `71000000-0000-4000-8001-${suffix}`,
    display_keyword: `keyword ${index}`,
    normalized_keyword: `keyword ${index}`,
    cluster_key: `cluster-${index}`,
  };
}

function libraryKeywordOccurrence(
  entity: KeywordEntityRow,
  ordinal: number,
): KeywordOccurrenceForEntityRow {
  const suffix = ordinal.toString(16).padStart(12, "0");
  const observationId = `71000000-0000-4000-b001-${suffix}`;
  return {
    ...keywordOccurrence(1),
    keyword_entity_id: entity.id,
    id: `71000000-0000-4000-9001-${suffix}`,
    data_snapshot_id: `71000000-0000-4000-a001-${suffix}`,
    normalized_observation_id: observationId,
    display_keyword: entity.display_keyword,
    normalized_keyword: entity.normalized_keyword,
    market: entity.market,
    language_tag: entity.language_tag,
    query_kind: entity.query_kind,
    source_ref: `observation:${observationId}#/valueJson/topQueries/0/query`,
  } as KeywordOccurrenceForEntityRow;
}

function mockKeywordReads(
  occurrences: readonly KeywordOccurrenceForEntityRow[],
  entity: KeywordEntityRow = keywordEntity(),
): void {
  vi.spyOn(
    KeywordsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([entity]);
  vi.spyOn(
    KeywordOccurrencesRepository.prototype,
    "listForEntityIds",
  ).mockResolvedValue([...occurrences]);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([]);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listOriginsForCompetitorIds",
  ).mockResolvedValue([]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("freezeDiagnosticGovernance (analysis refresh)", () => {
  it("accepts exact Product Profile keyword lineage without invented provider evidence", async () => {
    const profileId = "71000000-0000-4000-8000-000000000011";
    const entity = keywordEntity({ query_kind: "generative_query" });
    mockKeywordReads(
      [
        {
          ...keywordOccurrence(1),
          product_profile_id: profileId,
          data_snapshot_id: null,
          normalized_observation_id: null,
          query_kind: "generative_query",
          source_kind: "product_profile",
          scope_basis: "project_context",
          source_pointer: null,
          source_ref: `product_profile:${profileId}#profile-generative-query.v1/what-is-product`,
          provider_data_as_of: null,
        },
      ],
      entity,
    );

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(projection.keywordClusters[0]?.keywords[0]?.occurrenceRefs).toEqual([
      {
        occurrenceId: "71000000-0000-4000-9000-000000000001",
        snapshotId: null,
        observationId: null,
      },
    ]);
  });

  it("preserves exact bounded lineage for a healthy 11,242-ref keyword library", async () => {
    const entities = Array.from({ length: 1_248 }, (_, index) =>
      libraryKeywordEntity(index + 1),
    );
    vi.spyOn(
      KeywordsRepository.prototype,
      "listDiagnosticEligible",
    ).mockResolvedValue(entities);
    const occurrenceRead = vi.spyOn(
      KeywordOccurrencesRepository.prototype,
      "listForEntityIds",
    );
    occurrenceRead.mockImplementation(async (_scope, entityIds, options) => {
      const byId = new Map(entities.map((entity) => [entity.id, entity]));
      const rows: KeywordOccurrenceForEntityRow[] = [];
      for (const [entityIndex, entityId] of entityIds.entries()) {
        const entity = byId.get(entityId);
        if (!entity) throw new Error("test fixture entity is missing");
        const productionShapedCount =
          entityIndex === 0 ? 100 : entityIndex <= 1_166 ? 9 : 8;
        for (
          let index = 0;
          index < Math.min(options.limitPerEntity, productionShapedCount);
          index += 1
        ) {
          rows.push(
            libraryKeywordOccurrence(
              entity,
              entityIndex * 100 + index + 1,
            ),
          );
        }
      }
      return rows.slice(0, options.totalLimit + 1);
    });
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listDiagnosticEligible",
    ).mockResolvedValue([]);
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listOriginsForCompetitorIds",
    ).mockResolvedValue([]);

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(occurrenceRead).toHaveBeenCalledWith(
      scope,
      entities.map((entity) => entity.id),
      { limitPerEntity: 100, totalLimit: 20_000 },
    );
    const facts = projection.keywordClusters.flatMap(
      (cluster) => cluster.keywords,
    );
    expect(facts).toHaveLength(entities.length);
    expect(
      facts.reduce((total, fact) => total + fact.occurrenceRefs.length, 0),
    ).toBe(11_241);
  });

  it("keeps the newest per-entity window when a head keyword overflows the occurrence cap", async () => {
    // Regression: the brand query of a www site reached 135 distinct GSC
    // sources (1 of 1186 entities) and the overflow was treated as fatal,
    // killing every diagnostic of the project. Healthy growth must bound the
    // evidence, not the run.
    const rows = Array.from({ length: 100 }, (_, index) =>
      keywordOccurrence(index + 1),
    );
    mockKeywordReads(rows);

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    const facts = projection.keywordClusters.flatMap(
      (cluster) => cluster.keywords,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]?.occurrenceRefs).toHaveLength(99);
    // The repository ranks newest-first; the retained window is its prefix.
    expect(facts[0]?.occurrenceRefs[0]?.occurrenceId).toBe(rows[0]?.id);
    expect(facts[0]?.occurrenceRefs[98]?.occurrenceId).toBe(rows[98]?.id);
  });

  it("freezes all occurrences when a keyword stays inside the per-entity cap", async () => {
    const rows = [keywordOccurrence(1), keywordOccurrence(2)];
    mockKeywordReads(rows);

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(
      projection.keywordClusters.flatMap((cluster) => cluster.keywords)[0]
        ?.occurrenceRefs,
    ).toHaveLength(2);
  });

  it("freezes exact canonical lineage for serp_overlap competitor origins", async () => {
    mockLibraryReads(origin("serp_overlap"));

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(projection.competitors[0]?.originRefs).toEqual([
      {
        occurrenceId: ids.origin,
        originKind: "serp_overlap",
        snapshotId: ids.snapshot,
        observationId: ids.observation,
      },
    ]);
  });

  it("freezes exact canonical lineage for ai_citation competitor origins", async () => {
    mockLibraryReads(origin("ai_citation"));

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(projection.competitors[0]?.originRefs).toEqual([
      {
        occurrenceId: ids.origin,
        originKind: "ai_citation",
        snapshotId: ids.snapshot,
        observationId: ids.observation,
      },
    ]);
  });

  it("fails closed when serp_overlap lineage is missing or partial", async () => {
    mockLibraryReads(
      origin("serp_overlap", {
        data_snapshot_id: null,
        normalized_observation_id: null,
      }),
    );
    await expect(
      freezeDiagnosticGovernance({} as never, scope),
    ).rejects.toThrow(/competitor origin provenance is inconsistent/iu);

    vi.restoreAllMocks();
    mockLibraryReads(
      origin("serp_overlap", {
        normalized_observation_id: null,
      }),
    );
    await expect(
      freezeDiagnosticGovernance({} as never, scope),
    ).rejects.toThrow(/incomplete snapshot\/observation lineage/iu);
  });

  it.each(["product_profile", "manual"] as const)(
    "requires %s competitor origins to omit canonical observation lineage",
    async (originKind) => {
      mockLibraryReads(origin(originKind));
      await expect(
        freezeDiagnosticGovernance({} as never, scope),
      ).resolves.toMatchObject({
        competitors: [
          {
            originRefs: [
              {
                originKind,
                snapshotId: null,
                observationId: null,
              },
            ],
          },
        ],
      });

      vi.restoreAllMocks();
      mockLibraryReads(
        origin(originKind, {
          data_snapshot_id: ids.snapshot,
          normalized_observation_id: ids.observation,
        }),
      );
      await expect(
        freezeDiagnosticGovernance({} as never, scope),
      ).rejects.toThrow(/competitor origin provenance is inconsistent/iu);
    },
  );
});
