import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompetitorsRepository,
  contentHash,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  type CanonicalValue,
  type CompetitorEntityRow,
  type CompetitorOriginRow,
  type KeywordEntityRow,
  type KeywordOccurrenceForEntityRow,
  type KeywordOccurrenceRow,
  type ProjectScope,
} from "@sf/db";
import { GOVERNANCE_PROJECTION_VERSION } from "@sf/engine";
import {
  DIAGNOSTIC_GOVERNANCE_LIMITS,
  freezeDiagnosticGovernance,
} from "./diagnostic-governance.ts";

const scope = {
  workspaceId: "70000000-0000-4000-8000-000000000001",
  projectId: "70000000-0000-4000-8000-000000000002",
} satisfies ProjectScope;

const ids = {
  keyword: "70000000-0000-4000-8000-000000000003",
  occurrence: "70000000-0000-4000-8000-000000000004",
  snapshot: "70000000-0000-4000-8000-000000000005",
  observation: "70000000-0000-4000-8000-000000000006",
  competitor: "70000000-0000-4000-8000-000000000007",
  competitorOrigin: "70000000-0000-4000-8000-000000000008",
  competitorSnapshot: "70000000-0000-4000-8000-000000000009",
  competitorObservation: "70000000-0000-4000-8000-000000000010",
} as const;

const instant = "2026-07-27T08:00:00.000Z";

function keyword(
  overrides: Partial<KeywordEntityRow> = {},
): KeywordEntityRow {
  return {
    id: ids.keyword,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    display_keyword: "Customer onboarding software",
    normalized_keyword: "customer onboarding software",
    market: "US",
    language_tag: "en",
    query_kind: "search_query",
    status: "approved",
    intent: "commercial",
    buyer_stage: "consideration",
    cluster_key: "customer-onboarding",
    mapping_decision: "new_asset",
    mapped_site_page_id: null,
    mapping_review_state: "confirmed",
    mapping_revision: 3,
    first_seen_at: instant,
    last_seen_at: instant,
    created_at: instant,
    updated_at: instant,
    ...overrides,
  };
}

function occurrence(
  overrides: Partial<KeywordOccurrenceRow> = {},
): KeywordOccurrenceRow {
  return {
    id: ids.occurrence,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    product_profile_id: null,
    data_snapshot_id: ids.snapshot,
    normalized_observation_id: ids.observation,
    display_keyword: "Customer onboarding software",
    normalized_keyword: "customer onboarding software",
    market: "US",
    language_tag: "en",
    query_kind: "search_query",
    source_kind: "dataforseo_ranked",
    scope_basis: "provider_collection_scope",
    source_pointer: "/valueJson/keyword",
    source_ref: `observation:${ids.observation}#/valueJson/keyword`,
    collected_at: instant,
    provider_data_as_of: instant,
    created_at: instant,
    ...overrides,
  };
}

function competitor(
  overrides: Partial<CompetitorEntityRow> = {},
): CompetitorEntityRow {
  return {
    id: ids.competitor,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    domain: "example-competitor.com",
    name: "Example Competitor",
    review_status: "approved",
    relationship: "direct",
    analysis_scope: ["serp_visibility", "keyword_gap"],
    revision: 4,
    last_observed_at: instant,
    origin_count: 1,
    created_at: instant,
    updated_at: instant,
    ...overrides,
  };
}

function origin(
  overrides: Partial<CompetitorOriginRow> = {},
): CompetitorOriginRow {
  return {
    id: ids.competitorOrigin,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    competitor_id: ids.competitor,
    origin_kind: "csv_keyword_gap",
    source_name: null,
    product_profile_id: null,
    profile_version: null,
    candidate_id: null,
    field_provenance_path: null,
    evidence_refs: null,
    source_review_status: null,
    source_relationship: null,
    source_analysis_scope: null,
    data_snapshot_id: ids.competitorSnapshot,
    normalized_observation_id: ids.competitorObservation,
    import_preview_id: "70000000-0000-4000-8000-000000000011",
    source_pointer: "/valueJson/competitorDomain",
    manual_entry_id: null,
    observed_at: instant,
    created_at: instant,
    ...overrides,
  };
}

function mockLibraryReads(input?: {
  readonly keywords?: readonly KeywordEntityRow[];
  readonly occurrences?: ReadonlyMap<string, readonly KeywordOccurrenceRow[]>;
  readonly competitors?: readonly CompetitorEntityRow[];
  readonly origins?: ReadonlyMap<string, readonly CompetitorOriginRow[]>;
}) {
  const keywordRows = [...(input?.keywords ?? [keyword()])];
  const occurrenceRows =
    input?.occurrences ??
    new Map<string, readonly KeywordOccurrenceRow[]>([
      [ids.keyword, [occurrence()]],
    ]);
  const competitorRows = [...(input?.competitors ?? [competitor()])];
  const originRows =
    input?.origins ??
    new Map<string, readonly CompetitorOriginRow[]>([
      [ids.competitor, [origin()]],
    ]);

  vi.spyOn(
    KeywordsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue(keywordRows);
  vi.spyOn(
    KeywordOccurrencesRepository.prototype,
    "listForEntityIds",
  ).mockResolvedValue(
    [...occurrenceRows].flatMap(([entityId, rows]) =>
      rows.map(
        (row) =>
          ({
            ...row,
            keyword_entity_id: entityId,
          }) satisfies KeywordOccurrenceForEntityRow,
      ),
    ),
  );
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue(competitorRows);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listOriginsForCompetitorIds",
  ).mockResolvedValue([...originRows.values()].flat());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("freezeDiagnosticGovernance", () => {
  it("accepts exact Product Profile keyword lineage without invented provider evidence", async () => {
    const profileId = "70000000-0000-4000-8000-000000000012";
    mockLibraryReads({
      keywords: [keyword({ query_kind: "generative_query" })],
      occurrences: new Map([
        [
          ids.keyword,
          [
            occurrence({
              product_profile_id: profileId,
              data_snapshot_id: null,
              normalized_observation_id: null,
              query_kind: "generative_query",
              source_kind: "product_profile",
              scope_basis: "project_context",
              source_pointer: null,
              source_ref: `product_profile:${profileId}#profile-generative-query.v1/what-is-product`,
              provider_data_as_of: null,
            }),
          ],
        ],
      ]),
      competitors: [],
      origins: new Map(),
    });

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(projection.keywordClusters[0]?.keywords[0]?.occurrenceRefs).toEqual([
      {
        occurrenceId: ids.occurrence,
        snapshotId: null,
        observationId: null,
      },
    ]);
  });

  it("keeps the newest per-keyword lineage window when healthy source history grows", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => {
      const suffix = (index + 1).toString(16).padStart(12, "0");
      const observationId = `70000000-0000-4000-b001-${suffix}`;
      return occurrence({
        id: `70000000-0000-4000-9001-${suffix}`,
        data_snapshot_id: `70000000-0000-4000-a001-${suffix}`,
        normalized_observation_id: observationId,
        source_ref: `observation:${observationId}#/valueJson/keyword`,
      });
    });
    mockLibraryReads({
      occurrences: new Map([[ids.keyword, rows]]),
      competitors: [],
      origins: new Map(),
    });

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    const fact = projection.keywordClusters[0]?.keywords[0];
    expect(fact?.occurrenceRefs).toHaveLength(99);
    expect(fact?.occurrenceRefs[0]?.occurrenceId).toBe(rows[0]?.id);
    expect(fact?.occurrenceRefs[98]?.occurrenceId).toBe(rows[98]?.id);
  });

  it("freezes only persisted identities, revisions, and canonical lineage refs", async () => {
    mockLibraryReads();

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(projection).toEqual({
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [
        {
          clusterKey: "customer-onboarding",
          keywords: [
            {
              keywordEntityId: ids.keyword,
              displayKeyword: "Customer onboarding software",
              normalizedKeyword: "customer onboarding software",
              marketCode: "US",
              languageTag: "en",
              revision: 3,
              status: "approved",
              queryKind: "search_query",
              intent: "commercial",
              buyerStage: "consideration",
              clusterKey: "customer-onboarding",
              mappingDecision: "new_asset",
              mappedSitePageId: null,
              mappingReviewState: "confirmed",
              lastSeenAt: instant,
              occurrenceRefs: [
                {
                  occurrenceId: ids.occurrence,
                  snapshotId: ids.snapshot,
                  observationId: ids.observation,
                },
              ],
              // The library row identifies the keyword at /valueJson/keyword.
              // It does not prove that any optional metric pointer exists.
              metricRefs: [],
            },
          ],
        },
      ],
      competitors: [
        {
          competitorEntityId: ids.competitor,
          domain: "example-competitor.com",
          reviewStatus: "approved",
          revision: 4,
          relationship: "direct",
          analysisScopes: ["keyword_gap", "serp_visibility"],
          originRefs: [
            {
              occurrenceId: ids.competitorOrigin,
              originKind: "csv_keyword_gap",
              snapshotId: ids.competitorSnapshot,
              observationId: ids.competitorObservation,
            },
          ],
        },
      ],
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(projection.keywordClusters[0]).not.toHaveProperty("topicNodeId");
    expect(projection.keywordClusters[0]).not.toHaveProperty(
      "topicModelRevision",
    );
  });

  it("freezes exact canonical lineage for serp_overlap competitor origins", async () => {
    mockLibraryReads({
      origins: new Map([
        [
          ids.competitor,
          [
            origin({
              origin_kind: "serp_overlap",
              import_preview_id: null,
            }),
          ],
        ],
      ]),
    });

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(projection.competitors[0]?.originRefs).toEqual([
      {
        occurrenceId: ids.competitorOrigin,
        originKind: "serp_overlap",
        snapshotId: ids.competitorSnapshot,
        observationId: ids.competitorObservation,
      },
    ]);
  });

  it("freezes exact canonical lineage for ai_citation competitor origins", async () => {
    mockLibraryReads({
      origins: new Map([
        [
          ids.competitor,
          [
            origin({
              origin_kind: "ai_citation",
              import_preview_id: null,
              source_pointer: "/valueJson/competitorDomain",
            }),
          ],
        ],
      ]),
    });

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(projection.competitors[0]?.originRefs).toEqual([
      {
        occurrenceId: ids.competitorOrigin,
        originKind: "ai_citation",
        snapshotId: ids.competitorSnapshot,
        observationId: ids.competitorObservation,
      },
    ]);
  });

  it("fails closed when serp_overlap lineage is missing or partial", async () => {
    mockLibraryReads({
      origins: new Map([
        [
          ids.competitor,
          [
            origin({
              origin_kind: "serp_overlap",
              data_snapshot_id: null,
              normalized_observation_id: null,
              import_preview_id: null,
            }),
          ],
        ],
      ]),
    });
    await expect(
      freezeDiagnosticGovernance({} as never, scope),
    ).rejects.toThrow(/competitor origin provenance is inconsistent/iu);

    vi.restoreAllMocks();
    mockLibraryReads({
      origins: new Map([
        [
          ids.competitor,
          [
            origin({
              origin_kind: "serp_overlap",
              normalized_observation_id: null,
              import_preview_id: null,
            }),
          ],
        ],
      ]),
    });
    await expect(
      freezeDiagnosticGovernance({} as never, scope),
    ).rejects.toThrow(/incomplete snapshot\/observation lineage/iu);
  });

  it.each(["product_profile", "manual"] as const)(
    "requires %s competitor origins to omit canonical observation lineage",
    async (originKind) => {
      mockLibraryReads({
        origins: new Map([
          [
            ids.competitor,
            [
              origin({
                origin_kind: originKind,
                data_snapshot_id: null,
                normalized_observation_id: null,
                import_preview_id: null,
                source_pointer: null,
              }),
            ],
          ],
        ]),
      });
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
      mockLibraryReads({
        origins: new Map([
          [
            ids.competitor,
            [
              origin({
                origin_kind: originKind,
                import_preview_id: null,
                source_pointer: null,
              }),
            ],
          ],
        ]),
      });
      await expect(
        freezeDiagnosticGovernance({} as never, scope),
      ).rejects.toThrow(/competitor origin provenance is inconsistent/iu);
    },
  );

  it("canonicalizes repository order so equivalent facts hash identically", async () => {
    const keywordA = keyword();
    const keywordB = keyword({
      id: "70000000-0000-4000-8000-000000000012",
      display_keyword: "Onboarding workflow",
      normalized_keyword: "onboarding workflow",
      mapping_revision: 1,
    });
    const occurrenceA = occurrence();
    const occurrenceB = occurrence({
      id: "70000000-0000-4000-8000-000000000013",
      display_keyword: keywordB.display_keyword,
      normalized_keyword: keywordB.normalized_keyword,
      normalized_observation_id:
        "70000000-0000-4000-8000-000000000014",
      source_ref:
        "observation:70000000-0000-4000-8000-000000000014#/valueJson/keyword",
    });
    const competitorA = competitor();
    const competitorB = competitor({
      id: "70000000-0000-4000-8000-000000000015",
      domain: "another-competitor.com",
      revision: 1,
    });
    const originA = origin();
    const originB = origin({
      id: "70000000-0000-4000-8000-000000000016",
      competitor_id: competitorB.id,
    });
    const occurrences = new Map([
      [keywordA.id, [occurrenceA]],
      [keywordB.id, [occurrenceB]],
    ]);
    const origins = new Map([
      [competitorA.id, [originA]],
      [competitorB.id, [originB]],
    ]);

    mockLibraryReads({
      keywords: [keywordB, keywordA],
      occurrences,
      competitors: [competitorB, competitorA],
      origins,
    });
    const first = await freezeDiagnosticGovernance({} as never, scope);
    vi.restoreAllMocks();
    mockLibraryReads({
      keywords: [keywordA, keywordB],
      occurrences: new Map([
        [keywordA.id, [...occurrences.get(keywordA.id)!].reverse()],
        [keywordB.id, [...occurrences.get(keywordB.id)!].reverse()],
      ]),
      competitors: [competitorA, competitorB],
      origins: new Map([
        [competitorA.id, [...origins.get(competitorA.id)!].reverse()],
        [competitorB.id, [...origins.get(competitorB.id)!].reverse()],
      ]),
    });
    const second = await freezeDiagnosticGovernance({} as never, scope);

    expect(contentHash(first as unknown as CanonicalValue)).toBe(
      contentHash(second as unknown as CanonicalValue),
    );
  });

  it("keeps governance query count independent of entity count", async () => {
    const keywordRows = Array.from({ length: 100 }, (_, index) => {
      const suffix = (index + 100).toString(16).padStart(12, "0");
      return keyword({
        id: `71000000-0000-4000-8000-${suffix}`,
        display_keyword: `Governed keyword ${index}`,
        normalized_keyword: `governed keyword ${index}`,
        cluster_key: `cluster-${index % 10}`,
      });
    });
    const occurrenceByKeyword = new Map(
      keywordRows.map((entity, index) => {
        const occurrenceSuffix = (index + 1_000)
          .toString(16)
          .padStart(12, "0");
        const observationSuffix = (index + 2_000)
          .toString(16)
          .padStart(12, "0");
        const observationId = `72000000-0000-4000-8000-${observationSuffix}`;
        return [
          entity.id,
          occurrence({
            id: `72000000-0000-4000-8000-${occurrenceSuffix}`,
            display_keyword: entity.display_keyword,
            normalized_keyword: entity.normalized_keyword,
            normalized_observation_id: observationId,
            source_ref: `observation:${observationId}#/valueJson/keyword`,
          }),
        ] as const;
      }),
    );
    const competitorRows = Array.from({ length: 20 }, (_, index) => {
      const suffix = (index + 3_000).toString(16).padStart(12, "0");
      return competitor({
        id: `73000000-0000-4000-8000-${suffix}`,
        domain: `competitor-${index}.example`,
        revision: index,
      });
    });
    const originByCompetitor = new Map(
      competitorRows.map((entity, index) => {
        const suffix = (index + 4_000).toString(16).padStart(12, "0");
        return [
          entity.id,
          origin({
            id: `74000000-0000-4000-8000-${suffix}`,
            competitor_id: entity.id,
          }),
        ] as const;
      }),
    );
    vi.spyOn(
      KeywordsRepository.prototype,
      "listDiagnosticEligible",
    ).mockResolvedValue(keywordRows);
    const legacyPerKeywordRead = vi
      .spyOn(KeywordOccurrencesRepository.prototype, "listForEntity")
      .mockRejectedValue(new Error("legacy per-keyword read must not run"));
    const batchKeywordRead = vi
      .spyOn(KeywordOccurrencesRepository.prototype, "listForEntityIds")
      .mockResolvedValue(
        [...occurrenceByKeyword].map(
          ([entityId, row]) =>
            ({
              ...row,
              keyword_entity_id: entityId,
            }) satisfies KeywordOccurrenceForEntityRow,
        ),
      );
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listDiagnosticEligible",
    ).mockResolvedValue(competitorRows);
    const legacyPerCompetitorRead = vi
      .spyOn(CompetitorsRepository.prototype, "listOrigins")
      .mockRejectedValue(new Error("legacy per-competitor read must not run"));
    const batchCompetitorRead = vi
      .spyOn(
        CompetitorsRepository.prototype,
        "listOriginsForCompetitorIds",
      )
      .mockResolvedValue([...originByCompetitor.values()]);

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(
      projection.keywordClusters.flatMap((group) => group.keywords),
    ).toHaveLength(keywordRows.length);
    expect(projection.competitors).toHaveLength(competitorRows.length);
    expect(batchKeywordRead).toHaveBeenCalledTimes(1);
    expect(batchCompetitorRead).toHaveBeenCalledTimes(1);
    expect(legacyPerKeywordRead).not.toHaveBeenCalled();
    expect(legacyPerCompetitorRead).not.toHaveBeenCalled();
  });

  it("changes the canonical hash when an entity revision changes", async () => {
    mockLibraryReads();
    const first = await freezeDiagnosticGovernance({} as never, scope);
    vi.restoreAllMocks();
    mockLibraryReads({
      keywords: [keyword({ mapping_revision: 4 })],
      competitors: [competitor({ revision: 5 })],
    });
    const second = await freezeDiagnosticGovernance({} as never, scope);

    expect(contentHash(first as unknown as CanonicalValue)).not.toBe(
      contentHash(second as unknown as CanonicalValue),
    );
  });

  it("fails closed if any repository returns a cross-project row", async () => {
    mockLibraryReads({
      keywords: [keyword({ project_id: "foreign-project" })],
    });

    await expect(
      freezeDiagnosticGovernance({} as never, scope),
    ).rejects.toThrow(/scope|project/iu);
  });

  it("refuses an eligible keyword library beyond the hard entity cap", async () => {
    const rows = Array.from(
      {
        length: DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities + 1,
      },
      (_, index) =>
        keyword({
          id: `70000000-0000-4000-8000-${(index + 100)
            .toString(16)
            .padStart(12, "0")}`,
          display_keyword: `Keyword ${index}`,
          normalized_keyword: `keyword ${index}`,
        }),
    );
    const list = vi
      .spyOn(KeywordsRepository.prototype, "listDiagnosticEligible")
      .mockResolvedValue(rows);
    const batchOccurrenceRead = vi.spyOn(
      KeywordOccurrencesRepository.prototype,
      "listForEntityIds",
    );

    await expect(
      freezeDiagnosticGovernance({} as never, scope),
    ).rejects.toThrow(/cap|limit|large/iu);
    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith(scope, {
      limit: DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities + 1,
    });
    expect(batchOccurrenceRead).not.toHaveBeenCalled();
  });

  it("accepts a large total library when its rule-eligible subset is small", async () => {
    const eligible = [
      keyword(),
      keyword({
        id: "70000000-0000-4000-8000-000000000012",
        display_keyword: "Onboarding workflow",
        normalized_keyword: "onboarding workflow",
      }),
    ];
    const legacyWholeLibraryRead = vi.spyOn(
      KeywordsRepository.prototype,
      "listByProject",
    );
    vi.spyOn(
      KeywordsRepository.prototype,
      "listDiagnosticEligible",
    ).mockImplementation(async (_scope, options) => {
      expect(options).toEqual({
        limit: DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities + 1,
      });
      // Candidate and unreviewed rows from the much larger source library are
      // deliberately excluded by this repository contract.
      return eligible;
    });
    vi.spyOn(
      KeywordOccurrencesRepository.prototype,
      "listForEntityIds",
    ).mockResolvedValue(
      eligible.map(
        (entity, index) =>
          ({
            ...occurrence({
              id:
                index === 0
                  ? ids.occurrence
                  : "70000000-0000-4000-8000-000000000013",
              display_keyword: entity.display_keyword,
              normalized_keyword: entity.normalized_keyword,
            }),
            keyword_entity_id: entity.id,
          }) satisfies KeywordOccurrenceForEntityRow,
      ),
    );
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listDiagnosticEligible",
    ).mockResolvedValue([]);
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listOriginsForCompetitorIds",
    ).mockResolvedValue([]);

    const projection = await freezeDiagnosticGovernance({} as never, scope);

    expect(
      projection.keywordClusters.flatMap((cluster) => cluster.keywords),
    ).toHaveLength(2);
    expect(legacyWholeLibraryRead).not.toHaveBeenCalled();
  });

  it("fails closed if an eligible read returns an unreviewed keyword", async () => {
    mockLibraryReads({
      keywords: [
        keyword({
          status: "candidate",
          mapping_review_state: "unreviewed",
        }),
      ],
    });

    await expect(
      freezeDiagnosticGovernance({} as never, scope),
    ).rejects.toThrow(/approved|confirmed|clustered/iu);
  });

  it("fails closed on corrupt occurrence identity instead of freezing it", async () => {
    mockLibraryReads({
      occurrences: new Map([
        [
          ids.keyword,
          [occurrence({ normalized_keyword: "a different keyword" })],
        ],
      ]),
    });

    await expect(
      freezeDiagnosticGovernance({} as never, scope),
    ).rejects.toThrow(/occurrence|identity|corrupt/iu);
  });
});
