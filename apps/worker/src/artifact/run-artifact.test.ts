import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ProjectsRepository,
  type ActionRow,
  type ArtifactRow,
  type AsyncRunRow,
  type FindingRow,
  type IcpProfileRow,
  type ProjectRow,
} from "@sf/db";
import { LLMError, type AnalysisInvocationRecord } from "@sf/artifacts";
import type { Logger } from "@sf/observability";
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

const { runArtifact } = await import("./run-artifact.ts");

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const request = {
  artifactId: "artifact-1",
  actionId: "action-1",
  artifactType: "technical_ticket" as const,
  generationMode: "template" as const,
  outputLocale: "en",
  operatorInstructions: null,
};
const run = {
  id: "run-1",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  kind: "artifact_generation",
  status: "running",
  active_key: "artifact:artifact-1",
  contract_version: "2026-07-18",
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
const project = {
  id: scope.projectId,
  workspace_id: scope.workspaceId,
  client_name: "Acme",
  project_name: "Growth",
  stage: "executing" as const,
  default_delivery_locale: "en",
  current_icp_profile_id: null,
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

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockResolvedValue();
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockResolvedValue();
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "reconcileActiveToTerminal",
  ).mockResolvedValue(true);
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
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(project);
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(icpRow);
  vi.spyOn(EvidenceRepository.prototype, "listForFindings").mockResolvedValue([
    { finding_id: finding.id, evidence_id: "evidence-1", role: "primary" },
  ]);
  vi.spyOn(EvidenceRepository.prototype, "findByIds").mockResolvedValue([
    {
      id: "evidence-1",
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
    },
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
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(run.id, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "artifact missing",
    });
    expect(ExecutionArtifactsRepository.prototype.setFailed).not.toHaveBeenCalled();
  });

  it("builds an allowlisted high-risk template prompt and commits a text revision", async () => {
    await runArtifact(ctx, { runId: run.id, ...scope });
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
      }),
    );
    expect(ExecutionArtifactsRepository.prototype.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 1,
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
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(run.id, {
      status: "completed",
      resultType: "artifact",
      resultId: artifact.id,
    });
    expect(mocks.info).toHaveBeenCalledWith(
      "artifact_done",
      expect.objectContaining({ valid: true }),
    );
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
    expect(
      AsyncRunsRepository.prototype.reconcileActiveToTerminal,
    ).toHaveBeenCalledWith(scope, run.id, {
      status: "cancelled",
      lastErrorCode: "ARTIFACT_GENERATION_SUPERSEDED",
      lastErrorSummary: "Artifact generation was superseded.",
    });
    expect(mocks.info).not.toHaveBeenCalledWith(
      "artifact_done",
      expect.anything(),
    );
  });

  it("loads the current ICP and commits invalid JSON content as a draft", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: {
        ...request,
        artifactType: "metadata_rewrite",
      },
    });
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce({
      ...project,
      current_icp_profile_id: icpRow.id,
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
    expect(
      AsyncRunsRepository.prototype.reconcileActiveToTerminal,
    ).toHaveBeenCalledWith(scope, run.id, {
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
      run.id,
    );
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(ExecutionArtifactsRepository.prototype.setFailed).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalledWith(
      "artifact_failed",
      expect.anything(),
    );
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
      run.id,
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
