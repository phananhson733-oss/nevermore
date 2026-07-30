import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompetitorsRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  type CompetitorEntityRow,
  type CompetitorOriginKind,
  type CompetitorOriginRow,
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
      originKind === "csv_keyword_gap" || originKind === "serp_overlap"
        ? ids.snapshot
        : null,
    normalized_observation_id:
      originKind === "csv_keyword_gap" || originKind === "serp_overlap"
        ? ids.observation
        : null,
    import_preview_id:
      originKind === "csv_keyword_gap"
        ? "71000000-0000-4000-8000-000000000007"
        : null,
    source_pointer:
      originKind === "csv_keyword_gap" || originKind === "serp_overlap"
        ? "/valueJson/competitorDomain"
        : null,
    manual_entry_id:
      originKind === "manual"
        ? "71000000-0000-4000-8000-000000000008"
        : null,
    observed_at:
      originKind === "csv_keyword_gap" || originKind === "serp_overlap"
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("freezeDiagnosticGovernance (analysis refresh)", () => {
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
