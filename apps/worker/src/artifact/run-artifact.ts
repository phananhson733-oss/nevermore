import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
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
  PROMPT_SET_VERSION,
  validateArtifact,
  type ArtifactContent,
  type ArtifactPromptInput,
  type ArtifactType,
  type EvidenceExcerpt,
  type LLMArtifactResult,
} from "@sf/artifacts";
import { parseIcp } from "@sf/engine";
import { createHash } from "node:crypto";
import type { WorkerContext } from "../context.ts";

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

function contentHashOf(content: ArtifactContent): string {
  const payload =
    typeof content.content === "string"
      ? content.content
      : JSON.stringify(content.content);
  return createHash("sha256").update(payload, "utf8").digest("hex");
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

  try {
    const input = await buildPromptInput(ctx, scope, req);
    let content: ArtifactContent;
    let invocationId: string | null = null;

    if (req.generationMode === "structured_llm") {
      const client = createOpenAIClient({
        apiKey: ctx.openai.apiKey,
        model: ctx.openai.model,
      });
      const result: LLMArtifactResult = await client.generateArtifact(input);
      content = result.content;
      invocationId = await new AnalysisInvocationsRepository(ctx.db).insert({
        workspaceId,
        projectId,
        asyncRunId: runId,
        task: result.invocation.task,
        provider: result.invocation.provider,
        model: result.invocation.model,
        promptSetVersion: result.invocation.promptSetVersion,
        inputHash: result.invocation.inputHash,
        outputHash: result.invocation.outputHash,
        status: result.invocation.status,
        inputTokens: result.invocation.inputTokens,
        outputTokens: result.invocation.outputTokens,
        costUsd: result.invocation.costUsd,
        latencyMs: result.invocation.latencyMs,
        errorCode: result.invocation.errorCode,
      });
    } else {
      content = buildTemplateArtifact(input);
    }

    const validation = validateArtifact(req.artifactType, content, {
      requiresValidationRollback: input.requiresValidationRollback,
    });
    const hash = contentHashOf(content);
    const nextRevision = artifact.current_revision + 1;

    await ctx.db.transaction(async (tx) => {
      const repo = new ExecutionArtifactsRepository(tx);
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
      await repo.setGenerated(req.artifactId, {
        status: "draft",
        currentRevision: nextRevision,
        validationState: validation.valid ? "valid" : "invalid",
        contentHash: hash,
      });
      await new AsyncRunsRepository(tx).setTerminal(runId, {
        status: "completed",
        resultType: "artifact",
        resultId: req.artifactId,
      });
    });
    ctx.logger.info("artifact_done", {
      runId,
      artifactId: req.artifactId,
      valid: validation.valid,
    });
  } catch (error) {
    ctx.logger.error("artifact_failed", {
      runId,
      message: error instanceof Error ? error.message : "unknown",
    });
    await artifactsRepo.setFailed(req.artifactId);
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "artifact generation failed",
    });
  }
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
