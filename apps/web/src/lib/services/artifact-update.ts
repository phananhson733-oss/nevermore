import {
  ActionsRepository,
  contentHash,
  ExecutionArtifactsRepository,
  ProjectsRepository,
  type WorkspaceScope,
} from "@sf/db";
import { validateArtifact, type ArtifactType } from "@sf/artifacts";
import {
  isArtifactContentWithinBudget,
  type UpdateArtifactRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getProjectArtifact } from "./artifacts";
import { type ArtifactDto } from "./artifact-mappers";
import {
  isArtifactContentEditAllowed,
  isManualArtifactStatusTransitionAllowed,
} from "./artifact-state";
import { assertContentShadowAdoptionAllowed } from "./content-shadow-adoption";

/**
 * Manual artifact revision + status change (spec §10.3). Each content PATCH
 * appends a new immutable revision (never mutates an old one); `baseRevision`
 * conflicts return 409 STALE_REVISION; identical content returns the current
 * object without a new revision. Editing sends the artifact back to `draft`;
 * `ready` requires an empty validation-error set (else 422).
 *
 * `ready` additionally requires that no automated verdict forbids adoption. A
 * Content Shadow deliverable is reachable from two surfaces — the review
 * control and the workspace editor below it — and both perform this same
 * `draft -> ready` write, so both ask `content-shadow-adoption.ts`. See that
 * module for why a second copy of the rule would be worse than none.
 */

export async function updateProjectArtifact(
  scope: WorkspaceScope,
  projectId: string,
  artifactId: string,
  actorId: string,
  body: UpdateArtifactRequest,
): Promise<ArtifactDto> {
  // The API route already parses UpdateArtifactRequest. Keep the resource
  // budget here too so a future internal caller cannot bypass the HTTP schema.
  if ("contentFormat" in body && !isArtifactContentWithinBudget(body.content)) {
    throw new ProblemError("VALIDATION_ERROR", "Request failed validation.");
  }

  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at)
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");

  const repo = new ExecutionArtifactsRepository(db);
  const artifact = await repo.findById(projectScope, artifactId);
  if (!artifact) throw new ProblemError("NOT_FOUND", "Artifact not found.");

  // Content update: append a new immutable revision.
  if ("contentFormat" in body) {
    if (body.baseRevision !== artifact.current_revision) {
      throw staleRevision();
    }
    if (!isArtifactContentEditAllowed(artifact.status)) {
      throw artifactStateConflict();
    }
    const content: string | Record<string, unknown> = body.content;
    const hash = contentHash(
      (typeof content === "string"
        ? { text: content }
        : (content as Record<string, unknown>)) as Parameters<
        typeof contentHash
      >[0],
    );
    const requiresValidationRollback = await needsValidationRollback(
      projectScope,
      artifact.action_id,
      artifact.artifact_type,
    );
    const validation = validateArtifact(
      artifact.artifact_type as ArtifactType,
      { contentFormat: body.contentFormat, content },
      { requiresValidationRollback },
    );
    const nextRevision = artifact.current_revision + 1;

    await db.transaction(async (tx) => {
      const currentProject = await new ProjectsRepository(tx).findByIdForUpdate(
        scope,
        projectId,
      );
      if (!currentProject) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }
      if (currentProject.archived_at) {
        throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
      }

      const txRepo = new ExecutionArtifactsRepository(tx);
      const locked = await txRepo.findByIdForUpdate(projectScope, artifactId);
      if (!locked) throw new ProblemError("NOT_FOUND", "Artifact not found.");
      if (locked.current_revision !== body.baseRevision) {
        throw staleRevision();
      }
      if (
        locked.status !== artifact.status ||
        !isArtifactContentEditAllowed(locked.status)
      ) {
        throw artifactStateConflict();
      }
      if (hash === locked.content_hash) {
        const current = await txRepo.findRevision(
          projectScope,
          artifactId,
          locked.current_revision,
        );
        if (!current) {
          throw new Error("artifact current revision is unavailable");
        }
        // Content bytes alone do not identify a revision: the format controls
        // validation and downstream serialization. Only the exact same bytes
        // in the exact same format are an idempotent no-op.
        if (current.content_format === body.contentFormat) return;
      }

      const installed = await txRepo.setGeneratedIfRevision(
        projectScope,
        artifactId,
        {
          status: "draft", // editing always returns to draft
          currentRevision: nextRevision,
          expectedRevision: body.baseRevision,
          expectedStatus: locked.status,
          validationState: validation.valid ? "valid" : "invalid",
          contentHash: hash,
        },
      );
      if (!installed) throw staleRevision();
      await txRepo.insertRevision({
        workspaceId: scope.workspaceId,
        projectId,
        artifactId,
        revision: nextRevision,
        outputLocale: locked.output_locale,
        contentFormat: body.contentFormat,
        contentText: typeof content === "string" ? content : null,
        contentJson: typeof content === "string" ? null : content,
        contentHash: hash,
        generatedBy: "operator",
        editorId: actorId,
        analysisInvocationId: null,
        note: body.editorNote ?? null,
        validationErrors: [...validation.errors],
      });
    });
    return getProjectArtifact(scope, projectId, artifactId);
  }

  // Status change. Status does not bump the content revision, so the current
  // status is part of the CAS predicate as well as baseRevision.
  if (body.baseRevision !== artifact.current_revision) {
    throw staleRevision();
  }
  await db.transaction(async (tx) => {
    const currentProject = await new ProjectsRepository(tx).findByIdForUpdate(
      scope,
      projectId,
    );
    if (!currentProject) {
      throw new ProblemError("NOT_FOUND", "Project not found.");
    }
    if (currentProject.archived_at) {
      throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
    }

    const txRepo = new ExecutionArtifactsRepository(tx);
    const locked = await txRepo.findByIdForUpdate(projectScope, artifactId);
    if (!locked) throw new ProblemError("NOT_FOUND", "Artifact not found.");
    if (locked.current_revision !== body.baseRevision) {
      throw staleRevision();
    }
    if (locked.status !== artifact.status) {
      throw artifactStateConflict();
    }

    // Safe retries of an already-applied status command are true no-ops.
    if (body.status === locked.status) {
      if (body.status === "ready" && locked.validation_state !== "valid") {
        throw artifactValidationFailed();
      }
      return;
    }
    if (!isManualArtifactStatusTransitionAllowed(locked.status, body.status)) {
      throw artifactStateConflict();
    }
    if (body.status === "ready" && locked.validation_state !== "valid") {
      throw artifactValidationFailed();
    }
    // The second door into `ready`. `POST /content-shadow-runs/{id}/review`
    // refuses a `blocked` verdict; this endpoint performs the identical write,
    // so it consults the same judgement rather than a copy of it. Recomputed
    // under the row lock, like every other predicate here.
    if (body.status === "ready") {
      await assertContentShadowAdoptionAllowed(
        tx,
        projectScope,
        locked,
        "/status",
      );
    }

    const updated = await txRepo.setStatusIfRevision(
      projectScope,
      artifactId,
      body.status,
      body.baseRevision,
      locked.status,
    );
    if (!updated) throw artifactStateConflict();
  });
  return getProjectArtifact(scope, projectId, artifactId);
}

function artifactStateConflict(): ProblemError {
  return new ProblemError(
    "VERSION_CONFLICT",
    "Requested artifact state transition is not allowed.",
  );
}

function artifactValidationFailed(): ProblemError {
  return new ProblemError(
    "ARTIFACT_VALIDATION_FAILED",
    "Fix validation errors before marking ready.",
  );
}

function staleRevision(): ProblemError {
  return new ProblemError(
    "STALE_REVISION",
    "Artifact was modified; refetch and retry.",
  );
}

async function needsValidationRollback(
  projectScope: { workspaceId: string; projectId: string },
  actionId: string,
  artifactType: string,
): Promise<boolean> {
  if (artifactType !== "technical_ticket") return false;
  const { db } = getDb();
  const action = await new ActionsRepository(db).findById(
    projectScope,
    actionId,
  );
  return action?.risk === "high";
}
