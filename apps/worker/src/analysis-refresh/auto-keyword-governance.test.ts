import {
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
  KeywordsRepository,
  type AutoGovernanceCandidateRow,
} from "@sf/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autoKeywordGovernanceFailureReport,
  AUTO_GOVERNANCE_ENTITY_SAFETY_RESERVE,
  AUTO_GOVERNANCE_OCCURRENCE_SAFETY_RESERVE,
  deriveAutoKeywordApproval,
  freezeBudget,
  MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN,
  runAutoKeywordGovernance,
  withinFreezeBudget,
} from "./auto-keyword-governance.ts";
import { DIAGNOSTIC_GOVERNANCE_LIMITS } from "./governance.ts";

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
    occurrence_count: 1,
    ...overrides,
  };
}

/**
 * An empty project: the freeze has its whole budget, so budget behaviour never
 * silently explains a result in the tests that are about something else.
 */
function mockEmptyGovernanceLoad(): void {
  vi.spyOn(
    KeywordsRepository.prototype,
    "readDiagnosticGovernanceLoad",
  ).mockResolvedValue({ eligibleEntities: 0, occurrenceRefs: 0 });
}

beforeEach(() => {
  mockEmptyGovernanceLoad();
});

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

  it("reads the committed freeze load BEFORE it proposes anything", async () => {
    const load = vi
      .spyOn(KeywordsRepository.prototype, "readDiagnosticGovernanceLoad")
      .mockResolvedValue({ eligibleEntities: 0, occurrenceRefs: 0 });
    const read = vi
      .spyOn(KeywordsRepository.prototype, "listAutoGovernanceCandidates")
      .mockResolvedValue([]);

    await runAutoKeywordGovernance(tx, scope, { enabled: true });

    expect(load).toHaveBeenCalledWith(scope);
    expect(load).toHaveBeenCalledBefore(read);
  });

  it("approves only what the diagnostic freeze still has room for", async () => {
    // Two entities of headroom left, and every candidate costs one entity.
    vi.spyOn(
      KeywordsRepository.prototype,
      "readDiagnosticGovernanceLoad",
    ).mockResolvedValue({
      eligibleEntities:
        DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities -
        AUTO_GOVERNANCE_ENTITY_SAFETY_RESERVE -
        2,
      occurrenceRefs: 0,
    });
    const ids = [
      "00000000-0000-4000-8000-00000000000a",
      "00000000-0000-4000-8000-00000000000b",
      "00000000-0000-4000-8000-00000000000c",
      "00000000-0000-4000-8000-00000000000d",
    ];
    vi.spyOn(
      KeywordsRepository.prototype,
      "listAutoGovernanceCandidates",
    ).mockResolvedValue(
      ids.map((id) => candidate({ id, dataforseo_ranked_evidence: 1 })),
    );
    const write = vi
      .spyOn(KeywordGovernanceRepository.prototype, "applySystemApprovals")
      .mockImplementation(async (_scope, inputs) =>
        inputs.map((input) => ({
          keywordId: input.keywordId,
          applied: true,
          skipped: null,
          governanceRevision: 1,
        })),
      );

    const report = await runAutoKeywordGovernance(tx, scope, {
      enabled: true,
    });

    // Only the first two, in the repository's own id order.
    expect(write).toHaveBeenCalledWith(scope, [
      expect.objectContaining({ keywordId: ids[0] }),
      expect.objectContaining({ keywordId: ids[1] }),
    ]);
    expect(report).toMatchObject({
      considered: 4,
      proposed: 4,
      submitted: 2,
      approved: 2,
      withheld: expect.objectContaining({ entity_budget_exhausted: 2 }),
    });
  });

  it("approves nothing, writes nothing, and says why when the budget is gone", async () => {
    vi.spyOn(
      KeywordsRepository.prototype,
      "readDiagnosticGovernanceLoad",
    ).mockResolvedValue({
      eligibleEntities: DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities,
      occurrenceRefs: DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrenceRefsTotal,
    });
    vi.spyOn(
      KeywordsRepository.prototype,
      "listAutoGovernanceCandidates",
    ).mockResolvedValue([candidate({ dataforseo_ranked_evidence: 1 })]);
    const write = vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "applySystemApprovals",
    );

    const report = await runAutoKeywordGovernance(tx, scope, {
      enabled: true,
    });

    expect(write).not.toHaveBeenCalled();
    // The reason is reported, never silent: an operator must be able to see
    // that the library stalled on the freeze ceiling rather than on evidence.
    expect(report).toMatchObject({
      proposed: 1,
      submitted: 0,
      approved: 0,
      withheld: expect.objectContaining({ entity_budget_exhausted: 1 }),
      budget: expect.objectContaining({
        entityHeadroom: 0,
        occurrenceHeadroom: 0,
      }),
    });
  });

  it("stops at the occurrence ceiling even while entity headroom remains", async () => {
    vi.spyOn(
      KeywordsRepository.prototype,
      "readDiagnosticGovernanceLoad",
    ).mockResolvedValue({
      eligibleEntities: 0,
      occurrenceRefs:
        DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrenceRefsTotal -
        AUTO_GOVERNANCE_OCCURRENCE_SAFETY_RESERVE -
        10,
    });
    vi.spyOn(
      KeywordsRepository.prototype,
      "listAutoGovernanceCandidates",
    ).mockResolvedValue([
      candidate({
        id: "00000000-0000-4000-8000-00000000000a",
        dataforseo_ranked_evidence: 1,
        occurrence_count: 10,
      }),
      candidate({
        id: "00000000-0000-4000-8000-00000000000b",
        dataforseo_ranked_evidence: 1,
        occurrence_count: 1,
      }),
    ]);
    const write = vi
      .spyOn(KeywordGovernanceRepository.prototype, "applySystemApprovals")
      .mockResolvedValue([
        {
          keywordId: "00000000-0000-4000-8000-00000000000a",
          applied: true,
          skipped: null,
          governanceRevision: 1,
        },
      ]);

    const report = await runAutoKeywordGovernance(tx, scope, {
      enabled: true,
    });

    expect(write).toHaveBeenCalledWith(scope, [
      expect.objectContaining({
        keywordId: "00000000-0000-4000-8000-00000000000a",
      }),
    ]);
    expect(report.withheld).toMatchObject({
      occurrence_budget_exhausted: 1,
      entity_budget_exhausted: 0,
    });
  });

  it("refuses a keyword whose own history the freeze could never read", async () => {
    vi.spyOn(
      KeywordsRepository.prototype,
      "listAutoGovernanceCandidates",
    ).mockResolvedValue([
      candidate({
        id: "00000000-0000-4000-8000-00000000000a",
        dataforseo_ranked_evidence: 1,
        occurrence_count:
          DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrencesPerEntity + 1,
      }),
      candidate({
        id: "00000000-0000-4000-8000-00000000000b",
        dataforseo_ranked_evidence: 1,
        occurrence_count: 0,
      }),
    ]);
    const write = vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "applySystemApprovals",
    );

    const report = await runAutoKeywordGovernance(tx, scope, {
      enabled: true,
    });

    // Approving either one would make EVERY later freeze fail, so both stay
    // ungoverned and both are reported.
    expect(write).not.toHaveBeenCalled();
    expect(report.withheld).toMatchObject({
      occurrence_history_unfreezable: 1,
      occurrence_lineage_absent: 1,
    });
  });

  it("runs the whole pass in a nested transaction when the executor offers one", async () => {
    vi.spyOn(
      KeywordsRepository.prototype,
      "listAutoGovernanceCandidates",
    ).mockResolvedValue([]);
    const nested = vi.fn(async (run: (inner: never) => Promise<unknown>) =>
      run({} as never),
    );

    await runAutoKeywordGovernance(
      { transaction: nested } as never,
      scope,
      { enabled: true },
    );

    expect(nested).toHaveBeenCalledTimes(1);
  });
});

describe("freezeBudget", () => {
  it("never reports negative headroom for an already-overflowing library", () => {
    expect(
      freezeBudget({
        eligibleEntities: DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities + 500,
        occurrenceRefs:
          DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrenceRefsTotal + 500,
      }),
    ).toMatchObject({ entityHeadroom: 0, occurrenceHeadroom: 0 });
  });

  it("keeps a reserve so a concurrent write cannot tip the freeze over", () => {
    const budget = freezeBudget({ eligibleEntities: 0, occurrenceRefs: 0 });
    expect(budget.entityHeadroom).toBe(
      DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities -
        AUTO_GOVERNANCE_ENTITY_SAFETY_RESERVE,
    );
    expect(budget.occurrenceHeadroom).toBe(
      DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrenceRefsTotal -
        AUTO_GOVERNANCE_OCCURRENCE_SAFETY_RESERVE,
    );
  });
});

describe("withinFreezeBudget", () => {
  it("is deterministic, so a retried run withholds exactly the same rows", () => {
    const proposals = [1, 2, 3].map((index) => {
      const row = candidate({
        id: `00000000-0000-4000-8000-00000000000${index}`,
        dataforseo_ranked_evidence: 1,
        occurrence_count: 2,
      });
      const decision = deriveAutoKeywordApproval(row);
      if (decision.kind !== "approve") throw new Error("expected an approval");
      return { candidate: row, input: decision.input };
    });
    const budget = {
      eligibleEntities: 0,
      occurrenceRefs: 0,
      entityHeadroom: 5,
      occurrenceHeadroom: 4,
    };

    const first = withinFreezeBudget(proposals, budget);
    const second = withinFreezeBudget(proposals, budget);

    expect(first.approvals).toHaveLength(2);
    expect(first).toEqual(second);
  });
});

describe("autoKeywordGovernanceFailureReport", () => {
  it("reports the failure as a limitation and claims no decision at all", () => {
    const report = autoKeywordGovernanceFailureReport(
      new KeywordGovernanceIntegrityError("CAS_UPDATE_FAILED"),
    );
    expect(report).toMatchObject({
      enabled: true,
      considered: 0,
      proposed: 0,
      submitted: 0,
      approved: 0,
      budget: null,
    });
    expect(report.failure?.code).toBe(
      "AUTO_KEYWORD_GOVERNANCE_CAS_UPDATE_FAILED",
    );
    expect(report.failure?.summary).toContain("no decision");
    expect(
      autoKeywordGovernanceFailureReport(new RangeError("too many")).failure
        ?.code,
    ).toBe("AUTO_KEYWORD_GOVERNANCE_BOUND_EXCEEDED");
    expect(
      autoKeywordGovernanceFailureReport(new Error("boom")).failure?.code,
    ).toBe("AUTO_KEYWORD_GOVERNANCE_FAILED");
  });
});
