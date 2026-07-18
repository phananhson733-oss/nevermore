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

function ruleId(finding: FindingRow): keyof typeof ACTION_TEMPLATES {
  return finding.rule_id as keyof typeof ACTION_TEMPLATES;
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
    await new FindingsRepository(tx).updateReview(projectScope, findingId, {
      reviewState: body.reviewState,
      reviewRevision: nextRevision,
      reason,
      note,
    });
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
  const template = ACTION_TEMPLATES[ruleId(finding)];
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
    await new FindingsRepository(tx).updateReview(projectScope, finding.id, {
      reviewState: "confirmed",
      reviewRevision: nextRevision,
      reason: null,
      note,
    });
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
    const created = await actionsRepo.insert({
      workspaceId: scope.workspaceId,
      projectId: projectScope.projectId,
      sourceFindingId: finding.id,
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
