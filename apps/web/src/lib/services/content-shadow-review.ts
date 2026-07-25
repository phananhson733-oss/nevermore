import {
  ExecutionArtifactsRepository,
  FlowShadowQaGatesRepository,
  FlowShadowRunsRepository,
  ProjectsRepository,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import {
  ContentShadowQaClaim,
  type ContentShadowReviewReceipt,
  type ReviewContentShadowRevisionRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { isManualArtifactStatusTransitionAllowed } from "./artifact-state";
import {
  contentShadowAdoptionBlocked,
  verdictForbidsAdoption,
} from "./content-shadow-adoption";

/**
 * `POST /projects/{projectId}/content-shadow-runs/{flowShadowRunId}/review` —
 * record that a person reviewed one Content Shadow draft revision.
 *
 * Three things this command deliberately is NOT:
 *
 * 1. **Not a publish.** Slice 2 connects to no CMS, Git or third-party target,
 *    and there is no code path here that could reach one. The receipt reports
 *    that as a field with a single legal value rather than as a sentence.
 * 2. **Not a second confirmation path.** It writes exactly one thing: the
 *    artifact's status, `draft -> ready`, along the manual edge the artifact
 *    lifecycle already owns. No approval, checkpoint or review-event row is
 *    invented, and no revision is appended.
 * 3. **Not a client-trusting endpoint.** Every guard the screen renders as a
 *    disabled control is recomputed here under the row lock. A reader that got
 *    its arithmetic wrong, or a caller that never rendered anything, still
 *    cannot turn a blocked draft into a reviewed one.
 *
 * It is also not the ONLY endpoint that writes `draft -> ready` on this
 * deliverable: the generic artifact status PATCH does the same thing, so the
 * `blocked` refusal below is imported from `content-shadow-adoption.ts` and
 * that module is what both doors consult.
 *
 * The way back from `ready` is not a decision this command can take, and that
 * is not an omission: the frozen manual edges are `generating -> draft -> ready`
 * and `draft | ready -> archived`, so the return path is an edit, which appends
 * a revision and drops the deliverable back to `draft` on its own. Offering a
 * "send back" button that wrote nothing would be the failure this slice exists
 * to avoid.
 */

/** Claims are stored without severity; the tally does not need it. */
const StoredQaClaim = ContentShadowQaClaim.omit({ severity: true });

function staleRevision(
  detail: string,
  current: Readonly<Record<string, unknown>>,
): ProblemError {
  return new ProblemError("STALE_REVISION", detail, { current });
}

function rejected(pointer: string, code: string, detail: string): ProblemError {
  return new ProblemError("VALIDATION_ERROR", detail, {
    errors: [{ pointer, code, message: detail }],
  });
}

function countClaims(
  stored: unknown,
): ContentShadowReviewReceipt["claimCounts"] {
  const parsed = StoredQaClaim.array().safeParse(stored);
  if (!parsed.success) {
    // A gate row exists because a judgement was made. Reporting "0 / 0 / 0"
    // for findings that cannot be read would be the "we did not look" ->
    // "we found nothing" substitution the gate itself exists to prevent.
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The stored Content Shadow quality findings are unreadable.",
    );
  }
  let passed = 0;
  let failed = 0;
  let unevaluated = 0;
  for (const claim of parsed.data) {
    if (claim.status === "passed") passed += 1;
    else if (claim.status === "failed") failed += 1;
    else unevaluated += 1;
  }
  return { passed, failed, unevaluated };
}

export async function reviewContentShadowRevision(
  scope: WorkspaceScope,
  projectId: string,
  flowShadowRunId: string,
  body: ReviewContentShadowRevisionRequest,
): Promise<ContentShadowReviewReceipt> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const { db } = getDb();

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) {
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
  }

  // A run in another workspace or project is reported absent, never forbidden.
  const shadowRun = await new FlowShadowRunsRepository(db).findById(
    projectScope,
    flowShadowRunId,
  );
  if (!shadowRun) {
    throw new ProblemError("NOT_FOUND", "Content Shadow run not found.");
  }

  const gates = await new FlowShadowQaGatesRepository(db).findByRun(
    projectScope,
    shadowRun.id,
  );
  const gate = gates[0] ?? null;
  if (!gate) {
    // Nothing has been judged, so there is nothing for a person to countersign.
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "This run has produced no automated verdict yet, so there is nothing to review.",
    );
  }

  const artifacts = new ExecutionArtifactsRepository(db);
  const artifact = await artifacts.findById(
    projectScope,
    gate.evaluated_artifact_id,
  );
  if (!artifact) {
    throw new ProblemError("NOT_FOUND", "Reviewed deliverable not found.");
  }

  if (body.baseRevision !== artifact.current_revision) {
    throw staleRevision(
      "This deliverable has a newer revision; the review was not recorded and nothing changed.",
      { currentRevision: artifact.current_revision },
    );
  }
  if (gate.evaluated_revision !== artifact.current_revision) {
    // A verdict that judged revision M cannot carry a review of revision N.
    throw staleRevision(
      `The automated verdict describes revision ${gate.evaluated_revision}, not the current revision ${artifact.current_revision}; the review was not recorded and nothing changed.`,
      {
        currentRevision: artifact.current_revision,
        evaluatedRevision: gate.evaluated_revision,
      },
    );
  }
  // The same predicate and the same refusal the generic artifact status PATCH
  // raises. Both endpoints write `draft -> ready`; a second literal comparison
  // here is how the two doors drift apart.
  if (verdictForbidsAdoption(gate.verdict)) {
    throw contentShadowAdoptionBlocked("/baseRevision");
  }
  if (gate.verdict === "needs_review" && !body.acknowledgeFindings) {
    throw rejected(
      "/acknowledgeFindings",
      "acknowledgement_required",
      "The automated verdict needs human confirmation; acknowledge the findings before passing this revision.",
    );
  }

  const claimCounts = countClaims(gate.claims);

  const reviewed = await db.transaction(async (tx) => {
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

    const txArtifacts = new ExecutionArtifactsRepository(tx);
    const locked = await txArtifacts.findByIdForUpdate(
      projectScope,
      artifact.id,
    );
    if (!locked) {
      throw new ProblemError("NOT_FOUND", "Reviewed deliverable not found.");
    }
    if (locked.current_revision !== body.baseRevision) {
      throw staleRevision(
        "This deliverable has a newer revision; the review was not recorded and nothing changed.",
        { currentRevision: locked.current_revision },
      );
    }

    // A repeat of an already-applied review is a true no-op, not a conflict:
    // the same person clicking twice must not be told the record moved.
    if (locked.status !== "ready") {
      if (!isManualArtifactStatusTransitionAllowed(locked.status, "ready")) {
        throw new ProblemError(
          "VERSION_CONFLICT",
          `A ${locked.status} deliverable cannot be marked reviewed.`,
        );
      }
      if (locked.validation_state !== "valid") {
        throw new ProblemError(
          "ARTIFACT_VALIDATION_FAILED",
          "Fix the deliverable's validation errors before marking it reviewed.",
        );
      }
      const updated = await txArtifacts.setStatusIfRevision(
        projectScope,
        artifact.id,
        "ready",
        body.baseRevision,
        locked.status,
      );
      if (!updated) {
        throw staleRevision(
          "This deliverable changed while the review was being recorded; nothing was written.",
          { currentRevision: locked.current_revision },
        );
      }
    }

    const after = await txArtifacts.findById(projectScope, artifact.id);
    if (!after) {
      throw new ProblemError("NOT_FOUND", "Reviewed deliverable not found.");
    }
    return after;
  });

  return {
    flowShadowRunId: shadowRun.id,
    artifactId: reviewed.id,
    reviewedRevision: reviewed.current_revision,
    artifactStatus:
      reviewed.status as ContentShadowReviewReceipt["artifactStatus"],
    verdict: gate.verdict,
    claimCounts,
    contentHash: shadowRun.content_hash,
    reviewedAt: reviewed.updated_at,
    // Not a sentence a later change could quietly falsify: this stage owns no
    // code path to any external publishing target.
    externalPublishingWrite: "none",
  };
}
