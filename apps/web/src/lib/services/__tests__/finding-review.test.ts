import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  EvidenceRepository,
  FindingReviewEventsRepository,
  FindingsRepository,
  ProjectsRepository,
  TelemetryRepository,
  type ActionRow,
  type FindingRow,
  type ProjectRow,
} from "@sf/db";

/**
 * Upstream hardening of the Finding Review command (Slice 2 Task 5, red line B).
 *
 * Two failure modes used to leave the transaction as an unhandled 5xx with no
 * problem+json at all:
 *  - a Finding whose `rule_id` has no registered ActionTemplate (a naked
 *    `TypeError` on a bare cast), and
 *  - a `last_seen_run_id` that advanced between the pre-transaction read and the
 *    Action INSERT, which the `enforce_action_source_lineage` trigger rejects
 *    with 23514.
 */

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

const dbMock = { transaction: mocks.transaction };

vi.mock("@/lib/db", () => ({ getDb: () => ({ db: dbMock }) }));
vi.mock("../diagnostic-load", () => ({
  loadEvidenceByFinding: vi.fn(async () => new Map()),
}));

const { reviewProjectFinding } = await import("../finding-review.ts");

const scope = { workspaceId: "workspace-1" };
const projectId = "project-1";
const actorId = "user-1";

const project = {
  id: projectId,
  workspace_id: scope.workspaceId,
  archived_at: null,
  default_delivery_locale: "en",
} as ProjectRow;

function makeFinding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: "finding-1",
    workspace_id: scope.workspaceId,
    project_id: projectId,
    finding_key: "finding-key-1",
    rule_id: "CONTENT-COVERAGE-001",
    rule_version: 1,
    rule_family: "content",
    intent: "informational",
    domain: "content_intent",
    title_key: "finding.title",
    title_args: {},
    summary: "A confirmed content opportunity.",
    summary_locale: "en",
    summary_invocation_id: null,
    subject_refs: [],
    severity: "high",
    confidence: "high",
    review_state: "unreviewed",
    review_revision: 0,
    review_reason: null,
    review_note: null,
    active: true,
    regressed: false,
    first_seen_run_id: "diagnostic-1",
    last_seen_run_id: "diagnostic-1",
    first_seen_at: "2026-07-25T00:00:00.000Z",
    last_seen_at: "2026-07-25T00:00:00.000Z",
    resolved_at: null,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
    ...overrides,
  } as FindingRow;
}

const action = {
  id: "action-1",
  source_finding_id: "finding-1",
  source_diagnostic_run_id: "diagnostic-1",
  template_id: "create_priority_content.v1",
  status: "planned",
  evidence_refs: [],
} as unknown as ActionRow;

const confirm = { reviewState: "confirmed" as const, baseRevision: 0 };

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.transaction
    .mockReset()
    .mockImplementation(async (callback: (tx: object) => Promise<unknown>) =>
      callback({}),
    );
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(project);
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue(
    project,
  );
  vi.spyOn(FindingsRepository.prototype, "findById").mockResolvedValue(
    makeFinding(),
  );
  vi.spyOn(FindingsRepository.prototype, "updateReview").mockResolvedValue(
    true,
  );
  vi.spyOn(FindingReviewEventsRepository.prototype, "append").mockResolvedValue(
    undefined as never,
  );
  vi.spyOn(EvidenceRepository.prototype, "listForFindings").mockResolvedValue(
    [],
  );
  vi.spyOn(ActionsRepository.prototype, "findByKey").mockResolvedValue(null);
  vi.spyOn(ActionsRepository.prototype, "insert").mockResolvedValue(action);
  vi.spyOn(ActionsRepository.prototype, "mergeEvidenceRefs").mockResolvedValue(
    undefined as never,
  );
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue(
    undefined as never,
  );
});

describe("confirm with an unregistered rule", () => {
  it("answers 503 DEPENDENCY_UNAVAILABLE naming the rule instead of throwing a TypeError", async () => {
    vi.mocked(FindingsRepository.prototype.findById).mockResolvedValue(
      makeFinding({ rule_id: "TECH-NOPE-999" }),
    );

    const promise = reviewProjectFinding(
      scope,
      projectId,
      "finding-1",
      actorId,
      confirm,
    );

    await expect(promise).rejects.toMatchObject({
      name: "ProblemError",
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
      current: { ruleId: "TECH-NOPE-999" },
    });
    // It fails closed: no fallback template, so nothing is reviewed or minted.
    expect(FindingsRepository.prototype.updateReview).not.toHaveBeenCalled();
    expect(ActionsRepository.prototype.insert).not.toHaveBeenCalled();
  });
});

describe("confirm under a concurrent diagnosis advance", () => {
  it("answers 409 VERSION_CONFLICT when last_seen_run_id moved before the Action INSERT", async () => {
    vi.mocked(FindingsRepository.prototype.findById)
      // Pre-transaction read.
      .mockResolvedValueOnce(makeFinding())
      // Re-read under the row the review UPDATE just locked.
      .mockResolvedValueOnce(makeFinding({ last_seen_run_id: "diagnostic-2" }));

    await expect(
      reviewProjectFinding(scope, projectId, "finding-1", actorId, confirm),
    ).rejects.toMatchObject({
      name: "ProblemError",
      code: "VERSION_CONFLICT",
      status: 409,
    });
    expect(ActionsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("answers 409 VERSION_CONFLICT when the re-read finds no Finding at all", async () => {
    vi.mocked(FindingsRepository.prototype.findById)
      .mockResolvedValueOnce(makeFinding())
      .mockResolvedValueOnce(null);

    await expect(
      reviewProjectFinding(scope, projectId, "finding-1", actorId, confirm),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect(ActionsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("binds the Action to the re-read diagnosis when nothing moved", async () => {
    await reviewProjectFinding(scope, projectId, "finding-1", actorId, confirm);

    expect(ActionsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFindingId: "finding-1",
        sourceDiagnosticRunId: "diagnostic-1",
        templateId: "create_priority_content.v1",
      }),
    );
  });

  it("re-confirm reuses the existing Action even after the diagnosis advanced", async () => {
    // No INSERT happens on this path, so there is no frozen lineage to write and
    // nothing for the trigger to reject: re-confirm merges evidence and keeps
    // the human's priority/status, exactly as Slice 1 specified.
    vi.mocked(FindingsRepository.prototype.findById)
      .mockResolvedValueOnce(makeFinding())
      .mockResolvedValue(makeFinding({ last_seen_run_id: "diagnostic-2" }));
    vi.mocked(ActionsRepository.prototype.findByKey).mockResolvedValue(action);

    await reviewProjectFinding(scope, projectId, "finding-1", actorId, confirm);

    expect(ActionsRepository.prototype.insert).not.toHaveBeenCalled();
    expect(ActionsRepository.prototype.mergeEvidenceRefs).toHaveBeenCalledWith(
      action.id,
      [],
    );
  });
});
