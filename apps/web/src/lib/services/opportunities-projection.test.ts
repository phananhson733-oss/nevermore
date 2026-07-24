import { describe, expect, it } from "vitest";
import { GrowthOpportunity } from "@sf/contracts";
import type { EvidenceDto } from "./diagnostic-mappers";
import {
  buildActionSummary,
  buildEvidenceSummary,
  buildOpportunity,
  deriveOpportunityKey,
  resolvePrimaryTarget,
  resolveReadiness,
  type OpportunityFindingInput,
  type OpportunityTargetInput,
} from "./opportunities-projection";

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
