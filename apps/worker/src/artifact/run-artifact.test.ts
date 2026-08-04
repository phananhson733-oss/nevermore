import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ObservationsRepository,
  ProjectsRepository,
  toRunAttempt,
  type ActionRow,
  type ArtifactRow,
  type AsyncRunRow,
  type DiagnosticRunRow,
  type FindingRow,
  type IcpProfileRow,
  type ObservationRow,
  type ProjectRow,
} from "@sf/db";
import {
  LLMError,
  MAX_ARTIFACT_EVIDENCE_ROWS,
  type AnalysisInvocationRecord,
} from "@sf/artifacts";
import type { Logger } from "@sf/observability";
import { CRAWL_PROJECTION_LIMITS } from "@sf/sources";
import type { WorkerContext } from "../context.ts";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  buildTemplateArtifact: vi.fn(),
  validateArtifact: vi.fn(),
  createOpenAIClient: vi.fn(),
  generateArtifact: vi.fn(),
  parseIcp: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@sf/artifacts", async () => {
  const actual = await vi.importActual<typeof import("@sf/artifacts")>(
    "@sf/artifacts",
  );
  return {
    ...actual,
    buildTemplateArtifact: mocks.buildTemplateArtifact,
    validateArtifact: mocks.validateArtifact,
    createOpenAIClient: mocks.createOpenAIClient,
  };
});
vi.mock("@sf/engine", async () => {
  const actual = await vi.importActual<typeof import("@sf/engine")>("@sf/engine");
  return { ...actual, parseIcp: mocks.parseIcp };
});

const { buildArtifactPromptInput, runArtifact } = await import(
  "./run-artifact.ts"
);

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const frozenSnapshotId = "00000000-0000-4000-8000-000000000201";
const laterSnapshotId = "00000000-0000-4000-8000-000000000202";
const duplicateSnapshotId = "00000000-0000-4000-8000-000000000203";
const request = {
  artifactId: "artifact-1",
  actionId: "action-1",
  artifactType: "technical_ticket" as const,
  generationMode: "template" as const,
  outputLocale: "en",
  operatorInstructions: null,
  sourceDiagnosticRunId: "diagnostic-1",
  sourceIcpProfileId: "icp-1",
};
const run = {
  id: "run-1",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  kind: "artifact_generation",
  status: "running",
  active_key: "artifact:artifact-1",
  contract_version: "2026-07-21",
  request_payload: request,
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  attempt_count: 1,
  initiated_by: "user-1",
  queued_at: "2026-07-18T12:00:00.000Z",
  started_at: "2026-07-18T12:00:01.000Z",
  completed_at: null,
} satisfies AsyncRunRow;
const attempt = toRunAttempt(run);
const artifact = {
  id: request.artifactId,
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  action_id: request.actionId,
  artifact_type: request.artifactType,
  status: "generating",
  generation_mode: request.generationMode,
  output_locale: request.outputLocale,
  current_revision: 0,
  validation_state: "pending",
  content_hash: null,
  latest_generation_run_id: run.id,
  created_by: "user-1",
  created_at: "2026-07-18T12:00:00.000Z",
  updated_at: "2026-07-18T12:00:00.000Z",
} satisfies ArtifactRow;
const action = {
  id: request.actionId,
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  source_finding_id: "finding-1",
  source_diagnostic_run_id: "diagnostic-1",
  action_key: "action-key-1",
  template_id: "fix_http_status.v1",
  template_version: 1,
  title: "Restore the page",
  description: "Return a successful HTTP status",
  content_locale: "en",
  priority_band: "p0",
  roadmap_lane: "now",
  status: "accepted",
  effort: "s",
  risk: "high",
  expected_outcome: "The page is crawlable",
  evidence_refs: ["evidence-1"],
  revision: 1,
  created_by: "user-1",
  created_at: "2026-07-18T12:00:00.000Z",
  updated_at: "2026-07-18T12:00:00.000Z",
} satisfies ActionRow;
const finding = {
  id: action.source_finding_id,
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  finding_key: "finding-key-1",
  rule_id: "technical.http_status",
  rule_version: 1,
  rule_family: "technical",
  intent: "fix",
  domain: "technical",
  title_key: "finding.httpStatus",
  title_args: {},
  summary: "Pricing returns 503",
  summary_locale: "en",
  subject_refs: ["https://example.com/pricing", 42],
  severity: "critical",
  confidence: "high",
  review_state: "confirmed",
  review_revision: 1,
  review_reason: "verified",
  review_note: null,
  active: true,
  regressed: false,
  first_seen_run_id: "diagnostic-1",
  last_seen_run_id: "diagnostic-1",
  first_seen_at: "2026-07-18T11:00:00.000Z",
  last_seen_at: "2026-07-18T11:00:00.000Z",
  resolved_at: null,
  created_at: "2026-07-18T11:00:00.000Z",
  updated_at: "2026-07-18T11:00:00.000Z",
} satisfies FindingRow;
const frozenEvidenceRow = {
  id: "evidence-1",
  diagnostic_run_id: finding.last_seen_run_id,
  source_provider: "crawl",
  origin: "observed",
  method: "deterministic",
  grade: "A",
  availability: "available",
  support: "supports",
  subject_refs: ["https://example.com/pricing", 42],
  claim: "Pricing returned 503",
  observed_at: "2026-07-18T11:00:00.000Z",
  limitation: "Static HTML",
  snapshot_id: "snapshot-1",
  analysis_invocation_id: null,
};
const diagnosticRun = {
  id: finding.last_seen_run_id,
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  site_id: "site-1",
  icp_profile_id: "icp-1",
  icp_profile_version: 1,
  rule_set_version: "rules-1",
  prompt_set_version: "prompts-1",
  output_locale: "en",
  input_manifest: {
    snapshots: [
      {
        snapshotId: frozenSnapshotId,
        provider: "crawl",
        availability: "available",
      },
    ],
  },
  input_hash: "diagnostic-input-hash",
  coverage: {},
  created_at: "2026-07-18T11:00:00.000Z",
} satisfies DiagnosticRunRow;
const crawlObservation = {
  id: "observation-frozen",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  snapshot_id: frozenSnapshotId,
  site_page_id: null,
  provider: "crawl",
  metric_key: "crawl.page.v1",
  subject_type: "url",
  subject_ref: "https://example.com/pricing",
  observed_at: "2026-07-18T10:00:00.000Z",
  availability: "available",
  value_numeric: null,
  value_text: null,
  value_json: {
    title: "Frozen pricing title",
    metaDescription: "Frozen pricing description.",
  },
  unit: null,
  origin: "direct_public",
  method: "observed",
  grade: "A",
  support: "supports",
  limitation: "Static HTML",
} satisfies ObservationRow;
const project = {
  id: scope.projectId,
  workspace_id: scope.workspaceId,
  client_name: "Acme",
  project_name: "Growth",
  stage: "executing" as const,
  default_delivery_locale: "en",
  current_icp_profile_id: null,
  confirmed_icp_profile_id: null,
  archived_at: null,
  created_by: "user-1",
  created_at: "2026-07-18T10:00:00.000Z",
  updated_at: "2026-07-18T10:00:00.000Z",
} satisfies ProjectRow;
const icpRow = {
  id: "icp-1",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  version: 1,
  status: "complete" as const,
  profile: { productName: "SignalFrame" },
  content_hash: "icp-hash",
  created_by: "user-1",
  created_at: "2026-07-18T10:00:00.000Z",
} satisfies IcpProfileRow;
const invocation = {
  task: "artifact_generation",
  provider: "openai",
  model: "gpt-test",
  promptSetVersion: "v1",
  inputHash: "input-hash",
  outputHash: "output-hash",
  status: "succeeded" as const,
  inputTokens: 10,
  outputTokens: 20,
  costUsd: 0.01,
  latencyMs: 50,
  errorCode: null,
} satisfies AnalysisInvocationRecord;

const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: vi.fn(),
  info: mocks.info,
  warn: vi.fn(),
  error: mocks.error,
};
const ctx: WorkerContext = {
  db: { transaction: mocks.transaction } as never,
  boss: {} as never,
  blobStore: {} as never,
  credentialKey: Buffer.alloc(32),
  appOrigin: "https://app.example",
  googleOAuth: { clientId: "google-id", clientSecret: "google-secret" },
  openai: { apiKey: "openai-key", model: "gpt-test" },
  findingSummariesEnabled: true,
  logger,
};

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.transaction.mockReset().mockImplementation(
    async (callback: (tx: object) => Promise<unknown>) => callback({}),
  );
  mocks.buildTemplateArtifact.mockReset().mockReturnValue({
    contentFormat: "markdown",
    content: "# Technical ticket",
  });
  mocks.validateArtifact.mockReset().mockReturnValue({ valid: true, errors: [] });
  mocks.generateArtifact.mockReset();
  mocks.createOpenAIClient.mockReset().mockReturnValue({
    generateArtifact: mocks.generateArtifact,
  });
  mocks.parseIcp.mockReset().mockReturnValue({
    productName: "SignalFrame",
    oneLineDescription: "Evidence-led growth",
    offers: ["Audit"],
    useCases: ["SEO"],
    differentiators: ["Evidence"],
    primaryConversion: { label: "Book", type: "demo", targetUrl: "/demo" },
    marketCodes: ["US"],
  });
  mocks.info.mockReset();
  mocks.error.mockReset();
  vi.mocked(logger.warn).mockClear();

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "lockAttemptForUpdate",
  ).mockResolvedValue(run);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockResolvedValue(true);
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockResolvedValue(true);
  vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
    artifact,
  );
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findByIdForUpdate",
  ).mockResolvedValue(artifact);
  vi.spyOn(ExecutionArtifactsRepository.prototype, "insertRevision").mockResolvedValue(
    {} as never,
  );
  vi.spyOn(ExecutionArtifactsRepository.prototype, "setGenerated").mockResolvedValue();
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "setGeneratedForGenerationRun",
  ).mockResolvedValue(true);
  vi.spyOn(ExecutionArtifactsRepository.prototype, "setFailed").mockResolvedValue();
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "setFailedForGenerationRun",
  ).mockResolvedValue(true);
  vi.spyOn(ActionsRepository.prototype, "findById").mockResolvedValue(action);
  vi.spyOn(FindingsRepository.prototype, "findById").mockResolvedValue(finding);
  vi.spyOn(DiagnosticRunsRepository.prototype, "findById").mockResolvedValue(
    diagnosticRun,
  );
  vi.spyOn(
    ObservationsRepository.prototype,
    "findBySnapshotMetricSubject",
  ).mockResolvedValue(null);
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(project);
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(icpRow);
  vi.spyOn(EvidenceRepository.prototype, "listForFindings").mockResolvedValue([
    { finding_id: finding.id, evidence_id: "evidence-1", role: "primary" },
  ]);
  vi.spyOn(EvidenceRepository.prototype, "findByIds").mockResolvedValue([
    frozenEvidenceRow,
  ]);
  vi.spyOn(AnalysisInvocationsRepository.prototype, "insert").mockResolvedValue(
    "invocation-1",
  );
});

describe("runArtifact", () => {
  it("does nothing when another worker already claimed the run", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(null);
    await runArtifact(ctx, { runId: run.id, ...scope });
    expect(ExecutionArtifactsRepository.prototype.findById).not.toHaveBeenCalled();
  });

  it("fails the run when its artifact no longer exists", async () => {
    vi.mocked(ExecutionArtifactsRepository.prototype.findById).mockResolvedValueOnce(
      null,
    );
    await runArtifact(ctx, { runId: run.id, ...scope });
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(attempt, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "artifact missing",
    });
    expect(ExecutionArtifactsRepository.prototype.setFailed).not.toHaveBeenCalled();
  });

  it("builds an allowlisted high-risk template prompt and commits a text revision", async () => {
    await runArtifact(ctx, { runId: run.id, ...scope });
    expect(EvidenceRepository.prototype.listForFindings).toHaveBeenCalledWith(
      scope,
      [finding.id],
      {
        diagnosticRunId: finding.last_seen_run_id,
        maxRows: MAX_ARTIFACT_EVIDENCE_ROWS + 1,
      },
    );
    expect(mocks.buildTemplateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        requiresValidationRollback: true,
        finding: expect.objectContaining({
          subjectRefs: ["https://example.com/pricing"],
        }),
        evidence: [
          expect.objectContaining({
            evidenceId: "evidence-1",
            subjectRefs: ["https://example.com/pricing"],
          }),
        ],
        contentBriefOutline: null,
        researchContext: null,
        currentMetadata: {
          url: null,
          currentTitle: null,
          currentDescription: null,
        },
      }),
    );
    expect(DiagnosticRunsRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      request.sourceDiagnosticRunId,
    );
    expect(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).not.toHaveBeenCalled();
    expect(ExecutionArtifactsRepository.prototype.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 1,
        outputLocale: "en",
        contentText: "# Technical ticket",
        contentJson: null,
        generatedBy: "template",
        analysisInvocationId: null,
      }),
    );
    expect(
      ExecutionArtifactsRepository.prototype.setGeneratedForGenerationRun,
    ).toHaveBeenCalledWith(scope, artifact.id, run.id, {
      status: "draft",
      currentRevision: 1,
      expectedRevision: 0,
      validationState: "valid",
      contentHash: expect.any(String),
    });
    expect(ExecutionArtifactsRepository.prototype.setGenerated).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(attempt, {
      status: "completed",
      resultType: "artifact",
      resultId: artifact.id,
    });
    expect(mocks.info).toHaveBeenCalledWith(
      "artifact_done",
      expect.objectContaining({ valid: true }),
    );
  });

  it("fails before loading evidence rows or creating an external client when the frozen link budget overflows", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce(
      Array.from(
        { length: MAX_ARTIFACT_EVIDENCE_ROWS + 1 },
        (_unused, index) => ({
          finding_id: finding.id,
          evidence_id: `evidence-${String(index)}`,
          role: "supporting",
        }),
      ),
    );

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(EvidenceRepository.prototype.findByIds).not.toHaveBeenCalled();
    expect(mocks.createOpenAIClient).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(ExecutionArtifactsRepository.prototype.insertRevision).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it.each([
    {
      name: "missing",
      rows: [],
    },
    {
      name: "from another diagnostic run",
      rows: [
        {
          ...frozenEvidenceRow,
          diagnostic_run_id: "diagnostic-old",
          claim: "Old-run claim",
          observed_at: "2026-07-17T11:00:00.000Z",
          snapshot_id: "snapshot-old",
        },
      ],
    },
    {
      name: "duplicated by the evidence lookup",
      rows: [frozenEvidenceRow, { ...frozenEvidenceRow }],
    },
    {
      name: "mixed with an unexpected evidence id",
      rows: [
        frozenEvidenceRow,
        { ...frozenEvidenceRow, id: "evidence-unexpected" },
      ],
    },
  ])("fails before generation when frozen evidence is $name", async ({ rows }) => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    vi.mocked(EvidenceRepository.prototype.findByIds).mockResolvedValueOnce(rows);

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(EvidenceRepository.prototype.findByIds).toHaveBeenCalledWith(scope, [
      "evidence-1",
    ]);
    expect(mocks.createOpenAIClient).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(ExecutionArtifactsRepository.prototype.insertRevision).not.toHaveBeenCalled();
  });

  it("loads metadata from the exact crawl snapshot frozen in the finding's last-seen run", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, artifactType: "metadata_rewrite" },
    });
    vi.mocked(FindingsRepository.prototype.findById).mockResolvedValueOnce({
      ...finding,
      subject_refs: [
        "not-a-url",
        "https://example.com/pricing",
        "https://example.com/later-subject",
      ],
    });
    vi.mocked(DiagnosticRunsRepository.prototype.findById).mockResolvedValueOnce(
      diagnosticRun,
    );
    vi.mocked(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).mockImplementationOnce(async (_scope, lookup) =>
      lookup.snapshotId === frozenSnapshotId
        ? crawlObservation
        : {
            ...crawlObservation,
            snapshot_id: laterSnapshotId,
            value_json: {
              title: "Later title that must be ignored",
              metaDescription: "Later description that must be ignored.",
            },
          },
    );

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(DiagnosticRunsRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      finding.last_seen_run_id,
    );
    expect(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).toHaveBeenCalledTimes(1);
    expect(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).toHaveBeenCalledWith(scope, {
      snapshotId: frozenSnapshotId,
      provider: "crawl",
      metricKey: "crawl.page.v1",
      subjectType: "url",
      subjectRef: "https://example.com/pricing",
    });
    expect(mocks.buildTemplateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMetadata: {
          url: "https://example.com/pricing",
          currentTitle: "Frozen pricing title",
          currentDescription: "Frozen pricing description.",
        },
      }),
    );
  });

  it("falls back to the primary conversion only when no finding subject is a valid URL", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, artifactType: "metadata_rewrite" },
    });
    vi.mocked(FindingsRepository.prototype.findById).mockResolvedValueOnce({
      ...finding,
      subject_refs: ["/relative", "mailto:operator@example.com", 42],
    });
    mocks.parseIcp.mockReturnValueOnce({
      productName: "SignalFrame",
      oneLineDescription: "Evidence-led growth",
      offers: ["Audit"],
      useCases: ["SEO"],
      differentiators: ["Evidence"],
      primaryConversion: {
        label: "Book",
        type: "demo",
        targetUrl: "https://example.com/signup",
      },
      marketCodes: ["US"],
    });
    vi.mocked(DiagnosticRunsRepository.prototype.findById).mockResolvedValueOnce(
      diagnosticRun,
    );

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ subjectRef: "https://example.com/signup" }),
    );
    expect(mocks.buildTemplateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMetadata: {
          url: "https://example.com/signup",
          currentTitle: null,
          currentDescription: null,
        },
      }),
    );
  });

  it("returns null current fields for missing or malformed frozen crawl data", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, artifactType: "metadata_rewrite" },
    });
    vi.mocked(DiagnosticRunsRepository.prototype.findById).mockResolvedValueOnce({
      ...diagnosticRun,
      input_manifest: {
        snapshots: [
          { snapshotId: frozenSnapshotId, provider: "crawl" },
          { snapshotId: laterSnapshotId, provider: "gsc" },
        ],
      },
    });
    vi.mocked(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).mockResolvedValueOnce({
      ...crawlObservation,
      value_json: {
        title: 42,
        metaDescription: { unexpected: true },
      },
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(mocks.buildTemplateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMetadata: {
          url: "https://example.com/pricing",
          currentTitle: null,
          currentDescription: null,
        },
      }),
    );
  });

  it("fails closed on oversized crawl title and description values", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, artifactType: "metadata_rewrite" },
    });
    vi.mocked(DiagnosticRunsRepository.prototype.findById).mockResolvedValueOnce(
      diagnosticRun,
    );
    vi.mocked(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).mockResolvedValueOnce({
      ...crawlObservation,
      value_json: {
        title: "T".repeat(CRAWL_PROJECTION_LIMITS.maxTitleChars + 1),
        metaDescription: "D".repeat(
          CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars + 1,
        ),
      },
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(mocks.buildTemplateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMetadata: {
          url: "https://example.com/pricing",
          currentTitle: null,
          currentDescription: null,
        },
      }),
    );
  });

  it.each([
    [{ snapshots: [null] }],
    [
      {
        snapshots: [
          { snapshotId: frozenSnapshotId, provider: "crawl" },
          { snapshotId: duplicateSnapshotId, provider: "crawl" },
        ],
      },
    ],
    [{ snapshots: [{ snapshotId: "", provider: "crawl" }] }],
    [{ snapshots: [{ snapshotId: "not-a-uuid", provider: "crawl" }] }],
  ])("fails closed on a malformed or ambiguous frozen manifest", async (inputManifest) => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, artifactType: "metadata_rewrite" },
    });
    vi.mocked(DiagnosticRunsRepository.prototype.findById).mockResolvedValueOnce({
      ...diagnosticRun,
      input_manifest: inputManifest,
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMetadata: {
          url: "https://example.com/pricing",
          currentTitle: null,
          currentDescription: null,
        },
      }),
    );
  });

  it("reads evidence links only from the finding's exact frozen diagnostic run", async () => {
    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(EvidenceRepository.prototype.listForFindings).toHaveBeenCalledWith(
      scope,
      [finding.id],
      {
        diagnosticRunId: finding.last_seen_run_id,
        maxRows: MAX_ARTIFACT_EVIDENCE_ROWS + 1,
      },
    );
  });

  it("fails closed before loading evidence bodies when the frozen link set exceeds the budget", async () => {
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce(
      Array.from(
        { length: MAX_ARTIFACT_EVIDENCE_ROWS + 1 },
        (_unused, index) => ({
          finding_id: finding.id,
          evidence_id: `evidence-${index + 1}`,
          role: "primary",
        }),
      ),
    );
    const findByIds = vi.spyOn(EvidenceRepository.prototype, "findByIds");

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(findByIds).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.setFailedForGenerationRun,
    ).toHaveBeenCalledOnce();
  });

  it("fails closed when any loaded evidence row comes from a different diagnostic run", async () => {
    vi.mocked(EvidenceRepository.prototype.findByIds).mockResolvedValueOnce([
      {
        id: "evidence-1",
        diagnostic_run_id: "diagnostic-other",
        source_provider: "crawl",
        origin: "observed",
        method: "deterministic",
        grade: "A",
        availability: "available",
        support: "supports",
        subject_refs: ["https://example.com/pricing"],
        claim: "Pricing returned 503",
        observed_at: "2026-07-18T11:00:00.000Z",
        limitation: "Static HTML",
        snapshot_id: "snapshot-1",
        analysis_invocation_id: null,
      },
    ]);

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.setFailedForGenerationRun,
    ).toHaveBeenCalledOnce();
  });

  it("fails closed when a frozen evidence id disappears before the body lookup", async () => {
    vi.mocked(EvidenceRepository.prototype.findByIds).mockResolvedValueOnce([]);

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.setFailedForGenerationRun,
    ).toHaveBeenCalledOnce();
  });

  it("does not query a crawl observation when every target URL candidate is malformed", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, artifactType: "metadata_rewrite" },
    });
    vi.mocked(FindingsRepository.prototype.findById).mockResolvedValueOnce({
      ...finding,
      subject_refs: [
        "/relative",
        "javascript:alert(1)",
        "https://user:secret@example.com/pricing",
        `https://example.com/${"a".repeat(CRAWL_PROJECTION_LIMITS.maxUrlChars)}`,
        42,
      ],
    });
    mocks.parseIcp.mockReturnValueOnce({
      productName: "SignalFrame",
      oneLineDescription: "Evidence-led growth",
      offers: ["Audit"],
      useCases: ["SEO"],
      differentiators: ["Evidence"],
      primaryConversion: {
        label: "Book",
        type: "demo",
        targetUrl: "/also-relative",
      },
      marketCodes: ["US"],
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(DiagnosticRunsRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      request.sourceDiagnosticRunId,
    );
    expect(
      ObservationsRepository.prototype.findBySnapshotMetricSubject,
    ).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMetadata: {
          url: null,
          currentTitle: null,
          currentDescription: null,
        },
      }),
    );
  });

  it.each(["fr-FR", "zh-TW", "zh-Hant"])(
    "fails a legacy template request for unsupported locale %s without saving a revision",
    async (outputLocale) => {
      vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
        ...run,
        request_payload: { ...request, outputLocale },
      });

      await runArtifact(ctx, { runId: run.id, ...scope });

      expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
      expect(ExecutionArtifactsRepository.prototype.insertRevision).not.toHaveBeenCalled();
      expect(
        ExecutionArtifactsRepository.prototype.setFailedForGenerationRun,
      ).toHaveBeenCalledWith(scope, artifact.id, run.id, 0);
      expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
        attempt,
        expect.objectContaining({
          status: "failed",
          lastErrorCode: "UNSUPPORTED_TEMPLATE_LOCALE",
        }),
      );
      expect(mocks.error).toHaveBeenCalledWith("artifact_failed", {
        runId: run.id,
        code: "UNSUPPORTED_TEMPLATE_LOCALE",
        type: "internal",
      });
      expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(outputLocale);
    },
  );

  it("canonicalizes a legacy semantic zh-CN template locale before generation and persistence", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, outputLocale: "ZH-cn" },
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(mocks.buildTemplateArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ outputLocale: "zh-CN" }),
    );
    expect(ExecutionArtifactsRepository.prototype.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({ outputLocale: "zh-CN" }),
    );
  });

  it("does not write an artifact revision after this attempt loses its epoch", async () => {
    vi.mocked(
      AsyncRunsRepository.prototype.lockAttemptForUpdate,
    ).mockResolvedValueOnce(null);

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(
      ExecutionArtifactsRepository.prototype.setGeneratedForGenerationRun,
    ).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.insertRevision,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalledWith(
      "artifact_done",
      expect.anything(),
    );
  });

  it("passes governed research only to english_blog_draft prompts", async () => {
    const researchContext = {
      sources: [
        {
          sourceRef: "page-snapshot:1",
          kind: "first_party_page",
          label: "Pricing page",
          url: "https://example.com/pricing",
          availability: "available",
          authorityTier: "B",
          capturedAt: "2026-07-18T11:00:00.000Z",
          contentHash: "c".repeat(64),
          excerpt: "A bounded first-party page excerpt.",
          evidenceRefs: ["page-snapshot:1"],
          limitation: "First-party snapshot.",
        },
      ],
      policy: {
        brandConstraints: ["Use customer language."],
        complianceConstraints: ["No guarantees."],
        prohibitedTerms: ["best-in-class"],
        claimRestrictions: ["No unsupported quantified claims."],
      },
    } as const;

    const blog = await buildArtifactPromptInput(ctx, scope, {
      actionId: action.id,
      artifactType: "english_blog_draft",
      outputLocale: "en",
      operatorInstructions: null,
      sourceDiagnosticRunId: "diagnostic-1",
      sourceIcpProfileId: "icp-1",
      contentBriefOutline: null,
      researchContext,
    });
    expect(blog.researchContext).toEqual(researchContext);

    const ticket = await buildArtifactPromptInput(ctx, scope, {
      actionId: action.id,
      artifactType: "technical_ticket",
      outputLocale: "en",
      operatorInstructions: null,
      sourceDiagnosticRunId: "diagnostic-1",
      sourceIcpProfileId: "icp-1",
      researchContext,
    });
    expect(ticket.researchContext).toBeNull();
  });

  it("discards a successful stale generation and only cancels its own run", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValueOnce({
      ...artifact,
      status: "draft",
      current_revision: 1,
      content_hash: "manual-hash",
      latest_generation_run_id: "run-2",
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(ExecutionArtifactsRepository.prototype.insertRevision).not.toHaveBeenCalled();
    expect(ExecutionArtifactsRepository.prototype.setGenerated).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(attempt, {
      status: "cancelled",
      lastErrorCode: "ARTIFACT_GENERATION_SUPERSEDED",
      lastErrorSummary: "Artifact generation was superseded.",
    });
    expect(mocks.info).not.toHaveBeenCalledWith(
      "artifact_done",
      expect.anything(),
    );
  });

  it("loads the source diagnosis ICP and ignores later project profile pointers", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: {
        ...request,
        artifactType: "metadata_rewrite",
        sourceDiagnosticRunId: diagnosticRun.id,
        sourceIcpProfileId: icpRow.id,
      },
    });
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce({
      ...project,
      current_icp_profile_id: "later-draft-2",
      confirmed_icp_profile_id: "later-confirmed-3",
    });
    mocks.buildTemplateArtifact.mockReturnValueOnce({
      contentFormat: "json",
      content: { title: "Pricing" },
    });
    mocks.validateArtifact.mockReturnValueOnce({
      valid: false,
      errors: ["description is missing"],
    });
    await runArtifact(ctx, { runId: run.id, ...scope });
    expect(IcpProfilesRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      icpRow.id,
    );
    expect(ProjectsRepository.prototype.findById).not.toHaveBeenCalled();
    expect(mocks.parseIcp).toHaveBeenCalledWith(icpRow.profile);
    expect(ExecutionArtifactsRepository.prototype.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        contentText: null,
        contentJson: { title: "Pricing" },
        validationErrors: ["description is missing"],
      }),
    );
    expect(
      ExecutionArtifactsRepository.prototype.setGeneratedForGenerationRun,
    ).toHaveBeenCalledWith(
      scope,
      artifact.id,
      run.id,
      expect.objectContaining({ validationState: "invalid" }),
    );
  });

  it("fails closed when the source diagnosis ICP cannot be resolved", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: {
        ...request,
        sourceIcpProfileId: "missing-source-icp",
      },
    });
    vi.mocked(DiagnosticRunsRepository.prototype.findById).mockResolvedValueOnce({
      ...diagnosticRun,
      icp_profile_id: "missing-source-icp",
    });
    vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValueOnce(null);

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(IcpProfilesRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      "missing-source-icp",
    );
    expect(mocks.parseIcp).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("continues from the Action's frozen diagnosis after the finding projection advances", async () => {
    vi.mocked(FindingsRepository.prototype.findById).mockResolvedValueOnce({
      ...finding,
      summary: "A later diagnosis changed this finding",
      last_seen_run_id: "diagnostic-2",
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(DiagnosticRunsRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      request.sourceDiagnosticRunId,
    );
    expect(IcpProfilesRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      request.sourceIcpProfileId,
    );
    expect(EvidenceRepository.prototype.listForFindings).toHaveBeenCalledWith(
      scope,
      [finding.id],
      {
        diagnosticRunId: request.sourceDiagnosticRunId,
        maxRows: MAX_ARTIFACT_EVIDENCE_ROWS + 1,
      },
    );
    expect(mocks.buildTemplateArtifact).toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("fails closed when the queued diagnosis disagrees with the Action's immutable source", async () => {
    vi.mocked(ActionsRepository.prototype.findById).mockResolvedValueOnce({
      ...action,
      source_diagnostic_run_id: "diagnostic-2",
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(FindingsRepository.prototype.findById).not.toHaveBeenCalled();
    expect(DiagnosticRunsRepository.prototype.findById).not.toHaveBeenCalled();
    expect(IcpProfilesRepository.prototype.findById).not.toHaveBeenCalled();
    expect(EvidenceRepository.prototype.listForFindings).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("fails closed when the frozen source diagnosis cannot be resolved", async () => {
    vi.mocked(DiagnosticRunsRepository.prototype.findById).mockResolvedValueOnce(
      null,
    );

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(IcpProfilesRepository.prototype.findById).not.toHaveBeenCalled();
    expect(EvidenceRepository.prototype.listForFindings).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("fails closed when the frozen source ICP disagrees with its diagnosis", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: {
        ...request,
        sourceIcpProfileId: "unrelated-icp",
      },
    });

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(IcpProfilesRepository.prototype.findById).not.toHaveBeenCalled();
    expect(EvidenceRepository.prototype.listForFindings).not.toHaveBeenCalled();
    expect(mocks.buildTemplateArtifact).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("persists a successful structured-LLM invocation and provider provenance", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    mocks.generateArtifact.mockResolvedValueOnce({
      content: { contentFormat: "markdown", content: "# LLM ticket" },
      invocation,
    });
    await runArtifact(
      {
        ...ctx,
        openai: {
          apiKey: "azure-key",
          model: "deployment",
          baseUrl: "https://azure.example/chat/completions",
          authScheme: "api-key",
        },
      },
      { runId: run.id, ...scope },
    );
    expect(mocks.createOpenAIClient).toHaveBeenCalledWith({
      apiKey: "azure-key",
      model: "deployment",
      baseUrl: "https://azure.example/chat/completions",
      authScheme: "api-key",
    });
    expect(AnalysisInvocationsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        asyncRunId: run.id,
        inputHash: invocation.inputHash,
      }),
    );
    expect(ExecutionArtifactsRepository.prototype.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedBy: "llm",
        analysisInvocationId: "invocation-1",
      }),
    );
    expect(mocks.info).toHaveBeenCalledWith("llm_invocation_recorded", {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      runId: run.id,
      provider: "openai",
      model: "gpt-test",
      status: "succeeded",
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 50,
      validationFailure: false,
      costUsd: 0.01,
      costAvailable: true,
      errorCode: null,
    });
    const invocationLog = mocks.info.mock.calls.find(
      ([event]) => event === "llm_invocation_recorded",
    );
    expect(JSON.stringify(invocationLog)).not.toContain(invocation.inputHash);
    expect(JSON.stringify(invocationLog)).not.toContain(invocation.outputHash);
  });

  it.each(["fr-FR", "zh-TW", "zh-Hant"])(
    "preserves valid structured_llm locale %s",
    async (outputLocale) => {
      vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
        ...run,
        request_payload: {
          ...request,
          generationMode: "structured_llm",
          outputLocale,
        },
      });
      mocks.generateArtifact.mockResolvedValueOnce({
        content: { contentFormat: "markdown", content: "# LLM ticket" },
        invocation,
      });

      await runArtifact(ctx, { runId: run.id, ...scope });

      expect(mocks.generateArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ outputLocale }),
      );
      expect(ExecutionArtifactsRepository.prototype.insertRevision).toHaveBeenCalledWith(
        expect.objectContaining({ outputLocale, generatedBy: "llm" }),
      );
    },
  );

  it("keeps LLM telemetry observational when the logger fails", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    mocks.generateArtifact.mockResolvedValueOnce({
      content: { contentFormat: "markdown", content: "# LLM ticket" },
      invocation,
    });
    mocks.info.mockImplementationOnce(() => {
      throw new Error("telemetry sink unavailable");
    });

    await expect(
      runArtifact(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();
    expect(ExecutionArtifactsRepository.prototype.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({ analysisInvocationId: "invocation-1" }),
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("audits a failed model invocation and leaves no fabricated revision", async () => {
    const failedInvocation: AnalysisInvocationRecord = {
      ...invocation,
      status: "failed",
      outputHash: null,
      errorCode: "AUTH_FAILED",
    };
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    mocks.generateArtifact.mockRejectedValueOnce(
      new LLMError(
        "AUTH_FAILED",
        "authorization failed for customer-secret-model with customer-prompt-secret",
        failedInvocation,
      ),
    );
    await runArtifact(ctx, { runId: run.id, ...scope });
    expect(AnalysisInvocationsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "AUTH_FAILED" }),
    );
    expect(mocks.info).toHaveBeenCalledWith(
      "llm_invocation_recorded",
      expect.objectContaining({
        status: "failed",
        validationFailure: false,
        errorCode: "AUTH_FAILED",
      }),
    );
    expect(ExecutionArtifactsRepository.prototype.insertRevision).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.setFailedForGenerationRun,
    ).toHaveBeenCalledWith(scope, artifact.id, run.id, 0);
    expect(ExecutionArtifactsRepository.prototype.setFailed).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(
      "artifact_failed",
      { runId: run.id, code: "AUTH_FAILED", type: "llm" },
    );
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(
      "customer-secret-model",
    );
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(
      "customer-prompt-secret",
    );
  });

  it("does not fail an artifact now owned by a newer generation after a permanent error", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValueOnce({
      ...artifact,
      latest_generation_run_id: "run-2",
    });
    mocks.generateArtifact.mockRejectedValueOnce(
      new LLMError("AUTH_FAILED", "new generation customer secret"),
    );

    await runArtifact(ctx, { runId: run.id, ...scope });

    expect(ExecutionArtifactsRepository.prototype.setFailed).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.setFailedForGenerationRun,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(attempt, {
      status: "cancelled",
      lastErrorCode: "ARTIFACT_GENERATION_SUPERSEDED",
      lastErrorSummary: "Artifact generation was superseded.",
    });
  });

  it("audits and rethrows OpenAI rate limiting so pg-boss can retry", async () => {
    const failedInvocation: AnalysisInvocationRecord = {
      ...invocation,
      status: "failed",
      outputHash: null,
      errorCode: "RATE_LIMITED",
    };
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    const rateLimited = new LLMError(
      "RATE_LIMITED",
      "provider returned 429",
      failedInvocation,
    );
    mocks.generateArtifact.mockRejectedValueOnce(rateLimited);

    await expect(
      runArtifact(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(rateLimited);
    expect(AnalysisInvocationsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "RATE_LIMITED" }),
    );
    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      attempt,
    );
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(ExecutionArtifactsRepository.prototype.setFailed).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalledWith(
      "artifact_failed",
      expect.anything(),
    );
  });

  it("does not emit a transient alert after a newer artifact attempt wins", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    vi.mocked(
      AsyncRunsRepository.prototype.resetToQueued,
    ).mockResolvedValueOnce(false);
    const rateLimited = new LLMError("RATE_LIMITED", "provider returned 429");
    mocks.generateArtifact.mockRejectedValueOnce(rateLimited);

    await expect(
      runArtifact(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(logger.warn).not.toHaveBeenCalledWith(
      "artifact_transient_error",
      expect.anything(),
    );
    expect(mocks.info).toHaveBeenCalledWith("artifact_skip_stale_attempt", {
      code: "RATE_LIMITED",
    });
  });

  it("rethrows an LLM network error without an invocation but terminalizes an opaque failure", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { ...request, generationMode: "structured_llm" },
    });
    const networkError = new LLMError("NETWORK_ERROR", "network failed");
    mocks.generateArtifact.mockRejectedValueOnce(networkError);
    await expect(
      runArtifact(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(networkError);
    expect(AnalysisInvocationsRepository.prototype.insert).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      attempt,
    );
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();

    vi.mocked(ActionsRepository.prototype.findById).mockRejectedValueOnce(
      "opaque failure",
    );
    await runArtifact(ctx, { runId: run.id, ...scope });
    expect(mocks.error).toHaveBeenLastCalledWith("artifact_failed", {
      runId: run.id,
      code: "UNAVAILABLE",
      type: "unknown",
    });
  });

  it("fails safely when the action or source finding disappears", async () => {
    vi.mocked(ActionsRepository.prototype.findById).mockResolvedValueOnce(null);
    await runArtifact(ctx, { runId: run.id, ...scope });
    expect(mocks.error).toHaveBeenLastCalledWith(
      "artifact_failed",
      { runId: run.id, code: "UNAVAILABLE", type: "internal" },
    );

    vi.mocked(FindingsRepository.prototype.findById).mockResolvedValueOnce(null);
    await runArtifact(ctx, { runId: run.id, ...scope });
    expect(mocks.error).toHaveBeenLastCalledWith(
      "artifact_failed",
      { runId: run.id, code: "UNAVAILABLE", type: "internal" },
    );
  });
});
