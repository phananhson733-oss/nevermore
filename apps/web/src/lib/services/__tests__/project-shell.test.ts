import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExecutionArtifactsRepository,
  FindingsRepository,
  ProjectsRepository,
  SitesRepository,
  type Executor,
  type ProjectRow,
  type SiteRow,
  type WorkspaceScope,
} from "@sf/db";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getProjectShell, projectProgramPosition } = await import(
  "../project-shell.ts"
);

const SCOPE: WorkspaceScope = { workspaceId: "workspace-1" };
const CURRENT_PROJECT_ID = "project-current";
const EXECUTOR = { kind: "project-shell-test" } as unknown as Executor;
const CREATED_AT = "2026-05-01T00:00:00.000Z";

function projectRow(
  id: string,
  overrides: Partial<ProjectRow> = {},
): ProjectRow {
  return {
    id,
    workspace_id: SCOPE.workspaceId,
    client_name: id === CURRENT_PROJECT_ID ? "Northstar" : "Atlas",
    project_name: id === CURRENT_PROJECT_ID ? "90-day growth" : "Launch",
    stage: "planning",
    default_delivery_locale: "en",
    current_icp_profile_id: null,
    archived_at: null,
    created_by: "operator-1",
    created_at: CREATED_AT,
    updated_at: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

function siteRow(projectId: string, host: string): SiteRow {
  return {
    id: `site-${projectId}`,
    workspace_id: SCOPE.workspaceId,
    project_id: projectId,
    origin: `https://${host}`,
    host,
    market_codes: ["US"],
    language_codes: ["en"],
    is_primary: true,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

const CURRENT_PROJECT = projectRow(CURRENT_PROJECT_ID);
const OTHER_PROJECT = projectRow("project-other");
const CURRENT_SITE = siteRow(CURRENT_PROJECT_ID, "northstar.example");
const OTHER_SITE = siteRow(OTHER_PROJECT.id, "atlas.example");

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getDb.mockReset().mockReturnValue({ db: EXECUTOR });

  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
    CURRENT_PROJECT,
  );
  vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue(
    CURRENT_SITE,
  );
  vi.spyOn(ProjectsRepository.prototype, "listByWorkspace").mockResolvedValue({
    rows: [CURRENT_PROJECT, OTHER_PROJECT],
    nextCursor: null,
  });
  vi.spyOn(SitesRepository.prototype, "mapPrimariesByProjects").mockResolvedValue(
    new Map([
      [CURRENT_PROJECT_ID, CURRENT_SITE],
      [OTHER_PROJECT.id, OTHER_SITE],
    ]),
  );
  vi.spyOn(FindingsRepository.prototype, "list").mockResolvedValue({
    rows: [],
    nextCursor: null,
  });
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "listByProject",
  ).mockResolvedValue({ rows: [], nextCursor: null });
});

describe("getProjectShell", () => {
  it("returns accessible project options with exactly one current selection", async () => {
    const shell = await getProjectShell(SCOPE, CURRENT_PROJECT_ID, {
      exec: EXECUTOR,
      now: new Date("2026-05-30T00:00:00.000Z"),
    });

    expect(shell).not.toBeNull();
    expect(shell?.currentProject).toMatchObject({
      id: CURRENT_PROJECT_ID,
      clientName: "Northstar",
      projectName: "90-day growth",
      host: "northstar.example",
    });
    expect(shell?.projectOptions).toEqual([
      {
        id: CURRENT_PROJECT_ID,
        clientName: "Northstar",
        projectName: "90-day growth",
        host: "northstar.example",
        label: "Northstar — 90-day growth",
        selected: true,
      },
      {
        id: OTHER_PROJECT.id,
        clientName: "Atlas",
        projectName: "Launch",
        host: "atlas.example",
        label: "Atlas — Launch",
        selected: false,
      },
    ]);
    expect(
      shell?.projectOptions.filter((option) => option.selected),
    ).toHaveLength(1);
  });

  it("counts every active confirmed finding and every non-archived artifact", async () => {
    vi.spyOn(FindingsRepository.prototype, "list")
      .mockResolvedValueOnce({
        rows: [{ id: "finding-1" }, { id: "finding-2" }] as never,
        nextCursor: "finding-cursor",
      })
      .mockResolvedValueOnce({
        rows: [{ id: "finding-3" }] as never,
        nextCursor: null,
      });
    vi.spyOn(ExecutionArtifactsRepository.prototype, "listByProject")
      .mockResolvedValueOnce({
        rows: [
          { id: "artifact-1", status: "ready" },
          { id: "artifact-2", status: "archived" },
        ] as never,
        nextCursor: "artifact-cursor",
      })
      .mockResolvedValueOnce({
        rows: [{ id: "artifact-3", status: "draft" }] as never,
        nextCursor: null,
      });

    const shell = await getProjectShell(SCOPE, CURRENT_PROJECT_ID, {
      exec: EXECUTOR,
      now: new Date("2026-05-30T00:00:00.000Z"),
    });

    expect(shell?.navigationBadges).toEqual({ diagnosis: 3, studio: 2 });
    expect(FindingsRepository.prototype.list).toHaveBeenCalledWith(
      { workspaceId: SCOPE.workspaceId, projectId: CURRENT_PROJECT_ID },
      expect.objectContaining({
        activeOnly: true,
        reviewState: "confirmed",
      }),
    );
  });

  it("represents zero canonical counts as absent badges", async () => {
    const shell = await getProjectShell(SCOPE, CURRENT_PROJECT_ID, {
      exec: EXECUTOR,
      now: new Date("2026-05-30T00:00:00.000Z"),
    });

    expect(shell?.navigationBadges).toEqual({
      diagnosis: null,
      studio: null,
    });
  });

  it("returns not found without reading options or project children for a foreign project", async () => {
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(null);

    await expect(
      getProjectShell(SCOPE, "foreign-project", {
        exec: EXECUTOR,
        now: new Date("2026-05-30T00:00:00.000Z"),
      }),
    ).resolves.toBeNull();

    expect(SitesRepository.prototype.findPrimary).not.toHaveBeenCalled();
    expect(ProjectsRepository.prototype.listByWorkspace).not.toHaveBeenCalled();
    expect(FindingsRepository.prototype.list).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).not.toHaveBeenCalled();
  });

  it("returns not found when the scoped current project has no primary site", async () => {
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue(null);

    await expect(
      getProjectShell(SCOPE, CURRENT_PROJECT_ID, { exec: EXECUTOR }),
    ).resolves.toBeNull();

    expect(ProjectsRepository.prototype.listByWorkspace).not.toHaveBeenCalled();
    expect(FindingsRepository.prototype.list).not.toHaveBeenCalled();
  });

  it("uses the configured database, keeps an archived current selection, and omits projects without a site", async () => {
    const archivedCurrent = projectRow(CURRENT_PROJECT_ID, {
      archived_at: "2026-05-30T00:00:00.000Z",
    });
    const missingSiteProject = projectRow("project-without-site");
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      archivedCurrent,
    );
    vi.spyOn(ProjectsRepository.prototype, "listByWorkspace").mockResolvedValue({
      rows: [OTHER_PROJECT, missingSiteProject],
      nextCursor: null,
    });
    vi.spyOn(
      SitesRepository.prototype,
      "mapPrimariesByProjects",
    ).mockResolvedValue(new Map([[OTHER_PROJECT.id, OTHER_SITE]]));

    const shell = await getProjectShell(SCOPE, CURRENT_PROJECT_ID, {
      now: new Date("2026-05-30T00:00:00.000Z"),
    });

    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(shell?.projectOptions.map((option) => option.id)).toEqual([
      CURRENT_PROJECT_ID,
      OTHER_PROJECT.id,
    ]);
    expect(shell?.projectOptions[0]?.selected).toBe(true);
  });

  it("fails closed when project pagination repeats a cursor", async () => {
    vi.spyOn(ProjectsRepository.prototype, "listByWorkspace").mockResolvedValue({
      rows: [],
      nextCursor: "stalled-project-cursor",
    });

    await expect(
      getProjectShell(SCOPE, CURRENT_PROJECT_ID, { exec: EXECUTOR }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});

describe("projectProgramPosition", () => {
  it("derives a canonical inclusive day and percentage from project creation", () => {
    expect(
      projectProgramPosition(
        CREATED_AT,
        new Date("2026-05-30T00:00:00.000Z"),
      ),
    ).toEqual({ day: 30, totalDays: 90, progressPercent: 33 });
  });

  it("clamps future and completed programs to the 1–90 day boundary", () => {
    expect(
      projectProgramPosition(
        "2026-06-01T00:00:00.000Z",
        new Date("2026-05-30T00:00:00.000Z"),
      ).day,
    ).toBe(1);
    expect(
      projectProgramPosition(
        "2025-01-01T00:00:00.000Z",
        new Date("2026-05-30T00:00:00.000Z"),
      ),
    ).toEqual({ day: 90, totalDays: 90, progressPercent: 100 });
  });

  it("fails safe at day one when a persisted timestamp cannot be parsed", () => {
    expect(
      projectProgramPosition(
        "not-a-timestamp",
        new Date("2026-05-30T00:00:00.000Z"),
      ),
    ).toEqual({ day: 1, totalDays: 90, progressPercent: 1 });
  });
});
