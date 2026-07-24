import { describe, expect, it } from "vitest";
import { buildContentShadowInputManifest } from "../research/manifest.ts";
import { buildResearchPack } from "../research/research-pack.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../version.ts";
import {
  evaluateDraftQa,
  qaClaimsToJson,
  QA_PENDING_CLAIM_ID,
  RED_LINE_CHECKS,
  STRUCTURE_CHECKS,
  scoreCitability,
} from "./index.ts";

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
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    promptSetVersion: "mvp.prompts.0.2.0",
    projectionVersion: "content-shadow.0.3.0",
    outputLocale: "en",
  }),
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
