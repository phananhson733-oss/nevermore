import { describe, expect, it } from "vitest";
import { GrowthOpportunity } from "@sf/contracts";
import type { EvidenceDto } from "./diagnostic-mappers";
import {
  buildActionSummary,
  buildEvidenceSummary,
  buildOpportunity,
  deriveOpportunityKey,
  primaryTopicClusterKey,
  resolvePrimaryTarget,
  resolveReadiness,
  type OpportunityFindingInput,
  type OpportunityTargetInput,
} from "./opportunities-projection";
import {
  groupTopicClusterSupportRows,
  type TopicClusterSupportRow,
} from "./topic-cluster-projection";

const ids = {
  finding: "30000000-0000-4000-8000-000000000001",
  action: "30000000-0000-4000-8000-000000000003",
  evidence: "30000000-0000-4000-8000-000000000011",
  run: "30000000-0000-4000-8000-000000000012",
  snapshot: "30000000-0000-4000-8000-000000000013",
  sitePage: "30000000-0000-4000-8000-000000000014",
  collection: "30000000-0000-4000-8000-000000000015",
} as const;

const NOW = Date.parse("2026-07-21T09:00:00.000Z");

function crawlEvidence(overrides: Partial<EvidenceDto> = {}): EvidenceDto {
  return {
    id: ids.evidence,
    sourceProvider: "crawl",
    origin: "first_party",
    method: "crawl.page.v1",
    grade: "A",
    availability: "available",
    support: "supports",
    claim: "The owned page lacks a concise answer block.",
    subjectRefs: [],
    observedAt: "2026-07-21T08:00:00.000Z",
    limitation: "Single immutable crawl snapshot.",
    snapshotId: ids.snapshot,
    collectionRunId: ids.collection,
    analysisInvocationId: null,
    ...overrides,
  };
}

function ownedUrlTarget(
  overrides: Partial<OpportunityTargetInput> = {},
): OpportunityTargetInput {
  return {
    relation: "direct_url",
    targetKind: "url",
    targetRef: "https://example.com/customer-onboarding/",
    resolutionState: "resolved",
    sitePageId: ids.sitePage,
    pageSnapshotId: "30000000-0000-4000-8000-000000000016",
    ...overrides,
  };
}

const reviewableFinding: OpportunityFindingInput = {
  id: ids.finding,
  ruleId: "CONTENT-COVERAGE-001",
  reviewState: "unreviewed",
  active: true,
  title: "Make the onboarding page a citation-ready answer asset",
};

describe("deriveOpportunityKey", () => {
  it("keys URL targets by path so absolute forms collapse", () => {
    expect(
      deriveOpportunityKey({
        primaryTarget: "url",
        targetRef: "https://example.com/customer-onboarding/",
        ruleId: "CONTENT-COVERAGE-001",
      }),
    ).toBe("url:/customer-onboarding/:CONTENT-COVERAGE-001");
  });

  it("keys non-URL targets by their literal ref", () => {
    expect(
      deriveOpportunityKey({
        primaryTarget: "topic",
        targetRef: "customer onboarding",
        ruleId: "CONTENT-GAP-011",
      }),
    ).toBe("topic:customer onboarding:CONTENT-GAP-011");
  });
});

describe("resolvePrimaryTarget", () => {
  it("resolves a suitable owned asset from a resolved crawl URL", () => {
    const primary = resolvePrimaryTarget([ownedUrlTarget()]);
    expect(primary?.primaryTarget).toBe("url");
    expect(primary?.hasSuitableOwnedAsset).toBe(true);
    expect(primary?.ownedAsset).toMatchObject({
      sitePageId: ids.sitePage,
      suitableForIntent: true,
    });
  });

  it("has no owned asset for a topic target", () => {
    const primary = resolvePrimaryTarget([
      {
        relation: "affected_by_keyword_cluster",
        targetKind: "keyword_cluster",
        targetRef: "customer onboarding",
        resolutionState: "resolved",
        sitePageId: null,
        pageSnapshotId: null,
      },
    ]);
    expect(primary?.primaryTarget).toBe("topic");
    expect(primary?.hasSuitableOwnedAsset).toBe(false);
    expect(primary?.ownedAsset).toBeNull();
  });
});

describe("buildEvidenceSummary", () => {
  it("maps crawl lineage and derives freshness", () => {
    const traces = buildEvidenceSummary([crawlEvidence()], {
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      traceKind: "evidence",
      snapshotId: ids.snapshot,
      collectionRunId: ids.collection,
      analysisInvocationId: null,
      freshness: "current",
      support: "supports",
    });
  });

  it("drops unavailable evidence the contract cannot trace", () => {
    const traces = buildEvidenceSummary(
      [crawlEvidence({ availability: "unavailable" })],
      { diagnosticRunId: ids.run, now: NOW },
    );
    expect(traces).toHaveLength(0);
  });
});

describe("resolveReadiness", () => {
  it("treats reviewable states as reviewable and ignored as skip", () => {
    expect(
      resolveReadiness({
        finding: { reviewState: "unreviewed", active: true },
        action: null,
      }),
    ).toBe("reviewable");
    expect(
      resolveReadiness({
        finding: { reviewState: "ignored", active: true },
        action: null,
      }),
    ).toBe("skip");
  });

  it("is confirmed only with an active Action", () => {
    expect(
      resolveReadiness({
        finding: { reviewState: "confirmed", active: true },
        action: { id: ids.action, sourceFindingId: ids.finding, status: "planned" },
      }),
    ).toBe("confirmed");
    expect(
      resolveReadiness({
        finding: { reviewState: "confirmed", active: true },
        action: null,
      }),
    ).toBe("skip");
  });
});

describe("buildActionSummary", () => {
  it("fixes the Artifact type from the frozen rule projection", () => {
    expect(
      buildActionSummary(
        { id: ids.action, sourceFindingId: ids.finding, status: "planned" },
        "CONTENT-COVERAGE-001",
      ),
    ).toEqual({
      actionId: ids.action,
      findingId: ids.finding,
      status: "planned",
      artifactType: "content_brief",
    });
  });
});

describe("buildOpportunity", () => {
  it("builds an improve reviewable Opportunity for a suitable owned page", () => {
    const opportunity = buildOpportunity({
      finding: reviewableFinding,
      targets: [ownedUrlTarget()],
      evidence: [crawlEvidence()],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(opportunity).not.toBeNull();
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
    expect(opportunity).toMatchObject({
      readiness: "reviewable",
      workShape: "improve",
      primaryFindingId: ids.finding,
      lenses: ["demand_competition"],
    });
  });

  it("builds a create Opportunity when there is no suitable owned asset", () => {
    const opportunity = buildOpportunity({
      finding: reviewableFinding,
      targets: [
        {
          relation: "affected_by_keyword_cluster",
          targetKind: "keyword_cluster",
          targetRef: "customer onboarding",
          resolutionState: "resolved",
          sitePageId: null,
          pageSnapshotId: null,
        },
      ],
      evidence: [
        crawlEvidence({ sourceProvider: "dataforseo" }),
      ].map((dto) => ({ ...dto })),
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(opportunity).toMatchObject({
      readiness: "reviewable",
      workShape: "create",
      primaryTarget: "topic",
      currentOwnedAsset: null,
    });
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });

  it("projects a confirmed Opportunity over the Finding-owned Action", () => {
    const opportunity = buildOpportunity({
      finding: { ...reviewableFinding, reviewState: "confirmed" },
      targets: [ownedUrlTarget()],
      evidence: [crawlEvidence()],
      action: { id: ids.action, sourceFindingId: ids.finding, status: "planned" },
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(opportunity).toMatchObject({
      readiness: "confirmed",
      actionId: ids.action,
      action: { artifactType: "content_brief", findingId: ids.finding },
    });
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });

  it("omits ignored findings and findings without supporting provenance", () => {
    expect(
      buildOpportunity({
        finding: { ...reviewableFinding, reviewState: "ignored" },
        targets: [ownedUrlTarget()],
        evidence: [crawlEvidence()],
        action: null,
        diagnosticRunId: ids.run,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      buildOpportunity({
        finding: reviewableFinding,
        targets: [ownedUrlTarget()],
        evidence: [crawlEvidence({ support: "context" })],
        action: null,
        diagnosticRunId: ids.run,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("pins exact-variant technical rules to rule version 2", () => {
    const opportunity = buildOpportunity({
      finding: {
        id: ids.finding,
        ruleId: "TECH-HTTP-001",
        reviewState: "unreviewed",
        active: true,
        title: "Return a 200 for the canonical URL",
      },
      targets: [
        ownedUrlTarget({
          relation: "affected_by_http_status",
          targetKind: "http_status",
          targetRef: "404",
          sitePageId: null,
          pageSnapshotId: null,
        }),
      ],
      evidence: [crawlEvidence()],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(opportunity).toMatchObject({
      workShape: "fix",
      primaryRule: { ruleId: "TECH-HTTP-001", ruleVersion: 2 },
      lenses: ["site_health"],
    });
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });
});

describe("supportingFindingIds (decision F: the content cluster only)", () => {
  const clusterKey = "customer onboarding";
  const supportA = "30000000-0000-4000-8000-000000000021";
  const supportB = "30000000-0000-4000-8000-000000000022";

  function clusterTarget(): OpportunityTargetInput {
    return {
      relation: "affected_by_keyword_cluster",
      targetKind: "keyword_cluster",
      targetRef: clusterKey,
      resolutionState: "definition_only",
      sitePageId: null,
      pageSnapshotId: null,
    };
  }

  function clusterRows(
    rows: readonly TopicClusterSupportRow[],
  ): ReadonlyMap<string, readonly TopicClusterSupportRow[]> {
    return groupTopicClusterSupportRows(rows);
  }

  it("names the cluster key a keyword-cluster Finding is projected onto", () => {
    expect(primaryTopicClusterKey([clusterTarget()])).toBe(clusterKey);
    expect(primaryTopicClusterKey([ownedUrlTarget()])).toBeNull();
    expect(primaryTopicClusterKey([])).toBeNull();
  });

  it("populates supporting Findings from the TopicCluster read model", () => {
    const opportunity = buildOpportunity({
      finding: { ...reviewableFinding, ruleId: "CONTENT-GAP-011" },
      targets: [clusterTarget()],
      evidence: [crawlEvidence({ sourceProvider: "dataforseo" })],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
      topicClusterRows: clusterRows([
        {
          clusterKey,
          sitePageId: ids.sitePage,
          findingId: supportB,
          mappingConfirmed: true,
        },
        {
          clusterKey,
          sitePageId: ids.sitePage,
          findingId: supportA,
          mappingConfirmed: true,
        },
      ]),
    });
    expect(opportunity?.supportingFindingIds).toEqual([supportA, supportB]);
    expect(opportunity?.coverageAndLimitations).toContain(
      "Supporting Findings are projected from the reviewed keyword cluster label and the operator's keyword-to-page mapping; they are not a separate rule result.",
    );
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });

  it("says out loud when the cluster has no page assignment", () => {
    const opportunity = buildOpportunity({
      finding: { ...reviewableFinding, ruleId: "CONTENT-GAP-011" },
      targets: [clusterTarget()],
      evidence: [crawlEvidence({ sourceProvider: "dataforseo" })],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
      topicClusterRows: clusterRows([]),
    });
    expect(opportunity?.supportingFindingIds).toEqual([]);
    expect(opportunity?.coverageAndLimitations).toContain(
      "This keyword cluster is not mapped to any owned page yet, so no supporting Findings could be derived.",
    );
  });

  it("leaves every non-cluster rule with the empty list decision F fixed", () => {
    const opportunity = buildOpportunity({
      finding: reviewableFinding,
      targets: [ownedUrlTarget()],
      evidence: [crawlEvidence()],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
      // A URL Opportunity is handed the same read model and must ignore it.
      topicClusterRows: clusterRows([
        {
          clusterKey: "https://example.com/customer-onboarding/",
          sitePageId: ids.sitePage,
          findingId: supportA,
          mappingConfirmed: true,
        },
      ]),
    });
    expect(opportunity?.supportingFindingIds).toEqual([]);
    expect(opportunity?.coverageAndLimitations).not.toContain(
      "Supporting Findings are projected from the reviewed keyword cluster label and the operator's keyword-to-page mapping; they are not a separate rule result.",
    );
  });
});
