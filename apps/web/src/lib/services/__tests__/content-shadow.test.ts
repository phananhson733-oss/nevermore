import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  CompetitorsRepository,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  IcpProfilesRepository,
  KeywordsRepository,
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

const { buildContentShadowFrozenInput, loadContentShadowInputs } =
  await import("../content-shadow.ts");

const scope = { workspaceId: "workspace-1" };
const projectId = "project-1";
const exec = {} as Executor;

const ACTION_ID = "00000000-0000-4000-8000-0000000000a1";
const FINDING_ID = "00000000-0000-4000-8000-0000000000f1";
const DIAGNOSTIC_ID = "00000000-0000-4000-8000-0000000000d1";
const BRIEF_ID = "00000000-0000-4000-8000-0000000000b1";
const KEYWORD_ID = "00000000-0000-4000-8000-0000000000e1";
const GENERATIVE_ID = "00000000-0000-4000-8000-0000000000c1";
const ICP_ID = "00000000-0000-4000-8000-0000000000c9";
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
    },
  } as never);
  vi.spyOn(CompetitorsRepository.prototype, "listByIds").mockResolvedValue([]);
  vi.spyOn(KeywordsRepository.prototype, "listByIds").mockImplementation(
    async (_scope, ids) =>
      ids.map((id) => ({
        id,
        query_kind: id === GENERATIVE_ID ? "generative_query" : "search_query",
        cluster_key: id === GENERATIVE_ID ? null : "growth-analytics",
        display_keyword: `keyword ${id}`,
        normalized_keyword: `keyword ${id}`,
        mapping_decision: "existing_page",
        mapping_review_state: "confirmed",
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
