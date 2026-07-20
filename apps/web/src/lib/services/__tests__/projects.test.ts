import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contentHash,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
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
} from "@sf/contracts";
import type { UrlGuardResult } from "@sf/sources";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: { transaction: mocks.transaction } }),
}));

const { createProject, getProject, listProjects } = await import(
  "../projects.ts"
);

const scope = { workspaceId: "workspace-1" };
const actorId = "user-1";
const idempotencyKey = "idem-1";
const baseBody: CreateProjectRequest = {
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
  default_delivery_locale: baseBody.defaultDeliveryLocale,
  current_icp_profile_id: null,
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
  archived_at: null,
} as ProjectRow;

const siteRow = {
  id: "site-1",
  workspace_id: scope.workspaceId,
  project_id: projectRow.id,
  origin: "https://example.com",
  host: "example.com",
  market_codes: [...baseBody.marketCodes],
  language_codes: [...baseBody.siteLanguageCodes],
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
} as SiteRow;

function requestHash(
  body: CreateProjectWireRequest,
): string {
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
  mocks.transaction.mockReset().mockImplementation(
    async (callback: (tx: object) => Promise<unknown>) => callback({}),
  );
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue(
    reservedIdempotency(baseBody),
  );
  vi.spyOn(IdempotencyRepository.prototype, "complete").mockResolvedValue();
  vi.spyOn(ProjectsRepository.prototype, "insert").mockResolvedValue(projectRow);
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(projectRow);
  vi.spyOn(SitesRepository.prototype, "insertPrimary").mockResolvedValue(siteRow);
  vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue(siteRow);
  vi.spyOn(SitesRepository.prototype, "mapPrimariesByProjects").mockResolvedValue(
    new Map([[projectRow.id, siteRow]]),
  );
  vi.spyOn(SourceConnectionsRepository.prototype, "insertDefaultCrawl").mockResolvedValue(
    { id: "source-1" } as never,
  );
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue();
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(null);
  vi.spyOn(IcpProfilesRepository.prototype, "mapByIds").mockResolvedValue(
    new Map(),
  );
  vi.spyOn(ProjectsRepository.prototype, "listByWorkspace").mockResolvedValue({
    rows: [projectRow],
    nextCursor: null,
  });
});

describe("createProject", () => {
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
      createProject(
        scope,
        actorId,
        idempotencyKey,
        baseBody,
        guard,
      ),
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

  it("replays when another transaction wins the idempotency key after the fast-path read", async () => {
    const guard = vi.fn(async () => safeVerdict);
    vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValueOnce(null);
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
    vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValueOnce(null);
    vi.spyOn(IdempotencyRepository.prototype, "find")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      createProject(
        scope,
        actorId,
        idempotencyKey,
        baseBody,
        guard,
      ),
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
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValueOnce(null);

    await expect(getProject(scope, randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("fails closed when a listed project is missing its primary site", async () => {
    vi.spyOn(SitesRepository.prototype, "mapPrimariesByProjects").mockResolvedValueOnce(
      new Map(),
    );

    await expect(
      listProjects(scope, { limit: 50, cursor: null, archived: false }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
