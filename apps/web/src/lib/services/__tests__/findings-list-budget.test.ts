import {
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
  ProjectsRepository,
  type Executor,
} from "@sf/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { listProjectFindings } = await import("../findings-list.ts");

const SCOPE = { workspaceId: "workspace" };
const PROJECT_ID = "project";
const TIME = "2026-07-19T00:00:00.000Z";
const READ_TX = { role: "findings-budget-snapshot" } as unknown as Executor;
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

describe("listProjectFindings safety budgets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getDb.mockReset().mockImplementation(() => {
      throw new Error("global database must not be opened during injected reads");
    });
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      PROJECT_ROW,
    );
  });

  it("fails closed when evidence bytes exceed the page safety budget", async () => {
    vi.spyOn(FindingsRepository.prototype, "list").mockResolvedValue({
      rows: [FINDING_ROW],
      nextCursor: null,
    });
    const evidenceLinksRead = vi
      .spyOn(EvidenceRepository.prototype, "listForFindings")
      .mockResolvedValue([
        {
          finding_id: "finding-1",
          evidence_id: "evidence-1",
          role: "primary",
        },
      ] as never);
    vi.spyOn(EvidenceRepository.prototype, "findByIds").mockResolvedValue([
      {
        id: "evidence-1",
        source_provider: "crawl",
        origin: "crawl_pages",
        method: "HTTP response inspection",
        grade: "A",
        availability: "available",
        support: "supports",
        subject_refs: [],
        claim: "x".repeat(16 * 1024 * 1024),
        observed_at: TIME,
        limitation: "One captured response.",
        snapshot_id: null,
        analysis_invocation_id: null,
      },
    ] as never);
    const latestRead = vi.spyOn(
      DiagnosticRunsRepository.prototype,
      "findLatest",
    );

    await expect(
      listProjectFindings(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null, activeOnly: false },
        READ_TX,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Findings projection exceeded its safety budget.",
    });

    expect(evidenceLinksRead).toHaveBeenCalledWith(
      { workspaceId: SCOPE.workspaceId, projectId: PROJECT_ID },
      ["finding-1"],
      { maxRows: 10001 },
    );
    expect(latestRead).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("fails closed when the final finding DTO itself exceeds the page safety budget", async () => {
    vi.spyOn(FindingsRepository.prototype, "list").mockResolvedValue({
      rows: [
        {
          ...(FINDING_ROW as Record<string, unknown>),
          summary: "y".repeat(16 * 1024 * 1024),
        } as never,
      ],
      nextCursor: null,
    });
    const evidenceLinksRead = vi
      .spyOn(EvidenceRepository.prototype, "listForFindings")
      .mockResolvedValue([]);
    const evidenceRowsRead = vi.spyOn(EvidenceRepository.prototype, "findByIds");
    const latestRead = vi.spyOn(
      DiagnosticRunsRepository.prototype,
      "findLatest",
    );

    await expect(
      listProjectFindings(
        SCOPE,
        PROJECT_ID,
        { limit: 100, cursor: null, activeOnly: false },
        READ_TX,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Findings projection exceeded its safety budget.",
    });

    expect(evidenceLinksRead).toHaveBeenCalledOnce();
    expect(evidenceRowsRead).not.toHaveBeenCalled();
    expect(latestRead).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
