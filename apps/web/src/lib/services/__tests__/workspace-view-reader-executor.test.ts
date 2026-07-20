import {
  ActionsRepository,
  AsyncRunsRepository,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ProjectsRepository,
  SitesRepository,
  type Executor,
  type WorkspaceScope,
} from "@sf/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const [
  { listProjectActions },
  { listProjectArtifacts },
  { listProjectFindings },
  { getProject },
  { listProjectSnapshots },
] = await Promise.all([
  import("@/lib/services/actions-service"),
  import("@/lib/services/artifacts"),
  import("@/lib/services/findings-list"),
  import("@/lib/services/projects"),
  import("@/lib/services/snapshots"),
]);

const SCOPE: WorkspaceScope = { workspaceId: "workspace" };
const PROJECT_ID = "project";
const TIME = "2026-07-19T00:00:00.000Z";
const READ_TX = {
  role: "workspace-repeatable-read-snapshot",
} as unknown as Executor;
const PROJECT_ROW = {
  id: PROJECT_ID,
  workspace_id: SCOPE.workspaceId,
  client_name: "Client",
  project_name: "Project",
  stage: "active",
  current_icp_profile_id: "icp-1",
  default_delivery_locale: "en",
  created_at: TIME,
  updated_at: TIME,
  archived_at: null,
} as never;
const SITE_ROW = {
  id: "site-1",
  origin: "https://example.test",
  host: "example.test",
  market_codes: ["US"],
  language_codes: ["en"],
} as never;
const ICP_ROW = {
  id: "icp-1",
  project_id: PROJECT_ID,
  version: 1,
  status: "draft",
  profile: {},
  content_hash: "hash",
  created_at: TIME,
} as never;
const FINDING_ROW = {
  id: "finding-1",
  workspace_id: SCOPE.workspaceId,
  project_id: PROJECT_ID,
  finding_key: "finding-key",
  rule_id: "TECH-HTTP-001",
  rule_version: 1,
  rule_family: "http-status",
  intent: "restore_or_redirect",
  domain: "technical_seo",
  title_key: "finding.http_status",
  title_args: {},
  summary: "Finding summary",
  summary_locale: "en",
  summary_invocation_id: null,
  subject_refs: [],
  severity: "high",
  confidence: "high",
  review_state: "confirmed",
  review_revision: 1,
  review_reason: null,
  review_note: null,
  active: true,
  regressed: false,
  first_seen_run_id: "diag-1",
  last_seen_run_id: "diag-1",
  first_seen_at: TIME,
  last_seen_at: TIME,
  resolved_at: null,
  created_at: TIME,
  updated_at: TIME,
} as never;
const ARTIFACT_ROW = {
  id: "artifact-1",
  workspace_id: SCOPE.workspaceId,
  project_id: PROJECT_ID,
  action_id: "action-1",
  artifact_type: "technical_ticket",
  status: "ready",
  generation_mode: "template",
  output_locale: "en",
  current_revision: 1,
  validation_state: "valid",
  content_hash: "hash",
  latest_generation_run_id: null,
  created_by: "operator",
  created_at: TIME,
  updated_at: TIME,
} as never;
const ARTIFACT_REVISION_ROW = {
  id: "artifact-revision-1",
  workspace_id: SCOPE.workspaceId,
  project_id: PROJECT_ID,
  artifact_id: "artifact-1",
  revision: 1,
  output_locale: "en",
  content_format: "markdown",
  content_text: "content",
  content_json: null,
  content_hash: "hash",
  generated_by: "template",
  editor_id: null,
  analysis_invocation_id: null,
  note: null,
  validation_errors: [],
  created_at: TIME,
} as never;

const CASES = [
  {
    reader: "actions",
    read: () =>
      listProjectActions(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null },
        READ_TX,
      ),
  },
  {
    reader: "artifacts",
    read: () =>
      listProjectArtifacts(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null },
        READ_TX,
      ),
  },
  {
    reader: "findings",
    read: () =>
      listProjectFindings(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null, activeOnly: false },
        READ_TX,
      ),
  },
  {
    reader: "project aggregate",
    read: () => getProject(SCOPE, PROJECT_ID, READ_TX),
  },
  {
    reader: "snapshots",
    read: () =>
      listProjectSnapshots(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null },
        READ_TX,
      ),
  },
] as const;

describe("workspace canonical reader executor injection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getDb.mockReset().mockImplementation(() => {
      throw new Error("global database must not be opened inside the snapshot");
    });
  });

  it.each(CASES)(
    "uses the supplied transaction for $reader at the project gate",
    async ({ read }) => {
    const projectRead = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(null);

    await expect(read()).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mocks.getDb).not.toHaveBeenCalled();
      expect(projectRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    },
  );

  it("keeps project aggregate site and ICP reads on the supplied executor", async () => {
    const projectRead = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(PROJECT_ROW);
    const siteRead = vi
      .spyOn(SitesRepository.prototype, "findPrimary")
      .mockResolvedValue(SITE_ROW);
    const icpRead = vi
      .spyOn(IcpProfilesRepository.prototype, "findById")
      .mockResolvedValue(ICP_ROW);

    await expect(getProject(SCOPE, PROJECT_ID, READ_TX)).resolves.toMatchObject({
      id: PROJECT_ID,
      site: { id: "site-1" },
      currentIcpProfileVersion: 1,
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(projectRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(siteRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(icpRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
  });

  it("keeps action and snapshot page reads on the supplied executor", async () => {
    const projectRead = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(PROJECT_ROW);
    const actionRead = vi
      .spyOn(ActionsRepository.prototype, "list")
      .mockResolvedValue({ rows: [], nextCursor: null });
    const snapshotRead = vi
      .spyOn(DataSnapshotsRepository.prototype, "listByProject")
      .mockResolvedValue({ rows: [], nextCursor: null });

    await expect(
      listProjectActions(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null },
        READ_TX,
      ),
    ).resolves.toMatchObject({ data: [], nextCursor: null });
    await expect(
      listProjectSnapshots(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null },
        READ_TX,
      ),
    ).resolves.toMatchObject({ data: [], nextCursor: null });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(
      projectRead.mock.contexts.every(
        (context) =>
          (context as unknown as { exec: Executor }).exec === READ_TX,
      ),
    ).toBe(true);
    expect(actionRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(snapshotRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
  });

  it("keeps findings evidence and diagnostic sidecar reads on the supplied executor", async () => {
    const projectRead = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(PROJECT_ROW);
    const findingRead = vi
      .spyOn(FindingsRepository.prototype, "list")
      .mockResolvedValue({ rows: [FINDING_ROW], nextCursor: null });
    const evidenceLinksRead = vi
      .spyOn(EvidenceRepository.prototype, "listForFindings")
      .mockResolvedValue([{ finding_id: "finding-1", evidence_id: "evidence-1" }] as never);
    const evidenceRowsRead = vi
      .spyOn(EvidenceRepository.prototype, "findByIds")
      .mockResolvedValue([
        {
          id: "evidence-1",
          source_provider: "crawl",
          origin: "crawl_pages",
          method: "HTTP response inspection",
          grade: "A",
          availability: "available",
          support: "supports",
          subject_refs: [],
          claim: "Claim",
          observed_at: TIME,
          limitation: "Limitation",
          snapshot_id: null,
          analysis_invocation_id: null,
        },
      ] as never);
    const latestRead = vi
      .spyOn(DiagnosticRunsRepository.prototype, "findLatest")
      .mockResolvedValue(null);

    await expect(
      listProjectFindings(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null, activeOnly: false },
        READ_TX,
      ),
    ).resolves.toMatchObject({
      data: [{ id: "finding-1" }],
      meta: { nextCursor: null, latestRun: null },
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(projectRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(findingRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(evidenceLinksRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(evidenceRowsRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(latestRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
  });

  it("keeps latest diagnostic run and rule-result leaf reads on the supplied executor", async () => {
    const projectRead = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(PROJECT_ROW);
    const findingRead = vi
      .spyOn(FindingsRepository.prototype, "list")
      .mockResolvedValue({ rows: [], nextCursor: null });
    const latestRead = vi
      .spyOn(DiagnosticRunsRepository.prototype, "findLatest")
      .mockResolvedValue({
        id: "diagnostic-1",
        coverage: { overall: "partial", domains: {}, limitations: [] },
      } as never);
    const runRead = vi
      .spyOn(AsyncRunsRepository.prototype, "findById")
      .mockResolvedValue(null);
    const ruleResultsRead = vi
      .spyOn(DiagnosticRunsRepository.prototype, "listRuleResults")
      .mockResolvedValue([]);

    await expect(
      listProjectFindings(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null, activeOnly: false },
        READ_TX,
      ),
    ).resolves.toMatchObject({
      data: [],
      meta: { latestRun: null, coverage: { overall: "partial" } },
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    for (const read of [
      projectRead,
      findingRead,
      latestRead,
      runRead,
      ruleResultsRead,
    ]) {
      expect(read.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    }
  });

  it("keeps artifact revision reads on the supplied executor", async () => {
    const projectRead = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(PROJECT_ROW);
    const artifactListRead = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "listByProject")
      .mockResolvedValue({ rows: [ARTIFACT_ROW], nextCursor: null });
    const revisionRead = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "findRevision")
      .mockResolvedValue(ARTIFACT_REVISION_ROW);
    const runRead = vi.spyOn(AsyncRunsRepository.prototype, "findById");

    await expect(
      listProjectArtifacts(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null },
        READ_TX,
      ),
    ).resolves.toMatchObject({
      data: [{ id: "artifact-1", currentRevision: 1 }],
      nextCursor: null,
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(projectRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(artifactListRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(revisionRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(runRead).not.toHaveBeenCalled();
  });

  it("keeps artifact active-run leaf reads on the supplied executor", async () => {
    const projectRead = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue(PROJECT_ROW);
    const artifactListRead = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "listByProject")
      .mockResolvedValue({
        rows: [
          {
            ...(ARTIFACT_ROW as unknown as Record<string, unknown>),
            current_revision: 0,
            latest_generation_run_id: "generation-run-1",
          } as never,
        ],
        nextCursor: null,
      });
    const runRead = vi
      .spyOn(AsyncRunsRepository.prototype, "findById")
      .mockResolvedValue(null);

    await expect(
      listProjectArtifacts(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null },
        READ_TX,
      ),
    ).resolves.toMatchObject({
      data: [{ id: "artifact-1", currentRevision: 0, activeRun: null }],
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(projectRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(artifactListRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
    expect(runRead.mock.contexts[0]).toMatchObject({ exec: READ_TX });
  });
});
