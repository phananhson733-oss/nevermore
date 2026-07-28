import {
  ActionsRepository,
  ExecutionArtifactsRepository,
  MeasurementRunAlreadyActiveError,
  MeasurementRunAlreadyCompletedError,
  MeasurementRunIdempotencyConflictError,
  MeasurementWindowInvariantError,
  MeasurementWindowsRepository,
  ProjectsRepository,
  SitePagesRepository,
  type Executor,
} from "@sf/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const {
  createMeasurementWindowService,
  DefaultMeasurementWindowAuthority,
  listProjectMeasurementWindowHistory,
  listProjectRecentMeasurementWindows,
  MAX_MEASUREMENT_WINDOW_HISTORY_LIMIT,
  MEASUREMENT_CONTRACT_VERSION,
  MEASUREMENT_PROVIDER_SETTLEMENT_DELAY_DAYS,
} = await import("./measurement");

const ids = {
  workspace: "92000000-0000-4000-8000-000000000001",
  project: "92000000-0000-4000-8000-000000000002",
  site: "92000000-0000-4000-8000-000000000003",
  sitePage: "92000000-0000-4000-8000-000000000004",
  otherProject: "92000000-0000-4000-8000-000000000005",
  otherSite: "92000000-0000-4000-8000-000000000006",
  actor: "92000000-0000-4000-8000-000000000007",
  action: "92000000-0000-4000-8000-000000000008",
  artifact: "92000000-0000-4000-8000-000000000009",
  artifactRevision: "92000000-0000-4000-8000-00000000000a",
  publicationAttempt: "92000000-0000-4000-8000-00000000000b",
  publicationRun: "92000000-0000-4000-8000-00000000000c",
  changeReceipt: "92000000-0000-4000-8000-00000000000d",
  deliveryReceipt: "92000000-0000-4000-8000-00000000000e",
  measurementWindow: "92000000-0000-4000-8000-00000000000f",
  measurementRun: "92000000-0000-4000-8000-000000000010",
} as const;

const scope = { workspaceId: ids.workspace };
const projectScope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};
const target = {
  kind: "url" as const,
  targetRef: `site-page://${ids.sitePage}`,
  sitePageId: ids.sitePage,
};
const generatedAt = new Date("2026-07-28T08:09:10.123Z");
const exec = { kind: "measurement-read-test" } as unknown as Executor;

function installReadableTarget() {
  const project = vi
    .spyOn(ProjectsRepository.prototype, "findById")
    .mockResolvedValue({
      id: ids.project,
      workspace_id: ids.workspace,
    } as never);
  const page = vi
    .spyOn(SitePagesRepository.prototype, "findById")
    .mockResolvedValue({
      id: ids.sitePage,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      normalized_url:
        "https://relayops.example/blog/customer-onboarding/",
    } as never);
  const history = vi
    .spyOn(MeasurementWindowsRepository.prototype, "listByTarget")
    .mockResolvedValue([]);
  return { history, page, project };
}

function installReadableProject() {
  const project = vi
    .spyOn(ProjectsRepository.prototype, "findById")
    .mockResolvedValue({
      id: ids.project,
      workspace_id: ids.workspace,
    } as never);
  const recent = vi
    .spyOn(MeasurementWindowsRepository.prototype, "listRecent")
    .mockResolvedValue([]);
  return { project, recent };
}

beforeEach(() => {
  mocks.getDb.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Measurement Window history read service", () => {
  it("returns a fixed, contract-valid empty history for an exact scoped target", async () => {
    const { history, page, project } = installReadableTarget();

    const result = await listProjectMeasurementWindowHistory(
      scope,
      ids.project,
      target,
      { limit: 25, generatedAt },
      exec,
    );

    expect(result).toEqual({
      projectId: ids.project,
      target,
      windows: [],
      generatedAt: "2026-07-28T08:09:10.123Z",
    });
    expect(project).toHaveBeenCalledWith(scope, ids.project);
    expect(page).toHaveBeenCalledWith(projectScope, ids.sitePage);
    expect(history).toHaveBeenCalledWith(projectScope, target, {
      limit: 25,
    });
  });

  it("returns 404 for a missing or foreign project without probing its target", async () => {
    const project = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(null);
    const page = vi.spyOn(SitePagesRepository.prototype, "findById");
    const history = vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "listByTarget",
    );

    await expect(
      listProjectMeasurementWindowHistory(
        scope,
        ids.project,
        target,
        { limit: 25, generatedAt },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Project not found.",
    });
    expect(project).toHaveBeenCalledWith(scope, ids.project);
    expect(page).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing",
      page: null,
    },
    {
      name: "workspace drift",
      page: {
        id: ids.sitePage,
        workspace_id: "92000000-0000-4000-8000-000000000099",
        project_id: ids.project,
        site_id: ids.site,
      },
    },
    {
      name: "project drift",
      page: {
        id: ids.sitePage,
        workspace_id: ids.workspace,
        project_id: ids.otherProject,
        site_id: ids.site,
      },
    },
    {
      name: "identity drift",
      page: {
        id: "92000000-0000-4000-8000-000000000099",
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
      },
    },
  ])(
    "returns the same non-enumerating 404 for a $name SitePage",
    async ({ page: selectedPage }) => {
      vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
        id: ids.project,
        workspace_id: ids.workspace,
      } as never);
      vi.spyOn(SitePagesRepository.prototype, "findById").mockResolvedValue(
        selectedPage as never,
      );
      const history = vi.spyOn(
        MeasurementWindowsRepository.prototype,
        "listByTarget",
      );

      await expect(
        listProjectMeasurementWindowHistory(
          scope,
          ids.project,
          target,
          { limit: 25, generatedAt },
          exec,
        ),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Measurement target not found.",
      });
      expect(history).not.toHaveBeenCalled();
    },
  );

  it("returns 404 when targetRef is not the SitePage's server-derived identity", async () => {
    const { history } = installReadableTarget();

    await expect(
      listProjectMeasurementWindowHistory(
        scope,
        ids.project,
        {
          ...target,
          targetRef: "site-page://relayops/customer-onboarding",
        },
        { limit: 25, generatedAt },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Measurement target not found.",
    });
    expect(history).not.toHaveBeenCalled();
  });

  it("maps an invalid persisted projection to a customer-safe dependency error", async () => {
    const { history } = installReadableTarget();
    history.mockRejectedValueOnce(
      new MeasurementWindowInvariantError("MEASUREMENT_INTEGRITY_INVALID"),
    );

    await expect(
      listProjectMeasurementWindowHistory(
        scope,
        ids.project,
        target,
        { limit: 25, generatedAt },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message:
        "The Measurement Window history failed its scope or integrity checks.",
    });
  });

  it.each([
    {
      name: "project",
      window: {
        projectId: ids.otherProject,
        siteId: ids.site,
        target,
      },
    },
    {
      name: "Site",
      window: {
        projectId: ids.project,
        siteId: ids.otherSite,
        target,
      },
    },
    {
      name: "target",
      window: {
        projectId: ids.project,
        siteId: ids.site,
        target: {
          ...target,
          targetRef: "site-page://92000000-0000-4000-8000-000000000099",
        },
      },
    },
  ])(
    "fails closed when a repository row crosses the exact $name scope",
    async ({ window }) => {
      const { history } = installReadableTarget();
      history.mockResolvedValueOnce([window] as never);

      await expect(
        listProjectMeasurementWindowHistory(
          scope,
          ids.project,
          target,
          { limit: 25, generatedAt },
          exec,
        ),
      ).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        message:
          "The Measurement Window history failed its scope or integrity checks.",
      });
    },
  );

  it.each([
    {
      name: "zero limit",
      target,
      limit: 0,
      generatedAt,
    },
    {
      name: "oversized limit",
      target,
      limit: MAX_MEASUREMENT_WINDOW_HISTORY_LIMIT + 1,
      generatedAt,
    },
    {
      name: "fractional limit",
      target,
      limit: 1.5,
      generatedAt,
    },
    {
      name: "invalid target",
      target: { ...target, targetRef: "" },
      limit: 25,
      generatedAt,
    },
    {
      name: "invalid generatedAt",
      target,
      limit: 25,
      generatedAt: new Date(Number.NaN),
    },
  ])(
    "rejects $name before database access",
    async (input) => {
      const project = vi.spyOn(ProjectsRepository.prototype, "findById");

      await expect(
        listProjectMeasurementWindowHistory(
          scope,
          ids.project,
          input.target,
          { limit: input.limit, generatedAt: input.generatedAt },
          exec,
        ),
      ).rejects.toBeInstanceOf(RangeError);
      expect(project).not.toHaveBeenCalled();
    },
  );

  it("uses one repeatable-read, read-only transaction for a production read", async () => {
    const sentinel = new Error("stop before repository reads");
    const transaction = vi.fn(
      async (
        callback: (tx: unknown) => Promise<unknown>,
        options: Record<string, unknown>,
      ) => {
        expect(callback).toEqual(expect.any(Function));
        expect(options).toEqual({
          isolationLevel: "repeatable read",
          accessMode: "read only",
        });
        throw sentinel;
      },
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    await expect(
      listProjectMeasurementWindowHistory(
        scope,
        ids.project,
        target,
        { limit: 25, generatedAt },
      ),
    ).rejects.toBe(sentinel);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("samples generatedAt inside the production transaction after its snapshot reads", async () => {
    installReadableTarget();
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-28T08:00:00.000Z");
    const transaction = vi.fn(
      async (
        callback: (tx: Executor) => Promise<unknown>,
        options: Record<string, unknown>,
      ) => {
        expect(options).toEqual({
          isolationLevel: "repeatable read",
          accessMode: "read only",
        });
        vi.setSystemTime("2026-07-28T08:01:00.000Z");
        return callback(exec);
      },
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    const result = await listProjectMeasurementWindowHistory(
      scope,
      ids.project,
      target,
      { limit: 25 },
    );

    expect(result.generatedAt).toBe("2026-07-28T08:01:00.000Z");
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("recent project Measurement Window read service", () => {
  it("returns a contract-valid empty cross-target projection for a scoped project", async () => {
    const { project, recent } = installReadableProject();
    const page = vi.spyOn(
      SitePagesRepository.prototype,
      "findById",
    );

    const result = await listProjectRecentMeasurementWindows(
      scope,
      ids.project,
      { limit: 25, generatedAt },
      exec,
    );

    expect(result).toEqual({
      projectId: ids.project,
      windows: [],
      generatedAt: "2026-07-28T08:09:10.123Z",
    });
    expect(project).toHaveBeenCalledWith(scope, ids.project);
    expect(recent).toHaveBeenCalledWith(projectScope, { limit: 25 });
    expect(page).not.toHaveBeenCalled();
  });

  it("returns a non-enumerating 404 for a missing or foreign project", async () => {
    const project = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(null);
    const recent = vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "listRecent",
    );

    await expect(
      listProjectRecentMeasurementWindows(
        scope,
        ids.project,
        { limit: 25, generatedAt },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Project not found.",
    });
    expect(project).toHaveBeenCalledWith(scope, ids.project);
    expect(recent).not.toHaveBeenCalled();
  });

  it("maps repository integrity failures to a customer-safe dependency error", async () => {
    const { recent } = installReadableProject();
    recent.mockRejectedValueOnce(
      new MeasurementWindowInvariantError("MEASUREMENT_INTEGRITY_INVALID"),
    );

    await expect(
      listProjectRecentMeasurementWindows(
        scope,
        ids.project,
        { limit: 25, generatedAt },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message:
        "The Measurement Window history failed its scope or integrity checks.",
    });
  });

  it("fails closed when a repository row crosses project scope", async () => {
    const { recent } = installReadableProject();
    recent.mockResolvedValueOnce([
      {
        projectId: ids.otherProject,
      },
    ] as never);

    await expect(
      listProjectRecentMeasurementWindows(
        scope,
        ids.project,
        { limit: 25, generatedAt },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message:
        "The Measurement Window history failed its scope or integrity checks.",
    });
  });

  it.each([0, MAX_MEASUREMENT_WINDOW_HISTORY_LIMIT + 1, 1.5])(
    "rejects invalid limit %s before database access",
    async (limit) => {
      const project = vi.spyOn(
        ProjectsRepository.prototype,
        "findById",
      );

      await expect(
        listProjectRecentMeasurementWindows(
          scope,
          ids.project,
          { limit, generatedAt },
          exec,
        ),
      ).rejects.toBeInstanceOf(RangeError);
      expect(project).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid projection clock before database access", async () => {
    const project = vi.spyOn(
      ProjectsRepository.prototype,
      "findById",
    );

    await expect(
      listProjectRecentMeasurementWindows(
        scope,
        ids.project,
        {
          limit: 25,
          generatedAt: new Date(Number.NaN),
        },
        exec,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(project).not.toHaveBeenCalled();
  });

  it("uses one repeatable-read, read-only transaction and samples its clock after reads", async () => {
    installReadableProject();
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-28T08:00:00.000Z");
    const transaction = vi.fn(
      async (
        callback: (tx: Executor) => Promise<unknown>,
        options: Record<string, unknown>,
      ) => {
        expect(options).toEqual({
          isolationLevel: "repeatable read",
          accessMode: "read only",
        });
        vi.setSystemTime("2026-07-28T08:01:00.000Z");
        return callback(exec);
      },
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    const result = await listProjectRecentMeasurementWindows(
      scope,
      ids.project,
      { limit: 25 },
    );

    expect(result.generatedAt).toBe("2026-07-28T08:01:00.000Z");
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

const artifactContentHash = "a".repeat(64);
const contentChecksum = "b".repeat(64);
const changeObservedAt = "2026-07-01T12:34:56.789Z";
const createRequest = {
  changeReceiptId: ids.changeReceipt,
  idempotencyKey: "measurement-window-create-1",
};

function exactMeasurementAuthority() {
  return {
    receipt: {
      id: ids.changeReceipt,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      publication_attempt_id: ids.publicationAttempt,
      receipt_kind: "change_receipt",
      predecessor_delivery_receipt_id: ids.deliveryReceipt,
      provider_kind: "github",
      provider_request_id: "github-request-1",
      remote_scope_ref: "relayops/site",
      remote_object_kind: "github_merge",
      remote_object_id: "merge-1",
      remote_revision: "sha-live",
      delivery_url:
        "https://relayops.example/blog/customer-onboarding/",
      live_canonical_url:
        "https://relayops.example/blog/customer-onboarding/",
      artifact_content_hash: artifactContentHash,
      content_checksum: contentChecksum,
      verification_state: "verified_live",
      remote_facts: {},
      evidence_refs: [],
      limitation: null,
      observed_at: changeObservedAt,
      created_at: changeObservedAt,
    },
    deliveryReceipt: {
      id: ids.deliveryReceipt,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      publication_attempt_id: ids.publicationAttempt,
      receipt_kind: "delivery_receipt",
      predecessor_delivery_receipt_id: null,
      provider_kind: "github",
      provider_request_id: "github-request-1",
      remote_scope_ref: "relayops/site",
      remote_object_kind: "github_merge",
      remote_object_id: "merge-1",
      remote_revision: "sha-live",
      delivery_url:
        "https://relayops.example/blog/customer-onboarding/",
      live_canonical_url: null,
      artifact_content_hash: artifactContentHash,
      content_checksum: contentChecksum,
      verification_state: "provider_accepted",
      remote_facts: {},
      evidence_refs: [],
      limitation: null,
      observed_at: "2026-07-01T12:30:00.000Z",
      created_at: "2026-07-01T12:30:00.000Z",
    },
    attempt: {
      id: ids.publicationAttempt,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      async_run_id: ids.publicationRun,
      action_id: ids.action,
      artifact_id: ids.artifact,
      artifact_revision_id: ids.artifactRevision,
      approved_artifact_revision: 3,
      approved_artifact_content_hash: artifactContentHash,
      content_checksum: contentChecksum,
    },
    run: {
      id: ids.publicationRun,
      workspace_id: ids.workspace,
      project_id: ids.project,
      kind: "publication",
      status: "completed",
      result_type: "publication_attempt",
      result_id: ids.publicationAttempt,
    },
    action: {
      id: ids.action,
      workspace_id: ids.workspace,
      project_id: ids.project,
    },
    artifact: {
      id: ids.artifact,
      workspace_id: ids.workspace,
      project_id: ids.project,
      action_id: ids.action,
    },
    artifactRevision: {
      id: ids.artifactRevision,
      workspace_id: ids.workspace,
      project_id: ids.project,
      artifact_id: ids.artifact,
      revision: 3,
      content_hash: artifactContentHash,
    },
    site: {
      id: ids.site,
      workspace_id: ids.workspace,
      project_id: ids.project,
    },
    sitePage: {
      id: ids.sitePage,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      normalized_url:
        "https://relayops.example/blog/customer-onboarding/",
    },
  };
}

describe("Measurement Window create service", () => {
  it("loads and locks the exact verified publication authority inside the transaction", async () => {
    const facts = exactMeasurementAuthority();
    const findReceipt = vi
      .spyOn(
        MeasurementWindowsRepository.prototype,
        "findChangeReceiptForMeasurement",
      )
      .mockResolvedValue({
        receipt: facts.receipt,
        attempt: facts.attempt,
        run: facts.run,
        site: facts.site,
        sitePage: facts.sitePage,
        deliveryReceipt: facts.deliveryReceipt,
      } as never);
    const findAction = vi
      .spyOn(ActionsRepository.prototype, "findByIdForUpdate")
      .mockResolvedValue(facts.action as never);
    const findArtifact = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "findByIdForUpdate")
      .mockResolvedValue(facts.artifact as never);
    const findRevision = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "findRevision")
      .mockResolvedValue(facts.artifactRevision as never);

    await expect(
      new DefaultMeasurementWindowAuthority().loadCurrentFacts(exec, {
        ...projectScope,
        changeReceiptId: ids.changeReceipt,
        lock: true,
      }),
    ).resolves.toEqual(facts);

    expect(findReceipt).toHaveBeenCalledWith(
      projectScope,
      ids.changeReceipt,
      { lock: true },
    );
    expect(findAction).toHaveBeenCalledWith(projectScope, ids.action);
    expect(findArtifact).toHaveBeenCalledWith(
      projectScope,
      ids.artifact,
    );
    expect(findRevision).toHaveBeenCalledWith(
      projectScope,
      ids.artifact,
      3,
    );
  });

  it("freezes exact verified Change Receipt lineage and absolute symmetric windows before delayed enqueue", async () => {
    const authority = {
      loadCurrentFacts: vi.fn(async () => exactMeasurementAuthority()),
    };
    const createRunAtomically = vi.fn(
      async (command: {
        resolveCurrentFacts(exec: Executor): Promise<unknown>;
      }) => {
        const frozen = await command.resolveCurrentFacts(exec);
        expect(frozen).toEqual({
          workspaceId: ids.workspace,
          projectId: ids.project,
          changeReceiptId: ids.changeReceipt,
          publicationAttemptId: ids.publicationAttempt,
          siteId: ids.site,
          sitePageId: ids.sitePage,
          target: {
            kind: "url",
            targetRef: `site-page://${ids.sitePage}`,
            sitePageId: ids.sitePage,
          },
          actionId: ids.action,
          artifactId: ids.artifact,
          artifactRevisionId: ids.artifactRevision,
          artifactRevision: 3,
          artifactContentHash,
          contentChecksum,
          timelineDeliveryReceiptId: ids.deliveryReceipt,
          url: "https://relayops.example/blog/customer-onboarding/",
          canonicalUrl:
            "https://relayops.example/blog/customer-onboarding/",
          beforeWindow: {
            startAt: "2026-06-03T12:34:56.789Z",
            endAt: changeObservedAt,
          },
          afterWindow: {
            startAt: changeObservedAt,
            endAt: "2026-07-29T12:34:56.789Z",
          },
          timezone: "UTC",
          interpretation: "observational_non_causal",
          startAfter: "2026-08-02T12:34:56.789Z",
        });
        return {
          run: { id: ids.measurementRun },
          measurementWindowId: ids.measurementWindow,
          replayed: false,
        };
      },
    );
    const service = createMeasurementWindowService({
      db: exec,
      authority,
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    const result = await service.create(
      scope,
      ids.project,
      ids.actor,
      createRequest.idempotencyKey,
      createRequest,
    );

    expect(result).toEqual({
      measurementWindowId: ids.measurementWindow,
      asyncRunId: ids.measurementRun,
      state: "pending",
      replayed: false,
      location: `/api/mvp/projects/${ids.project}/runs/${ids.measurementRun}`,
    });
    expect(createRunAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ids.workspace,
        projectId: ids.project,
        changeReceiptId: ids.changeReceipt,
        idempotencyKey: createRequest.idempotencyKey,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        requestedBy: ids.actor,
        contractVersion: "measurement.0.1.0",
        resolveCurrentFacts: expect.any(Function),
      }),
    );
    expect(authority.loadCurrentFacts).toHaveBeenCalledWith(exec, {
      workspaceId: ids.workspace,
      projectId: ids.project,
      changeReceiptId: ids.changeReceipt,
      lock: true,
    });
    expect(MEASUREMENT_PROVIDER_SETTLEMENT_DELAY_DAYS).toBe(4);
  });

  it("returns the same strict accepted identity for a permanent exact replay", async () => {
    const createRunAtomically = vi.fn(async () => ({
      run: { id: ids.measurementRun },
      measurementWindowId: ids.measurementWindow,
      replayed: true,
    }));
    const authority = { loadCurrentFacts: vi.fn() };
    const service = createMeasurementWindowService({
      db: exec,
      authority,
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    await expect(
      service.create(
        scope,
        ids.project,
        ids.actor,
        createRequest.idempotencyKey,
        createRequest,
      ),
    ).resolves.toMatchObject({
      measurementWindowId: ids.measurementWindow,
      asyncRunId: ids.measurementRun,
      state: "pending",
      replayed: true,
    });
    expect(authority.loadCurrentFacts).not.toHaveBeenCalled();
  });

  it("rejects a Delivery Receipt as the lifecycle anchor even if a dependency returns it", async () => {
    const facts = exactMeasurementAuthority();
    const authority = {
      loadCurrentFacts: vi.fn(async () => ({
        ...facts,
        receipt: {
          ...facts.receipt,
          receipt_kind: "delivery_receipt",
          verification_state: "provider_accepted",
        },
      })),
    };
    const createRunAtomically = vi.fn(
      async (command: {
        resolveCurrentFacts(exec: Executor): Promise<unknown>;
      }) => {
        await command.resolveCurrentFacts(exec);
        throw new Error("unreachable");
      },
    );
    const service = createMeasurementWindowService({
      db: exec,
      authority,
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    await expect(
      service.create(
        scope,
        ids.project,
        ids.actor,
        createRequest.idempotencyKey,
        createRequest,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fails closed when publication, action, Artifact Revision, SitePage, or checksum lineage drifts", async () => {
    const facts = exactMeasurementAuthority();
    const authority = {
      loadCurrentFacts: vi.fn(async () => ({
        ...facts,
        artifactRevision: {
          ...facts.artifactRevision,
          id: "92000000-0000-4000-8000-000000000099",
        },
      })),
    };
    const createRunAtomically = vi.fn(
      async (command: {
        resolveCurrentFacts(exec: Executor): Promise<unknown>;
      }) => {
        await command.resolveCurrentFacts(exec);
        throw new Error("unreachable");
      },
    );
    const service = createMeasurementWindowService({
      db: exec,
      authority,
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    await expect(
      service.create(
        scope,
        ids.project,
        ids.actor,
        createRequest.idempotencyKey,
        createRequest,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("fails closed instead of scheduling from an unreadable Change Receipt clock", async () => {
    const facts = exactMeasurementAuthority();
    const authority = {
      loadCurrentFacts: vi.fn(async () => ({
        ...facts,
        receipt: { ...facts.receipt, observed_at: "not-an-instant" },
      })),
    };
    const createRunAtomically = vi.fn(
      async (command: {
        resolveCurrentFacts(exec: Executor): Promise<unknown>;
      }) => {
        await command.resolveCurrentFacts(exec);
        throw new Error("unreachable");
      },
    );
    const service = createMeasurementWindowService({
      db: exec,
      authority,
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    await expect(
      service.create(
        scope,
        ids.project,
        ids.actor,
        createRequest.idempotencyKey,
        createRequest,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("rejects a body/header idempotency mismatch before database access", async () => {
    const createRunAtomically = vi.fn();
    const service = createMeasurementWindowService({
      db: exec,
      authority: { loadCurrentFacts: vi.fn() },
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    await expect(
      service.create(
        scope,
        ids.project,
        ids.actor,
        "different-header-key",
        createRequest,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(createRunAtomically).not.toHaveBeenCalled();
  });

  it("maps permanent-key reuse with different facts to an explicit idempotency conflict", async () => {
    const createRunAtomically = vi.fn(async () => {
      throw new MeasurementRunIdempotencyConflictError();
    });
    const service = createMeasurementWindowService({
      db: exec,
      authority: { loadCurrentFacts: vi.fn() },
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    await expect(
      service.create(
        scope,
        ids.project,
        ids.actor,
        createRequest.idempotencyKey,
        createRequest,
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("maps an active run conflict to the exact recoverable run pointer", async () => {
    const createRunAtomically = vi.fn(async () => {
      throw new MeasurementRunAlreadyActiveError(ids.measurementRun);
    });
    const service = createMeasurementWindowService({
      db: exec,
      authority: { loadCurrentFacts: vi.fn() },
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    const rejection = service.create(
      scope,
      ids.project,
      ids.actor,
      createRequest.idempotencyKey,
      createRequest,
    );

    await expect(rejection).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      extraHeaders: {
        Location: `/api/mvp/projects/${ids.project}/runs/${ids.measurementRun}`,
      },
      current: {
        runId: ids.measurementRun,
        statusUrl: `/api/mvp/projects/${ids.project}/runs/${ids.measurementRun}`,
      },
    });
  });

  it("maps an already completed Change Receipt to its exact recoverable result pointer", async () => {
    const createRunAtomically = vi.fn(async () => {
      throw new MeasurementRunAlreadyCompletedError(
        ids.measurementRun,
        ids.measurementWindow,
      );
    });
    const service = createMeasurementWindowService({
      db: exec,
      authority: { loadCurrentFacts: vi.fn() },
      createStore: () => ({ createRunAtomically }),
      contractVersion: MEASUREMENT_CONTRACT_VERSION,
    });

    const rejection = service.create(
      scope,
      ids.project,
      ids.actor,
      createRequest.idempotencyKey,
      createRequest,
    );

    await expect(rejection).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      extraHeaders: {
        Location: `/api/mvp/projects/${ids.project}/runs/${ids.measurementRun}`,
      },
      current: {
        runId: ids.measurementRun,
        statusUrl: `/api/mvp/projects/${ids.project}/runs/${ids.measurementRun}`,
        measurementWindowId: ids.measurementWindow,
        state: "completed",
      },
    });
  });
});
