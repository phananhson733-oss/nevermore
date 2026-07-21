import {
  ActionsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  type ActionRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type FindingRow,
} from "@sf/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/services/projects", () => ({ getProject: mocks.getProject }));

const { getProjectReport } = await import("@/lib/services/report");

const TIME = "2026-07-19T00:00:00.000Z";
const SCOPE = { workspaceId: "workspace", projectId: "project" };
const SNAPSHOT_TX = { role: "report-snapshot" };
const EN_METHODOLOGY =
  "Findings are derived from deterministic rules over first-party and public evidence; " +
  "no result, ranking, or revenue outcome is promised.";
const ZH_CN_METHODOLOGY =
  "发现由确定性规则基于第一方和公开证据得出；不承诺任何结果、排名或收入表现。";
const OVERSIZED_REPORT_VALUE = "x".repeat(16 * 1024 * 1024);

function finding(id: string, reviewState: string): FindingRow {
  return {
    id,
    workspace_id: SCOPE.workspaceId,
    project_id: SCOPE.projectId,
    finding_key: `key-${id}`,
    rule_id: "TECH-HTTP-001",
    rule_version: 1,
    rule_family: "http-status",
    intent: "restore_or_redirect",
    domain: "technical_seo",
    title_key: "finding.http_status",
    title_args: {},
    summary: `Finding ${id}`,
    summary_locale: "en",
    summary_invocation_id: null,
    subject_refs: ["http_status:404"],
    severity: "high",
    confidence: "high",
    review_state: reviewState,
    review_revision: 0,
    review_reason: null,
    review_note: null,
    active: true,
    regressed: false,
    first_seen_run_id: "run",
    last_seen_run_id: "run",
    first_seen_at: TIME,
    last_seen_at: TIME,
    resolved_at: null,
    created_at: TIME,
    updated_at: TIME,
  };
}

function action(id: string, status: string): ActionRow {
  return {
    id,
    workspace_id: SCOPE.workspaceId,
    project_id: SCOPE.projectId,
    source_finding_id: "eligible-finding",
    source_diagnostic_run_id: "diagnostic-run-1",
    action_key: `key-${id}`,
    template_id: "technical_fix_v1",
    template_version: 1,
    title: `Action ${id}`,
    description: "Fix the issue.",
    content_locale: "en",
    priority_band: "high",
    roadmap_lane: "now",
    status,
    effort: "small",
    risk: "low",
    expected_outcome: "Issue is resolved.",
    evidence_refs: [],
    revision: 0,
    created_by: "operator",
    created_at: TIME,
    updated_at: TIME,
  };
}

function artifact(id: string, status: string): ArtifactRow {
  return {
    id,
    workspace_id: SCOPE.workspaceId,
    project_id: SCOPE.projectId,
    action_id: "eligible-action",
    artifact_type: "technical_ticket",
    status,
    generation_mode: "template",
    output_locale: "en",
    current_revision: status === "ready" ? 1 : 0,
    validation_state: status === "ready" ? "valid" : "pending",
    content_hash: status === "ready" ? "hash" : null,
    latest_generation_run_id: null,
    created_by: "operator",
    created_at: TIME,
    updated_at: TIME,
  };
}

function project(defaultDeliveryLocale = "en") {
  return {
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
    contextStatus: "complete" as const,
    currentIcpProfileVersion: 1,
    defaultDeliveryLocale,
    createdAt: TIME,
    updatedAt: TIME,
    archivedAt: null,
  };
}

const readyRevision: ArtifactRevisionRow = {
  id: "ready-revision",
  workspace_id: SCOPE.workspaceId,
  project_id: SCOPE.projectId,
  artifact_id: "eligible-artifact",
  revision: 1,
  output_locale: "en",
  content_format: "markdown",
  content_text: "Client-ready content",
  content_json: null,
  content_hash: "hash",
  generated_by: "template",
  editor_id: null,
  analysis_invocation_id: null,
  note: null,
  validation_errors: [],
  created_at: TIME,
};

describe("report canonical pagination", () => {
  beforeEach(() => {
    const transaction = vi.fn(
      async (callback: (tx: object) => Promise<unknown>) =>
        callback(SNAPSHOT_TX),
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });
    mocks.getProject.mockResolvedValue(project());

    vi.spyOn(DiagnosticRunsRepository.prototype, "findLatest").mockResolvedValue(null);
    vi.spyOn(EvidenceRepository.prototype, "listForFindings").mockResolvedValue([]);
    vi.spyOn(EvidenceRepository.prototype, "findByIds").mockResolvedValue([]);

    vi.spyOn(FindingsRepository.prototype, "list").mockImplementation(
      async (_scope, options) =>
        options.cursor
          ? { rows: [finding("eligible-finding", "confirmed")], nextCursor: null }
          : {
              rows: Array.from({ length: 100 }, (_, index) =>
                finding(`ignored-finding-${index}`, "ignored"),
              ),
              nextCursor: "findings-page-2",
            },
    );
    vi.spyOn(ActionsRepository.prototype, "list").mockImplementation(
      async (_scope, options) =>
        options.cursor
          ? { rows: [action("eligible-action", "candidate")], nextCursor: null }
          : {
              rows: Array.from({ length: 100 }, (_, index) =>
                action(`dismissed-action-${index}`, "dismissed"),
              ),
              nextCursor: "actions-page-2",
            },
    );
    vi.spyOn(ExecutionArtifactsRepository.prototype, "listByProject").mockImplementation(
      async (_scope, options) =>
        options.cursor
          ? { rows: [artifact("eligible-artifact", "ready")], nextCursor: null }
          : {
              rows: Array.from({ length: 100 }, (_, index) =>
                artifact(`draft-artifact-${index}`, "draft"),
              ),
              nextCursor: "artifacts-page-2",
            },
    );
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findRevision").mockResolvedValue(
      readyRevision,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not hide eligible canonical objects behind 100 newer ineligible rows", async () => {
    const report = await getProjectReport(SCOPE, SCOPE.projectId, null, TIME);

    expect(report.findings.map(({ id }) => id)).toEqual(["eligible-finding"]);
    expect(report.actions.map(({ id }) => id)).toEqual(["eligible-action"]);
    expect(report.artifacts.map(({ id }) => id)).toEqual(["eligible-artifact"]);
    expect(FindingsRepository.prototype.list).toHaveBeenCalledTimes(2);
    expect(ActionsRepository.prototype.list).toHaveBeenCalledTimes(2);
    expect(ExecutionArtifactsRepository.prototype.listByProject).toHaveBeenCalledTimes(2);
  });

  it("keeps every paginated canonical read in one read-only repeatable-read snapshot", async () => {
    const db = mocks.getDb().db as {
      transaction: ReturnType<typeof vi.fn>;
    };
    const repositoryExecutors = new Set<unknown>();

    vi.mocked(FindingsRepository.prototype.list).mockImplementation(
      async function (this: FindingsRepository, _scope, options) {
        const exec = (this as unknown as { exec: unknown }).exec;
        repositoryExecutors.add(exec);
        if (!options.cursor) {
          return {
            rows: Array.from({ length: 100 }, (_, index) =>
              finding(`ignored-finding-${index}`, "ignored"),
            ),
            nextCursor: "findings-page-2",
          };
        }

        // Model the row moving to a newer `updated_at` between pages. A live
        // READ COMMITTED page would now miss it because it moved before the
        // page-1 cursor; the frozen transaction view still returns it.
        return exec === SNAPSHOT_TX
          ? { rows: [finding("eligible-finding", "confirmed")], nextCursor: null }
          : { rows: [], nextCursor: null };
      },
    );
    vi.mocked(ActionsRepository.prototype.list).mockImplementation(
      async function (this: ActionsRepository, _scope, options) {
        const exec = (this as unknown as { exec: unknown }).exec;
        repositoryExecutors.add(exec);
        return options.cursor
          ? { rows: [action("eligible-action", "candidate")], nextCursor: null }
          : {
              rows: Array.from({ length: 100 }, (_, index) =>
                action(`dismissed-action-${index}`, "dismissed"),
              ),
              nextCursor: "actions-page-2",
            };
      },
    );
    vi.mocked(ExecutionArtifactsRepository.prototype.listByProject).mockImplementation(
      async function (this: ExecutionArtifactsRepository, _scope, options) {
        const exec = (this as unknown as { exec: unknown }).exec;
        repositoryExecutors.add(exec);
        return options.cursor
          ? { rows: [artifact("eligible-artifact", "ready")], nextCursor: null }
          : {
              rows: Array.from({ length: 100 }, (_, index) =>
                artifact(`draft-artifact-${index}`, "draft"),
              ),
              nextCursor: "artifacts-page-2",
            };
      },
    );
    vi.mocked(ExecutionArtifactsRepository.prototype.findRevision).mockImplementation(
      async function (this: ExecutionArtifactsRepository) {
        repositoryExecutors.add(
          (this as unknown as { exec: unknown }).exec,
        );
        return readyRevision;
      },
    );
    vi.mocked(DiagnosticRunsRepository.prototype.findLatest).mockImplementation(
      async function (this: DiagnosticRunsRepository) {
        repositoryExecutors.add(
          (this as unknown as { exec: unknown }).exec,
        );
        return null;
      },
    );
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockImplementation(
      async function (this: EvidenceRepository) {
        repositoryExecutors.add(
          (this as unknown as { exec: unknown }).exec,
        );
        return [];
      },
    );
    vi.mocked(EvidenceRepository.prototype.findByIds).mockImplementation(
      async function (this: EvidenceRepository) {
        repositoryExecutors.add(
          (this as unknown as { exec: unknown }).exec,
        );
        return [];
      },
    );

    const report = await getProjectReport(SCOPE, SCOPE.projectId, null, TIME);

    expect(report.findings.map(({ id }) => id)).toEqual(["eligible-finding"]);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    expect(mocks.getProject).toHaveBeenCalledWith(
      SCOPE,
      SCOPE.projectId,
      SNAPSHOT_TX,
    );
    expect(repositoryExecutors).toEqual(new Set([SNAPSHOT_TX]));
  });

  it("fails closed when a report cursor chain does not advance", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValue({
      rows: [],
      nextCursor: "repeated-cursor",
    });

    await expect(
      getProjectReport(SCOPE, SCOPE.projectId, null, TIME),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Report findings pagination did not complete safely.",
    });
    expect(FindingsRepository.prototype.list).toHaveBeenCalledTimes(2);
  });

  it("fails closed when evidence makes the final finding DTO exceed its byte budget", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValue({
      rows: [finding("eligible-finding", "confirmed")],
      nextCursor: null,
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValue([
      {
        finding_id: "eligible-finding",
        evidence_id: "oversized-evidence",
        role: "primary",
      },
    ]);
    vi.mocked(EvidenceRepository.prototype.findByIds).mockResolvedValue([
      {
        id: "oversized-evidence",
        diagnostic_run_id: "diagnostic-1",
        source_provider: "crawl",
        origin: "observed",
        method: "deterministic",
        grade: "a",
        availability: "available",
        support: "supports",
        subject_refs: [],
        claim: OVERSIZED_REPORT_VALUE,
        observed_at: TIME,
        limitation: "",
        snapshot_id: null,
        analysis_invocation_id: null,
      },
    ]);

    await expect(
      getProjectReport(SCOPE, SCOPE.projectId, null, TIME),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Report findings projection exceeded its safety budget.",
    });
    expect(ActionsRepository.prototype.list).not.toHaveBeenCalled();
  });

  it("counts repeated evidence in each serialized final finding DTO", async () => {
    const repeatedEvidenceValue = "x".repeat(5 * 1024 * 1024);
    const findings = Array.from({ length: 4 }, (_, index) =>
      finding(`eligible-finding-${index}`, "confirmed"),
    );
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValue({
      rows: findings,
      nextCursor: null,
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValue(
      findings.map(({ id }) => ({
        finding_id: id,
        evidence_id: "shared-evidence",
        role: "primary",
      })),
    );
    vi.mocked(EvidenceRepository.prototype.findByIds).mockResolvedValue([
      {
        id: "shared-evidence",
        diagnostic_run_id: "diagnostic-1",
        source_provider: "crawl",
        origin: "observed",
        method: "deterministic",
        grade: "a",
        availability: "available",
        support: "supports",
        subject_refs: [],
        claim: repeatedEvidenceValue,
        observed_at: TIME,
        limitation: "",
        snapshot_id: null,
        analysis_invocation_id: null,
      },
    ]);

    await expect(
      getProjectReport(SCOPE, SCOPE.projectId, null, TIME),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Report findings projection exceeded its safety budget.",
    });
    expect(ActionsRepository.prototype.list).not.toHaveBeenCalled();
  });

  it("fails closed when current revision content makes the final artifact DTO exceed its byte budget", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValue({
      rows: [],
      nextCursor: null,
    });
    vi.mocked(ActionsRepository.prototype.list).mockResolvedValue({
      rows: [],
      nextCursor: null,
    });
    vi.mocked(ExecutionArtifactsRepository.prototype.listByProject).mockResolvedValue({
      rows: [artifact("eligible-artifact", "ready")],
      nextCursor: null,
    });
    vi.mocked(ExecutionArtifactsRepository.prototype.findRevision).mockResolvedValue({
      ...readyRevision,
      content_text: OVERSIZED_REPORT_VALUE,
    });

    await expect(
      getProjectReport(SCOPE, SCOPE.projectId, null, TIME),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Report artifacts projection exceeded its safety budget.",
    });
  });

  it("fails closed when a final action DTO exceeds its byte budget", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValue({
      rows: [],
      nextCursor: null,
    });
    vi.mocked(ActionsRepository.prototype.list).mockResolvedValue({
      rows: [
        {
          ...action("eligible-action", "candidate"),
          description: OVERSIZED_REPORT_VALUE,
        },
      ],
      nextCursor: null,
    });

    await expect(
      getProjectReport(SCOPE, SCOPE.projectId, null, TIME),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Report actions projection exceeded its safety budget.",
    });
    expect(ExecutionArtifactsRepository.prototype.listByProject).not.toHaveBeenCalled();
  });

  it("localizes frozen methodology copy and labels unsupported-locale fallback honestly", async () => {
    mocks.getProject.mockResolvedValueOnce(project("zh-CN"));
    const def = await getProjectReport(SCOPE, SCOPE.projectId, null, TIME);
    const en = await getProjectReport(SCOPE, SCOPE.projectId, "en", TIME);
    const zh = await getProjectReport(SCOPE, SCOPE.projectId, "zh-CN", TIME);
    const fr = await getProjectReport(SCOPE, SCOPE.projectId, "fr-FR", TIME);

    expect(def.outputLocale).toBe("zh-CN");
    expect(def.methodology).toBe(ZH_CN_METHODOLOGY);
    expect(en.methodology).toBe(EN_METHODOLOGY);
    expect(zh.methodology).toBe(ZH_CN_METHODOLOGY);
    expect(fr.outputLocale).toBe("fr-FR");
    expect(fr.methodology).toBe(
      `A localized methodology is not available for fr-FR; ` +
        `the following text is the frozen English fallback. ${EN_METHODOLOGY}`,
    );
  });
});
