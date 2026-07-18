import {
  ActionsRepository,
  contentHash,
  ExecutionArtifactsRepository,
  ProjectsRepository,
  type WorkspaceScope,
} from "@sf/db";
import { validateArtifact, type ArtifactType } from "@sf/artifacts";
import type { UpdateArtifactRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getProjectArtifact } from "./artifacts";
import { type ArtifactDto } from "./artifact-mappers";

/**
 * Manual artifact revision + status change (spec §10.3). Each content PATCH
 * appends a new immutable revision (never mutates an old one); `baseRevision`
 * conflicts return 409 STALE_REVISION; identical content returns the current
 * object without a new revision. Editing sends the artifact back to `draft`;
 * `ready` requires an empty validation-error set (else 422).
 */

export async function updateProjectArtifact(
  scope: WorkspaceScope,
  projectId: string,
  artifactId: string,
  actorId: string,
  body: UpdateArtifactRequest,
): Promise<ArtifactDto> {
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
  if (
    body.contentFormat !== undefined &&
    body.content !== undefined &&
    body.content !== null
  ) {
    if (body.baseRevision !== artifact.current_revision) {
      throw new ProblemError(
        "STALE_REVISION",
        "Artifact was modified; refetch and retry.",
      );
    }
    const content: string | Record<string, unknown> = body.content;
    const hash = contentHash(
      (typeof content === "string"
        ? { text: content }
        : (content as Record<string, unknown>)) as Parameters<
        typeof contentHash
      >[0],
    );
    if (hash === artifact.content_hash) {
      return getProjectArtifact(scope, projectId, artifactId); // no-op save
    }

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
      const txRepo = new ExecutionArtifactsRepository(tx);
      await txRepo.insertRevision({
        workspaceId: scope.workspaceId,
        projectId,
        artifactId,
        revision: nextRevision,
        contentFormat: body.contentFormat!,
        contentText: typeof content === "string" ? content : null,
        contentJson: typeof content === "string" ? null : content,
        contentHash: hash,
        generatedBy: "operator",
        editorId: actorId,
        analysisInvocationId: null,
        note: body.editorNote ?? null,
        validationErrors: [...validation.errors],
      });
      await txRepo.setGenerated(artifactId, {
        status: "draft", // editing always returns to draft
        currentRevision: nextRevision,
        validationState: validation.valid ? "valid" : "invalid",
        contentHash: hash,
      });
    });
    return getProjectArtifact(scope, projectId, artifactId);
  }

  // Status change.
  if (body.status !== undefined) {
    if (body.status === "ready" && artifact.validation_state !== "valid") {
      throw new ProblemError(
        "ARTIFACT_VALIDATION_FAILED",
        "Fix validation errors before marking ready.",
      );
    }
    await repo.setStatus(projectScope, artifactId, body.status);
    return getProjectArtifact(scope, projectId, artifactId);
  }

  throw new ProblemError(
    "VALIDATION_ERROR",
    "Provide content or a status change.",
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
