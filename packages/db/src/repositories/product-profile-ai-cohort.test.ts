import { describe, expect, it, vi } from "vitest";
import {
  canonicalProductProfileSiteLanguageTag,
  ProductProfileAiCohortRepository,
  deriveConfirmedProductProfileGenerativeQueries,
  type ProductProfileAiCohortBootstrapInput,
  type DerivedProductProfileGenerativeQuery,
  type ProductProfileGenerativeQueryProfile,
} from "./product-profile-ai-cohort.ts";

describe("canonicalProductProfileSiteLanguageTag", () => {
  it.each([
    ["en-us", "en-US"],
    ["ZH-hans-cn-u-nu-hanidec", "zh-Hans-CN-u-nu-hanidec"],
    ["iw-IL", null],
    [" en-us", null],
    ["not_a_locale", null],
  ] as const)(
    "returns %s only when %s differs from Intl canonical form by case",
    (rawLanguageTag, expected) => {
      expect(canonicalProductProfileSiteLanguageTag(rawLanguageTag)).toBe(
        expected,
      );
    },
  );
});

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
};

class SelfTransactionalExecutor {
  transactionCalls = 0;

  async transaction<T>(run: (tx: never) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    if (this.transactionCalls > 1) {
      throw new Error("nested transaction recursion");
    }
    return run(this as never);
  }
}

function profile(
  overrides: Partial<ProductProfileGenerativeQueryProfile> = {},
): ProductProfileGenerativeQueryProfile {
  return {
    productName: "RelayOps",
    category: "Customer onboarding",
    productType: "B2B SaaS",
    valueProposition:
      "Help operations teams standardize customer onboarding.",
    coreFeatures: ["Workflow automation", "Implementation tracking"],
    targetAudiences: [
      {
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies with 50-500 employees",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize customer onboarding"],
        triggers: ["Onboarding volume increased"],
        pains: ["Manual handoffs"],
        jtbd: ["Reduce time to value"],
      },
    ],
    competitorCandidates: [
      {
        reviewStatus: "approved",
        name: "Userpilot",
        domain: "userpilot.com",
      },
      {
        reviewStatus: "candidate",
        name: "GuideCX",
        domain: "guidecx.com",
      },
    ],
    ...overrides,
  };
}

function bootstrapInput(
  overrides: Partial<ProductProfileAiCohortBootstrapInput> = {},
): ProductProfileAiCohortBootstrapInput {
  return {
    confirmedProfileId: "00000000-0000-4000-8000-000000000010",
    confirmedProfileVersion: 4,
    confirmedProfileContentHash: "a".repeat(64),
    confirmedAt: "2026-08-09T09:30:00.000Z",
    marketCode: "US",
    languageTag: "en-US",
    profile: profile(),
    ...overrides,
  };
}

describe("deriveConfirmedProductProfileGenerativeQueries", () => {
  it("returns exactly 20 deterministic, deduplicated queries for supported locales", () => {
    const first = deriveConfirmedProductProfileGenerativeQueries(
      bootstrapInput(),
    );
    const second = deriveConfirmedProductProfileGenerativeQueries(
      bootstrapInput(),
    );

    expect(first.status).toBe("ready");
    expect(second).toEqual(first);
    if (first.status !== "ready") return;
    expect(first.queries).toHaveLength(20);
    expect(
      new Set(first.queries.map((query) => query.normalizedKeyword)).size,
    ).toBe(20);
    expect(first.queries.every((query) => query.displayKeyword.length <= 500)).toBe(
      true,
    );
    expect(
      first.queries.some((query) =>
        query.sourceRef.includes(
          "#profile-generative-query.v1/compare-approved-competitor-1",
        ),
      ),
    ).toBe(true);
    expect(
      first.queries.some((query) =>
        query.displayKeyword.includes("GuideCX"),
      ),
    ).toBe(false);
  });

  it("fails closed when the locale family is unsupported or distinct queries underflow", () => {
    expect(
      deriveConfirmedProductProfileGenerativeQueries(
        bootstrapInput({ languageTag: "fr-FR" }),
      ),
    ).toMatchObject({ status: "skipped_unsupported_locale" });
    expect(
      deriveConfirmedProductProfileGenerativeQueries(
        bootstrapInput({
          profile: profile({
            targetAudiences: [],
            competitorCandidates: [],
          }),
        }),
      ),
    ).toMatchObject({ status: "skipped_inexact_generation" });
  });
});

describe("ProductProfileAiCohortRepository", () => {
  it("returns a typed skip when the project already has any GenerativeQuery", async () => {
    const repo = new ProductProfileAiCohortRepository(
      {} as never,
      {
        countGenerativeQueries: vi.fn().mockResolvedValue(19),
        upsertManyIntoLibrary: vi.fn(),
        listKeywordsByIds: vi.fn(),
        applySystemApprovals: vi.fn(),
        assertConfirmedProfileIdentity: vi.fn().mockResolvedValue(undefined),
      },
    );

    await expect(
      repo.bootstrapConfirmedProfileGenerativeQueries(
        scope,
        bootstrapInput(),
      ),
    ).resolves.toMatchObject({
      status: "skipped_existing_queries",
      existingQueryCount: 19,
      bootstrappedCount: 0,
    });
  });

  it("materializes and system-approves exactly 20 Product Profile queries with referential provenance", async () => {
    const exec = new SelfTransactionalExecutor();
    const countGenerativeQueries = vi.fn().mockResolvedValue(0);
    const assertConfirmedProfileIdentity = vi.fn().mockResolvedValue(undefined);
    const upsertManyIntoLibrary = vi
      .fn()
      .mockImplementation(async (_scope, inputs: readonly DerivedProductProfileGenerativeQuery[] | readonly { sourceRef: string }[]) =>
        inputs.map((_input: unknown, index: number) => ({
          occurrenceId: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000111`,
          entityId: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000001`,
        })),
      );
    const listKeywordsByIds = vi.fn().mockImplementation(async (_scope, entityIds) =>
      entityIds.map((entityId: string, index: number) => ({
        id: entityId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        display_keyword: `query ${index + 1}`,
        normalized_keyword: `query ${index + 1}`,
        market: "US",
        language_tag: "en-US",
        query_kind: "generative_query",
        status: "candidate",
        intent: null,
        buyer_stage: null,
        cluster_key: null,
        mapping_decision: "unassigned",
        mapped_site_page_id: null,
        mapping_review_state: "unreviewed",
        mapping_revision: 0,
        first_seen_at: "2026-08-09T09:30:00.000Z",
        last_seen_at: "2026-08-09T09:30:00.000Z",
        created_at: "2026-08-09T09:30:00.000Z",
        updated_at: "2026-08-09T09:30:00.000Z",
      })),
    );
    const applySystemApprovals = vi.fn().mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        keywordId: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000001`,
        applied: true,
        skipped: null,
        governanceRevision: 1,
      })),
    );
    const repo = new ProductProfileAiCohortRepository(
      exec as never,
      {
        countGenerativeQueries,
        upsertManyIntoLibrary,
        listKeywordsByIds,
        applySystemApprovals,
        assertConfirmedProfileIdentity,
      },
    );

    const result = await repo.bootstrapConfirmedProfileGenerativeQueries(
      scope,
      bootstrapInput(),
    );

    expect(result).toMatchObject({
      status: "bootstrapped",
      bootstrappedCount: 20,
      existingQueryCount: 0,
    });
    expect(exec.transactionCalls).toBe(1);
    expect(assertConfirmedProfileIdentity).toHaveBeenCalledTimes(1);
    expect(countGenerativeQueries).toHaveBeenCalledTimes(1);
    expect(upsertManyIntoLibrary).toHaveBeenCalledTimes(1);
    expect(upsertManyIntoLibrary).toHaveBeenCalledWith(
      scope,
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "product_profile",
          scopeBasis: "project_context",
          productProfileId: "00000000-0000-4000-8000-000000000010",
          dataSnapshotId: null,
          normalizedObservationId: null,
          sourcePointer: null,
        }),
      ]),
    );
    expect(applySystemApprovals).toHaveBeenCalledWith(
      scope,
      expect.arrayContaining([
        expect.objectContaining({
          expectedGovernanceRevision: 0,
          mappingDecision: "unassigned",
          mappedSitePageId: null,
        }),
      ]),
    );
    expect(applySystemApprovals).toHaveBeenCalledTimes(1);
    expect(applySystemApprovals.mock.calls[0]?.[1]).toHaveLength(20);
  });

  it("propagates a batch failure from the single atomic transaction without approving a partial cohort", async () => {
    const exec = new SelfTransactionalExecutor();
    const batchError = new Error("batch write failed");
    const upsertManyIntoLibrary = vi.fn().mockRejectedValue(batchError);
    const applySystemApprovals = vi.fn();
    const repo = new ProductProfileAiCohortRepository(exec as never, {
      countGenerativeQueries: vi.fn().mockResolvedValue(0),
      upsertManyIntoLibrary,
      listKeywordsByIds: vi.fn(),
      applySystemApprovals,
      assertConfirmedProfileIdentity: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      repo.bootstrapConfirmedProfileGenerativeQueries(scope, bootstrapInput()),
    ).rejects.toBe(batchError);
    expect(exec.transactionCalls).toBe(1);
    expect(upsertManyIntoLibrary).toHaveBeenCalledTimes(1);
    expect(applySystemApprovals).not.toHaveBeenCalled();
  });
});
