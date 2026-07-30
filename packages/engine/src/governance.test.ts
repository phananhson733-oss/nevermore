import { describe, expect, it } from "vitest";

import {
  GOVERNANCE_PROJECTION_VERSION,
  parseGovernanceProjectionV1,
} from "./governance.ts";

const EARLY = "2026-07-20T00:00:00.000Z";
const LATE = "2026-07-21T00:00:00.000Z";

function keyword(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    keywordEntityId: "00000000-0000-4000-8000-000000000101",
    displayKeyword: "Project Management Software",
    normalizedKeyword: "project management software",
    marketCode: "US",
    languageTag: "en",
    revision: 3,
    status: "approved",
    queryKind: "search_query",
    intent: "commercial",
    buyerStage: "consideration",
    clusterKey: "project-management",
    mappingDecision: "new_asset",
    mappedSitePageId: null,
    mappingReviewState: "confirmed",
    lastSeenAt: LATE,
    occurrenceRefs: [
      {
        occurrenceId: "00000000-0000-4000-8000-000000000301",
        snapshotId: "00000000-0000-4000-8000-000000000401",
        observationId: "00000000-0000-4000-8000-000000000501",
      },
    ],
    metricRefs: [
      {
        snapshotId: "00000000-0000-4000-8000-000000000401",
        observationId: "00000000-0000-4000-8000-000000000501",
        valuePointer: "/valueJson/searchVolume",
      },
    ],
    ...overrides,
  };
}

function competitor(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    competitorEntityId: "00000000-0000-4000-8000-000000000201",
    domain: "rival.example",
    reviewStatus: "approved",
    revision: 4,
    relationship: "direct",
    analysisScopes: ["serp_visibility", "keyword_gap"],
    originRefs: [
      {
        occurrenceId: "00000000-0000-4000-8000-000000000601",
        originKind: "csv_keyword_gap",
        snapshotId: "00000000-0000-4000-8000-000000000401",
        observationId: "00000000-0000-4000-8000-000000000501",
      },
    ],
    ...overrides,
  };
}

function projection(): Record<string, unknown> {
  return {
    projectionVersion: GOVERNANCE_PROJECTION_VERSION,
    keywordClusters: [
      {
        clusterKey: "zeta",
        keywords: [
          keyword({
            keywordEntityId: "00000000-0000-4000-8000-000000000103",
            displayKeyword: "Zeta Tool",
            normalizedKeyword: "zeta tool",
            clusterKey: "zeta",
            lastSeenAt: EARLY,
            occurrenceRefs: [
              {
                occurrenceId: "00000000-0000-4000-8000-000000000303",
                snapshotId: null,
                observationId: null,
              },
            ],
            metricRefs: [],
          }),
        ],
      },
      {
        clusterKey: "project-management",
        topicNodeId: "00000000-0000-4000-8000-000000000701",
        topicModelRevision: 2,
        keywords: [
          keyword({
            keywordEntityId: "00000000-0000-4000-8000-000000000102",
            displayKeyword: "Agile Planning",
            normalizedKeyword: "agile planning",
            occurrenceRefs: [
              {
                occurrenceId: "00000000-0000-4000-8000-000000000302",
                snapshotId: null,
                observationId: null,
              },
            ],
            metricRefs: [],
          }),
          keyword(),
        ],
      },
    ],
    competitors: [
      competitor(),
      competitor({
        competitorEntityId: "00000000-0000-4000-8000-000000000202",
        domain: "candidate.example",
        reviewStatus: "candidate",
        revision: 0,
        relationship: null,
        analysisScopes: [],
        originRefs: [
          {
            occurrenceId: "00000000-0000-4000-8000-000000000602",
            originKind: "manual",
            snapshotId: null,
            observationId: null,
          },
        ],
      }),
    ],
  };
}

describe("parseGovernanceProjectionV1", () => {
  it("returns a JSON-friendly, deeply frozen projection in canonical ASCII order", () => {
    const input = projection();
    const untouched = structuredClone(input);

    const parsed = parseGovernanceProjectionV1(input);

    expect(input).toEqual(untouched);
    expect(parsed.projectionVersion).toBe("growth-governance.1.0.0");
    expect(parsed.keywordClusters.map((cluster) => cluster.clusterKey)).toEqual([
      "project-management",
      "zeta",
    ]);
    expect(
      parsed.keywordClusters[0]?.keywords.map(
        (fact) => fact.normalizedKeyword,
      ),
    ).toEqual(["agile planning", "project management software"]);
    expect(parsed.competitors.map((fact) => fact.domain)).toEqual([
      "candidate.example",
      "rival.example",
    ]);
    expect(parsed.competitors[1]?.analysisScopes).toEqual([
      "keyword_gap",
      "serp_visibility",
    ]);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);

    const nested = parsed.keywordClusters[0]?.keywords[0];
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.keywordClusters)).toBe(true);
    expect(Object.isFrozen(parsed.keywordClusters[0])).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested?.occurrenceRefs)).toBe(true);
    expect(Object.isFrozen(nested?.occurrenceRefs[0])).toBe(true);
    expect(Object.isFrozen(parsed.competitors[1]?.analysisScopes)).toBe(true);

    expect(() => {
      (
        parsed.keywordClusters as unknown as Array<{ clusterKey: string }>
      )[0]!.clusterKey = "mutated";
    }).toThrow();
  });

  it("normalizes equivalent input ordering to identical bytes", () => {
    const forward = projection();
    const reversed = structuredClone(forward);
    (reversed["keywordClusters"] as unknown[]).reverse();
    for (const cluster of reversed["keywordClusters"] as Array<{
      keywords: unknown[];
    }>) {
      cluster.keywords.reverse();
    }
    (reversed["competitors"] as unknown[]).reverse();
    for (const fact of reversed["competitors"] as Array<{
      analysisScopes: unknown[];
      originRefs: unknown[];
    }>) {
      fact.analysisScopes.reverse();
      fact.originRefs.reverse();
    }

    expect(JSON.stringify(parseGovernanceProjectionV1(reversed))).toBe(
      JSON.stringify(parseGovernanceProjectionV1(forward)),
    );
  });

  it("rejects unknown fields and unsupported projection versions", () => {
    expect(() =>
      parseGovernanceProjectionV1({
        ...projection(),
        liveDatabaseFallback: true,
      }),
    ).toThrow(/unknown field.*liveDatabaseFallback/i);
    expect(() =>
      parseGovernanceProjectionV1({
        ...projection(),
        projectionVersion: "growth-governance.2.0.0",
      }),
    ).toThrow(/projectionVersion/i);
  });

  it("rejects contradictory mapping and review facts instead of repairing them", () => {
    const invalidMapping = projection();
    const clusters = invalidMapping["keywordClusters"] as Array<{
      keywords: Record<string, unknown>[];
    }>;
    clusters[0]!.keywords[0]!["mappedSitePageId"] =
      "00000000-0000-4000-8000-000000000801";

    expect(() => parseGovernanceProjectionV1(invalidMapping)).toThrow(
      /mappedSitePageId.*existing_page/i,
    );

    const invalidCompetitor = projection();
    const competitors = invalidCompetitor["competitors"] as Record<
      string,
      unknown
    >[];
    competitors[1]!["relationship"] = "direct";
    expect(() => parseGovernanceProjectionV1(invalidCompetitor)).toThrow(
      /candidate.*relationship/i,
    );
  });

  it("rejects duplicate canonical identities and incomplete lineage pairs", () => {
    const duplicate = projection();
    const clusters = duplicate["keywordClusters"] as Array<{
      keywords: Record<string, unknown>[];
    }>;
    clusters[1]!.keywords.push(structuredClone(clusters[1]!.keywords[0]!));
    expect(() => parseGovernanceProjectionV1(duplicate)).toThrow(
      /keywordEntityId.*unique/i,
    );

    const incompleteLineage = projection();
    const incompleteClusters = incompleteLineage["keywordClusters"] as Array<{
      keywords: Array<{
        occurrenceRefs: Record<string, unknown>[];
      }>;
    }>;
    incompleteClusters[0]!.keywords[0]!.occurrenceRefs[0]!["snapshotId"] =
      "00000000-0000-4000-8000-000000000401";
    expect(() => parseGovernanceProjectionV1(incompleteLineage)).toThrow(
      /snapshotId.*observationId.*together/i,
    );
  });

  it("accepts exact canonical lineage for serp_overlap competitor origins", () => {
    const input = projection();
    const competitors = input["competitors"] as Array<{
      originRefs: Record<string, unknown>[];
    }>;
    competitors[0]!.originRefs[0]!["originKind"] = "serp_overlap";

    const parsed = parseGovernanceProjectionV1(input);

    expect(parsed.competitors[1]?.originRefs).toEqual([
      {
        occurrenceId: "00000000-0000-4000-8000-000000000601",
        originKind: "serp_overlap",
        snapshotId: "00000000-0000-4000-8000-000000000401",
        observationId: "00000000-0000-4000-8000-000000000501",
      },
    ]);
  });

  it("fails closed when serp_overlap lineage is missing or partial", () => {
    const missingLineage = projection();
    const missingCompetitors = missingLineage["competitors"] as Array<{
      originRefs: Record<string, unknown>[];
    }>;
    missingCompetitors[0]!.originRefs[0] = {
      ...missingCompetitors[0]!.originRefs[0],
      originKind: "serp_overlap",
      snapshotId: null,
      observationId: null,
    };
    expect(() => parseGovernanceProjectionV1(missingLineage)).toThrow(
      /serp_overlap.*requires snapshotId and observationId/i,
    );

    const partialLineage = projection();
    const partialCompetitors = partialLineage["competitors"] as Array<{
      originRefs: Record<string, unknown>[];
    }>;
    partialCompetitors[0]!.originRefs[0] = {
      ...partialCompetitors[0]!.originRefs[0],
      originKind: "serp_overlap",
      observationId: null,
    };
    expect(() => parseGovernanceProjectionV1(partialLineage)).toThrow(
      /snapshotId.*observationId.*together/i,
    );
  });

  it.each(["product_profile", "manual"] as const)(
    "requires %s competitor origins to omit canonical observation lineage",
    (originKind) => {
      const lineageFree = projection();
      const lineageFreeCompetitors = lineageFree["competitors"] as Array<{
        originRefs: Record<string, unknown>[];
      }>;
      lineageFreeCompetitors[1]!.originRefs[0] = {
        ...lineageFreeCompetitors[1]!.originRefs[0],
        originKind,
        snapshotId: null,
        observationId: null,
      };
      expect(() => parseGovernanceProjectionV1(lineageFree)).not.toThrow();

      const falseLineage = projection();
      const falseLineageCompetitors = falseLineage["competitors"] as Array<{
        originRefs: Record<string, unknown>[];
      }>;
      falseLineageCompetitors[1]!.originRefs[0] = {
        ...falseLineageCompetitors[1]!.originRefs[0],
        originKind,
        snapshotId: "00000000-0000-4000-8000-000000000401",
        observationId: "00000000-0000-4000-8000-000000000501",
      };
      expect(() => parseGovernanceProjectionV1(falseLineage)).toThrow(
        new RegExp(`${originKind} origin cannot claim`, "i"),
      );
    },
  );

  it("requires canonical UUID identities and a positive Topic Model revision", () => {
    const malformedEntity = projection();
    const malformedClusters = malformedEntity["keywordClusters"] as Array<{
      keywords: Record<string, unknown>[];
    }>;
    malformedClusters[0]!.keywords[0]!["keywordEntityId"] = "not-a-uuid";
    expect(() => parseGovernanceProjectionV1(malformedEntity)).toThrow(
      /keywordEntityId.*UUID/i,
    );

    const malformedLineage = projection();
    const lineageClusters = malformedLineage["keywordClusters"] as Array<{
      keywords: Array<{
        occurrenceRefs: Record<string, unknown>[];
      }>;
    }>;
    lineageClusters[0]!.keywords[0]!.occurrenceRefs[0]!["observationId"] =
      "observation-1";
    expect(() => parseGovernanceProjectionV1(malformedLineage)).toThrow(
      /observationId.*UUID/i,
    );

    const zeroTopicRevision = projection();
    const topicClusters = zeroTopicRevision["keywordClusters"] as Record<
      string,
      unknown
    >[];
    topicClusters[1]!["topicModelRevision"] = 0;
    expect(() => parseGovernanceProjectionV1(zeroTopicRevision)).toThrow(
      /topicModelRevision.*positive/i,
    );
  });
});
