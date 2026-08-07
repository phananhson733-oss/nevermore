import {
  KeywordGovernanceRepository,
  KeywordsRepository,
  type AutoGovernanceCandidateRow,
} from "@sf/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveAutoKeywordApproval,
  MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN,
  runAutoKeywordGovernance,
} from "./auto-keyword-governance.ts";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  keyword: "00000000-0000-4000-8000-000000000003",
  otherKeyword: "00000000-0000-4000-8000-000000000004",
  page: "00000000-0000-4000-8000-000000000005",
} as const;

const scope = { workspaceId: IDS.workspace, projectId: IDS.project };
const tx = {} as never;

function candidate(
  overrides: Partial<AutoGovernanceCandidateRow> = {},
): AutoGovernanceCandidateRow {
  return {
    id: IDS.keyword,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    display_keyword: "Customer Onboarding Software",
    normalized_keyword: "customer onboarding software",
    market: "US",
    language_tag: "en-US",
    query_kind: "search_query",
    mapping_revision: 0,
    dataforseo_ranked_evidence: 0,
    gsc_impression_evidence: 0,
    gsc_attributed_site_page_count: 0,
    gsc_attributed_site_page_id: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deriveAutoKeywordApproval", () => {
  it("approves a keyword the provider already observed ranking or being served", () => {
    expect(
      deriveAutoKeywordApproval(
        candidate({ dataforseo_ranked_evidence: 1 }),
      ),
    ).toMatchObject({
      kind: "approve",
      input: {
        keywordId: IDS.keyword,
        expectedGovernanceRevision: 0,
        clusterKey: "customer onboarding",
        mappingDecision: "unassigned",
        mappedSitePageId: null,
      },
    });
    expect(
      deriveAutoKeywordApproval(
        candidate({ gsc_impression_evidence: 1 }),
      ).kind,
    ).toBe("approve");
  });

  it("rejects a candidate with no impression-bearing and no ranked evidence", () => {
    expect(deriveAutoKeywordApproval(candidate())).toEqual({
      kind: "reject",
      reason: "insufficient_evidence",
    });
  });

  it("never invents a cluster label for a keyword that yields no tokens", () => {
    expect(
      deriveAutoKeywordApproval(
        candidate({
          display_keyword: "!!! ???",
          dataforseo_ranked_evidence: 4,
        }),
      ),
    ).toEqual({ kind: "reject", reason: "no_cluster_key" });
  });

  it("accepts the known CJK degradation to one keyword per cluster", () => {
    // `cluster_key.v1` splits on whitespace and only treats tokens of 3+
    // characters as "long", so CJK degrades twice over: an unspaced keyword
    // stays one token and becomes its own cluster, and a spaced keyword of
    // short tokens keeps ALL of them instead of the first two. Both outcomes
    // are honest — nothing is invented — and both still satisfy the diagnostic
    // freeze's non-null cluster rule.
    const spaced = deriveAutoKeywordApproval(
      candidate({
        display_keyword: "占星 星座 运势",
        dataforseo_ranked_evidence: 2,
      }),
    );
    const unspaced = deriveAutoKeywordApproval(
      candidate({
        display_keyword: "占星星座运势",
        dataforseo_ranked_evidence: 2,
      }),
    );
    expect(spaced).toMatchObject({
      kind: "approve",
      input: { clusterKey: "占星 星座 运势" },
    });
    expect(unspaced).toMatchObject({
      kind: "approve",
      input: { clusterKey: "占星星座运势" },
    });
  });

  it("maps only to the single Site Page Search Console already proved", () => {
    expect(
      deriveAutoKeywordApproval(
        candidate({
          gsc_impression_evidence: 5,
          gsc_attributed_site_page_count: 1,
          gsc_attributed_site_page_id: IDS.page,
        }),
      ),
    ).toMatchObject({
      kind: "approve",
      input: {
        mappingDecision: "existing_page",
        mappedSitePageId: IDS.page,
      },
    });
  });

  it("leaves ambiguous or provider-unattributed keywords unassigned instead of guessing", () => {
    expect(
      deriveAutoKeywordApproval(
        candidate({
          gsc_impression_evidence: 5,
          gsc_attributed_site_page_count: 2,
          gsc_attributed_site_page_id: IDS.page,
        }),
      ),
    ).toMatchObject({
      kind: "approve",
      input: { mappingDecision: "unassigned", mappedSitePageId: null },
    });
    // DataForSEO keyword Observations are never page-attributed at persist
    // time, so a stale attribution counter must not leak into the mapping.
    expect(
      deriveAutoKeywordApproval(
        candidate({
          dataforseo_ranked_evidence: 9,
          gsc_impression_evidence: 0,
          gsc_attributed_site_page_count: 1,
          gsc_attributed_site_page_id: IDS.page,
        }),
      ),
    ).toMatchObject({
      kind: "approve",
      input: { mappingDecision: "unassigned", mappedSitePageId: null },
    });
  });

  it("discloses the automated origin and its exact evidence in the immutable reason", () => {
    const decision = deriveAutoKeywordApproval(
      candidate({
        dataforseo_ranked_evidence: 3,
        gsc_impression_evidence: 2,
      }),
    );
    if (decision.kind !== "approve") throw new Error("expected an approval");
    expect(decision.input.reason).toContain("auto_keyword_governance.v1");
    expect(decision.input.reason).toContain("cluster_key.v1");
    expect(decision.input.reason).toContain("3 DataForSEO occurrence(s)");
    expect(decision.input.reason).toContain("2 Search Console occurrence(s)");
    expect(decision.input.reason).toContain("No human has reviewed");
    expect(decision.input.reason.length).toBeLessThanOrEqual(2_000);
  });

  it("is deterministic, so a repeated run proposes the identical decision", () => {
    const row = candidate({ dataforseo_ranked_evidence: 1 });
    expect(deriveAutoKeywordApproval(row)).toEqual(
      deriveAutoKeywordApproval(row),
    );
  });
});

describe("runAutoKeywordGovernance", () => {
  it("reads and writes nothing when the rollout flag is off", async () => {
    const read = vi.spyOn(
      KeywordsRepository.prototype,
      "listAutoGovernanceCandidates",
    );
    const write = vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "applySystemApprovals",
    );

    await expect(
      runAutoKeywordGovernance(tx, scope, { enabled: false }),
    ).resolves.toMatchObject({ enabled: false, considered: 0, approved: 0 });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("proposes only evidence-bearing candidates and reports the rejections", async () => {
    vi.spyOn(
      KeywordsRepository.prototype,
      "listAutoGovernanceCandidates",
    ).mockResolvedValue([
      candidate({ dataforseo_ranked_evidence: 1 }),
      candidate({ id: IDS.otherKeyword }),
    ]);
    const write = vi
      .spyOn(KeywordGovernanceRepository.prototype, "applySystemApprovals")
      .mockResolvedValue([
        {
          keywordId: IDS.keyword,
          applied: true,
          skipped: null,
          governanceRevision: 1,
        },
      ]);

    const report = await runAutoKeywordGovernance(tx, scope, {
      enabled: true,
    });

    expect(write).toHaveBeenCalledWith(scope, [
      expect.objectContaining({ keywordId: IDS.keyword }),
    ]);
    expect(report).toMatchObject({
      enabled: true,
      considered: 2,
      proposed: 1,
      approved: 1,
      rejected: { insufficient_evidence: 1, no_cluster_key: 0 },
    });
  });

  it("counts an already-reviewed keyword as skipped so a repeated run is a no-op", async () => {
    vi.spyOn(
      KeywordsRepository.prototype,
      "listAutoGovernanceCandidates",
    ).mockResolvedValue([candidate({ dataforseo_ranked_evidence: 1 })]);
    vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "applySystemApprovals",
    ).mockResolvedValue([
      {
        keywordId: IDS.keyword,
        applied: false,
        skipped: "already_reviewed",
        governanceRevision: null,
      },
    ]);

    await expect(
      runAutoKeywordGovernance(tx, scope, { enabled: true }),
    ).resolves.toMatchObject({
      proposed: 1,
      approved: 0,
      skipped: expect.objectContaining({
        already_reviewed: 1,
        human_decision_exists: 0,
      }),
    });
  });

  it("never asks the repository for more than one bounded page of candidates", async () => {
    const read = vi
      .spyOn(KeywordsRepository.prototype, "listAutoGovernanceCandidates")
      .mockResolvedValue([]);

    await runAutoKeywordGovernance(tx, scope, {
      enabled: true,
      limit: MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN + 5_000,
    });

    expect(read).toHaveBeenCalledWith(scope, {
      limit: MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN,
    });
  });
});
