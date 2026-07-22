import { AsyncRunsRepository, GrowthMapReadRepository } from "@sf/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactDto } from "@/lib/services/artifact-mappers";
import type {
  ActionDto,
  CoverageDto,
  FindingDto,
} from "@/lib/services/diagnostic-mappers";
import type { DataSnapshotDto } from "@/lib/services/source-mappers";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  transaction: vi.fn(),
  getProject: vi.fn(),
  getProjectReport: vi.fn(),
  listProjectActions: vi.fn(),
  listProjectArtifacts: vi.fn(),
  listProjectFindings: vi.fn(),
  listProjectSnapshots: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/services/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/services/report", () => ({
  getProjectReport: mocks.getProjectReport,
}));
vi.mock("@/lib/services/actions-service", () => ({
  listProjectActions: mocks.listProjectActions,
}));
vi.mock("@/lib/services/artifacts", () => ({
  listProjectArtifacts: mocks.listProjectArtifacts,
}));
vi.mock("@/lib/services/findings-list", () => ({
  listProjectFindings: mocks.listProjectFindings,
}));
vi.mock("@/lib/services/snapshots", () => ({
  listProjectSnapshots: mocks.listProjectSnapshots,
}));

const { getWorkspaceView } = await import("@/lib/services/workspace-view");

const TIME = "2026-07-20T00:00:00.000Z";
const SCOPE = { workspaceId: "workspace", projectId: "project" };
const READ_TX = { role: "workspace-repeatable-read-snapshot" };
const COVERAGE: CoverageDto = {
  overall: "partial",
  domains: { technical_seo: "complete" },
  limitations: ["Search Console is unavailable."],
};

function action(
  id: string,
  findingId: string,
  priorityBand: string,
): ActionDto {
  return {
    id,
    findingId,
    templateId: "technical_fix_v1",
    title: `Action ${id}`,
    description: "Canonical action copy.",
    contentLocale: "en",
    priorityBand,
    roadmapLane: "now",
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: "The issue is resolved.",
    revision: 1,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function finding(
  id: string,
  evidenceId: string | null = null,
): FindingDto {
  return {
    id,
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
    domain: "technical_seo",
    titleKey: "finding.http_status",
    titleArgs: {},
    summary: `Finding ${id}`,
    summaryLocale: "en",
    severity: "high",
    confidence: "high",
    reviewState: "confirmed",
    reviewRevision: 1,
    active: true,
    regressed: false,
    subjectRefs: [],
    evidence: evidenceId
      ? [
          {
            id: evidenceId,
            sourceProvider: "crawl",
            origin: "crawl_pages",
            method: "HTTP response inspection",
            grade: "A",
            availability: "available",
            support: "supports",
            claim: "The URL returned HTTP 500.",
            subjectRefs: [],
            observedAt: TIME,
            limitation: "One captured response.",
            snapshotId: "snapshot-target",
            collectionRunId: "collection-run-target",
            analysisInvocationId: null,
          },
        ]
      : [],
    firstSeenAt: TIME,
    lastSeenAt: TIME,
    resolvedAt: null,
  };
}

function artifact(id: string, actionId: string): ArtifactDto {
  return {
    id,
    actionId,
    artifactType: "technical_ticket",
    status: "ready",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 1,
    validationState: "valid",
    current: null,
    activeRun: null,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function snapshot(id: string, capturedAt: string): DataSnapshotDto {
  return {
    id,
    siteId: "site-1",
    provider: "crawl",
    datasetKey: "crawl_pages",
    schemaVersion: "1.0.0",
    methodVersion: "crawl-v1",
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Static HTML only.",
    rowCount: 1,
    checksum: `sha256:${id}`,
  };
}

function findingPage(data: FindingDto[], nextCursor: string | null) {
  return {
    data,
    meta: {
      nextCursor,
      hasNext: nextCursor !== null,
      limit: 100,
      latestRun: null,
      coverage: COVERAGE,
      ruleResults: [],
    },
  };
}

function installSinglePageDefaults(): void {
  mocks.listProjectActions.mockResolvedValue({
    data: [],
    nextCursor: null,
    limit: 100,
  });
  mocks.listProjectFindings.mockResolvedValue(findingPage([], null));
  mocks.listProjectArtifacts.mockResolvedValue({
    data: [],
    nextCursor: null,
    limit: 100,
  });
  mocks.listProjectSnapshots.mockResolvedValue({
    data: [],
    nextCursor: null,
    limit: 100,
  });
}

describe("workspace complete pagination and snapshot reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getDb.mockReturnValue({
      db: { transaction: mocks.transaction },
    });
    mocks.transaction.mockImplementation(
      async (callback: (tx: object) => Promise<unknown>) => callback(READ_TX),
    );
    mocks.getProject.mockResolvedValue({
      id: SCOPE.projectId,
      clientName: "Client",
      projectName: "Project",
      stage: "active",
      site: {
        id: "site",
        origin: "https://example.test",
        host: "example.test",
        marketCodes: ["US"],
        languageCodes: ["en"],
      },
      contextStatus: "complete",
      currentIcpProfileVersion: 1,
      defaultDeliveryLocale: "en",
      createdAt: TIME,
      updatedAt: TIME,
      archivedAt: null,
    });
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveByProject",
    ).mockResolvedValue([]);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "findLatestReadableRun",
    ).mockResolvedValue({ id: "00000000-0000-4000-8000-000000000090" } as never);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listCurrentRunUrls",
    ).mockResolvedValue({
      rows: [
        {
          site_page_id: "00000000-0000-4000-8000-000000000091",
        },
      ],
      nextCursor: null,
    } as never);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listResolvedTargets",
    ).mockResolvedValue([
      ...Array.from({ length: 100 }, (_, index) => ({
        finding_id: `recent-finding-${index}`,
      })),
      { finding_id: "old-critical-finding" },
      { finding_id: "finding" },
    ] as never);
    installSinglePageDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps an older critical action and its evidence/artifact behind 100 newer rows", async () => {
    mocks.listProjectActions.mockImplementation(async (_scope, _projectId, options) =>
      options.cursor === null
        ? {
            data: Array.from({ length: 100 }, (_, index) =>
              action(`recent-medium-${index}`, `recent-finding-${index}`, "medium"),
            ),
            nextCursor: "actions-page-2",
            limit: 100,
          }
        : {
            data: [action("old-critical", "old-critical-finding", "critical")],
            nextCursor: null,
            limit: 100,
          },
    );
    mocks.listProjectFindings.mockImplementation(
      async (_scope, _projectId, options) =>
        options.cursor === null
          ? findingPage(
              Array.from({ length: 100 }, (_, index) =>
                finding(`recent-finding-${index}`),
              ),
              "findings-page-2",
            )
          : findingPage(
              [finding("old-critical-finding", "old-critical-evidence")],
              null,
            ),
    );
    mocks.listProjectArtifacts.mockImplementation(
      async (_scope, _projectId, options) =>
        options.cursor === null
          ? {
              data: Array.from({ length: 100 }, (_, index) =>
                artifact(`recent-artifact-${index}`, `recent-medium-${index}`),
              ),
              nextCursor: "artifacts-page-2",
              limit: 100,
            }
          : {
              data: [artifact("old-critical-artifact", "old-critical")],
              nextCursor: null,
              limit: 100,
            },
    );
    mocks.listProjectSnapshots.mockImplementation(
      async (_scope, _projectId, options) =>
        options.cursor === null
          ? {
              data: Array.from({ length: 100 }, (_, index) =>
                snapshot(`recent-snapshot-${index}`, "2026-07-19T00:00:00.000Z"),
              ),
              nextCursor: "snapshots-page-2",
              limit: 100,
            }
          : {
              // `created_at` drives repository pagination, while Overview must
              // still compare the canonical capture time across every page.
              data: [snapshot("snapshot-target", "2026-07-20T01:00:00.000Z")],
              nextCursor: null,
              limit: 100,
            },
    );

    const view = await getWorkspaceView(SCOPE, SCOPE.projectId, "overview", null);

    expect(view.view).toBe("overview");
    if (view.view !== "overview") throw new Error("expected Overview view");
    expect(view.topActions[0]?.id).toBe("old-critical");
    expect(view.topActionEvidence.map(({ id }) => id)).toEqual([
      "old-critical-evidence",
    ]);
    expect(view.deliveryFocus).toEqual({
      artifactId: "old-critical-artifact",
      actionId: "old-critical",
      artifactType: "technical_ticket",
      status: "ready",
      updatedAt: TIME,
    });
    expect(view.latestSnapshot?.id).toBe("snapshot-target");
    expect(view.coverage).toEqual(COVERAGE);
    expect(mocks.listProjectActions).toHaveBeenCalledTimes(2);
    expect(mocks.listProjectFindings).toHaveBeenCalledTimes(2);
    expect(mocks.listProjectArtifacts).toHaveBeenCalledTimes(2);
    expect(mocks.listProjectSnapshots).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    expect(mocks.getProject).toHaveBeenCalledWith(
      SCOPE,
      SCOPE.projectId,
      READ_TX,
    );
    for (const reader of [
      mocks.listProjectActions,
      mocks.listProjectFindings,
      mocks.listProjectArtifacts,
      mocks.listProjectSnapshots,
    ]) {
      expect(reader.mock.calls.every((call) => call[3] === READ_TX)).toBe(true);
    }
    expect(
      vi.mocked(AsyncRunsRepository.prototype.listActiveByProject).mock
        .contexts[0],
    ).toMatchObject({ exec: READ_TX });
  });

  it("keeps project-wide work cards from two URLs in the exact frozen run and excludes a stale-run action", async () => {
    const firstUrl = "00000000-0000-4000-8000-000000000101";
    const secondUrl = "00000000-0000-4000-8000-000000000102";
    const firstFinding = "00000000-0000-4000-8000-000000000111";
    const secondFinding = "00000000-0000-4000-8000-000000000112";
    const staleFinding = "00000000-0000-4000-8000-000000000113";

    vi.mocked(
      GrowthMapReadRepository.prototype.listCurrentRunUrls,
    ).mockResolvedValue({
      rows: [{ site_page_id: firstUrl }, { site_page_id: secondUrl }],
      nextCursor: null,
    } as never);
    vi.mocked(
      GrowthMapReadRepository.prototype.listResolvedTargets,
    ).mockResolvedValue([
      { finding_id: firstFinding, site_page_id: firstUrl },
      { finding_id: secondFinding, site_page_id: secondUrl },
    ] as never);
    mocks.listProjectActions.mockResolvedValue({
      data: [
        action("stale-critical", staleFinding, "critical"),
        action("url-one-high", firstFinding, "high"),
        action("url-two-medium", secondFinding, "medium"),
      ],
      nextCursor: null,
      limit: 100,
    });

    const view = await getWorkspaceView(SCOPE, SCOPE.projectId, "overview", null);

    expect(view.view).toBe("overview");
    if (view.view !== "overview") throw new Error("expected Overview view");
    expect(view.topActions.map((item) => item.id)).toEqual([
      "url-one-high",
      "url-two-medium",
    ]);
    expect(view.frozenDiagnosticRunId).toBe(
      "00000000-0000-4000-8000-000000000090",
    );
    expect(
      vi.mocked(GrowthMapReadRepository.prototype.listResolvedTargets),
    ).toHaveBeenCalledWith(
      SCOPE,
      "00000000-0000-4000-8000-000000000090",
      [firstUrl, secondUrl],
    );
  });

  it("returns a null frozen run and no legacy work cards when no readable audit exists", async () => {
    vi.mocked(
      GrowthMapReadRepository.prototype.findLatestReadableRun,
    ).mockResolvedValue(null);
    mocks.listProjectActions.mockResolvedValue({
      data: [action("legacy-critical", "legacy-finding", "critical")],
      nextCursor: null,
      limit: 100,
    });

    const view = await getWorkspaceView(SCOPE, SCOPE.projectId, "overview", null);

    expect(view.view).toBe("overview");
    if (view.view !== "overview") throw new Error("expected Overview view");
    expect(view.frozenDiagnosticRunId).toBeNull();
    expect(view.topActions).toEqual([]);
    expect(
      GrowthMapReadRepository.prototype.listCurrentRunUrls,
    ).not.toHaveBeenCalled();
  });

  it("fails explicitly when a resource cursor stops advancing", async () => {
    mocks.listProjectActions.mockImplementation(async (_scope, _projectId, options) => ({
      data: [action("action", "finding", "high")],
      nextCursor: options.cursor === null ? "stuck-cursor" : "stuck-cursor",
      limit: 100,
    }));

    await expect(
      getWorkspaceView(SCOPE, SCOPE.projectId, "overview", null),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: expect.stringContaining("pagination did not advance"),
    });
    expect(mocks.listProjectActions).toHaveBeenCalledTimes(2);
  });

  it("does not leave sibling readers running after an Overview dependency fails", async () => {
    const dependencyFailure = new Error("findings dependency failed");
    mocks.listProjectFindings.mockRejectedValueOnce(dependencyFailure);

    await expect(
      getWorkspaceView(SCOPE, SCOPE.projectId, "overview", null),
    ).rejects.toBe(dependencyFailure);

    expect(mocks.listProjectActions).not.toHaveBeenCalled();
    expect(mocks.listProjectSnapshots).not.toHaveBeenCalled();
    expect(mocks.listProjectArtifacts).not.toHaveBeenCalled();
  });

  it("keeps all 101 Plan actions when a concurrent update moves the last row ahead of page one", async () => {
    const movedDuringRead = action(
      "action-moved-during-read",
      "finding-moved-during-read",
      "high",
    );
    let concurrentUpdateCommitted = false;
    mocks.listProjectActions.mockImplementation(
      async (_scope, _projectId, options, exec) => {
        if (options.cursor === null) {
          // Model READ COMMITTED drift: after page one, a writer updates the
          // 101st row's `updated_at`, moving it ahead of the page-one cursor.
          concurrentUpdateCommitted = true;
          return {
            data: Array.from({ length: 100 }, (_, index) =>
              action(`action-${index}`, `finding-${index}`, "medium"),
            ),
            nextCursor: "actions-page-2",
            limit: 100,
          };
        }
        return {
          // A reader that left the original snapshot would now miss this row.
          data:
            concurrentUpdateCommitted && exec === READ_TX
              ? [movedDuringRead]
              : [],
          nextCursor: null,
          limit: 100,
        };
      },
    );

    const view = await getWorkspaceView(SCOPE, SCOPE.projectId, "plan", null);

    expect(view.view).toBe("plan");
    if (view.view !== "plan") throw new Error("expected Plan view");
    expect(view.actions).toHaveLength(101);
    expect(view.actions.at(-1)?.id).toBe(movedDuringRead.id);
    expect(mocks.listProjectActions).toHaveBeenCalledTimes(2);
    expect(mocks.listProjectActions.mock.calls[1]?.[3]).toBe(READ_TX);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  });

  it("returns every Studio artifact beyond the first 100-row page", async () => {
    mocks.listProjectArtifacts.mockImplementation(
      async (_scope, _projectId, options, exec) => {
        expect(exec).toBe(READ_TX);
        return options.cursor === null
          ? {
              data: Array.from({ length: 100 }, (_, index) =>
                artifact(`artifact-${index}`, `action-${index}`),
              ),
              nextCursor: "artifacts-page-2",
              limit: 100,
            }
          : {
              data: [artifact("artifact-100", "action-100")],
              nextCursor: null,
              limit: 100,
            };
      },
    );

    const view = await getWorkspaceView(SCOPE, SCOPE.projectId, "studio", null);

    expect(view.view).toBe("studio");
    if (view.view !== "studio") throw new Error("expected Studio view");
    expect(view.artifacts).toHaveLength(101);
    expect(view.artifacts.at(-1)?.id).toBe("artifact-100");
    expect(mocks.listProjectArtifacts).toHaveBeenCalledTimes(2);
  });

  it("fails a Plan projection after the bounded page budget is exhausted", async () => {
    mocks.listProjectActions.mockImplementation(
      async (_scope, _projectId, options) => ({
        data: [],
        nextCursor:
          options.cursor === null
            ? "actions-cursor-1"
            : `actions-cursor-${Number(options.cursor.split("-").at(-1)) + 1}`,
        limit: 100,
      }),
    );

    await expect(
      getWorkspaceView(SCOPE, SCOPE.projectId, "plan", null),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: expect.stringContaining("100-page safety budget"),
    });
    expect(mocks.listProjectActions).toHaveBeenCalledTimes(100);
  });
});
