import {
  createInitialProductProfileDraft,
  type ProductProfileDraft,
} from "@sf/contracts";
import { contentHash, type CanonicalValue } from "@sf/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  site: "00000000-0000-4000-8000-000000000003",
  actor: "00000000-0000-4000-8000-000000000004",
  current: "00000000-0000-4000-8000-000000000005",
  confirmed: "00000000-0000-4000-8000-000000000006",
  candidate: "00000000-0000-4000-8000-000000000007",
  evidence: "00000000-0000-8000-8000-000000000008",
  run: "00000000-0000-4000-8000-000000000009",
} as const;

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  projectFind: vi.fn(),
  projectLock: vi.fn(),
  setCurrent: vi.fn(),
  setConfirmed: vi.fn(),
  setReady: vi.fn(),
  profileFind: vi.fn(),
  profileFindHash: vi.fn(),
  profileMaxVersion: vi.fn(),
  profileInsert: vi.fn(),
  profileProvenancePreflight: vi.fn(),
  activeFind: vi.fn(),
  updateMarkets: vi.fn(),
  competitorUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: { transaction: mocks.transaction } }),
}));

vi.mock("@sf/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/db")>();
  return {
    ...actual,
    ProjectsRepository: class {
      findById = mocks.projectFind;
      findByIdForUpdate = mocks.projectLock;
      setCurrentIcpProfile = mocks.setCurrent;
      setConfirmedIcpProfile = mocks.setConfirmed;
      setReadyToDiagnoseIfEligible = mocks.setReady;
    },
    IcpProfilesRepository: class {
      findById = mocks.profileFind;
      findByContentHash = mocks.profileFindHash;
      maxVersion = mocks.profileMaxVersion;
      insertVersion = mocks.profileInsert;
      preflightProductProfileProvenance = mocks.profileProvenancePreflight;
    },
    AsyncRunsRepository: class {
      findActive = mocks.activeFind;
    },
    SitesRepository: class {
      updatePrimaryMarketCodes = mocks.updateMarkets;
    },
    CompetitorsRepository: class {
      upsertOrigin = mocks.competitorUpsert;
    },
  };
});

const service = await import("./product-profile");

const scope = { workspaceId: ids.workspace };
const createdAt = "2026-07-22T08:00:00.000Z";

function draft(): ProductProfileDraft {
  return createInitialProductProfileDraft({
    sourceSiteId: ids.site,
    sourcePageUrl: "https://example.com/product",
    businessHint: "B2B onboarding software",
  });
}

function completeDraft(): ProductProfileDraft {
  return service.applyProductProfileEditablePatch(draft(), {
    productName: "RelayOps",
    oneLiner: "Automate customer onboarding operations.",
    category: "Customer onboarding",
    productType: "B2B SaaS",
    businessModels: ["subscription"],
    valueProposition: "Help operations teams standardize onboarding.",
    coreFeatures: ["Workflow automation"],
    targetMarkets: [
      { marketCode: "US", priority: "primary" },
      { marketCode: "GB", priority: "secondary" },
    ],
    targetAudiences: [
      {
        candidateId: "00000000-0000-4000-8000-000000000010",
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies with 50-500 employees",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize customer onboarding"],
        triggers: ["Onboarding volume increased"],
        pains: ["Manual handoffs"],
        jtbd: ["Reduce time to value"],
        outcomes: ["Faster activation"],
        barriers: ["Fragmented systems"],
        qualificationSignals: ["Dedicated customer operations team"],
        disqualifiers: [],
      },
    ],
  });
}

function row(
  profile: Record<string, unknown>,
  options: {
    id?: string;
    version?: number;
    status?: "draft" | "complete";
    hash?: string;
    createdAt?: string;
  } = {},
) {
  return {
    id: options.id ?? ids.current,
    workspace_id: ids.workspace,
    project_id: ids.project,
    version: options.version ?? 3,
    status: options.status ?? "draft",
    profile,
    content_hash: options.hash ?? "a".repeat(64),
    created_by: ids.actor,
    created_at: options.createdAt ?? createdAt,
  };
}

function project(options: {
  currentId?: string | null;
  confirmedId?: string | null;
  archived?: boolean;
} = {}) {
  return {
    id: ids.project,
    workspace_id: ids.workspace,
    current_icp_profile_id:
      options.currentId === undefined ? ids.current : options.currentId,
    confirmed_icp_profile_id: options.confirmedId ?? null,
    archived_at: options.archived ? createdAt : null,
  };
}

function activeRun(kind = "product_profile_synthesis", status = "queued") {
  return {
    id: ids.run,
    workspace_id: ids.workspace,
    project_id: ids.project,
    kind,
    status,
    active_key: "product-profile:synthesis",
    contract_version: "0.3.0",
    request_payload: {},
    progress: {},
    last_error_code: null,
    last_error_summary: null,
    result_type: null,
    result_id: null,
    attempt_count: 0,
    initiated_by: ids.actor,
    queued_at: createdAt,
    started_at: null,
    completed_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback) => callback({}));
  mocks.setCurrent.mockResolvedValue(true);
  mocks.setConfirmed.mockResolvedValue(true);
  mocks.setReady.mockResolvedValue(false);
  mocks.profileFindHash.mockResolvedValue(null);
  mocks.profileMaxVersion.mockResolvedValue(3);
  mocks.profileProvenancePreflight.mockImplementation(async (_scope, profile) => ({
    ok: true,
    profile,
    canonicalRefs: {
      sourceSiteId: profile.sourceSiteId,
      sourceSnapshotId: profile.sourceSnapshotId,
      analysisInvocationId: profile.analysisInvocationId,
      pageSnapshotIds: [],
      observationIds: [],
    },
  }));
  mocks.updateMarkets.mockResolvedValue(undefined);
  mocks.activeFind.mockResolvedValue(null);
  mocks.competitorUpsert.mockResolvedValue({
    occurrenceId: "00000000-0000-4000-8000-000000000030",
    competitorId: "00000000-0000-4000-8000-000000000031",
  });
});

describe("getProductProfileWorkspace", () => {
  it("does not expose legacy opaque ICP rows as a Product Profile", async () => {
    mocks.projectFind.mockResolvedValue(
      project({ currentId: ids.current, confirmedId: ids.confirmed }),
    );
    mocks.profileFind
      .mockResolvedValueOnce(row({ legacy: true }))
      .mockResolvedValueOnce(
        row(
          { marketCodes: ["US"] },
          { id: ids.confirmed, status: "complete" },
        ),
      );

    await expect(
      service.getProductProfileWorkspace(scope, ids.project),
    ).resolves.toEqual({
      projectId: ids.project,
      currentProfile: null,
      confirmedProfile: null,
      activeSynthesisRun: null,
      activeCrawlRun: null,
    });
  });

  it("returns explicit DTO flags and only the canonical active synthesis run", async () => {
    const current = row(draft());
    mocks.projectFind.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(current);
    mocks.activeFind.mockResolvedValue(activeRun());

    const result = await service.getProductProfileWorkspace(scope, ids.project);

    expect(mocks.activeFind).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      "product-profile:synthesis",
    );
    expect(mocks.activeFind).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      "collect:crawl:site_graph",
    );
    expect(result.currentProfile).toMatchObject({
      id: ids.current,
      status: "draft",
      isCurrent: true,
      isConfirmed: false,
    });
    expect(result.activeSynthesisRun).toMatchObject({
      id: ids.run,
      kind: "product_profile_synthesis",
      status: "queued",
      resultRef: null,
    });

    mocks.activeFind.mockResolvedValue(activeRun("diagnostic"));
    await expect(
      service.getProductProfileWorkspace(scope, ids.project),
    ).resolves.toMatchObject({ activeSynthesisRun: null });
  });

  it("returns the canonical active Crawl so onboarding can recover after refresh", async () => {
    mocks.projectFind.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(draft()));
    mocks.activeFind.mockImplementation(async (_scope, activeKey) =>
      activeKey === "collect:crawl:site_graph"
        ? activeRun("collection", "running")
        : null,
    );

    await expect(
      service.getProductProfileWorkspace(scope, ids.project),
    ).resolves.toMatchObject({
      activeSynthesisRun: null,
      activeCrawlRun: {
        id: ids.run,
        kind: "collection",
        status: "running",
        resultRef: null,
      },
    });
  });

  it("normalizes PostgreSQL timestamptz text before returning a profile DTO", async () => {
    mocks.projectFind.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(
      row(draft(), { createdAt: "2026-07-22 17:04:27.563162+08" }),
    );

    const result = await service.getProductProfileWorkspace(scope, ids.project);

    expect(result.currentProfile?.createdAt).toBe(
      "2026-07-22T09:04:27.563162Z",
    );
  });

  it("maps one confirmed row explicitly as both current and confirmed", async () => {
    const confirmed = row(completeDraft(), {
      id: ids.confirmed,
      status: "complete",
    });
    mocks.projectFind.mockResolvedValue(
      project({ currentId: ids.confirmed, confirmedId: ids.confirmed }),
    );
    mocks.profileFind.mockResolvedValue(confirmed);

    const result = await service.getProductProfileWorkspace(scope, ids.project);

    expect(result.currentProfile).toMatchObject({
      id: ids.confirmed,
      status: "complete",
      isCurrent: true,
      isConfirmed: true,
    });
    expect(result.confirmedProfile).toMatchObject({
      id: ids.confirmed,
      status: "complete",
      isCurrent: true,
      isConfirmed: true,
    });
    expect(mocks.profileFind).toHaveBeenCalledOnce();
  });

  it("uses workspace scope and returns NOT_FOUND for a foreign project", async () => {
    mocks.projectFind.mockResolvedValue(null);
    await expect(
      service.getProductProfileWorkspace(scope, ids.project),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("returns an empty workspace when no Product Profile pointers exist", async () => {
    mocks.projectFind.mockResolvedValue(
      project({ currentId: null, confirmedId: null }),
    );
    mocks.activeFind.mockResolvedValue(activeRun("product_profile_synthesis", "completed"));

    await expect(
      service.getProductProfileWorkspace(scope, ids.project),
    ).resolves.toEqual({
      projectId: ids.project,
      currentProfile: null,
      confirmedProfile: null,
      activeSynthesisRun: null,
      activeCrawlRun: null,
    });
    expect(mocks.profileFind).not.toHaveBeenCalled();
  });
});

describe("updateProductProfileDraft", () => {
  it("records customer model and growth objective edits with server-owned userEdit provenance", () => {
    const updated = service.applyProductProfileEditablePatch(draft(), {
      customerModel: "b2b",
      growthObjectives: [
        "increase_signups",
        "generate_qualified_leads",
      ],
    });

    expect(updated).toMatchObject({
      customerModel: "b2b",
      growthObjectives: [
        "increase_signups",
        "generate_qualified_leads",
      ],
    });
    for (const path of ["/customerModel", "/growthObjectives"]) {
      expect(
        updated.fieldProvenance.find((entry) => entry.path === path),
      ).toMatchObject({
        derivation: "declared",
        confidence: "high",
        evidenceRefs: [{ kind: "userEdit" }],
        limitation: expect.stringContaining("not independently observed"),
        observedAt: null,
      });
    }
  });

  it("rewrites patched provenance and missing/conflict markers without inventing evidence", async () => {
    const customerEdited = service.applyProductProfileEditablePatch(draft(), {
      productName: "Observed name",
      coreFeatures: ["Conflicted feature"],
    });
    const base = {
      ...customerEdited,
      conflictingFields: ["/productName", "/coreFeatures/0"],
    } satisfies ProductProfileDraft;
    const current = row(base);
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(current);
    mocks.profileInsert.mockImplementation(async (values) =>
      row(values.profile, {
        id: "00000000-0000-4000-8000-000000000011",
        version: values.version,
        hash: values.contentHash,
      }),
    );

    const result = await service.updateProductProfileDraft(
      scope,
      ids.project,
      ids.actor,
      {
        baseVersion: 3,
        patch: { productName: null, coreFeatures: ["Automated handoffs"] },
      },
    );

    const profile = result.profile;
    expect(profile.productName).toBeNull();
    expect(profile.coreFeatures).toEqual(["Automated handoffs"]);
    expect(profile.missingFields).toContain("/productName");
    expect(profile.missingFields).not.toContain("/coreFeatures");
    expect(profile.conflictingFields).not.toContain("/productName");
    expect(profile.conflictingFields).not.toContain("/coreFeatures/0");
    expect(
      profile.fieldProvenance.some((entry) =>
        entry.path.startsWith("/productName"),
      ),
    ).toBe(false);
    expect(
      profile.fieldProvenance.find((entry) => entry.path === "/coreFeatures"),
    ).toMatchObject({
      derivation: "declared",
      confidence: "high",
      evidenceRefs: [{ kind: "userEdit" }],
      limitation: expect.stringContaining("not independently observed"),
      observedAt: null,
    });
    expect(mocks.setCurrent).toHaveBeenCalledWith(
      scope,
      ids.project,
      result.id,
    );
    expect(mocks.setConfirmed).not.toHaveBeenCalled();
  });

  it("reuses a semantic no-op row and rejects stale baseVersion", async () => {
    const initial = draft();
    const edited = service.applyProductProfileEditablePatch(initial, {
      businessHint: "B2B onboarding software",
    });
    expect(
      service.applyProductProfileEditablePatch(edited, {
        businessHint: "B2B onboarding software",
      }),
    ).toEqual(edited);

    const current = row(edited, {
      hash: contentHash({
        status: "draft",
        profile: edited as unknown as CanonicalValue,
      }),
    });
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(current);
    mocks.profileFindHash.mockResolvedValue(current);

    const result = await service.updateProductProfileDraft(
      scope,
      ids.project,
      ids.actor,
      { baseVersion: 3, patch: { businessHint: "B2B onboarding software" } },
    );

    expect(result.id).toBe(current.id);
    expect(mocks.profileInsert).not.toHaveBeenCalled();
    expect(mocks.setCurrent).not.toHaveBeenCalled();

    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(current);
    await expect(
      service.updateProductProfileDraft(scope, ids.project, ids.actor, {
        baseVersion: 2,
        patch: { productName: "stale" },
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("repoints current to an existing immutable row when a customer reverts exactly", async () => {
    const olderProfile = service.applyProductProfileEditablePatch(draft(), {
      productName: "Earlier name",
    });
    const currentProfile = service.applyProductProfileEditablePatch(
      olderProfile,
      { productName: "Current name" },
    );
    const current = row(currentProfile);
    const older = row(olderProfile, {
      id: "00000000-0000-4000-8000-000000000012",
      version: 1,
      hash: contentHash({
        status: "draft",
        profile: olderProfile as unknown as CanonicalValue,
      }),
    });
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(current);
    mocks.profileFindHash.mockResolvedValue(older);

    const result = await service.updateProductProfileDraft(
      scope,
      ids.project,
      ids.actor,
      { baseVersion: 3, patch: { productName: "Earlier name" } },
    );

    expect(result.id).toBe(older.id);
    expect(result.profile).toEqual(olderProfile);
    expect(mocks.profileInsert).not.toHaveBeenCalled();
    expect(mocks.setCurrent).toHaveBeenCalledWith(
      scope,
      ids.project,
      older.id,
    );
  });

  it("rejects archived projects before mutation", async () => {
    mocks.projectLock.mockResolvedValue(project({ archived: true }));
    await expect(
      service.updateProductProfileDraft(scope, ids.project, ids.actor, {
        baseVersion: 3,
        patch: { productName: "No mutation" },
      }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", status: 422 });
    expect(mocks.profileInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["missing pointer", project({ currentId: null }), null],
    ["missing row", project(), null],
    [
      "complete current row",
      project(),
      row(completeDraft(), { status: "complete" }),
    ],
    ["legacy opaque row", project(), row({ legacy: true })],
  ])("fails closed for %s", async (_case, lockedProject, currentRow) => {
    mocks.projectLock.mockResolvedValue(lockedProject);
    mocks.profileFind.mockResolvedValue(currentRow);

    await expect(
      service.updateProductProfileDraft(scope, ids.project, ids.actor, {
        baseVersion: 3,
        patch: { productName: "No mutation" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("validates the contract again at the service boundary", async () => {
    await expect(
      service.updateProductProfileDraft(scope, ids.project, ids.actor, {
        baseVersion: 3,
        patch: { sourceSnapshotId: ids.current },
      } as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("competitor lifecycle", () => {
  function withCandidate(): ProductProfileDraft {
    const base = draft();
    return {
      ...base,
      competitorCandidates: [
        {
          candidateId: ids.candidate,
          name: "Existing competitor",
          domain: "competitor.example",
          relationship: null,
          analysisScope: [],
          similarity: 0.62,
          reason: "Observed in product copy.",
          reviewStatus: "candidate",
          confidence: "medium",
        },
      ],
      fieldProvenance: [
        ...base.fieldProvenance,
        {
          path: "/competitorCandidates/0",
          derivation: "declared",
          confidence: "high",
          evidenceRefs: [
            { evidenceRefId: ids.evidence, kind: "userEdit" },
          ],
          limitation: "Customer-declared competitor; not independently observed.",
          observedAt: null,
        },
      ],
      missingFields: base.missingFields.filter(
        (path) => path !== "/competitorCandidates",
      ),
    };
  }

  it("requires effective relationship and scope before approval", async () => {
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(withCandidate()));

    await expect(
      service.reviewProductProfileCompetitor(
        scope,
        ids.project,
        ids.candidate,
        ids.actor,
        { baseVersion: 3, reviewStatus: "approved" },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("preserves server-owned candidate identity and records the customer review", async () => {
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(withCandidate()));
    mocks.profileInsert.mockImplementation(async (values) =>
      row(values.profile, {
        id: "00000000-0000-4000-8000-000000000013",
        version: values.version,
        hash: values.contentHash,
      }),
    );

    const result = await service.reviewProductProfileCompetitor(
      scope,
      ids.project,
      ids.candidate,
      ids.actor,
      {
        baseVersion: 3,
        reviewStatus: "approved",
        relationship: "direct",
        analysisScope: ["keyword_gap", "content"],
        reason: "Customer-confirmed direct competitor.",
        similarity: null,
      },
    );

    const candidate = result.profile.competitorCandidates[0];
    expect(candidate).toMatchObject({
      candidateId: ids.candidate,
      name: "Existing competitor",
      domain: "competitor.example",
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["keyword_gap", "content"],
      confidence: "high",
      similarity: null,
    });
    expect(
      result.profile.fieldProvenance.find(
        (entry) => entry.path === "/competitorCandidates/0",
      ),
    ).toMatchObject({
      derivation: "declared",
      evidenceRefs: [{ kind: "userEdit" }],
    });
  });

  it("returns NOT_FOUND when the server candidate identity is absent", async () => {
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(withCandidate()));

    await expect(
      service.reviewProductProfileCompetitor(
        scope,
        ids.project,
        "00000000-0000-4000-8000-000000000099",
        ids.actor,
        { baseVersion: 3, reviewStatus: "excluded" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects duplicate domains and adds an honest deterministic manual candidate", async () => {
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(withCandidate()));
    await expect(
      service.addProductProfileCompetitor(scope, ids.project, ids.actor, {
        baseVersion: 3,
        name: "Duplicate",
        domain: "competitor.example",
        relationship: "direct",
        analysisScope: ["positioning"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(withCandidate()));
    mocks.profileInsert.mockImplementation(async (values) =>
      row(values.profile, {
        id: "00000000-0000-4000-8000-000000000014",
        version: values.version,
        hash: values.contentHash,
      }),
    );
    const body = {
      baseVersion: 3,
      name: "Manual competitor",
      domain: "manual.example",
      relationship: "indirect" as const,
      analysisScope: ["positioning" as const],
    };
    const result = await service.addProductProfileCompetitor(
      scope,
      ids.project,
      ids.actor,
      body,
    );
    const added = result.profile.competitorCandidates[1];
    expect(added).toMatchObject({
      candidateId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      reviewStatus: "approved",
      similarity: null,
      reason: "Customer-declared competitor.",
      confidence: "high",
    });
  });
});

describe("confirmProductProfile", () => {
  it("confirms the current version, projects markets only, and starts no async work", async () => {
    const current = row(completeDraft());
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(current);
    mocks.profileInsert.mockImplementation(async (values) =>
      row(values.profile, {
        id: "00000000-0000-4000-8000-000000000015",
        version: values.version,
        status: "complete",
        hash: values.contentHash,
      }),
    );

    const result = await service.confirmProductProfile(
      scope,
      ids.project,
      ids.actor,
      { baseVersion: 3 },
    );

    expect(result).toMatchObject({
      status: "complete",
      isCurrent: true,
      isConfirmed: true,
    });
    expect(mocks.setCurrent).toHaveBeenCalledWith(
      scope,
      ids.project,
      result.id,
    );
    expect(mocks.setConfirmed).toHaveBeenCalledWith(
      scope,
      ids.project,
      result.id,
    );
    expect(mocks.competitorUpsert).not.toHaveBeenCalled();
    expect(mocks.updateMarkets).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      ["US", "GB"],
    );
    expect(mocks.setReady).toHaveBeenCalledOnce();
    expect(mocks.activeFind).not.toHaveBeenCalled();
  });

  it("has no competitor-count gate but rejects an incomplete Primary ICP", async () => {
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(completeDraft()));
    mocks.profileInsert.mockImplementation(async (values) =>
      row(values.profile, {
        id: "00000000-0000-4000-8000-000000000016",
        version: values.version,
        status: "complete",
        hash: values.contentHash,
      }),
    );
    await expect(
      service.confirmProductProfile(scope, ids.project, ids.actor, {
        baseVersion: 3,
      }),
    ).resolves.toMatchObject({ status: "complete" });

    const incomplete = completeDraft();
    incomplete.targetAudiences[0]!.jtbd = [];
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(incomplete));
    await expect(
      service.confirmProductProfile(scope, ids.project, ids.actor, {
        baseVersion: 3,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("rejects structurally complete facts that have no traceable provenance", async () => {
    const untraceable = completeDraft();
    untraceable.fieldProvenance = untraceable.fieldProvenance.filter(
      (entry) => entry.path !== "/valueProposition",
    );
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(untraceable));

    await expect(
      service.confirmProductProfile(scope, ids.project, ids.actor, {
        baseVersion: 3,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mocks.profileInsert).not.toHaveBeenCalled();
  });

  it("returns a clean validation error before insert when canonical provenance is foreign or stale", async () => {
    const profile = completeDraft();
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(profile));
    mocks.profileProvenancePreflight.mockResolvedValueOnce({
      ok: false,
      issues: [
        {
          code: "page_snapshot_snapshot_mismatch",
          path: "/fieldProvenance/3/evidenceRefs/1/pageSnapshotId",
          refKind: "pageSnapshot",
          refId: "00000000-0000-4000-8000-000000000099",
        },
      ],
    });

    await expect(
      service.confirmProductProfile(scope, ids.project, ids.actor, {
        baseVersion: 3,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Product Profile provenance does not match its frozen source data.",
    });
    expect(mocks.profileProvenancePreflight).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      expect.objectContaining({ profileSchemaVersion: "product-profile.0.3.0" }),
    );
    expect(mocks.profileInsert).not.toHaveBeenCalled();
  });

  it("requires traceable provenance for every retained competitor", async () => {
    const untraceable = completeDraft();
    untraceable.competitorCandidates = [
      {
        candidateId: ids.candidate,
        name: "Untraceable competitor",
        domain: "untraceable.example",
        relationship: "direct",
        analysisScope: ["positioning"],
        similarity: null,
        reason: "No supporting provenance was persisted.",
        reviewStatus: "approved",
        confidence: "high",
      },
    ];
    untraceable.missingFields = untraceable.missingFields.filter(
      (path) => path !== "/competitorCandidates",
    );
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(untraceable));

    await expect(
      service.confirmProductProfile(scope, ids.project, ids.actor, {
        baseVersion: 3,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("accepts one pool-level provenance anchor for all retained competitors", async () => {
    const profile = completeDraft();
    profile.competitorCandidates = [
      {
        candidateId: ids.candidate,
        name: "Competitor one",
        domain: "one.example",
        relationship: "direct",
        analysisScope: ["positioning"],
        similarity: 0.7,
        reason: "Grounded in the selected product pages.",
        reviewStatus: "approved",
        confidence: "medium",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000000017",
        name: "Competitor two",
        domain: "two.example",
        relationship: "indirect",
        analysisScope: ["content"],
        similarity: null,
        reason: "Grounded in the selected product pages.",
        reviewStatus: "approved",
        confidence: "medium",
      },
    ];
    profile.missingFields = profile.missingFields.filter(
      (path) => path !== "/competitorCandidates",
    );
    profile.fieldProvenance.push({
      path: "/competitorCandidates",
      derivation: "declared",
      confidence: "high",
      evidenceRefs: [
        {
          evidenceRefId: "00000000-0000-8000-8000-000000000018",
          kind: "userEdit",
        },
      ],
      limitation: "Candidate pool declared by the customer; not independently observed.",
      observedAt: null,
    });
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(profile));
    mocks.profileInsert.mockImplementation(async (values) =>
      row(values.profile, {
        id: "00000000-0000-4000-8000-000000000020",
        version: values.version,
        status: "complete",
        hash: values.contentHash,
      }),
    );

    await expect(
      service.confirmProductProfile(scope, ids.project, ids.actor, {
        baseVersion: 3,
      }),
    ).resolves.toMatchObject({ status: "complete" });
    expect(mocks.competitorUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.competitorUpsert).toHaveBeenNthCalledWith(
      1,
      { workspaceId: ids.workspace, projectId: ids.project },
      expect.objectContaining({
        originKind: "product_profile",
        productProfileId: "00000000-0000-4000-8000-000000000020",
        profileVersion: 4,
        candidateId: ids.candidate,
        fieldProvenancePath: "/competitorCandidates",
        sourceReviewStatus: "approved",
        sourceRelationship: "direct",
        sourceAnalysisScope: ["positioning"],
      }),
    );
    expect(mocks.competitorUpsert).toHaveBeenNthCalledWith(
      2,
      { workspaceId: ids.workspace, projectId: ids.project },
      expect.objectContaining({
        originKind: "product_profile",
        productProfileId: "00000000-0000-4000-8000-000000000020",
        profileVersion: 4,
        candidateId: "00000000-0000-4000-8000-000000000017",
        fieldProvenancePath: "/competitorCandidates",
        sourceReviewStatus: "approved",
        sourceRelationship: "indirect",
        sourceAnalysisScope: ["content"],
      }),
    );
    expect(mocks.setCurrent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.competitorUpsert.mock.invocationCallOrder[0]!,
    );
    expect(mocks.setConfirmed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.competitorUpsert.mock.invocationCallOrder[0]!,
    );
  });

  it("prefers exact candidate provenance when projecting confirmed competitors", async () => {
    const profile = completeDraft();
    profile.competitorCandidates = [
      {
        candidateId: ids.candidate,
        name: "Exact competitor",
        domain: "exact.example",
        relationship: "direct",
        analysisScope: ["keyword_gap"],
        similarity: null,
        reason: "Exact provenance retained.",
        reviewStatus: "approved",
        confidence: "high",
      },
    ];
    profile.missingFields = profile.missingFields.filter(
      (path) => path !== "/competitorCandidates",
    );
    profile.fieldProvenance.push(
      {
        path: "/competitorCandidates",
        derivation: "declared",
        confidence: "high",
        evidenceRefs: [
          {
            evidenceRefId: "00000000-0000-8000-8000-000000000040",
            kind: "userEdit",
          },
        ],
        limitation: "Pool-level provenance.",
        observedAt: null,
      },
      {
        path: "/competitorCandidates/0",
        derivation: "declared",
        confidence: "high",
        evidenceRefs: [
          {
            evidenceRefId: "00000000-0000-8000-8000-000000000041",
            kind: "userEdit",
          },
        ],
        limitation: "Exact candidate provenance.",
        observedAt: null,
      },
    );
    mocks.projectLock.mockResolvedValue(project());
    mocks.profileFind.mockResolvedValue(row(profile));
    mocks.profileInsert.mockImplementation(async (values) =>
      row(values.profile, {
        id: "00000000-0000-4000-8000-000000000042",
        version: values.version,
        status: "complete",
        hash: values.contentHash,
      }),
    );

    await expect(
      service.confirmProductProfile(scope, ids.project, ids.actor, {
        baseVersion: 3,
      }),
    ).resolves.toMatchObject({ status: "complete" });

    expect(mocks.competitorUpsert).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      expect.objectContaining({
        fieldProvenancePath: "/competitorCandidates/0",
        evidenceRefs: [
          {
            evidenceRefId: "00000000-0000-8000-8000-000000000041",
            kind: "userEdit",
          },
        ],
      }),
    );
  });
});

describe("database conflict mapping", () => {
  it("maps wrapped Product Profile uniqueness violations to VERSION_CONFLICT", async () => {
    mocks.transaction.mockRejectedValueOnce({
      cause: {
        code: "23505",
        constraint: "icp_profiles_project_id_content_hash_key",
      },
    });
    await expect(
      service.updateProductProfileDraft(scope, ids.project, ids.actor, {
        baseVersion: 3,
        patch: { productName: "Race winner" },
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });
});
