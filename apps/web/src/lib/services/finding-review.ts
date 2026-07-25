import {
  ActionsRepository,
  contentHash,
  EvidenceRepository,
  FindingReviewEventsRepository,
  FindingsRepository,
  ProjectsRepository,
  TelemetryRepository,
  type ActionRow,
  type FindingRow,
  type WorkspaceScope,
} from "@sf/db";
import {
  ACTION_TEMPLATES,
  derivePriority,
  resolveActionCopy,
  type ActionTemplate,
} from "@sf/engine";
import type { ReviewFindingRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import {
  toFindingDto,
  toActionDto,
  type FindingDto,
  type ActionDto,
} from "./diagnostic-mappers";
import { loadEvidenceByFinding } from "./diagnostic-load";

/**
 * Finding review mutation (spec §9.1, §9.2). `baseRevision` guards concurrency
 * (409 VERSION_CONFLICT). Confirm triggers a same-transaction idempotent Action
 * upsert. Changing a confirmed finding to ignored/needs_more_data is blocked
 * (409 FINDING_ACTION_ACTIVE) while a non-dismissed Action exists — the operator
 * must dismiss the Action first.
 */

export interface ReviewResult {
  readonly finding: FindingDto;
  readonly action: ActionDto | null;
}

/**
 * Resolve the ONE ActionTemplate a rule mints (spec §9.2).
 *
 * `findings.rule_id` is a regex CHECK in the database, not an enum, so a
 * historical row or a renamed rule can name a template that no longer exists.
 * That is a server-side registry gap — the caller's findingId is perfectly
 * valid — so it answers 503 with the offending rule id rather than 4xx, and
 * never falls back to a stand-in template: a fallback would silently mint an
 * Action bound to the wrong artifact type.
 */
function resolveActionTemplate(finding: FindingRow): ActionTemplate {
  const template: ActionTemplate | undefined =
    ACTION_TEMPLATES[finding.rule_id as keyof typeof ACTION_TEMPLATES];
  if (!template) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "No Action template is registered for this finding's rule.",
      { current: { ruleId: finding.rule_id } },
    );
  }
  return template;
}

export async function reviewProjectFinding(
  scope: WorkspaceScope,
  projectId: string,
  findingId: string,
  actorId: string,
  body: ReviewFindingRequest,
): Promise<ReviewResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at)
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");

  const finding = await new FindingsRepository(db).findById(
    projectScope,
    findingId,
  );
  if (!finding) throw new ProblemError("NOT_FOUND", "Finding not found.");
  if (finding.review_revision !== body.baseRevision) {
    throw new ProblemError(
      "VERSION_CONFLICT",
      "Finding was modified; refetch and retry.",
    );
  }

  if (body.reviewState === "confirmed") {
    return confirmFinding(
      scope,
      projectScope,
      project.default_delivery_locale,
      finding,
      actorId,
      body.note ?? null,
    );
  }

  // ignored / needs_more_data: block while an active Action exists (spec §9.1).
  const activeAction = await new ActionsRepository(db).findActiveByFinding(
    projectScope,
    findingId,
  );
  if (activeAction) {
    throw new ProblemError(
      "FINDING_ACTION_ACTIVE",
      "Dismiss the linked action in the plan before changing this finding.",
    );
  }
  const reason = body.reviewState === "ignored" ? body.reason : null;
  const note = body.reviewState === "needs_more_data" ? body.note : null;
  const nextRevision = finding.review_revision + 1;

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

    const ok = await new FindingsRepository(tx).updateReview(
      projectScope,
      findingId,
      {
        reviewState: body.reviewState,
        reviewRevision: nextRevision,
        reason,
        note,
        expectedRevision: finding.review_revision,
      },
    );
    if (!ok) {
      throw new ProblemError(
        "VERSION_CONFLICT",
        "Finding was modified; refetch and retry.",
      );
    }
    await new FindingReviewEventsRepository(tx).append({
      workspaceId: scope.workspaceId,
      projectId,
      findingId,
      fromState: finding.review_state,
      toState: body.reviewState,
      revision: nextRevision,
      reason,
      note,
      actorId,
    });
  });

  const updated = await new FindingsRepository(db).findById(
    projectScope,
    findingId,
  );
  return {
    finding: await buildFindingDto(projectScope, updated ?? finding),
    action: null,
  };
}

async function buildFindingDto(
  projectScope: { workspaceId: string; projectId: string },
  finding: FindingRow,
): Promise<FindingDto> {
  const { db } = getDb();
  const evidenceByFinding = await loadEvidenceByFinding(db, projectScope, [
    finding.id,
  ]);
  return toFindingDto(finding, evidenceByFinding.get(finding.id) ?? []);
}

async function confirmFinding(
  scope: WorkspaceScope,
  projectScope: { workspaceId: string; projectId: string },
  deliveryLocale: string,
  finding: FindingRow,
  actorId: string,
  note: string | null,
): Promise<ReviewResult> {
  const { db } = getDb();
  const template = resolveActionTemplate(finding);
  const actionKey = contentHash({
    projectId: projectScope.projectId,
    findingKey: finding.finding_key,
    templateId: template.templateId,
  });
  const nextRevision = finding.review_revision + 1;

  // Evidence ids linked to this finding become the action's evidence refs.
  const links = await new EvidenceRepository(db).listForFindings(projectScope, [
    finding.id,
  ]);
  const evidenceRefs = links.map((l) => l.evidence_id);

  const priorityRelevant = readPriorityRelevant(finding.title_args);
  const priority = derivePriority({
    severity: finding.severity as "critical" | "high" | "medium" | "low",
    confidence: finding.confidence as "high" | "medium" | "low",
    priorityRelevant,
  });
  const { copy, contentLocale } = resolveActionCopy(template, deliveryLocale);

  const action = await db.transaction(async (tx): Promise<ActionRow> => {
    const currentProject = await new ProjectsRepository(tx).findByIdForUpdate(
      scope,
      projectScope.projectId,
    );
    if (!currentProject) {
      throw new ProblemError("NOT_FOUND", "Project not found.");
    }
    if (currentProject.archived_at) {
      throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
    }

    const ok = await new FindingsRepository(tx).updateReview(
      projectScope,
      finding.id,
      {
        reviewState: "confirmed",
        reviewRevision: nextRevision,
        reason: null,
        note,
        expectedRevision: finding.review_revision,
      },
    );
    if (!ok) {
      throw new ProblemError(
        "VERSION_CONFLICT",
        "Finding was modified; refetch and retry.",
      );
    }
    await new FindingReviewEventsRepository(tx).append({
      workspaceId: scope.workspaceId,
      projectId: projectScope.projectId,
      findingId: finding.id,
      fromState: finding.review_state,
      toState: "confirmed",
      revision: nextRevision,
      reason: null,
      note,
      actorId,
    });

    // The Finding was read BEFORE this transaction, so a diagnostic run that
    // completed in between may already have advanced `last_seen_run_id`. The
    // review UPDATE above locked this row, so re-reading it here is the first
    // moment the value is stable through commit.
    const currentFinding = await new FindingsRepository(tx).findById(
      projectScope,
      finding.id,
    );

    const actionsRepo = new ActionsRepository(tx);
    const existing = await actionsRepo.findByKey(projectScope, actionKey);
    if (existing) {
      // Re-confirm / cross-run: merge evidence refs, keep human priority/status.
      const merged = [
        ...new Set([...(existing.evidence_refs as string[]), ...evidenceRefs]),
      ];
      await actionsRepo.mergeEvidenceRefs(existing.id, merged);
      return existing;
    }
    // Only the INSERT freezes lineage, and `enforce_action_source_lineage`
    // requires `finding.last_seen_run_id = source_diagnostic_run_id` at that
    // moment. Without this comparison a drift raised 23514 with no problem+json
    // at all; a 409 tells the operator to refetch the (now newer) Finding and
    // confirm the diagnosis they actually reviewed. The re-confirm path above
    // is deliberately untouched: it writes no lineage, and Slice 1's contract
    // is that re-confirm never rebinds an Action's source DiagnosticRun.
    if (
      !currentFinding ||
      currentFinding.last_seen_run_id !== finding.last_seen_run_id
    ) {
      throw new ProblemError(
        "VERSION_CONFLICT",
        "A newer diagnosis observed this finding while it was being confirmed; refetch and retry.",
      );
    }
    const created = await actionsRepo.insert({
      workspaceId: scope.workspaceId,
      projectId: projectScope.projectId,
      sourceFindingId: finding.id,
      sourceDiagnosticRunId: finding.last_seen_run_id,
      actionKey,
      templateId: template.templateId,
      templateVersion: template.templateVersion,
      title: copy.title,
      description: copy.description,
      contentLocale,
      priorityBand: priority.band,
      roadmapLane: priority.lane,
      status: priority.status,
      effort: template.effort,
      risk: template.risk,
      expectedOutcome: copy.expectedOutcome,
      evidenceRefs,
      createdBy: actorId,
    });
    await new TelemetryRepository(tx).emit({
      workspaceId: scope.workspaceId,
      projectId: projectScope.projectId,
      eventName: "action_confirmed",
      actorId,
      properties: {
        ruleId: finding.rule_id,
        priorityBand: priority.band,
        roadmapLane: priority.lane,
      },
    });
    return created;
  });

  const updated = await new FindingsRepository(db).findById(
    projectScope,
    finding.id,
  );
  return {
    finding: await buildFindingDto(projectScope, updated ?? finding),
    action: toActionDto(action),
  };
}

function readPriorityRelevant(titleArgs: Record<string, unknown>): boolean {
  return titleArgs["__priorityRelevant"] === true;
}
