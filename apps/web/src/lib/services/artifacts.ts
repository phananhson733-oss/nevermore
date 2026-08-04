import { randomUUID } from "node:crypto";
import {
  ActionsRepository,
  AsyncRunsRepository,
  contentHash,
  DiagnosticRunsRepository,
  enqueueRunInTx,
  ExecutionArtifactsRepository,
  FindingsRepository,
  IdempotencyRepository,
  ProjectsRepository,
  type Executor,
  type WorkspaceScope,
} from "@sf/db";
import { ACTION_TEMPLATES } from "@sf/engine";
import {
  CONTRACT_VERSION,
  type CreateArtifactWireRequest,
} from "@sf/contracts";
import {
  normalizeTemplateArtifactLocale,
  UNSUPPORTED_TEMPLATE_LOCALE_MESSAGE,
} from "@sf/artifacts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { isPostgresUniqueViolation } from "./db-errors";
import { assertValidTimestampUuidListCursor } from "./list-cursor";
import { toAsyncRunDto, runStatusUrl, type AsyncRunDto } from "./runs";
import { toArtifactDto, type ArtifactDto } from "./artifact-mappers";
import { readContentShadowAdoption } from "./content-shadow-adoption";

/**
 * Execution artifact create + read (spec §10.1). Create is ALWAYS async (202),
 * even for template mode. A dismissed action rejects creation (422
 * ACTION_NOT_EXECUTABLE); the artifactType must match the action template. A
 * second live artifact for the same action+type is a REGENERATE (reuse id + new
 * run); concurrent regenerate on `artifact:{id}` returns 409.
 */

const IDEMPOTENCY_SCOPE = "createActionArtifact";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const ARTIFACTS_MAX_PAGE_BYTES = 16 * 1024 * 1024;

/** Reverse map: action templateId → its fixed artifact type (spec §9.2, §10.1). */
const ARTIFACT_TYPE_BY_TEMPLATE: Record<string, string> = Object.fromEntries(
  Object.values(ACTION_TEMPLATES).map((t) => [t.templateId, t.artifactType]),
);

/**
 * Artifact types no operator command may mint (Slice 2 red line B).
 *
 * `english_blog_draft` exists only as the output of a shadow-mode Content
 * Shadow run bound to an already frozen `content_brief` revision; it has no
 * ActionTemplate and no deterministic template dispatch. Allowing this route to
 * cast one would create a second, unaudited path to the same artifact type.
 */
const OPERATOR_FORBIDDEN_ARTIFACT_TYPES: ReadonlySet<string> = new Set([
  "english_blog_draft",
]);

function assertOperatorMintable(artifactType: string): void {
  if (!OPERATOR_FORBIDDEN_ARTIFACT_TYPES.has(artifactType)) return;
  throw new ProblemError(
    "VALIDATION_ERROR",
    `A ${artifactType} is produced by the Content Shadow capability, not by an artifact command.`,
    {
      errors: [
        {
          pointer: "/artifactType",
          code: "type_not_operator_mintable",
          message: `${artifactType} cannot be requested for an Action.`,
        },
      ],
    },
  );
}

/**
 * An Action may only carry the artifact type its template fixes.
 *
 * `actions.template_id` is unconstrained text, so an unknown template used to
 * make this check vanish entirely — the guard read `if (expectedType && ...)`,
 * and an unresolvable template made `expectedType` falsy, admitting ANY wire
 * artifact type for that Action. An Action whose provenance cannot be resolved
 * is now refused instead of trusted.
 */
function assertArtifactTypeMatchesTemplate(
  action: { readonly template_id: string },
  artifactType: string,
): void {
  const expectedType = ARTIFACT_TYPE_BY_TEMPLATE[action.template_id];
  if (!expectedType) {
    throw new ProblemError(
      "ACTION_NOT_EXECUTABLE",
      "This action's template is not in the Action template registry, so the artifact it produces cannot be determined.",
    );
  }
  if (artifactType === expectedType) return;
  throw new ProblemError(
    "VALIDATION_ERROR",
    `This action produces a ${expectedType}, not a ${artifactType}.`,
    {
      errors: [
        {
          pointer: "/artifactType",
          code: "type_mismatch",
          message: `Expected ${expectedType}.`,
        },
      ],
    },
  );
}

export interface ArtifactAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "artifact"; id: string };
  readonly location: string;
}

function replayArtifact(
  row: {
    request_hash: string;
    status: string;
    resource_id: string | null;
    response_body: unknown;
  },
  requestHash: string,
): ArtifactAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key reused with a different request.",
    );
  }
  if (row.status !== "completed" || !row.resource_id) return null;
  const body = row.response_body as {
    run: AsyncRunDto;
    statusUrl: string;
    resourceRef?: { id?: string };
  } | null;
  if (!body?.run || !body.statusUrl) return null;
  return {
    status: 202,
    run: body.run,
    statusUrl: body.statusUrl,
    resourceRef: {
      type: "artifact",
      id: body.resourceRef?.id ?? row.resource_id,
    },
    location: body.statusUrl,
  };
}

function activeArtifactConflict(
  projectId: string,
  runId?: string,
): ProblemError {
  return new ProblemError(
    "RUN_ALREADY_ACTIVE",
    "This artifact is already generating.",
    {
      ...(runId
        ? { headers: { Location: runStatusUrl(projectId, runId) } }
        : {}),
    },
  );
}

function artifactsBudgetExceeded(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "Artifacts projection exceeded its safety budget.",
  );
}

export async function createActionArtifact(
  scope: WorkspaceScope,
  projectId: string,
  actionId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateArtifactWireRequest,
): Promise<ArtifactAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  // A completed key is an immutable record of an already accepted command.
  // Consult it before mutable project/action validation so a safe retry still
  // replays after the project is archived or the action is later dismissed.
  const requestHash = contentHash({
    projectId,
    actionId,
    artifactType: body.artifactType,
    generationMode: body.generationMode,
    outputLocale: body.outputLocale,
    operatorInstructions: body.operatorInstructions ?? null,
  });
  const idem = new IdempotencyRepository(db);
  const existingKey = await idem.find(
    scope.workspaceId,
    IDEMPOTENCY_SCOPE,
    idempotencyKey,
  );
  if (existingKey) {
    const replay = replayArtifact(existingKey, requestHash);
    if (replay) return replay;
  }

  // Route parsing already enforces and canonicalizes this rule. Keep the
  // service defense for direct/internal callers, but apply it only after an
  // immutable completed command had the chance to replay under its original
  // raw/canonical hash.
  const outputLocale =
    body.generationMode === "template"
      ? normalizeTemplateArtifactLocale(body.outputLocale)
      : body.outputLocale;
  if (!outputLocale) {
    throw new ProblemError("VALIDATION_ERROR", "Request failed validation.", {
      errors: [
        {
          pointer: "/outputLocale",
          code: "unsupported_template_locale",
          message: UNSUPPORTED_TEMPLATE_LOCALE_MESSAGE,
        },
      ],
    });
  }

  // Body-only refusal: decided before any read, so a forbidden type can never
  // reach a lookup, a lock, or a queue.
  assertOperatorMintable(body.artifactType);

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at)
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");

  const action = await new ActionsRepository(db).findById(
    projectScope,
    actionId,
  );
  if (!action) throw new ProblemError("NOT_FOUND", "Action not found.");
  if (action.status === "dismissed") {
    throw new ProblemError(
      "ACTION_NOT_EXECUTABLE",
      "A dismissed action cannot produce an artifact.",
    );
  }
  assertArtifactTypeMatchesTemplate(action, body.artifactType);

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const artifactsRepo = new ExecutionArtifactsRepository(db);
  const existing = await artifactsRepo.findLiveByActionType(
    projectScope,
    actionId,
    body.artifactType,
  );
  const artifactId = existing ? existing.id : randomUUID();
  const activeKey = `artifact:${artifactId}`;

  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    activeKey,
  );
  if (active) {
    // Close the read-then-active race for identical idempotent requests: the
    // winner may have committed between the two reads above.
    const now = await idem.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
    );
    const replay = now ? replayArtifact(now, requestHash) : null;
    if (replay) return replay;
    throw activeArtifactConflict(projectId, active.id);
  }

  const boss = await getBoss();
  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
      const txProjects = new ProjectsRepository(tx);
      const txActions = new ActionsRepository(tx);
      const txArtifacts = new ExecutionArtifactsRepository(tx);
      const txFindings = new FindingsRepository(tx);
      const txDiagnosticRuns = new DiagnosticRunsRepository(tx);
      const reserved = await txIdem.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const winner = await txIdem.find(
          scope.workspaceId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
        );
        const replay = winner ? replayArtifact(winner, requestHash) : null;
        if (replay) return replay;
        throw new ProblemError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key is being processed.",
        );
      }

      const currentProject = await txProjects.findByIdForUpdate(
        scope,
        projectId,
      );
      if (!currentProject) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }
      if (currentProject.archived_at) {
        throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
      }

      const currentAction = await txActions.findByIdForUpdate(
        projectScope,
        actionId,
      );
      if (!currentAction) {
        throw new ProblemError("NOT_FOUND", "Action not found.");
      }
      if (currentAction.status === "dismissed") {
        throw new ProblemError(
          "ACTION_NOT_EXECUTABLE",
          "A dismissed action cannot produce an artifact.",
        );
      }
      assertArtifactTypeMatchesTemplate(currentAction, body.artifactType);

      // An Artifact belongs to the exact diagnosis frozen on its Action. The
      // mutable Finding projection may advance after an operator confirms the
      // Action; that must not invalidate already-approved work. Resolve the
      // Finding only to prove the source identity still exists, then use the
      // Action's immutable DiagnosticRun for every queued lineage field.
      const sourceFinding = await txFindings.findById(
        projectScope,
        currentAction.source_finding_id,
      );
      if (!sourceFinding) {
        throw new ProblemError(
          "DEPENDENCY_UNAVAILABLE",
          "Artifact source finding is unavailable.",
        );
      }
      const sourceDiagnosticRun = await txDiagnosticRuns.findById(
        projectScope,
        currentAction.source_diagnostic_run_id,
      );
      if (!sourceDiagnosticRun) {
        throw new ProblemError(
          "DEPENDENCY_UNAVAILABLE",
          "Artifact source diagnosis is unavailable.",
        );
      }

      const currentExisting = await txArtifacts.findLiveByActionType(
        projectScope,
        actionId,
        body.artifactType,
      );
      const currentArtifactId = currentExisting
        ? currentExisting.id
        : randomUUID();

      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "artifact_generation",
        activeKey: `artifact:${currentArtifactId}`,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          artifactId: currentArtifactId,
          actionId,
          artifactType: body.artifactType,
          generationMode: body.generationMode,
          outputLocale,
          operatorInstructions: body.operatorInstructions ?? null,
          sourceDiagnosticRunId: sourceDiagnosticRun.id,
          sourceIcpProfileId: sourceDiagnosticRun.icp_profile_id,
        },
      });

      if (currentExisting) {
        const started = await txArtifacts.startRegenerationIfLive(
          projectScope,
          currentArtifactId,
          run.id,
          {
            generationMode: body.generationMode,
            outputLocale,
          },
        );
        if (!started) {
          throw new ProblemError(
            "VERSION_CONFLICT",
            "Artifact was archived; refetch and retry.",
          );
        }
      } else {
        await txArtifacts.insert({
          id: currentArtifactId,
          workspaceId: scope.workspaceId,
          projectId,
          actionId,
          artifactType: body.artifactType,
          generationMode: body.generationMode,
          outputLocale,
          latestGenerationRunId: run.id,
          createdBy: actorId,
        });
      }
      await enqueueRunInTx(boss, tx, "artifact.generate", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });
      const stageUpdated = await new ProjectsRepository(tx).setStage(
        scope,
        projectId,
        "executing",
      );
      if (!stageUpdated) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }

      const statusUrl = runStatusUrl(projectId, run.id);
      const result: ArtifactAcceptedResult = {
        status: 202,
        run: toAsyncRunDto(run),
        statusUrl,
        resourceRef: { type: "artifact", id: currentArtifactId },
        location: statusUrl,
      };
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody: {
          run: result.run,
          statusUrl: result.statusUrl,
          resourceRef: result.resourceRef,
        },
        resourceType: "artifact",
        resourceId: currentArtifactId,
      });
      return result;
    });
  } catch (error) {
    if (
      isPostgresUniqueViolation(error, [
        "async_runs_one_active_key_idx",
        "execution_artifacts_one_active_type_idx",
      ])
    ) {
      const winnerKey = await idem.find(
        scope.workspaceId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
      );
      const replay = winnerKey ? replayArtifact(winnerKey, requestHash) : null;
      if (replay) return replay;

      const winnerArtifact = await artifactsRepo.findLiveByActionType(
        projectScope,
        actionId,
        body.artifactType,
      );
      const winnerRun = winnerArtifact
        ? await new AsyncRunsRepository(db).findActive(
            projectScope,
            `artifact:${winnerArtifact.id}`,
          )
        : await new AsyncRunsRepository(db).findActive(projectScope, activeKey);
      throw activeArtifactConflict(projectId, winnerRun?.id);
    }
    throw error;
  }
}

export async function listProjectArtifacts(
  scope: WorkspaceScope,
  projectId: string,
  opts: {
    limit: number;
    cursor: string | null;
    artifactType?:
      | "content_brief"
      | "metadata_rewrite"
      | "technical_ticket"
      | "english_blog_draft"
      | null;
    status?: "generating" | "draft" | "ready" | "failed" | "archived" | null;
  },
  exec?: Executor,
): Promise<{ data: ArtifactDto[]; nextCursor: string | null; limit: number }> {
  assertValidTimestampUuidListCursor(opts.cursor);
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const db = exec ?? getDb().db;
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const repo = new ExecutionArtifactsRepository(db);
  const page = await repo.listByProject(projectScope, opts);
  const runs = new AsyncRunsRepository(db);
  const data: ArtifactDto[] = [];
  const encoder = new TextEncoder();
  let dataBytes = 2; // JSON array brackets.
  for (const a of page.rows) {
    const current =
      a.current_revision > 0
        ? await repo.findRevision(projectScope, a.id, a.current_revision)
        : null;
    const activeRun = a.latest_generation_run_id
      ? await runs.findById(projectScope, a.latest_generation_run_id)
      : null;
    const dto = toArtifactDto(
      a,
      current,
      activeRun && !isTerminal(activeRun.status) ? activeRun : null,
      // One extra read, and only for the one artifact type a gate ever judges.
      // The list is what the Studio "Mark ready" control renders from, so
      // leaving the judgement out is what made that control learn the refusal
      // by being refused.
      await readContentShadowAdoption(db, projectScope, a),
    );
    dataBytes +=
      (data.length === 0 ? 0 : 1) +
      encoder.encode(JSON.stringify(dto)).byteLength;
    if (dataBytes > ARTIFACTS_MAX_PAGE_BYTES) artifactsBudgetExceeded();
    data.push(dto);
  }
  return { data, nextCursor: page.nextCursor, limit: opts.limit };
}

export async function getProjectArtifact(
  scope: WorkspaceScope,
  projectId: string,
  artifactId: string,
  requestedRevision?: number | null,
): Promise<ArtifactDto> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const repo = new ExecutionArtifactsRepository(db);
  const artifact = await repo.findById(projectScope, artifactId);
  if (!artifact) throw new ProblemError("NOT_FOUND", "Artifact not found.");
  const selectedRevision = requestedRevision ?? artifact.current_revision;
  const current =
    selectedRevision > 0
      ? await repo.findRevision(projectScope, artifactId, selectedRevision)
      : null;
  if (requestedRevision != null && !current) {
    throw new ProblemError("NOT_FOUND", "Artifact not found.");
  }
  const encoder = new TextEncoder();
  const adoption = await readContentShadowAdoption(db, projectScope, artifact);
  const baseDto = toArtifactDto(artifact, current, null, adoption);
  if (
    encoder.encode(JSON.stringify(baseDto)).byteLength >
    ARTIFACTS_MAX_PAGE_BYTES
  ) {
    artifactsBudgetExceeded();
  }
  const activeRun = artifact.latest_generation_run_id
    ? await new AsyncRunsRepository(db).findById(
        projectScope,
        artifact.latest_generation_run_id,
      )
    : null;
  const dto = toArtifactDto(
    artifact,
    current,
    activeRun && !isTerminal(activeRun.status) ? activeRun : null,
    adoption,
  );
  const dtoBytes = encoder.encode(JSON.stringify(dto)).byteLength;
  if (dtoBytes > ARTIFACTS_MAX_PAGE_BYTES) artifactsBudgetExceeded();
  return dto;
}

function isTerminal(status: string): boolean {
  return (
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "cancelled"
  );
}
