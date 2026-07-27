import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  CompetitorsRepository,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  IcpProfilesRepository,
  KeywordsRepository,
  PageSnapshotsRepository,
  SitesRepository,
  type ActionRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type Executor,
  type FindingRow,
} from "@sf/db";
import { CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION } from "@sf/contracts";
import { CONTENT_SHADOW_PROMPT_SET_VERSION } from "@sf/artifacts";
import { PROMPT_SET_VERSION as ENGINE_PROMPT_SET_VERSION } from "@sf/engine";
import type { CreateContentShadowRunRequest } from "@sf/contracts";

/**
 * Slice 2 Task 5 admission hardening for `createContentShadowRun`.
 *
 * `loadContentShadowInputs` is the one place that decides whether a frozen
 * tuple may exist at all, so every refusal it can produce needs a distinct,
 * operator-actionable code. These branches are deliberately redundant with the
 * `flow_shadow_runs` provenance trigger — the trigger raises 23514 (a 500),
 * this layer explains what to do about it.
 */

vi.mock("@/lib/db", () => ({ getDb: () => ({ db: {} }) }));
vi.mock("@/lib/boss", () => ({ getBoss: async () => ({}) }));

const {
  buildContentShadowFrozenInput,
  loadContentShadowInputs,
  projectContentShadowFrozenInputs,
  projectContentShadowPackSources,
  projectContentShadowRevisionHistory,
} = await import("../content-shadow.ts");

const scope = { workspaceId: "workspace-1" };
const projectId = "project-1";
const exec = {} as Executor;

const ACTION_ID = "00000000-0000-4000-8000-0000000000a1";
const FINDING_ID = "00000000-0000-4000-8000-0000000000f1";
const DIAGNOSTIC_ID = "00000000-0000-4000-8000-0000000000d1";
const BRIEF_ID = "00000000-0000-4000-8000-0000000000b1";
const KEYWORD_ID = "00000000-0000-4000-8000-0000000000e1";
const GENERATIVE_ID = "00000000-0000-4000-8000-0000000000c1";
const COMPETITOR_ID = "00000000-0000-4000-8000-0000000000c2";
const ICP_ID = "00000000-0000-4000-8000-0000000000c9";
const CRAWL_SNAPSHOT_ID = "00000000-0000-4000-8000-0000000000ca";
const PAGE_SNAPSHOT_ID = "00000000-0000-4000-8000-0000000000cb";
const SITE_ORIGIN = "https://acme.example";
const CONVERSION_URL = "https://acme.example/demo";

const action = {
  id: ACTION_ID,
  source_finding_id: FINDING_ID,
  source_diagnostic_run_id: DIAGNOSTIC_ID,
  template_id: "create_priority_content.v1",
  status: "planned",
} as unknown as ActionRow;

const finding = {
  id: FINDING_ID,
  rule_id: "CONTENT-COVERAGE-001",
  review_state: "confirmed",
  last_seen_run_id: DIAGNOSTIC_ID,
} as unknown as FindingRow;

const brief = {
  id: BRIEF_ID,
  action_id: ACTION_ID,
  artifact_type: "content_brief",
  status: "draft",
  validation_state: "valid",
  current_revision: 2,
} as unknown as ArtifactRow;

const BRIEF_MARKDOWN = [
  "## Objective",
  "",
  "Close the gap.",
  "",
  "## 受众",
  "",
  "RevOps.",
  "",
  "[Industry benchmark](https://authority.example/benchmark)",
].join("\n");

const briefRevision = {
  id: "revision-1",
  artifact_id: BRIEF_ID,
  revision: 2,
  content_text: BRIEF_MARKDOWN,
} as unknown as ArtifactRevisionRow;

const body: CreateContentShadowRunRequest = {
  actionId: ACTION_ID,
  competitorEntityIds: [],
  searchCluster: {
    clusterKey: "growth-analytics",
    keywordEntityIds: [KEYWORD_ID],
  },
  generativeQueryEntityIds: [GENERATIVE_ID],
  outputLocale: "en",
  capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
};

function frozenResearchContext(
  searchId = KEYWORD_ID,
  generativeId = GENERATIVE_ID,
) {
  const fact = (id: string, cluster: string | null) => ({
    id,
    display: `keyword ${id}`,
    market: "US",
    language: "en",
    intent: "commercial",
    buyerStage: "consideration",
    cluster,
    mapping: {
      decision: "existing_page" as const,
      mappedSitePageId: "00000000-0000-4000-8000-0000000000cc",
      reviewState: "confirmed" as const,
      revision: 2,
    },
    lastSeen: "2026-07-25T00:00:00.000Z",
    evidenceRefs: [],
  });
  return {
    firstPartyPageSnapshots: [],
    searchKeywordFacts: [fact(searchId, "growth-analytics")],
    generativeKeywordFacts: [fact(generativeId, null)],
    competitorFacts: [],
    externalTargets: [],
    contentPolicy: {
      brandConstraints: [],
      complianceConstraints: [],
      prohibitedTerms: [],
      claimRestrictions: [...DEFAULT_TEST_CLAIM_RESTRICTIONS],
    },
  };
}

const DEFAULT_TEST_CLAIM_RESTRICTIONS = [
  "no_guarantees",
  "no_unsupported_quantified_claims",
  "no_unverified_superlatives",
] as const;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(ActionsRepository.prototype, "findById").mockResolvedValue(action);
  vi.spyOn(
    ActionsRepository.prototype,
    "countActionsForFinding",
  ).mockResolvedValue(1);
  vi.spyOn(FindingsRepository.prototype, "findById").mockResolvedValue(finding);
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findLiveByActionType",
  ).mockResolvedValue(brief);
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findRevision",
  ).mockResolvedValue(briefRevision);
  vi.spyOn(DiagnosticRunsRepository.prototype, "findById").mockResolvedValue({
    id: DIAGNOSTIC_ID,
    site_id: "site-1",
    icp_profile_id: ICP_ID,
    input_manifest: {
      snapshots: [
        {
          snapshotId: CRAWL_SNAPSHOT_ID,
          provider: "crawl",
        },
      ],
    },
  } as never);
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
    id: "site-1",
    origin: SITE_ORIGIN,
  } as never);
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
    id: ICP_ID,
    profile: {
      primaryConversion: {
        label: "Book a demo",
        type: "demo",
        targetUrl: CONVERSION_URL,
      },
      brandConstraints: ["Use a calm, practical voice."],
      complianceConstraints: ["Qualify forward-looking statements."],
    },
  } as never);
  vi.spyOn(
    PageSnapshotsRepository.prototype,
    "listByDataSnapshotWithSitePageIdentity",
  ).mockResolvedValue([
    {
      page_snapshot_id: PAGE_SNAPSHOT_ID,
      data_snapshot_id: CRAWL_SNAPSHOT_ID,
      normalized_url: `${SITE_ORIGIN}/growth`,
      normalized_url_hash: "a".repeat(64),
      content_hash: "b".repeat(64),
      captured_at: "2026-07-25T00:00:00.000Z",
      site_id: "site-1",
    },
  ] as never);
  vi.spyOn(CompetitorsRepository.prototype, "listByIds").mockResolvedValue([]);
  vi.spyOn(KeywordsRepository.prototype, "listByIds").mockImplementation(
    async (_scope, ids) =>
      ids.map((id) => ({
        id,
        query_kind: id === GENERATIVE_ID ? "generative_query" : "search_query",
        cluster_key: id === GENERATIVE_ID ? null : "growth-analytics",
        display_keyword: `keyword ${id}`,
        normalized_keyword: `keyword ${id}`,
        market: "US",
        language_tag: "en",
        intent: "commercial",
        buyer_stage: "consideration",
        mapping_decision: "existing_page",
        mapped_site_page_id: "00000000-0000-4000-8000-0000000000cc",
        mapping_review_state: "confirmed",
        mapping_revision: 2,
        last_seen_at: "2026-07-25T00:00:00.000Z",
      })) as never,
  );
});

function load(): Promise<unknown> {
  return loadContentShadowInputs(exec, scope, projectId, body);
}

describe("canonical Action cardinality", () => {
  it("accepts the one canonical Action", async () => {
    await expect(load()).resolves.toMatchObject({
      actionId: ACTION_ID,
      findingId: FINDING_ID,
      contentBriefArtifactId: BRIEF_ID,
      contentBriefRevision: 2,
    });
  });

  it("answers 422 ACTION_NOT_EXECUTABLE when the Finding owns no live Action", async () => {
    // Reachable in the data model through dismiss -> re-confirm: the Finding is
    // confirmed while its only Action sits dismissed. The operator fixes it by
    // restoring the Action, so it is a 4xx, never a 5xx.
    vi.mocked(
      ActionsRepository.prototype.countActionsForFinding,
    ).mockResolvedValue(0);

    await expect(load()).rejects.toMatchObject({
      code: "ACTION_NOT_EXECUTABLE",
      status: 422,
    });
  });

  it("answers 409 FINDING_ACTION_ACTIVE when the Finding owns more than one live Action", async () => {
    vi.mocked(
      ActionsRepository.prototype.countActionsForFinding,
    ).mockResolvedValue(2);

    await expect(load()).rejects.toMatchObject({
      code: "FINDING_ACTION_ACTIVE",
      status: 409,
    });
  });
});

describe("frozen content brief admissibility", () => {
  it.each([
    { status: "archived", code: "brief_not_live" },
    { status: "failed", code: "brief_not_live" },
    { status: "generating", code: "brief_not_live" },
  ])("refuses a $status brief with $code", async ({ status, code }) => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findLiveByActionType,
    ).mockResolvedValue({ ...brief, status } as ArtifactRow);

    await expect(load()).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [expect.objectContaining({ pointer: "/actionId", code })],
    });
  });

  it("refuses a brief that has never produced a revision", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findLiveByActionType,
    ).mockResolvedValue({ ...brief, current_revision: 0 } as ArtifactRow);

    await expect(load()).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({
          pointer: "/actionId",
          code: "brief_missing_revision",
        }),
      ],
    });
  });

  it("refuses a brief whose last validation failed", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findLiveByActionType,
    ).mockResolvedValue({
      ...brief,
      validation_state: "invalid",
    } as ArtifactRow);

    await expect(load()).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({
          pointer: "/actionId",
          code: "brief_invalid",
        }),
      ],
    });
  });
});

describe("source lineage and rule scope", () => {
  it("reuses the artifact route's verbatim drift wording so one drift reads the same everywhere", async () => {
    vi.mocked(FindingsRepository.prototype.findById).mockResolvedValue({
      ...finding,
      last_seen_run_id: "00000000-0000-4000-8000-0000000000d2",
    } as FindingRow);

    await expect(load()).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      message:
        "Finding changed after this Action was created; review the current opportunity before generating an artifact.",
    });
  });

  it("refuses a Finding whose rule does not mint a content brief", async () => {
    vi.mocked(FindingsRepository.prototype.findById).mockResolvedValue({
      ...finding,
      rule_id: "TECH-HTTP-001",
    } as FindingRow);

    await expect(load()).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [
        expect.objectContaining({
          pointer: "/actionId",
          code: "rule_not_content",
        }),
      ],
    });
  });
});

describe("buildContentShadowFrozenInput observation separation", () => {
  const inputs = {
    siteId: "site-1",
    actionId: ACTION_ID,
    findingId: FINDING_ID,
    sourceDiagnosticRunId: DIAGNOSTIC_ID,
    contentBriefArtifactId: BRIEF_ID,
    contentBriefRevision: 2,
    competitorEntityIds: [],
    clusterKey: "growth-analytics",
    keywordEntityIds: [KEYWORD_ID],
    generativeQueryEntityIds: [GENERATIVE_ID],
    firstParty: {
      siteOrigin: SITE_ORIGIN,
      icpPrimaryConversionUrl: CONVERSION_URL,
    },
    contentBriefOutline: {
      briefSections: ["Objective", "Audience"],
      targetKeywords: [`keyword ${KEYWORD_ID}`],
      pageAssignment: "existing_page" as const,
    },
    researchContext: frozenResearchContext(),
  };

  it("changes the content address when the two identity sets are swapped", () => {
    // Invariant 8 is an ADDRESSING property, not only a validation one: a search
    // identity and a generative identity are different observations, so the
    // same ids in the opposite roles must freeze a different run.
    const straight = buildContentShadowFrozenInput({
      inputs,
      outputLocale: "en",
    });
    const swapped = buildContentShadowFrozenInput({
      inputs: {
        ...inputs,
        keywordEntityIds: [GENERATIVE_ID],
        generativeQueryEntityIds: [KEYWORD_ID],
        researchContext: frozenResearchContext(GENERATIVE_ID, KEYWORD_ID),
      },
      outputLocale: "en",
    });

    expect(swapped.contentHash).not.toBe(straight.contentHash);
    expect(swapped.manifest.searchCluster.keywordEntityIds).toEqual([
      GENERATIVE_ID,
    ]);
  });

  it("is stable for the identical tuple", () => {
    expect(
      buildContentShadowFrozenInput({ inputs, outputLocale: "en" }).contentHash,
    ).toBe(
      buildContentShadowFrozenInput({ inputs, outputLocale: "en" }).contentHash,
    );
  });
});

describe("brief -> draft structured extraction (Task 4b)", () => {
  it("freezes the brief's structure, normalized across locales, with zero extra reads", async () => {
    const listByIds = vi.mocked(KeywordsRepository.prototype.listByIds);
    const findRevision = vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    );

    const inputs = (await load()) as {
      readonly contentBriefOutline: {
        readonly briefSections: readonly string[];
        readonly targetKeywords: readonly string[];
        readonly pageAssignment: string;
      };
    };

    // `受众` is normalized onto the English canonical label so a zh-CN brief
    // and an English draft speak one closed vocabulary.
    expect(inputs.contentBriefOutline).toEqual({
      briefSections: ["Objective", "Audience"],
      targetKeywords: [`keyword ${KEYWORD_ID}`],
      pageAssignment: "existing_page",
    });
    // No extra query: the brief revision and the keyword rows were already read
    // for admission, so extraction is free.
    expect(findRevision).toHaveBeenCalledTimes(1);
    expect(listByIds).toHaveBeenCalledTimes(2);
  });

  it("degrades to an empty outline instead of refusing an unparseable brief", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValue({
      ...briefRevision,
      content_text: "# Only a title",
    } as ArtifactRevisionRow);

    const inputs = (await load()) as {
      readonly contentBriefOutline: {
        readonly briefSections: readonly string[];
      };
    };

    expect(inputs.contentBriefOutline.briefSections).toEqual([]);
  });

  it("re-addresses the run when a single brief heading is renamed", () => {
    const base = {
      siteId: "site-1",
      actionId: ACTION_ID,
      findingId: FINDING_ID,
      sourceDiagnosticRunId: DIAGNOSTIC_ID,
      contentBriefArtifactId: BRIEF_ID,
      contentBriefRevision: 2,
      competitorEntityIds: [],
      clusterKey: "growth-analytics",
      keywordEntityIds: [KEYWORD_ID],
      generativeQueryEntityIds: [GENERATIVE_ID],
      firstParty: {
        siteOrigin: SITE_ORIGIN,
        icpPrimaryConversionUrl: CONVERSION_URL,
      },
      contentBriefOutline: {
        briefSections: ["Objective", "Audience"],
        targetKeywords: ["a"],
        pageAssignment: "existing_page" as const,
      },
      researchContext: frozenResearchContext(),
    };

    const pinned = buildContentShadowFrozenInput({
      inputs: base,
      outputLocale: "en",
    });
    const renamed = buildContentShadowFrozenInput({
      inputs: {
        ...base,
        contentBriefOutline: {
          ...base.contentBriefOutline,
          briefSections: ["North Star Metric", "Audience"],
        },
      },
      outputLocale: "en",
    });

    expect(renamed.contentHash).not.toBe(pinned.contentHash);
  });

  it("pins the scoped Content Shadow prompt set, not the global one", () => {
    const frozen = buildContentShadowFrozenInput({
      inputs: {
        siteId: "site-1",
        actionId: ACTION_ID,
        findingId: FINDING_ID,
        sourceDiagnosticRunId: DIAGNOSTIC_ID,
        contentBriefArtifactId: BRIEF_ID,
        contentBriefRevision: 2,
        competitorEntityIds: [],
        clusterKey: "growth-analytics",
        keywordEntityIds: [KEYWORD_ID],
        generativeQueryEntityIds: [GENERATIVE_ID],
        firstParty: {
          siteOrigin: SITE_ORIGIN,
          icpPrimaryConversionUrl: CONVERSION_URL,
        },
        contentBriefOutline: {
          briefSections: [],
          targetKeywords: [],
          pageAssignment: "unassigned" as const,
        },
        researchContext: frozenResearchContext(),
      },
      outputLocale: "en",
    });

    expect(frozen.manifest.promptSetVersion).toBe(
      CONTENT_SHADOW_PROMPT_SET_VERSION,
    );
    expect(frozen.manifest.promptSetVersion).not.toBe(
      ENGINE_PROMPT_SET_VERSION,
    );
  });
});

describe("first-party identity is frozen at accept time (Task 6b)", () => {
  it("freezes the project's site origin and the frozen ICP conversion target", async () => {
    await expect(load()).resolves.toMatchObject({
      firstParty: {
        siteOrigin: SITE_ORIGIN,
        icpPrimaryConversionUrl: CONVERSION_URL,
      },
    });
  });

  it("freezes the absence of a conversion target rather than a placeholder", async () => {
    vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValue({
      id: ICP_ID,
      profile: { primaryConversion: null },
    } as never);

    await expect(load()).resolves.toMatchObject({
      firstParty: { icpPrimaryConversionUrl: null },
    });
  });

  it("refuses to freeze a tuple whose site row is unreadable", async () => {
    vi.mocked(SitesRepository.prototype.findById).mockResolvedValue(null);

    await expect(load()).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE" });
  });

  it("refuses to freeze a tuple whose frozen ICP profile is unreadable", async () => {
    vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValue(null);

    await expect(load()).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE" });
  });

  /**
   * Red line C. `sites.origin` is a mutable row, so an origin that moves inside
   * the accept -> claim window has to change the content address and fail the
   * run as drift, not silently re-judge the draft's links against a different
   * identity.
   */
  it("re-addresses the run when the site origin moves", () => {
    const base = {
      siteId: "site-1",
      actionId: ACTION_ID,
      findingId: FINDING_ID,
      sourceDiagnosticRunId: DIAGNOSTIC_ID,
      contentBriefArtifactId: BRIEF_ID,
      contentBriefRevision: 2,
      competitorEntityIds: [],
      clusterKey: "growth-analytics",
      keywordEntityIds: [KEYWORD_ID],
      generativeQueryEntityIds: [GENERATIVE_ID],
      firstParty: {
        siteOrigin: SITE_ORIGIN,
        icpPrimaryConversionUrl: CONVERSION_URL,
      },
      contentBriefOutline: {
        briefSections: ["Objective"],
        targetKeywords: ["a"],
        pageAssignment: "existing_page" as const,
      },
      researchContext: frozenResearchContext(),
    };

    const pinned = buildContentShadowFrozenInput({
      inputs: base,
      outputLocale: "en",
    });
    const rebranded = buildContentShadowFrozenInput({
      inputs: {
        ...base,
        firstParty: {
          siteOrigin: "https://acme-rebrand.example",
          icpPrimaryConversionUrl: CONVERSION_URL,
        },
      },
      outputLocale: "en",
    });

    expect(rebranded.contentHash).not.toBe(pinned.contentHash);
  });
});

describe("Task 6 governed research context", () => {
  it("freezes canonical first-party pages, search/generative facts, external targets and ICP policy", async () => {
    const inputs = (await load()) as {
      readonly researchContext: {
        readonly firstPartyPageSnapshots: readonly unknown[];
        readonly searchKeywordFacts: readonly Record<string, unknown>[];
        readonly generativeKeywordFacts: readonly Record<string, unknown>[];
        readonly externalTargets: readonly Record<string, unknown>[];
        readonly contentPolicy: Record<string, unknown>;
      };
    };

    expect(inputs.researchContext).toMatchObject({
      firstPartyPageSnapshots: [
        {
          pageSnapshotId: PAGE_SNAPSHOT_ID,
          dataSnapshotId: CRAWL_SNAPSHOT_ID,
          url: `${SITE_ORIGIN}/growth`,
          urlHash: "a".repeat(64),
          contentHash: "b".repeat(64),
          capturedAt: "2026-07-25T00:00:00.000Z",
        },
      ],
      searchKeywordFacts: [
        expect.objectContaining({
          id: KEYWORD_ID,
          display: `keyword ${KEYWORD_ID}`,
          market: "US",
          language: "en",
          mapping: {
            decision: "existing_page",
            mappedSitePageId: "00000000-0000-4000-8000-0000000000cc",
            reviewState: "confirmed",
            revision: 2,
          },
        }),
      ],
      generativeKeywordFacts: [
        expect.objectContaining({ id: GENERATIVE_ID }),
      ],
      externalTargets: [
        expect.objectContaining({
          ref: "content-brief-link:https://authority.example/benchmark",
          url: "https://authority.example/benchmark",
        }),
      ],
      contentPolicy: {
        brandConstraints: ["Use a calm, practical voice."],
        complianceConstraints: ["Qualify forward-looking statements."],
        prohibitedTerms: [],
        claimRestrictions: [
          "no_guarantees",
          "no_unsupported_quantified_claims",
          "no_unverified_superlatives",
        ],
      },
    });
    expect(
      PageSnapshotsRepository.prototype
        .listByDataSnapshotWithSitePageIdentity,
    ).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      CRAWL_SNAPSHOT_ID,
    );
  });

  it("re-addresses the run when a canonical keyword mapping changes", async () => {
    const before = await loadContentShadowInputs(
      exec,
      scope,
      projectId,
      body,
    );
    const initial = buildContentShadowFrozenInput({
      inputs: before,
      outputLocale: "en",
    });
    vi.mocked(KeywordsRepository.prototype.listByIds).mockImplementation(
      async (_scope, ids) =>
        ids.map((id) => ({
          id,
          query_kind:
            id === GENERATIVE_ID ? "generative_query" : "search_query",
          cluster_key: id === GENERATIVE_ID ? null : "growth-analytics",
          display_keyword: `keyword ${id}`,
          normalized_keyword: `keyword ${id}`,
          market: "US",
          language_tag: "en",
          intent: "commercial",
          buyer_stage: "consideration",
          mapping_decision: "existing_page",
          mapped_site_page_id: "00000000-0000-4000-8000-0000000000cc",
          mapping_review_state: "confirmed",
          mapping_revision: 3,
          last_seen_at: "2026-07-25T00:00:00.000Z",
        })) as never,
    );

    const after = await loadContentShadowInputs(
      exec,
      scope,
      projectId,
      body,
    );
    const replay = buildContentShadowFrozenInput({
      inputs: after,
      outputLocale: "en",
    });

    expect(replay.contentHash).not.toBe(initial.contentHash);
    expect(replay.manifest.researchContext.searchKeywordFacts[0]?.mapping)
      .toMatchObject({ revision: 3 });
  });

  it("re-reads and re-addresses canonical generative facts instead of copying the prior manifest", async () => {
    const first = await loadContentShadowInputs(
      exec,
      scope,
      projectId,
      body,
    );
    const initial = buildContentShadowFrozenInput({
      inputs: first,
      outputLocale: "en",
    });
    vi.mocked(KeywordsRepository.prototype.listByIds).mockImplementation(
      async (_scope, ids) =>
        ids.map((id) => ({
          id,
          query_kind:
            id === GENERATIVE_ID ? "generative_query" : "search_query",
          cluster_key: id === GENERATIVE_ID ? null : "growth-analytics",
          display_keyword:
            id === GENERATIVE_ID
              ? "updated generative prompt"
              : `keyword ${id}`,
          normalized_keyword: `keyword ${id}`,
          market: "US",
          language_tag: "en",
          intent: "commercial",
          buyer_stage: "consideration",
          mapping_decision: "existing_page",
          mapped_site_page_id: "00000000-0000-4000-8000-0000000000cc",
          mapping_review_state: "confirmed",
          mapping_revision: 2,
          last_seen_at: "2026-07-25T00:00:00.000Z",
        })) as never,
    );

    const reread = await loadContentShadowInputs(
      exec,
      scope,
      projectId,
      body,
    );
    const replay = buildContentShadowFrozenInput({
      inputs: reread,
      outputLocale: "en",
    });

    expect(replay.contentHash).not.toBe(initial.contentHash);
    expect(
      replay.manifest.researchContext.generativeKeywordFacts[0]?.display,
    ).toBe("updated generative prompt");
  });

  it("freezes canonical competitor facts and re-addresses a later competitor review revision", async () => {
    const competitor = {
      id: COMPETITOR_ID,
      domain: "competitor.example",
      name: "Competitor",
      review_status: "approved",
      relationship: "direct",
      analysis_scope: ["content", "keyword_gap"],
      revision: 1,
    };
    vi.mocked(
      CompetitorsRepository.prototype.listByIds,
    ).mockResolvedValue([competitor] as never);
    const withCompetitor = {
      ...body,
      competitorEntityIds: [COMPETITOR_ID],
    };
    const first = await loadContentShadowInputs(
      exec,
      scope,
      projectId,
      withCompetitor,
    );
    const initial = buildContentShadowFrozenInput({
      inputs: first,
      outputLocale: "en",
    });
    expect(initial.manifest.researchContext).toMatchObject({
      competitorFacts: [
        {
          id: COMPETITOR_ID,
          domain: "competitor.example",
          status: "approved",
          revision: 1,
        },
      ],
      externalTargets: expect.arrayContaining([
        {
          ref: `competitor-root:${COMPETITOR_ID}`,
          kind: "competitor_root",
          url: "https://competitor.example/",
          label: "Competitor",
        },
      ]),
    });

    vi.mocked(
      CompetitorsRepository.prototype.listByIds,
    ).mockResolvedValue([{ ...competitor, revision: 2 }] as never);
    const reread = await loadContentShadowInputs(
      exec,
      scope,
      projectId,
      withCompetitor,
    );
    const replay = buildContentShadowFrozenInput({
      inputs: reread,
      outputLocale: "en",
    });

    expect(replay.contentHash).not.toBe(initial.contentHash);
    expect(replay.manifest.researchContext.competitorFacts[0]?.revision).toBe(2);
  });

  it("sorts candidate external targets before the eight-target cap", async () => {
    const competitorIds = Array.from(
      { length: 10 },
      (_, index) =>
        `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
    );
    const competitors = competitorIds.map((id, index) => ({
      id,
      domain: `competitor-${String(index).padStart(2, "0")}.example`,
      name: `Competitor ${index}`,
      review_status: "approved",
      relationship: "direct",
      analysis_scope: ["content"],
      revision: 1,
    }));
    const withCompetitors = {
      ...body,
      competitorEntityIds: competitorIds,
    };
    vi.mocked(
      CompetitorsRepository.prototype.listByIds,
    ).mockResolvedValue([...competitors].reverse() as never);
    const reversed = await loadContentShadowInputs(
      exec,
      scope,
      projectId,
      withCompetitors,
    );

    vi.mocked(
      CompetitorsRepository.prototype.listByIds,
    ).mockResolvedValue(competitors as never);
    const forward = await loadContentShadowInputs(
      exec,
      scope,
      projectId,
      withCompetitors,
    );

    expect(reversed.researchContext.externalTargets).toEqual(
      forward.researchContext.externalTargets,
    );
    expect(reversed.researchContext.externalTargets).toHaveLength(8);
    expect(reversed.researchContext.externalTargets[0]?.ref).toBe(
      "content-brief-link:https://authority.example/benchmark",
    );
    expect(
      buildContentShadowFrozenInput({
        inputs: reversed,
        outputLocale: "en",
      }).contentHash,
    ).toBe(
      buildContentShadowFrozenInput({
        inputs: forward,
        outputLocale: "en",
      }).contentHash,
    );
  });

  it("fails closed when a pinned crawl page resolves to another site in the project", async () => {
    vi.mocked(
      PageSnapshotsRepository.prototype
        .listByDataSnapshotWithSitePageIdentity,
    ).mockResolvedValue([
      {
        page_snapshot_id: PAGE_SNAPSHOT_ID,
        data_snapshot_id: CRAWL_SNAPSHOT_ID,
        normalized_url: "https://other-site.example/page",
        normalized_url_hash: "a".repeat(64),
        content_hash: "b".repeat(64),
        captured_at: "2026-07-25T00:00:00.000Z",
        site_id: "site-2",
      },
    ] as never);

    await expect(load()).rejects.toMatchObject({
      code: "CONTEXT_INCOMPLETE",
    });
  });

  it("keeps upstream truncation visible in a closed body-free customer summary", () => {
    const projected = projectContentShadowPackSources({
      sources: [
        {
          kind: "external_page",
          ref: "target:one",
          authorityTier: "B",
          label: "Authority",
          url: "https://authority.example/report",
          availability: "partial",
          capturedAt: "2026-07-25T00:00:00.000Z",
          urlHash: "a".repeat(64),
          contentHash: "b".repeat(64),
          contentHashMethod: "sha256_normalized_text",
          contentText: "the complete retrieved body must stay server-side",
          contentTruncated: true,
          excerpt: "Bounded excerpt.",
          excerptTruncated: true,
          metrics: {
            status: 200,
            contentType: "text/html",
            bodyBytes: 1024,
            wordCount: 140,
            responseMs: 40,
            redirectChain: ["https://authority.example/report"],
          },
          evidenceRefs: ["target:one"],
          limitation: null,
        },
      ],
    });

    expect(projected).toEqual([
      {
        kind: "external_page",
        ref: "target:one",
        label: "Authority",
        url: "https://authority.example/report",
        availability: "partial",
        authorityTier: "B",
        capturedAt: "2026-07-25T00:00:00.000Z",
        contentHash: "b".repeat(64),
        contentHashMethod: "sha256_normalized_text",
        contentTruncated: true,
        excerpt: "Bounded excerpt.",
        excerptTruncated: true,
        metrics: {
          status: 200,
          contentType: "text/html",
          bodyBytes: 1024,
          wordCount: 140,
          responseMs: 40,
          redirectChain: ["https://authority.example/report"],
        },
        evidenceRefs: ["target:one"],
        limitation: null,
      },
    ]);
    expect(projected[0]).not.toHaveProperty("contentText");
    expect(projected[0]).not.toHaveProperty("urlHash");
  });

  it("fails closed instead of presenting an unreadable source pack as empty", () => {
    expect(() =>
      projectContentShadowPackSources({
        sources: [{ kind: "external_page", contentText: "body only" }],
      }),
    ).toThrow(/research sources are unreadable/i);
  });

  it("projects the repository's complete newest-first revision ledger", () => {
    const rows = [
      {
        revision: 3,
        content_hash: "c".repeat(64),
        generated_by: "human",
        editor_id: "00000000-0000-4000-8000-0000000000ce",
        note: "Final proof edit.",
        validation_errors: [],
        created_at: "2026-07-25T03:00:00.000Z",
      },
      {
        revision: 2,
        content_hash: "b".repeat(64),
        generated_by: "human",
        editor_id: "00000000-0000-4000-8000-0000000000cd",
        note: null,
        validation_errors: [{ code: "warning" }],
        created_at: "2026-07-25T02:00:00.000Z",
      },
      {
        revision: 1,
        content_hash: "a".repeat(64),
        generated_by: "llm",
        editor_id: null,
        note: null,
        validation_errors: [],
        created_at: "2026-07-25T01:00:00.000Z",
      },
    ];

    expect(projectContentShadowRevisionHistory(rows as never)).toEqual([
      expect.objectContaining({ revision: 3, validationErrorCount: 0 }),
      expect.objectContaining({ revision: 2, validationErrorCount: 1 }),
      expect.objectContaining({ revision: 1, validationErrorCount: 0 }),
    ]);
    expect(() =>
      projectContentShadowRevisionHistory([...rows].reverse() as never),
    ).toThrow(/newest-first/i);
    expect(() =>
      projectContentShadowRevisionHistory([rows[0], rows[2]] as never),
    ).toThrow(/complete/i);
    expect(() =>
      projectContentShadowRevisionHistory([rows[0], rows[1]] as never),
    ).toThrow(/incomplete/i);
  });
});

describe("Task 6 frozen manifest read integrity", () => {
  const manifest = () => ({
    sourceDiagnosticRunId: DIAGNOSTIC_ID,
    competitorEntityIds: [],
    searchCluster: {
      clusterKey: "growth-analytics",
      keywordEntityIds: [KEYWORD_ID],
    },
    generativeQueryEntityIds: [GENERATIVE_ID],
    firstParty: {
      siteOrigin: SITE_ORIGIN,
      icpPrimaryConversionUrl: CONVERSION_URL,
    },
    contentBriefOutline: {
      briefSections: ["Objective"],
      targetKeywords: [`keyword ${KEYWORD_ID}`],
      pageAssignment: "existing_page",
    },
    researchContext: frozenResearchContext(),
  });

  it("projects an intact frozen manifest through the strict contract", () => {
    expect(
      projectContentShadowFrozenInputs(manifest(), FINDING_ID),
    ).toMatchObject({
      primaryFindingId: FINDING_ID,
      searchCluster: { keywordEntityIds: [KEYWORD_ID] },
      generativeQueryEntityIds: [GENERATIVE_ID],
    });
  });

  it.each([
    {
      label: "non-array competitor identities",
      mutate: (value: ReturnType<typeof manifest>) => {
        (value as Record<string, unknown>)["competitorEntityIds"] =
          "not-an-array";
      },
    },
    {
      label: "mixed search identity members",
      mutate: (value: ReturnType<typeof manifest>) => {
        value.searchCluster.keywordEntityIds = [KEYWORD_ID, 42] as never;
      },
    },
    {
      label: "mixed generative identity members",
      mutate: (value: ReturnType<typeof manifest>) => {
        value.generativeQueryEntityIds = [GENERATIVE_ID, 42] as never;
      },
    },
    {
      label: "duplicate search identities",
      mutate: (value: ReturnType<typeof manifest>) => {
        value.searchCluster.keywordEntityIds = [KEYWORD_ID, KEYWORD_ID];
      },
    },
    {
      label: "empty search identities",
      mutate: (value: ReturnType<typeof manifest>) => {
        value.searchCluster.keywordEntityIds = [];
        value.researchContext.searchKeywordFacts = [];
      },
    },
    {
      label: "duplicate competitor identities",
      mutate: (value: ReturnType<typeof manifest>) => {
        value.competitorEntityIds = [
          COMPETITOR_ID,
          COMPETITOR_ID,
        ] as never;
        value.researchContext.competitorFacts = [
          {
            id: COMPETITOR_ID,
            domain: "competitor.example",
            name: "Competitor",
            status: "approved",
            relationship: "direct",
            scopes: ["content"],
            revision: 1,
          },
        ] as never;
      },
    },
    {
      label: "duplicate research fact identities",
      mutate: (value: ReturnType<typeof manifest>) => {
        value.researchContext.searchKeywordFacts = [
          ...value.researchContext.searchKeywordFacts,
          ...value.researchContext.searchKeywordFacts,
        ];
      },
    },
    {
      label: "mixed brief sections",
      mutate: (value: ReturnType<typeof manifest>) => {
        value.contentBriefOutline.briefSections = ["Objective", 42] as never;
      },
    },
    {
      label: "mixed target keywords",
      mutate: (value: ReturnType<typeof manifest>) => {
        value.contentBriefOutline.targetKeywords = ["growth", 42] as never;
      },
    },
  ])("fails closed for $label", ({ mutate }) => {
    const corrupted = manifest();
    mutate(corrupted);
    expect(() =>
      projectContentShadowFrozenInputs(corrupted, FINDING_ID),
    ).toThrow(/frozen Content Shadow (?:manifest|research context) is unreadable/i);
  });
});
