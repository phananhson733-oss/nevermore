import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  contentHash,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ObservationsRepository,
  toRunAttempt,
  type DiagnosticRunRow,
  type ProjectScope,
  type RunAttempt,
} from "@sf/db";
import {
  ARTIFACT_FORMAT,
  assertTemplateArtifactLocale,
  buildTemplateArtifact,
  createOpenAIClient,
  LLMError,
  MAX_ARTIFACT_COLLECTION_ITEMS,
  MAX_ARTIFACT_EVIDENCE_ROWS,
  PROMPT_SET_VERSION,
  UnsupportedTemplateLocaleError,
  validateArtifact,
  type AnalysisInvocationRecord,
  type ArtifactContent,
  type ArtifactPromptInput,
  type ArtifactType,
  type EvidenceExcerpt,
  type LLMArtifactResult,
  type PromptCurrentMetadata,
} from "@sf/artifacts";
import { parseIcp } from "@sf/engine";
import { CRAWL_PROJECTION_LIMITS, subjectUrlOf } from "@sf/sources";
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
  /** Absent only on legacy runs queued before source-lineage freezing. */
  sourceDiagnosticRunId?: string | null;
  /** Absent only on legacy runs; otherwise must match the source diagnosis. */
  sourceIcpProfileId?: string | null;
}

const SUPERSEDED_RUN = {
  status: "cancelled" as const,
  lastErrorCode: "ARTIFACT_GENERATION_SUPERSEDED",
  lastErrorSummary: "Artifact generation was superseded.",
};

const UNKNOWN_CURRENT_METADATA: PromptCurrentMetadata = {
  url: null,
  currentTitle: null,
  currentDescription: null,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function assertPromptCollectionBound(
  label: string,
  values: readonly unknown[],
  maxItems = MAX_ARTIFACT_COLLECTION_ITEMS,
): void {
  if (values.length > maxItems) {
    throw new Error(`${label} exceeded ${maxItems} items`);
  }
}

function firstCanonicalSubjectUrl(values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const candidate = value.trim();
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      continue;
    }
    const url = subjectUrlOf(candidate);
    if (
      url !== null &&
      url.length <= CRAWL_PROJECTION_LIMITS.maxUrlChars
    ) {
      return url;
    }
  }
  return null;
}

function frozenCrawlSnapshotId(
  manifest: Record<string, unknown>,
): string | null {
  const snapshots = manifest["snapshots"];
  if (!Array.isArray(snapshots)) return null;
  const crawlSnapshotIds: string[] = [];
  for (const snapshot of snapshots) {
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      Array.isArray(snapshot)
    ) {
      return null;
    }
    const entry = snapshot as Record<string, unknown>;
    const provider = entry["provider"];
    const snapshotId = entry["snapshotId"];
    if (
      typeof provider !== "string" ||
      typeof snapshotId !== "string" ||
      snapshotId.length === 0 ||
      snapshotId.trim() !== snapshotId ||
      !UUID_RE.test(snapshotId)
    ) {
      return null;
    }
    if (provider === "crawl") crawlSnapshotIds.push(snapshotId);
  }
  return crawlSnapshotIds.length === 1 ? crawlSnapshotIds[0]! : null;
}

function nullableMetadataField(
  value: Record<string, unknown>,
  key: "title" | "metaDescription",
  maxChars: number,
): string | null {
  const field = value[key];
  return typeof field === "string" &&
    field.length > 0 &&
    field.length <= maxChars &&
    field.trim() === field
    ? field
    : null;
}

async function loadCurrentMetadata(
  ctx: WorkerContext,
  scope: ProjectScope,
  finding: {
    readonly subject_refs: readonly unknown[];
  },
  diagnosticRun: DiagnosticRunRow,
  primaryConversionUrl: string | null,
): Promise<PromptCurrentMetadata> {
  const url =
    firstCanonicalSubjectUrl(finding.subject_refs) ??
    firstCanonicalSubjectUrl([primaryConversionUrl]);
  if (url === null) return UNKNOWN_CURRENT_METADATA;

  const snapshotId = frozenCrawlSnapshotId(diagnosticRun.input_manifest);
  if (snapshotId === null) {
    return { url, currentTitle: null, currentDescription: null };
  }

  const observation = await new ObservationsRepository(
    ctx.db,
  ).findBySnapshotMetricSubject(scope, {
    snapshotId,
    provider: "crawl",
    metricKey: "crawl.page.v1",
    subjectType: "url",
    subjectRef: url,
  });
  if (
    observation === null ||
    observation.snapshot_id !== snapshotId ||
    observation.provider !== "crawl" ||
    observation.metric_key !== "crawl.page.v1" ||
    observation.subject_type !== "url" ||
    observation.subject_ref !== url ||
    observation.availability !== "available" ||
    typeof observation.value_json !== "object" ||
    observation.value_json === null ||
    Array.isArray(observation.value_json)
  ) {
    return { url, currentTitle: null, currentDescription: null };
  }
  const value = observation.value_json as Record<string, unknown>;
  return {
    url,
    currentTitle: nullableMetadataField(
      value,
      "title",
      CRAWL_PROJECTION_LIMITS.maxTitleChars,
    ),
    currentDescription: nullableMetadataField(
      value,
      "metaDescription",
      CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars,
    ),
  };
}

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
  if (error instanceof UnsupportedTemplateLocaleError) {
    return { code: error.code, type: "internal" };
  }
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
  const claimed = await runs.claim(scope, runId);
  if (!claimed) return;
  const attempt = toRunAttempt(claimed);

  if (
    claimed.workspace_id !== workspaceId ||
    claimed.project_id !== projectId
  ) {
    await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "RUN_SCOPE_MISMATCH",
      lastErrorSummary: "Artifact generation scope did not match its run.",
    });
    return;
  }

  let req = claimed.request_payload as unknown as RunRequest;
  const artifactsRepo = new ExecutionArtifactsRepository(ctx.db);
  const artifact = await artifactsRepo.findById(scope, req.artifactId);
  if (!artifact) {
    await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "artifact missing",
    });
    return;
  }
  const expectedRevision = artifact.current_revision;
  if (!ownsGeneration(artifact, runId, expectedRevision)) {
    await runs.setTerminal(attempt, SUPERSEDED_RUN);
    return;
  }

  try {
    if (req.generationMode === "template") {
      req = {
        ...req,
        outputLocale: assertTemplateArtifactLocale(req.outputLocale),
      };
    }
    const input = await buildPromptInput(ctx, scope, req);
    let content: ArtifactContent;
    let invocationId: string | null = null;

    if (req.generationMode === "structured_llm") {
      const client = createOpenAIClient({
        apiKey: ctx.openai.apiKey,
        model: ctx.openai.model,
        ...(ctx.openai.baseUrl ? { baseUrl: ctx.openai.baseUrl } : {}),
        ...(ctx.openai.authScheme ? { authScheme: ctx.openai.authScheme } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
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
      if (!(await txRuns.lockAttemptForUpdate(attempt))) return false;
      const locked = await repo.findByIdForUpdate(scope, req.artifactId);
      if (!locked || !ownsGeneration(locked, runId, expectedRevision)) {
        await txRuns.setTerminal(attempt, SUPERSEDED_RUN);
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
        await txRuns.setTerminal(attempt, SUPERSEDED_RUN);
        return false;
      }
      await repo.insertRevision({
        workspaceId,
        projectId,
        artifactId: req.artifactId,
        revision: nextRevision,
        outputLocale: req.outputLocale,
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
      const terminalized = await txRuns.setTerminal(attempt, {
        status: "completed",
        resultType: "artifact",
        resultId: req.artifactId,
      });
      if (!terminalized) {
        throw new Error("artifact attempt ownership changed while locked");
      }
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
        attempt,
      );
      if (superseded) return;
      const code =
        error instanceof LLMError
          ? error.code
          : transientFailureCode(error);
      if (!(await runs.resetToQueued(attempt))) {
        ctx.logger.info("artifact_skip_stale_attempt", { code });
        return;
      }
      ctx.logger.warn("artifact_transient_error", { code });
      throw error;
    }
    const failure = permanentFailureMetadata(error);
    const failed = await ctx.db.transaction(async (tx) => {
      const repo = new ExecutionArtifactsRepository(tx);
      const txRuns = new AsyncRunsRepository(tx);
      if (!(await txRuns.lockAttemptForUpdate(attempt))) return false;
      const locked = await repo.findByIdForUpdate(scope, req.artifactId);
      if (!ownsGeneration(locked, runId, expectedRevision)) {
        await txRuns.setTerminal(attempt, SUPERSEDED_RUN);
        return false;
      }
      const installed = await repo.setFailedForGenerationRun(
        scope,
        req.artifactId,
        runId,
        expectedRevision,
      );
      if (!installed) {
        await txRuns.setTerminal(attempt, SUPERSEDED_RUN);
        return false;
      }
      const terminalized = await txRuns.setTerminal(attempt, {
        status: "failed",
        lastErrorCode:
          failure.code === "UNSUPPORTED_TEMPLATE_LOCALE"
            ? failure.code
            : "UNAVAILABLE",
        lastErrorSummary: "artifact generation failed",
      });
      if (!terminalized) {
        throw new Error("artifact attempt ownership changed while locked");
      }
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
  attempt: RunAttempt,
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const runs = new AsyncRunsRepository(tx);
    if (!(await runs.lockAttemptForUpdate(attempt))) return true;
    const artifact = await new ExecutionArtifactsRepository(tx).findByIdForUpdate(
      scope,
      artifactId,
    );
    if (ownsGeneration(artifact, runId, expectedRevision)) return false;
    await runs.setTerminal(attempt, SUPERSEDED_RUN);
    return true;
  });
}

async function persistAnalysisInvocation(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  invocation: AnalysisInvocationRecord,
): Promise<string> {
  const invocationId = await new AnalysisInvocationsRepository(ctx.db).insert({
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

  // This is an operational projection only: never include prompt/output,
  // hashes, provider prose, or credentials. Logging must remain observational
  // after the immutable invocation has been committed.
  try {
    ctx.logger.info("llm_invocation_recorded", {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      runId,
      provider: invocation.provider,
      model: invocation.model,
      status: invocation.status,
      inputTokens: invocation.inputTokens,
      outputTokens: invocation.outputTokens,
      latencyMs: invocation.latencyMs,
      validationFailure: invocation.status === "rejected",
      costUsd: invocation.costUsd,
      costAvailable: invocation.costUsd !== null,
      errorCode: invocation.errorCode,
    });
  } catch {
    // A telemetry sink failure cannot change the artifact/run outcome.
  }

  return invocationId;
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
  if (
    req.sourceDiagnosticRunId &&
    req.sourceDiagnosticRunId !== action.source_diagnostic_run_id
  ) {
    throw new Error("queued diagnosis does not match the Action source");
  }
  const sourceDiagnosticRunId = action.source_diagnostic_run_id;
  const finding = await new FindingsRepository(ctx.db).findById(
    scope,
    action.source_finding_id,
  );
  if (!finding) throw new Error("source finding missing");

  if (finding.last_seen_run_id !== sourceDiagnosticRunId) {
    throw new Error("source finding moved beyond the frozen diagnosis");
  }
  const sourceDiagnosticRun = await new DiagnosticRunsRepository(
    ctx.db,
  ).findById(scope, sourceDiagnosticRunId);
  if (!sourceDiagnosticRun) {
    throw new Error("source diagnostic run missing");
  }
  const sourceIcpProfileId =
    req.sourceIcpProfileId ?? sourceDiagnosticRun.icp_profile_id;
  if (sourceDiagnosticRun.icp_profile_id !== sourceIcpProfileId) {
    throw new Error("source diagnosis ICP does not match the frozen request");
  }
  const icpRow = await new IcpProfilesRepository(ctx.db).findById(
    scope,
    sourceIcpProfileId,
  );
  if (!icpRow || icpRow.status !== "complete") {
    throw new Error("source diagnosis ICP missing or incomplete");
  }
  const icp = parseIcp(icpRow.profile);

  const currentMetadata =
    req.artifactType === "metadata_rewrite"
      ? await loadCurrentMetadata(
          ctx,
          scope,
          finding,
          sourceDiagnosticRun,
          icp.primaryConversion?.targetUrl ?? null,
        )
      : UNKNOWN_CURRENT_METADATA;

  // Evidence excerpts: claims + grades only (spec §10.2 allowlist).
  const evidenceRepo = new EvidenceRepository(ctx.db);
  const links = await evidenceRepo.listForFindings(scope, [finding.id], {
    diagnosticRunId: sourceDiagnosticRunId,
    // The final row is an overflow sentinel. Refuse the projection before
    // loading claims (or constructing an external model client) when the
    // frozen finding/run relationship exceeds the prompt contract.
    maxRows: MAX_ARTIFACT_EVIDENCE_ROWS + 1,
  });
  if (links.length > MAX_ARTIFACT_EVIDENCE_ROWS) {
    throw new Error("artifact evidence projection exceeded its safety budget");
  }
  if (links.some((link) => link.finding_id !== finding.id)) {
    throw new Error("artifact evidence projection failed its integrity check");
  }
  const evidenceIds = [...new Set(links.map((link) => link.evidence_id))];
  const evidenceRows = await evidenceRepo.findByIds(
    scope,
    evidenceIds,
  );
  const expectedEvidenceIds = new Set(evidenceIds);
  const observedEvidenceIds = new Set<string>();
  for (const row of evidenceRows) {
    if (
      !expectedEvidenceIds.has(row.id) ||
      observedEvidenceIds.has(row.id) ||
      row.diagnostic_run_id !== sourceDiagnosticRunId
    ) {
      throw new Error("artifact evidence projection failed its integrity check");
    }
    observedEvidenceIds.add(row.id);
  }
  if (observedEvidenceIds.size !== expectedEvidenceIds.size) {
    throw new Error("artifact evidence projection failed its integrity check");
  }
  const evidence: EvidenceExcerpt[] = [];
  for (const row of evidenceRows) {
    const subjectRefs = (row.subject_refs as unknown[]).filter(
      (value) => typeof value === "string",
    ) as string[];
    assertPromptCollectionBound(
      "artifact evidence " + row.id + " subjectRefs",
      subjectRefs,
    );
    evidence.push({
      evidenceId: row.id,
      claim: row.claim,
      grade: row.grade,
      subjectRefs,
      observedAt: row.observed_at,
    });
  }
  const findingSubjectRefs = (finding.subject_refs as unknown[]).filter(
    (x): x is string => typeof x === "string",
  );
  assertPromptCollectionBound("icp.offers", icp.offers);
  assertPromptCollectionBound("icp.useCases", icp.useCases);
  assertPromptCollectionBound("icp.differentiators", icp.differentiators);
  assertPromptCollectionBound("icp.marketCodes", icp.marketCodes);
  assertPromptCollectionBound("finding.subjectRefs", findingSubjectRefs);

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
      subjectRefs: findingSubjectRefs,
    },
    currentMetadata,
    evidence,
    requiresValidationRollback:
      req.artifactType === "technical_ticket" && action.risk === "high",
  };
}
