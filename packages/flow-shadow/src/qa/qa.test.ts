import { describe, expect, it } from "vitest";
import { buildContentShadowInputManifest } from "../research/manifest.ts";
import { buildResearchPack } from "../research/research-pack.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../version.ts";
import {
  clampVerdictToFailedClaims,
  evaluateDraftQa,
  qaClaimsToJson,
  QA_BRIEF_OUTLINE_CLAIM_ID,
  QA_PENDING_CLAIM_ID,
  RED_LINE_CHECKS,
  STRUCTURE_CHECKS,
  scoreCitability,
} from "./index.ts";
import type { ContentShadowBriefOutline } from "../types.ts";

const OUTLINE: ContentShadowBriefOutline = {
  briefSections: ["Objective", "Audience"],
  targetKeywords: ["growth analytics"],
  pageAssignment: "existing_page",
};

const STATS = {
  clusterKeywordCount: 1,
  projectedKeywordCount: 1,
  unconfirmedMappingCount: 0,
};

function packWith(outline: ContentShadowBriefOutline) {
  return buildResearchPack(
    buildContentShadowInputManifest({
      primaryFindingId: "00000000-0000-4000-8000-000000000001",
      sourceActionId: "00000000-0000-4000-8000-000000000002",
      sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000003",
      contentBriefArtifactId: "00000000-0000-4000-8000-000000000004",
      contentBriefRevision: 1,
      competitorEntityIds: [],
      searchCluster: {
        clusterKey: "growth-analytics",
        keywordEntityIds: ["00000000-0000-4000-8000-00000000000a"],
      },
      generativeQueryEntityIds: [],
      contentBriefOutline: outline,
      flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
      promptSetVersion: "mvp.prompts.content-shadow.0.3.0",
      projectionVersion: "content-shadow.0.3.1",
      outputLocale: "en",
    }),
    STATS,
  );
}

const pack = buildResearchPack(
  buildContentShadowInputManifest({
    primaryFindingId: "00000000-0000-4000-8000-000000000001",
    sourceActionId: "00000000-0000-4000-8000-000000000002",
    sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000003",
    contentBriefArtifactId: "00000000-0000-4000-8000-000000000004",
    contentBriefRevision: 1,
    competitorEntityIds: [],
    searchCluster: {
      clusterKey: "growth-analytics",
      keywordEntityIds: ["00000000-0000-4000-8000-00000000000a"],
    },
    generativeQueryEntityIds: [],
    contentBriefOutline: OUTLINE,
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    promptSetVersion: "mvp.prompts.content-shadow.0.3.0",
    projectionVersion: "content-shadow.0.3.1",
    outputLocale: "en",
  }),
  STATS,
);

const input = { draftMarkdown: "# Draft\n\nBody.", pack };

describe("evaluateDraftQa (Task 4 skeleton)", () => {
  it("records needs_review rather than claiming an unimplemented pass", () => {
    const evaluation = evaluateDraftQa(input);

    expect(evaluation.verdict).toBe("needs_review");
    expect(evaluation.claims).toEqual([
      {
        claimId: QA_PENDING_CLAIM_ID,
        kind: "coverage",
        status: "unevaluated",
        detail: expect.stringContaining("requires human review"),
      },
      {
        claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
        kind: "coverage",
        status: "unevaluated",
        detail: expect.stringContaining("2 coverage topic(s)"),
      },
    ]);
  });

  it("never reports a passed claim while the checks are unimplemented", () => {
    expect(
      evaluateDraftQa(input).claims.some((claim) => claim.status === "passed"),
    ).toBe(false);
  });

  it("keeps the ported check vocabularies empty until Task 6", () => {
    expect(RED_LINE_CHECKS).toEqual([]);
    expect(STRUCTURE_CHECKS).toEqual([]);
  });

  it("keeps citability advisory and unscored", () => {
    expect(scoreCitability(input)).toBeNull();
  });

  it("serializes claims to plain JSON for the jsonb column", () => {
    const claims = qaClaimsToJson(evaluateDraftQa(input).claims);

    expect(Array.isArray(claims)).toBe(true);
    expect(claims[0]?.["status"]).toBe("unevaluated");
  });
});

describe("brief -> draft causal chain claim (decision O-4)", () => {
  it("fails the claim, not silently, when the brief produced no outline", () => {
    const evaluation = evaluateDraftQa({
      draftMarkdown: "# Draft\n\nBody.",
      pack: packWith({
        briefSections: [],
        targetKeywords: [],
        pageAssignment: "unassigned",
      }),
    });
    const claim = evaluation.claims.find(
      (candidate) => candidate.claimId === QA_BRIEF_OUTLINE_CLAIM_ID,
    );

    expect(claim?.status).toBe("failed");
    expect(evaluation.verdict).not.toBe("passed");
  });

  it("clamps a would-be `passed` verdict off `passed` while any claim failed", () => {
    // Task 6 replaces the skeleton verdict; this keeps it from regressing O-4.
    expect(
      clampVerdictToFailedClaims("passed", [
        {
          claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
          kind: "coverage",
          status: "failed",
          detail: "no outline",
        },
      ]),
    ).toBe("needs_review");
    expect(
      clampVerdictToFailedClaims("passed", [
        {
          claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
          kind: "coverage",
          status: "unevaluated",
          detail: "pending",
        },
      ]),
    ).toBe("passed");
    expect(clampVerdictToFailedClaims("blocked", [])).toBe("blocked");
  });
});
