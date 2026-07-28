import { describe, expect, it } from "vitest";
import {
  DecideKeywordRelationRequest,
  GrowthMapKeywordRelation,
  KeywordRelationCandidate,
  KeywordRelationDecision,
  KeywordRelationRefreshResponse,
  KeywordRelationRevisionConflict,
} from "./keyword-relations.ts";

const ids = {
  project: "81000000-0000-4000-8000-000000000001",
  relation: "81000000-0000-4000-8000-000000000002",
  candidate: "81000000-0000-4000-8000-000000000003",
  keywordA: "81000000-0000-4000-8000-000000000004",
  keywordB: "81000000-0000-4000-8000-000000000005",
  page: "81000000-0000-4000-8000-000000000006",
  topic: "81000000-0000-4000-8000-000000000007",
  decision: "81000000-0000-4000-8000-000000000008",
  actor: "81000000-0000-4000-8000-000000000009",
} as const;

function participant(
  keywordId: string,
  displayKeyword: string,
) {
  return {
    keywordId,
    displayKeyword,
    normalizedKeyword: displayKeyword.toLowerCase(),
    governanceRevision: 3,
    marketCode: "US",
    languageTag: "en-US",
    intent: "Commercial",
    topicNodeId: ids.topic,
    topicModelRevision: 2,
    mappedSitePageId: ids.page,
  };
}

const candidate = {
  candidateId: ids.candidate,
  relationId: ids.relation,
  projectId: ids.project,
  candidateRevision: 1,
  ruleVersion: "keyword-relation.1.0.0",
  keywordA: participant(ids.keywordA, "Customer Onboarding"),
  keywordB: participant(
    ids.keywordB,
    "Customer Onboarding Automation",
  ),
  signals: {
    sameConfirmedMappedPage: true,
    sameReviewedIntent: true,
    sameMarket: true,
    sameLanguage: true,
    sameConfirmedTopic: true,
    lexicalTokenOverlap: 0.67,
    serpOverlap: {
      availability: "unavailable",
      value: null,
      limitation:
        "Canonical SERP-overlap observations are not available yet.",
    },
  },
  evidenceHash: "a".repeat(64),
  generatedAt: "2026-07-27T10:00:00.000Z",
} as const;

const foldDecision = {
  decisionId: ids.decision,
  relationId: ids.relation,
  candidateId: ids.candidate,
  projectId: ids.project,
  relationRevision: 1,
  decisionKind: "primary_supporting",
  primaryKeywordId: ids.keywordA,
  supportingKeywordId: ids.keywordB,
  reason: "Keep one primary row while retaining all supporting evidence.",
  decidedBy: ids.actor,
  decidedAt: "2026-07-27T10:05:00.000Z",
} as const;

describe("Keyword Relation contracts", () => {
  it("accepts a narrow same-page, same-intent candidate with frozen evidence", () => {
    expect(KeywordRelationCandidate.parse(candidate)).toEqual(candidate);
  });

  it("rejects cross-page, cross-market, unordered, or self-like candidates", () => {
    expect(
      KeywordRelationCandidate.safeParse({
        ...candidate,
        keywordB: {
          ...candidate.keywordB,
          mappedSitePageId: ids.topic,
        },
      }).success,
    ).toBe(false);
    expect(
      KeywordRelationCandidate.safeParse({
        ...candidate,
        keywordA: candidate.keywordB,
        keywordB: candidate.keywordA,
      }).success,
    ).toBe(false);
    expect(
      KeywordRelationCandidate.safeParse({
        ...candidate,
        keywordB: {
          ...candidate.keywordB,
          marketCode: "GB",
        },
      }).success,
    ).toBe(false);
  });

  it("requires primary/supporting identities only for a fold decision", () => {
    expect(KeywordRelationDecision.parse(foldDecision)).toEqual(
      foldDecision,
    );
    expect(
      KeywordRelationDecision.safeParse({
        ...foldDecision,
        decisionKind: "keep_separate",
      }).success,
    ).toBe(false);
    expect(
      KeywordRelationDecision.safeParse({
        ...foldDecision,
        supportingKeywordId: ids.keywordA,
      }).success,
    ).toBe(false);
  });

  it("derives an effective fold only from the exact current candidate decision", () => {
    const relation = {
      projectId: ids.project,
      relationId: ids.relation,
      candidate,
      candidateState: "current",
      staleReasons: [],
      currentRelationRevision: 1,
      decision: foldDecision,
      decisionState: "active",
      displayState: "folded",
      isEffectivelyFolded: true,
      primaryKeywordId: ids.keywordA,
      supportingKeywordId: ids.keywordB,
    } as const;
    expect(GrowthMapKeywordRelation.parse(relation)).toEqual(relation);

    expect(
      GrowthMapKeywordRelation.safeParse({
        ...relation,
        candidateState: "stale",
        staleReasons: ["mapping_changed"],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapKeywordRelation.safeParse({
        ...relation,
        decision: {
          ...foldDecision,
          candidateId: ids.topic,
        },
      }).success,
    ).toBe(false);
  });

  it("makes drift explicit and restores the supporting Keyword to the visible list", () => {
    expect(
      GrowthMapKeywordRelation.parse({
        projectId: ids.project,
        relationId: ids.relation,
        candidate,
        candidateState: "stale",
        staleReasons: ["mapping_changed"],
        currentRelationRevision: 1,
        decision: foldDecision,
        decisionState: "stale",
        displayState: "stale",
        isEffectivelyFolded: false,
        primaryKeywordId: null,
        supportingKeywordId: null,
      }),
    ).toMatchObject({
      candidateState: "stale",
      isEffectivelyFolded: false,
    });
  });

  it("keeps actor/time server-owned and bounds compare-and-swap revisions", () => {
    const request = {
      expectedRelationRevision: 0,
      candidateId: ids.candidate,
      decisionKind: "primary_supporting",
      primaryKeywordId: ids.keywordA,
      supportingKeywordId: ids.keywordB,
      reason: "Use the first phrase as the primary Keyword.",
    } as const;
    expect(DecideKeywordRelationRequest.parse(request)).toEqual(
      request,
    );
    expect(
      DecideKeywordRelationRequest.safeParse({
        ...request,
        decidedBy: ids.actor,
      }).success,
    ).toBe(false);
    expect(
      DecideKeywordRelationRequest.safeParse({
        ...request,
        expectedRelationRevision: 2_147_483_647,
      }).success,
    ).toBe(false);
  });

  it("exposes exact current candidate facts for a safe decision retry", () => {
    const conflict = {
      kind: "revision_conflict",
      resource: "keyword_relation",
      projectId: ids.project,
      resourceId: ids.relation,
      expectedRevision: 0,
      currentRevision: 1,
      currentCandidateId: ids.candidate,
    } as const;

    expect(KeywordRelationRevisionConflict.parse(conflict)).toEqual(
      conflict,
    );
    expect(
      KeywordRelationRevisionConflict.safeParse({
        ...conflict,
        currentRevision: conflict.expectedRevision,
      }).success,
    ).toBe(false);
    expect(
      KeywordRelationRevisionConflict.safeParse({
        ...conflict,
        actorId: ids.actor,
      }).success,
    ).toBe(false);
  });

  it("keeps duplicate detection refresh counts internally consistent", () => {
    const response = {
      projectId: ids.project,
      eligiblePairCount: 4,
      createdRelationCount: 1,
      createdCandidateCount: 2,
      generatedAt: "2026-07-27T10:10:00.000Z",
    } as const;

    expect(KeywordRelationRefreshResponse.parse(response)).toEqual(
      response,
    );
    expect(
      KeywordRelationRefreshResponse.safeParse({
        ...response,
        createdCandidateCount: 5,
      }).success,
    ).toBe(false);
  });
});
