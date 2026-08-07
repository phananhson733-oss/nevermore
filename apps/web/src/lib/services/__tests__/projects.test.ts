import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  contentHash,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  TelemetryRepository,
  type IdempotencyRow,
  type ProjectRow,
  type SiteRow,
} from "@sf/db";
import type {
  CreateProjectRequest,
  CreateProjectWireRequest,
  LegacyCreateProjectRequest,
} from "@sf/contracts";
import type { UrlGuardResult } from "@sf/sources";
import { workspaces } from "@sf/db/schema";

/**
 * A transaction stub that answers only the plan-limit lookup.
 *
 * Every repository below is spied on its prototype, so the transaction object
 * itself is otherwise unused — but `createProject` now reads the workspace tier
 * and counts active projects through it before inserting. Defaults are the
 * unbounded tier so the tests that are about creation stay about creation.
 */
function txWithPlan(planTier = "internal", activeProjects = 0) {
  return {
    select: () => ({
      from: (table: unknown) =>
        table === workspaces
          ? {
              where: () => ({
                for: () => ({ limit: async () => [{ planTier }] }),
              }),
            }
          : { where: async () => [{ total: activeProjects }] },
    }),
  };
}

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  enqueueRunInTx: vi.fn(async () => "job-1"),
  getBoss: vi.fn(async () => ({ name: "boss" })),
}));

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  return { ...actual, enqueueRunInTx: mocks.enqueueRunInTx };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: { transaction: mocks.transaction } }),
}));
vi.mock("@/lib/boss", () => ({ getBoss: mocks.getBoss }));

const { archiveProject, createProject, getProject, listProjects } =
  await import("../projects.ts");

const scope = { workspaceId: "workspace-1" };
const actorId = "user-1";
const idempotencyKey = "idem-1";
const baseBody: LegacyCreateProjectRequest = {
  clientName: "Client",
  projectName: "Project",
  siteUrl: "https://example.com",
  marketCodes: ["US"],
  siteLanguageCodes: ["en"],
  defaultDeliveryLocale: "en",
};

const projectRow = {
  id: "project-1",
  workspace_id: scope.workspaceId,
  client_name: baseBody.clientName,
  project_name: baseBody.projectName,
  stage: "setup",
  default_delivery_locale: baseBody.defaultDeliveryLocale,
  current_icp_profile_id: null,
  confirmed_icp_profile_id: null,
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
  archived_at: null,
} as ProjectRow;

const siteRow = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: scope.workspaceId,
  project_id: projectRow.id,
  origin: "https://example.com",
  host: "example.com",
  market_codes: [...baseBody.marketCodes],
  language_codes: [...baseBody.siteLanguageCodes],
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
} as SiteRow;

function requestHash(body: CreateProjectWireRequest): string {
  if ("mode" in body) {
    return contentHash({
      mode: body.mode,
      productUrl: body.productUrl,
      businessHint: body.businessHint ?? null,
      ...(body.productName === undefined
        ? {}
        : { productName: body.productName }),
      ...(body.customerModel === undefined
        ? {}
        : { customerModel: body.customerModel }),
      ...(body.primaryMarket === undefined
        ? {}
        : { primaryMarket: body.primaryMarket }),
      ...(body.growthObjectives === undefined
        ? {}
        : { growthObjectives: [...body.growthObjectives] }),
    });
  }
  return contentHash({
    clientName: body.clientName,
    projectName: body.projectName,
    siteUrl: body.siteUrl,
    marketCodes: [...body.marketCodes],
    siteLanguageCodes: [...body.siteLanguageCodes],
    defaultDeliveryLocale: body.defaultDeliveryLocale,
  });
}

function completedIdempotency(
  body: CreateProjectWireRequest,
  overrides: Partial<IdempotencyRow> = {},
): IdempotencyRow {
  return {
    id: "idem-row-1",
    workspace_id: scope.workspaceId,
    scope: "createProject",
    key: idempotencyKey,
    request_hash: requestHash(body),
    request_body: null,
    status: "completed",
    resource_type: "project",
    resource_id: projectRow.id,
    response_status: 201,
    response_body: {
      data: {
        id: projectRow.id,
        clientName: baseBody.clientName,
        projectName: baseBody.projectName,
        stage: "active",
        site: {
          id: siteRow.id,
          origin: siteRow.origin,
          host: siteRow.host,
          marketCodes: siteRow.market_codes,
          languageCodes: siteRow.language_codes,
        },
        contextStatus: "missing",
        currentIcpProfileVersion: null,
        defaultDeliveryLocale: baseBody.defaultDeliveryLocale,
        createdAt: projectRow.created_at,
        updatedAt: projectRow.updated_at,
        archivedAt: null,
      },
    },
    expires_at: "2026-07-20T00:00:00.000Z",
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
    ...overrides,
  } as IdempotencyRow;
}

function reservedIdempotency(body: CreateProjectWireRequest): IdempotencyRow {
  return {
    ...completedIdempotency(body),
    status: "in_progress",
    resource_id: null,
    response_body: null,
  } as IdempotencyRow;
}

const safeVerdict: UrlGuardResult = {
  safe: true,
  normalizedUrl: "https://example.com",
  pinnedIp: "203.0.113.10",
  reason: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.transaction
    .mockReset()
    .mockImplementation(async (callback: (tx: object) => Promise<unknown>) =>
      callback(txWithPlan()),
    );
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue(
    reservedIdempotency(baseBody),
  );
  vi.spyOn(IdempotencyRepository.prototype, "complete").mockResolvedValue();
  vi.spyOn(ProjectsRepository.prototype, "insert").mockResolvedValue(
    projectRow,
  );
  vi.spyOn(
    ProjectsRepository.prototype,
    "setCurrentIcpProfile",
  ).mockResolvedValue(true);
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
    projectRow,
  );
  vi.spyOn(SitesRepository.prototype, "insertPrimary").mockResolvedValue(
    siteRow,
  );
  vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue(siteRow);
  vi.spyOn(
    SitesRepository.prototype,
    "mapPrimariesByProjects",
  ).mockResolvedValue(new Map([[projectRow.id, siteRow]]));
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "insertDefaultCrawl",
  ).mockResolvedValue({ id: "source-1" } as never);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "insertConnection",
  ).mockResolvedValue({ id: "dataforseo-source-1" } as never);
  vi.spyOn(AsyncRunsRepository.prototype, "insertQueued").mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000099",
  } as never);
  vi.spyOn(
    CollectionRunsRepository.prototype,
    "insertPlaceholder",
  ).mockResolvedValue({ id: "00000000-0000-4000-8000-000000000099" } as never);
  vi.spyOn(
    SitePagesRepository.prototype,
    "upsertNormalizedUrl",
  ).mockResolvedValue({
    id: "page-1",
  } as never);
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue();
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(null);
  vi.spyOn(IcpProfilesRepository.prototype, "insertVersion").mockResolvedValue({
    id: "icp-profile-1",
    workspace_id: scope.workspaceId,
    project_id: projectRow.id,
    version: 1,
    status: "draft",
    profile: {},
    content_hash: "a".repeat(64),
    created_by: actorId,
    created_at: projectRow.created_at,
  });
  vi.spyOn(IcpProfilesRepository.prototype, "mapByIds").mockResolvedValue(
    new Map(),
  );
  vi.spyOn(ProjectsRepository.prototype, "listByWorkspace").mockResolvedValue({
    rows: [projectRow],
    nextCursor: null,
  });
});

describe("createProject", () => {
  it("creates an honest URL-first draft and preserves the submitted product page", async () => {
    const body: CreateProjectRequest = {
      mode: "product_profile",
      productUrl:
        "https://Example.com:443/products/growth/?utm_source=demo&plan=pro",
      businessHint: "Hybrid B2B and B2C growth workspace",
      productName: "RelayOps",
      customerModel: "b2b",
      primaryMarket: "US",
      growthObjectives: ["increase_signups", "generate_qualified_leads"],
    };
    const guard = vi.fn(async (url: string) => ({
      ...safeVerdict,
      normalizedUrl: url,
    }));

    const result = await createProject(
      scope,
      actorId,
      idempotencyKey,
      body,
      guard,
      { defaultDeliveryLocale: "zh-CN" },
    );

    expect(guard).toHaveBeenCalledWith(
      "https://example.com/products/growth/?plan=pro",
    );
    expect(ProjectsRepository.prototype.insert).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      clientName: "RelayOps",
      projectName: "RelayOps",
      defaultDeliveryLocale: "zh-CN",
      createdBy: actorId,
    });
    expect(SitesRepository.prototype.insertPrimary).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "https://example.com",
        host: "example.com",
        marketCodes: ["US"],
        languageCodes: [],
      }),
    );
    expect(
      SitePagesRepository.prototype.upsertNormalizedUrl,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedUrl: "https://example.com/products/growth/?plan=pro",
      }),
    );
    expect(IcpProfilesRepository.prototype.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        status: "draft",
        profile: expect.objectContaining({
          profileSchemaVersion: "product-profile.0.3.0",
          sourcePageUrl: "https://example.com/products/growth/?plan=pro",
          sourceSnapshotId: null,
          analysisInvocationId: null,
          productName: "RelayOps",
          customerModel: "b2b",
          growthObjectives: ["increase_signups", "generate_qualified_leads"],
          targetMarkets: [{ marketCode: "US", priority: "primary" }],
          targetAudiences: [],
          competitorCandidates: [],
          businessHint: "Hybrid B2B and B2C growth workspace",
          fieldProvenance: expect.arrayContaining([
            expect.objectContaining({
              path: "/productName",
              derivation: "declared",
              evidenceRefs: [expect.objectContaining({ kind: "userEdit" })],
            }),
            expect.objectContaining({
              path: "/customerModel",
              derivation: "declared",
              evidenceRefs: [expect.objectContaining({ kind: "userEdit" })],
            }),
            expect.objectContaining({
              path: "/targetMarkets",
              derivation: "declared",
              evidenceRefs: [expect.objectContaining({ kind: "userEdit" })],
            }),
            expect.objectContaining({
              path: "/growthObjectives",
              derivation: "declared",
              evidenceRefs: [expect.objectContaining({ kind: "userEdit" })],
            }),
          ]),
        }),
      }),
    );
    expect(
      ProjectsRepository.prototype.setCurrentIcpProfile,
    ).toHaveBeenCalledWith(scope, projectRow.id, "icp-profile-1");
    expect(result.project.contextStatus).toBe("draft");
    expect(result.project.confirmedIcpProfileVersion).toBeNull();
    expect(result.location).toBe(`/p/${projectRow.id}/context`);
    expect(IdempotencyRepository.prototype.begin).toHaveBeenCalledWith(
      expect.objectContaining({ requestHash: requestHash(body) }),
    );
  });

  it("queues bounded DataForSEO competitor discovery during URL-first creation", async () => {
    const body: CreateProjectRequest = {
      mode: "product_profile",
      productUrl: "https://example.com/product",
      primaryMarket: "US",
    };
    const guard = vi.fn(async () => safeVerdict);

    await createProject(scope, actorId, idempotencyKey, body, guard, {
      defaultDeliveryLocale: "zh-CN",
      dataForSeoDiscovery: {
        enabled: true,
        maxKeywords: 120,
        maxCompetitors: 40,
      },
    });

    expect(
      SourceConnectionsRepository.prototype.insertConnection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "dataforseo",
        state: "connected",
        config: expect.objectContaining({
          target: "example.com",
          marketCode: "US",
          // The delivery locale above is zh-CN. DataForSEO Labs serves only
          // `en` and `es` for the United States and rejects anything else with
          // task status 40501, so the search language must follow the market,
          // never the language the customer reads the report in.
          languageCode: "en",
          locationCode: 2840,
          locationName: "United States",
          maxKeywords: 120,
          maxCompetitors: 40,
        }),
      }),
    );
    expect(AsyncRunsRepository.prototype.insertQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "collection",
        activeKey: "collect:dataforseo:search_landscape",
        requestPayload: expect.objectContaining({
          provider: "dataforseo",
          operation: "search_landscape",
        }),
      }),
    );
    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "dataforseo",
        operation: "search_landscape",
      }),
    );
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "collect.dataforseo",
      expect.objectContaining({ projectId: projectRow.id }),
    );
  });

  it("treats each declared onboarding field as part of idempotent command identity", async () => {
    const original: CreateProjectRequest = {
      mode: "product_profile",
      productUrl: "https://example.com/product",
      productName: "RelayOps",
      customerModel: "b2b",
      primaryMarket: "US",
      growthObjectives: ["increase_signups"],
    };
    const changed: CreateProjectRequest = {
      ...original,
      growthObjectives: ["increase_revenue"],
    };
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValueOnce(
      completedIdempotency(original),
    );

    await expect(
      createProject(scope, actorId, idempotencyKey, changed, guard),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
    expect(guard).not.toHaveBeenCalled();
  });

  it("preserves the historical URL-first request hash when new declarations are omitted", async () => {
    const historicalBody: CreateProjectRequest = {
      mode: "product_profile",
      productUrl: "https://example.com/product",
    };
    const guard = vi.fn(async () => safeVerdict);

    await createProject(scope, actorId, idempotencyKey, historicalBody, guard);

    expect(IdempotencyRepository.prototype.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        requestHash: contentHash({
          mode: "product_profile",
          productUrl: "https://example.com/product",
          businessHint: null,
        }),
      }),
    );
  });

  it("replays a completed idempotent create before any DNS or reachability checks", async () => {
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValueOnce(
      completedIdempotency(baseBody),
    );

    const result = await createProject(
      scope,
      actorId,
      idempotencyKey,
      baseBody,
      guard,
    );

    expect(result).toMatchObject({
      status: 201,
      replayed: true,
      location: "/p/project-1/overview",
    });
    expect(guard).not.toHaveBeenCalled();
    expect(IdempotencyRepository.prototype.begin).not.toHaveBeenCalled();
  });

  it("replays a completed URL-first create to the Product Profile editor", async () => {
    const body: CreateProjectRequest = {
      mode: "product_profile",
      productUrl: "https://example.com/product",
      businessHint: "Customer-declared B2B product context",
    };
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValueOnce(
      completedIdempotency(body),
    );

    const result = await createProject(
      scope,
      actorId,
      idempotencyKey,
      body,
      guard,
    );

    expect(result).toMatchObject({
      status: 201,
      replayed: true,
      location: "/p/project-1/context",
    });
    expect(guard).not.toHaveBeenCalled();
    expect(IdempotencyRepository.prototype.begin).not.toHaveBeenCalled();
  });

  it("rehydrates a completed replay from the scoped project instead of returning a stale stored response contract", async () => {
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValueOnce(
      completedIdempotency(baseBody, {
        response_body: {
          data: {
            id: "stale-project-id",
            clientName: "Historical Client",
            projectName: "Historical Project",
            stage: "active",
            legacyOnlyField: "must-not-leak",
          },
        },
      }),
    );

    const result = await createProject(
      scope,
      actorId,
      idempotencyKey,
      baseBody,
      guard,
    );

    expect(ProjectsRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      projectRow.id,
    );
    expect(result.project).toEqual({
      id: projectRow.id,
      clientName: baseBody.clientName,
      projectName: baseBody.projectName,
      stage: "setup",
      site: {
        id: siteRow.id,
        origin: siteRow.origin,
        host: siteRow.host,
        marketCodes: siteRow.market_codes,
        languageCodes: siteRow.language_codes,
      },
      contextStatus: "missing",
      currentIcpProfileVersion: null,
      confirmedIcpProfileVersion: null,
      defaultDeliveryLocale: baseBody.defaultDeliveryLocale,
      createdAt: projectRow.created_at,
      updatedAt: projectRow.updated_at,
      archivedAt: null,
    });
    expect(result.project.stage).not.toBe("active");
    expect(result.project).not.toHaveProperty("legacyOnlyField");
    expect(guard).not.toHaveBeenCalled();
    expect(IdempotencyRepository.prototype.begin).not.toHaveBeenCalled();
  });

  it("fails explicitly when a completed replay target cannot be rehydrated in the workspace scope", async () => {
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValueOnce(
      completedIdempotency(baseBody),
    );
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValueOnce(
      null,
    );

    await expect(
      createProject(scope, actorId, idempotencyKey, baseBody, guard),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      message: "Idempotent project replay target not found.",
    });
    expect(guard).not.toHaveBeenCalled();
    expect(IdempotencyRepository.prototype.begin).not.toHaveBeenCalled();
  });

  it("fails explicitly when a completed replay record has no resource identity", async () => {
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValueOnce(
      completedIdempotency(baseBody, { resource_id: null }),
    );

    await expect(
      createProject(scope, actorId, idempotencyKey, baseBody, guard),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      message: "Idempotent project replay target not found.",
    });
    expect(ProjectsRepository.prototype.findById).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
    expect(IdempotencyRepository.prototype.begin).not.toHaveBeenCalled();
  });

  it("replays a completed legacy path/query request before the tightened origin-only policy", async () => {
    const legacyBody = {
      ...baseBody,
      siteUrl: "https://example.com/customer-path?campaign=legacy",
    };
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValueOnce(
      completedIdempotency(legacyBody),
    );

    const result = await createProject(
      scope,
      actorId,
      idempotencyKey,
      legacyBody,
      guard,
    );

    expect(result).toMatchObject({ status: 201, replayed: true });
    expect(guard).not.toHaveBeenCalled();
    expect(IdempotencyRepository.prototype.begin).not.toHaveBeenCalled();
  });

  it("rejects a non-origin site URL before any guard lookup", async () => {
    const guard = vi.fn(async () => safeVerdict);

    await expect(
      createProject(
        scope,
        actorId,
        idempotencyKey,
        { ...baseBody, siteUrl: "https://example.com/path?q=1" },
        guard,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(guard).not.toHaveBeenCalled();
  });

  it.each([
    {
      body: { ...baseBody, siteUrl: "https://customer-secret.example:8443" },
      pointer: "/siteUrl",
    },
    {
      body: {
        mode: "product_profile" as const,
        productUrl: "http://customer-secret.example:2375/product/",
      },
      pointer: "/productUrl",
    },
  ])(
    "rejects a non-standard port before guard or persistence without exposing target details",
    async ({ body, pointer }) => {
      const guard = vi.fn(async () => safeVerdict);

      const rejection = await createProject(
        scope,
        actorId,
        idempotencyKey,
        body,
        guard,
        { environment: "production", siteOriginProbe: vi.fn(async () => true) },
      ).catch((error: unknown) => error);

      expect(rejection).toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        fieldErrors: [expect.objectContaining({ pointer })],
      });
      expect(JSON.stringify(rejection)).not.toContain(
        "customer-secret.example",
      );
      expect(JSON.stringify(rejection)).not.toContain("8443");
      expect(JSON.stringify(rejection)).not.toContain("2375");
      expect(guard).not.toHaveBeenCalled();
      expect(ProjectsRepository.prototype.insert).not.toHaveBeenCalled();
    },
  );

  it("does not read or expose an unsafe guard's target-specific reason", async () => {
    let reasonReads = 0;
    const guard = vi.fn(async () => ({
      safe: false as const,
      normalizedUrl: null,
      pinnedIp: null,
      get reason(): string {
        reasonReads += 1;
        return "customer-secret.example resolved to 10.0.0.7";
      },
    }));

    const rejection = await createProject(
      scope,
      actorId,
      idempotencyKey,
      baseBody,
      guard,
    ).catch((error: unknown) => error);

    expect(rejection).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [
        expect.objectContaining({
          pointer: "/siteUrl",
          code: "blocked_url",
          message: "Use a public URL on a standard HTTP(S) port.",
        }),
      ],
    });
    expect(reasonReads).toBe(0);
    expect(JSON.stringify(rejection)).not.toContain("customer-secret.example");
    expect(JSON.stringify(rejection)).not.toContain("10.0.0.7");
  });

  it("upgrades production HTTP origins to HTTPS only after a pinned reachability probe", async () => {
    const guard = vi.fn(async () => safeVerdict);
    const probe = vi.fn(async () => true);

    await createProject(
      scope,
      actorId,
      idempotencyKey,
      { ...baseBody, siteUrl: "http://example.com" },
      guard,
      {
        environment: "production",
        siteOriginProbe: probe,
      },
    );

    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith("https://example.com");
    expect(probe).toHaveBeenCalledWith({
      origin: "https://example.com",
      pinnedIp: "203.0.113.10",
    });
    expect(SitesRepository.prototype.insertPrimary).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "https://example.com",
        host: "example.com",
      }),
    );
  });

  it("guards and persists the exact deep fetch URL during a production HTTPS upgrade", async () => {
    const guard = vi.fn(async (url: string) => ({
      ...safeVerdict,
      normalizedUrl: url,
    }));
    const probe = vi.fn(async () => true);

    await createProject(
      scope,
      actorId,
      idempotencyKey,
      {
        mode: "product_profile",
        productUrl: "http://example.com:80/products/growth/?plan=pro",
      },
      guard,
      {
        environment: "production",
        siteOriginProbe: probe,
      },
    );

    const exactPageUrl = "https://example.com/products/growth/?plan=pro";
    expect(guard).toHaveBeenCalledOnce();
    expect(guard).toHaveBeenCalledWith(exactPageUrl);
    expect(probe).toHaveBeenCalledWith({
      origin: "https://example.com",
      pinnedIp: "203.0.113.10",
    });
    expect(
      SitePagesRepository.prototype.upsertNormalizedUrl,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedUrl: exactPageUrl,
      }),
    );
  });

  it("fails closed when the production HTTPS reachability probe does not confirm the secure origin", async () => {
    const guard = vi.fn(async () => safeVerdict);
    const probe = vi.fn(async () => false);

    await expect(
      createProject(
        scope,
        actorId,
        idempotencyKey,
        { ...baseBody, siteUrl: "http://example.com" },
        guard,
        {
          environment: "production",
          siteOriginProbe: probe,
        },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [
        expect.objectContaining({
          pointer: "/siteUrl",
          code: "https_unreachable",
        }),
      ],
    });
    expect(guard).toHaveBeenCalledWith("https://example.com");
    expect(probe).toHaveBeenCalledOnce();
  });

  it("fails closed when the production HTTPS guard cannot pin a public address", async () => {
    const guard = vi.fn(async () => ({
      safe: true,
      normalizedUrl: "https://example.com",
      pinnedIp: null,
      reason: null,
    }));
    const probe = vi.fn(async () => true);

    await expect(
      createProject(
        scope,
        actorId,
        idempotencyKey,
        { ...baseBody, siteUrl: "http://example.com" },
        guard,
        {
          environment: "production",
          siteOriginProbe: probe,
        },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [
        expect.objectContaining({
          pointer: "/siteUrl",
          code: "https_unreachable",
        }),
      ],
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns a blocked_url validation error when the canonical origin is not allowed", async () => {
    const guard = vi.fn(async () => ({
      safe: false,
      normalizedUrl: null,
      pinnedIp: null,
      reason: "URL resolves to a blocked address.",
    }));

    await expect(
      createProject(scope, actorId, idempotencyKey, baseBody, guard),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [
        expect.objectContaining({
          pointer: "/siteUrl",
          code: "blocked_url",
        }),
      ],
    });
  });

  it("refuses a second project on the free tier without inserting", async () => {
    const guard = vi.fn(async () => safeVerdict);
    mocks.transaction.mockImplementation(
      async (callback: (tx: object) => Promise<unknown>) =>
        callback(txWithPlan("free", 1)),
    );

    await expect(
      createProject(scope, actorId, idempotencyKey, baseBody, guard),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    expect(ProjectsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("admits the first project on the free tier", async () => {
    const guard = vi.fn(async () => safeVerdict);
    mocks.transaction.mockImplementation(
      async (callback: (tx: object) => Promise<unknown>) =>
        callback(txWithPlan("free", 0)),
    );

    await createProject(scope, actorId, idempotencyKey, baseBody, guard);

    expect(ProjectsRepository.prototype.insert).toHaveBeenCalled();
  });

  it("replays when another transaction wins the idempotency key after the fast-path read", async () => {
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValueOnce(
      null,
    );
    vi.spyOn(IdempotencyRepository.prototype, "find")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(completedIdempotency(baseBody));

    const result = await createProject(
      scope,
      actorId,
      idempotencyKey,
      baseBody,
      guard,
    );

    expect(result.replayed).toBe(true);
    expect(ProjectsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("fails closed when another transaction wins the idempotency key but no completed replay is available yet", async () => {
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValueOnce(
      null,
    );
    vi.spyOn(IdempotencyRepository.prototype, "find")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      createProject(scope, actorId, idempotencyKey, baseBody, guard),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "Idempotency key is being processed.",
    });
  });

  it("rejects a reused idempotency key when the stored request hash differs", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValueOnce(
      completedIdempotency(baseBody, {
        request_hash: requestHash({
          ...baseBody,
          siteUrl: "https://different.example",
        }),
      }),
    );

    await expect(
      createProject(scope, actorId, idempotencyKey, baseBody),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
  });
});

describe("getProject and listProjects", () => {
  it("404s when the project does not exist in the workspace scope", async () => {
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValueOnce(
      null,
    );

    await expect(getProject(scope, randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("fails closed when a listed project is missing its primary site", async () => {
    vi.spyOn(
      SitesRepository.prototype,
      "mapPrimariesByProjects",
    ).mockResolvedValueOnce(new Map());

    await expect(
      listProjects(scope, { limit: 50, cursor: null, archived: false }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("archiveProject", () => {
  it("locks and archives an active workspace-scoped project", async () => {
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValueOnce(projectRow);
    const archive = vi
      .spyOn(ProjectsRepository.prototype, "archive")
      .mockResolvedValueOnce(true);

    await expect(archiveProject(scope, projectRow.id)).resolves.toBeUndefined();

    expect(archive).toHaveBeenCalledWith(scope, projectRow.id);
  });

  it("is idempotent for an already archived project", async () => {
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValueOnce({
      ...projectRow,
      archived_at: "2026-08-01T10:00:00.000Z",
    });
    const archive = vi.spyOn(ProjectsRepository.prototype, "archive");

    await expect(archiveProject(scope, projectRow.id)).resolves.toBeUndefined();

    expect(archive).not.toHaveBeenCalled();
  });

  it("does not reveal a foreign or absent project", async () => {
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValueOnce(null);

    await expect(archiveProject(scope, projectRow.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
