import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  contentHash,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ProjectsRepository,
  type ProjectScope,
} from "@sf/db";
import {
  ARTIFACT_FORMAT,
  buildTemplateArtifact,
  createOpenAIClient,
  LLMError,
  PROMPT_SET_VERSION,
  validateArtifact,
  type AnalysisInvocationRecord,
  type ArtifactContent,
  type ArtifactPromptInput,
  type ArtifactType,
  type EvidenceExcerpt,
  type LLMArtifactResult,
} from "@sf/artifacts";
import { parseIcp } from "@sf/engine";
import type { WorkerContext } from "../context.ts";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "../handlers/transient-errors.ts";

/**
 * Artifact generation job (spec §10.1, §10.2). Builds the allowlisted prompt from
 * the confirmed finding + action + evidence, generates content (deterministic
 * template or a validated LLM envelope), validates it, and appends an immutable
 * revision. A model call is recorded as an AnalysisInvocation. Validation failures
 * are saved as a draft revision (never set ready).
 */

export interface ArtifactJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

interface RunRequest {
  artifactId: string;
  actionId: string;
  artifactType: ArtifactType;
  generationMode: "template" | "structured_llm";
  outputLocale: string;
  operatorInstructions: string | null;
}

const SUPERSEDED_RUN = {
  status: "cancelled" as const,
  lastErrorCode: "ARTIFACT_GENERATION_SUPERSEDED",
  lastErrorSummary: "Artifact generation was superseded.",
};

function ownsGeneration(
  artifact: {
    readonly status: string;
    readonly current_revision: number;
    readonly latest_generation_run_id: string | null;
  } | null,
  runId: string,
  expectedRevision: number,
): boolean {
  return (
    artifact?.status === "generating" &&
    artifact.latest_generation_run_id === runId &&
    artifact.current_revision === expectedRevision
  );
}

function isTransientArtifactError(error: unknown): boolean {
  return (
    (error instanceof LLMError &&
      (error.code === "RATE_LIMITED" ||
        error.code === "NETWORK_ERROR" ||
        error.code === "TIMEOUT" ||
        error.code === "SERVER_ERROR")) ||
    isTransientInfrastructureError(error)
  );
}

function permanentFailureMetadata(error: unknown): {
  readonly code: string;
  readonly type: "llm" | "internal" | "unknown";
} {
  if (error instanceof LLMError) return { code: error.code, type: "llm" };
  if (error instanceof Error) return { code: "UNAVAILABLE", type: "internal" };
  return { code: "UNAVAILABLE", type: "unknown" };
}

export function artifactContentHash(
  content: ArtifactContent["content"],
): string {
  return contentHash(
    (typeof content === "string"
      ? { text: content }
      : content) as Parameters<typeof contentHash>[0],
  );
}

export async function runArtifact(
  ctx: WorkerContext,
  payload: ArtifactJobPayload,
): Promise<void> {
  const { runId, workspaceId, projectId } = payload;
  const scope: ProjectScope = { workspaceId, projectId };
  const runs = new AsyncRunsRepository(ctx.db);
  const claimed = await runs.claim(runId);
  if (!claimed) return;

  if (
    claimed.workspace_id !== workspaceId ||
    claimed.project_id !== projectId
  ) {
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: "RUN_SCOPE_MISMATCH",
      lastErrorSummary: "Artifact generation scope did not match its run.",
    });
    return;
  }

  const req = claimed.request_payload as unknown as RunRequest;
  const artifactsRepo = new ExecutionArtifactsRepository(ctx.db);
  const artifact = await artifactsRepo.findById(scope, req.artifactId);
  if (!artifact) {
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "artifact missing",
    });
    return;
  }
  const expectedRevision = artifact.current_revision;
  if (!ownsGeneration(artifact, runId, expectedRevision)) {
    await runs.reconcileActiveToTerminal(scope, runId, SUPERSEDED_RUN);
    return;
  }

  try {
    const input = await buildPromptInput(ctx, scope, req);
    let content: ArtifactContent;
    let invocationId: string | null = null;

    if (req.generationMode === "structured_llm") {
      const client = createOpenAIClient({
        apiKey: ctx.openai.apiKey,
        model: ctx.openai.model,
        ...(ctx.openai.baseUrl ? { baseUrl: ctx.openai.baseUrl } : {}),
        ...(ctx.openai.authScheme ? { authScheme: ctx.openai.authScheme } : {}),
      });
      try {
        const result: LLMArtifactResult = await client.generateArtifact(input);
        content = result.content;
        invocationId = await persistAnalysisInvocation(
          ctx,
          scope,
          runId,
          result.invocation,
        );
      } catch (error) {
        // A rejected/failed model call is still an immutable invocation. Do not
        // silently manufacture a template revision for a structured_llm request:
        // the artifact remains failed and the exact stable error code is auditable.
        if (error instanceof LLMError && error.invocation) {
          await persistAnalysisInvocation(
            ctx,
            scope,
            runId,
            error.invocation,
          );
        }
        throw error;
      }
    } else {
      content = buildTemplateArtifact(input);
    }

    const validation = validateArtifact(req.artifactType, content, {
      requiresValidationRollback: input.requiresValidationRollback,
    });
    const hash = artifactContentHash(content.content);

    const committed = await ctx.db.transaction(async (tx) => {
      const repo = new ExecutionArtifactsRepository(tx);
      const txRuns = new AsyncRunsRepository(tx);
      const locked = await repo.findByIdForUpdate(scope, req.artifactId);
      if (!locked || !ownsGeneration(locked, runId, expectedRevision)) {
        await txRuns.reconcileActiveToTerminal(scope, runId, SUPERSEDED_RUN);
        return false;
      }

      // Compute the next revision only after taking the artifact row lock. The
      // expected-revision CAS below remains a second, explicit ownership guard.
      const nextRevision = locked.current_revision + 1;
      const installed = await repo.setGeneratedForGenerationRun(
        scope,
        req.artifactId,
        runId,
        {
          status: "draft",
          currentRevision: nextRevision,
          expectedRevision,
          validationState: validation.valid ? "valid" : "invalid",
          contentHash: hash,
        },
      );
      if (!installed) {
        await txRuns.reconcileActiveToTerminal(scope, runId, SUPERSEDED_RUN);
        return false;
      }
      await repo.insertRevision({
        workspaceId,
        projectId,
        artifactId: req.artifactId,
        revision: nextRevision,
        contentFormat: ARTIFACT_FORMAT[req.artifactType],
        contentText:
          typeof content.content === "string" ? content.content : null,
        contentJson:
          typeof content.content === "string" ? null : content.content,
        contentHash: hash,
        generatedBy:
          req.generationMode === "structured_llm" ? "llm" : "template",
        editorId: null,
        analysisInvocationId: invocationId,
        note: null,
        validationErrors: [...validation.errors],
      });
      await txRuns.setTerminal(runId, {
        status: "completed",
        resultType: "artifact",
        resultId: req.artifactId,
      });
      return true;
    });
    if (committed) {
      ctx.logger.info("artifact_done", {
        runId,
        artifactId: req.artifactId,
        valid: validation.valid,
      });
    }
  } catch (error) {
    if (isTransientArtifactError(error)) {
      const superseded = await cancelRunIfGenerationWasSuperseded(
        ctx,
        scope,
        req.artifactId,
        runId,
        expectedRevision,
      );
      if (superseded) return;
      ctx.logger.warn("artifact_transient_error", {
        runId,
        code:
          error instanceof LLMError
            ? error.code
            : transientFailureCode(error),
      });
      await runs.resetToQueued(runId);
      throw error;
    }
    const failure = permanentFailureMetadata(error);
    const failed = await ctx.db.transaction(async (tx) => {
      const repo = new ExecutionArtifactsRepository(tx);
      const txRuns = new AsyncRunsRepository(tx);
      const locked = await repo.findByIdForUpdate(scope, req.artifactId);
      if (!ownsGeneration(locked, runId, expectedRevision)) {
        await txRuns.reconcileActiveToTerminal(scope, runId, SUPERSEDED_RUN);
        return false;
      }
      const installed = await repo.setFailedForGenerationRun(
        scope,
        req.artifactId,
        runId,
        expectedRevision,
      );
      if (!installed) {
        await txRuns.reconcileActiveToTerminal(scope, runId, SUPERSEDED_RUN);
        return false;
      }
      await txRuns.setTerminal(runId, {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "artifact generation failed",
      });
      return true;
    });
    if (failed) {
      ctx.logger.error("artifact_failed", {
        runId,
        code: failure.code,
        type: failure.type,
      });
    }
  }
}

async function cancelRunIfGenerationWasSuperseded(
  ctx: WorkerContext,
  scope: ProjectScope,
  artifactId: string,
  runId: string,
  expectedRevision: number,
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const artifact = await new ExecutionArtifactsRepository(tx).findByIdForUpdate(
      scope,
      artifactId,
    );
    if (ownsGeneration(artifact, runId, expectedRevision)) return false;
    await new AsyncRunsRepository(tx).reconcileActiveToTerminal(
      scope,
      runId,
      SUPERSEDED_RUN,
    );
    return true;
  });
}

async function persistAnalysisInvocation(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  invocation: AnalysisInvocationRecord,
): Promise<string> {
  return new AnalysisInvocationsRepository(ctx.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    asyncRunId: runId,
    task: invocation.task,
    provider: invocation.provider,
    model: invocation.model,
    promptSetVersion: invocation.promptSetVersion,
    inputHash: invocation.inputHash,
    outputHash: invocation.outputHash,
    status: invocation.status,
    inputTokens: invocation.inputTokens,
    outputTokens: invocation.outputTokens,
    costUsd: invocation.costUsd,
    latencyMs: invocation.latencyMs,
    errorCode: invocation.errorCode,
  });
}

async function buildPromptInput(
  ctx: WorkerContext,
  scope: ProjectScope,
  req: RunRequest,
): Promise<ArtifactPromptInput> {
  void ARTIFACT_FORMAT;
  void PROMPT_SET_VERSION;
  const action = await new ActionsRepository(ctx.db).findById(
    scope,
    req.actionId,
  );
  if (!action) throw new Error("action missing");
  const finding = await new FindingsRepository(ctx.db).findById(
    scope,
    action.source_finding_id,
  );
  if (!finding) throw new Error("source finding missing");

  const project = await new ProjectsRepository(ctx.db).findById(
    { workspaceId: scope.workspaceId },
    scope.projectId,
  );
  const icpRow = project?.current_icp_profile_id
    ? await new IcpProfilesRepository(ctx.db).findById(
        scope,
        project.current_icp_profile_id,
      )
    : null;
  const icp = parseIcp(icpRow?.profile ?? {});

  // Evidence excerpts: claims + grades only (spec §10.2 allowlist).
  const evidenceRepo = new EvidenceRepository(ctx.db);
  const links = await evidenceRepo.listForFindings(scope, [finding.id]);
  const evidenceRows = await evidenceRepo.findByIds(
    scope,
    links.map((l) => l.evidence_id),
  );
  const evidence: EvidenceExcerpt[] = evidenceRows.map((e) => ({
    evidenceId: e.id,
    claim: e.claim,
    grade: e.grade,
    subjectRefs: (e.subject_refs as unknown[]).filter(
      (x): x is string => typeof x === "string",
    ),
    observedAt: e.observed_at,
  }));

  return {
    artifactType: req.artifactType,
    outputLocale: req.outputLocale,
    operatorInstructions: req.operatorInstructions,
    icp: {
      productName: icp.productName,
      oneLineDescription: icp.oneLineDescription,
      offers: icp.offers,
      useCases: icp.useCases,
      differentiators: icp.differentiators,
      primaryConversion: icp.primaryConversion,
      marketCodes: icp.marketCodes,
    },
    action: {
      templateId: action.template_id,
      title: action.title,
      description: action.description,
      expectedOutcome: action.expected_outcome,
      effort: action.effort,
      risk: action.risk,
    },
    finding: {
      ruleId: finding.rule_id,
      domain: finding.domain,
      summary: finding.summary,
      severity: finding.severity,
      confidence: finding.confidence,
      subjectRefs: (finding.subject_refs as unknown[]).filter(
        (x): x is string => typeof x === "string",
      ),
    },
    evidence,
    requiresValidationRollback:
      req.artifactType === "technical_ticket" && action.risk === "high",
  };
}
