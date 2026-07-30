import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RULE_OPPORTUNITY_PROJECTION } from "@sf/contracts";
import { ActionsRepository, type ProjectScope } from "@sf/db";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import {
  createActionArtifact,
  listProjectArtifacts,
} from "@/lib/services/artifacts";
import { getProjectOpportunity } from "@/lib/services/opportunities";
import type { ArtifactDto } from "@/lib/services/artifact-mappers";
import {
  buildCtx,
  createDbHandle,
  DATABASE_URL,
  DB_AVAILABLE,
  listProjectFindings,
  runArtifact,
  runMissingProviderDiagnostic,
  stopSharedBoss,
  type DbHandle,
  type WorkerContext,
} from "./full-chain-harness.ts";
import { publishDiagnosticGeneration } from "./published-growth-map-fixture.ts";

/**
 * Vertical proof of the Slice 1 technical delivery chain (Task 7): one measured
 * Finding -> one canonical Action -> one template-fixed Artifact. The chain is
 * driven through the REAL services (finding review, artifact create) and the
 * REAL worker runner, then observed through the canonical read models — no
 * bespoke fixtures, no writes from the read layer. The Execution aggregate view
 * that once mirrored this join was retired with stop gate §19.4; the Artifact
 * list projection is the canonical delivery read model now.
 */

const describeDb = DB_AVAILABLE ? describe : describe.skip;

const READ_SCOPE = (scope: ProjectScope) => ({
  workspaceId: scope.workspaceId,
  uiLocale: "en" as const,
});

describeDb("technical opportunity vertical single chain", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;
  let scope: ProjectScope;
  let actor: string;
  let primaryFindingId: string;
  let supportingFindingIds: string[];

  let reviewableReadiness: string;
  let firstActionId: string;
  let replayActionId: string;
  let confirmedArtifactType: string;
  let primaryActionCount: number;
  let supportingActionCounts: number[];
  let deliveredArtifacts: ArtifactDto[];

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    ctx = buildCtx(handle);

    // Crawl-only diagnostic: trips the technical rules and leaves every Finding
    // reviewable (nothing is auto-confirmed), so this test owns the confirm.
    const run = await runMissingProviderDiagnostic(
      handle,
      ctx,
      "tech-vertical",
    );
    scope = run.scope;
    actor = run.actor;
    await publishDiagnosticGeneration(handle.db, {
      scope,
      diagnosticRunId: run.diagRunId,
      actorId: actor,
      completedAt: new Date().toISOString(),
    });

    const findings = await listProjectFindings(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      { limit: 100, cursor: null, activeOnly: false },
    );
    const httpFinding = findings.data.find((f) => f.ruleId === "TECH-HTTP-001");
    if (!httpFinding)
      throw new Error("golden fixture did not trip TECH-HTTP-001");
    primaryFindingId = httpFinding.id;
    supportingFindingIds = findings.data
      .filter((f) => f.id !== httpFinding.id)
      .map((f) => f.id);

    // Reviewable BEFORE confirmation: exactly one primary Finding, no Action.
    const reviewable = await getProjectOpportunity(
      READ_SCOPE(scope),
      scope.projectId,
      primaryFindingId,
      handle.db,
    );
    reviewableReadiness = reviewable.data.readiness;

    // Confirm from the unreviewed base revision (0), then replay from the
    // revision the first confirm produced — idempotent same-Action upsert.
    const firstReview = await reviewProjectFinding(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      primaryFindingId,
      actor,
      { reviewState: "confirmed", baseRevision: httpFinding.reviewRevision },
    );
    if (!firstReview.action)
      throw new Error("confirm did not create an Action");
    firstActionId = firstReview.action.id;

    const replay = await reviewProjectFinding(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      primaryFindingId,
      actor,
      {
        reviewState: "confirmed",
        baseRevision: firstReview.finding.reviewRevision,
      },
    );
    if (!replay.action) throw new Error("replay did not return the Action");
    replayActionId = replay.action.id;

    const confirmed = await getProjectOpportunity(
      READ_SCOPE(scope),
      scope.projectId,
      primaryFindingId,
      handle.db,
    );
    confirmedArtifactType =
      confirmed.data.readiness === "confirmed"
        ? confirmed.data.action.artifactType
        : "none";

    const actionsRepo = new ActionsRepository(handle.db);
    primaryActionCount = await actionsRepo.countActionsForFinding(
      scope,
      primaryFindingId,
    );
    supportingActionCounts = await Promise.all(
      supportingFindingIds.map((id) =>
        actionsRepo.countActionsForFinding(scope, id),
      ),
    );

    // Create and run the one technical ticket the confirmed Action fixes.
    const artifact = await createActionArtifact(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      firstActionId,
      actor,
      randomUUID(),
      {
        artifactType: "technical_ticket",
        generationMode: "template",
        outputLocale: "en",
        operatorInstructions: null,
      },
    );
    await runArtifact(ctx, {
      runId: artifact.run.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });

    const artifactPage = await listProjectArtifacts(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      { limit: 100, cursor: null },
    );
    deliveredArtifacts = artifactPage.data;
  }, 120_000);

  afterAll(async () => {
    await stopSharedBoss();
    await handle?.end();
  });

  it("surfaces the canonical Finding as a reviewable opportunity before confirm", () => {
    expect(reviewableReadiness).toBe("reviewable");
  });

  it("confirm then replay return the same canonical Action and technical ticket type", () => {
    expect(replayActionId).toBe(firstActionId);
    expect(confirmedArtifactType).toBe("technical_ticket");
    // The Artifact type is rule-fixed, never recomputed by the projection.
    expect(RULE_OPPORTUNITY_PROJECTION["TECH-HTTP-001"].artifactType).toBe(
      "technical_ticket",
    );
  });

  it("keeps exactly one Action for the confirmed Finding and none for supporting Findings", () => {
    expect(primaryActionCount).toBe(1);
    expect(supportingFindingIds.length).toBeGreaterThan(0);
    for (const count of supportingActionCounts) expect(count).toBe(0);
  });

  it("delivers exactly one template-fixed technical ticket on the canonical Artifact read model", () => {
    expect(deliveredArtifacts).toHaveLength(1);
    const delivered = deliveredArtifacts[0]!;
    expect(delivered.actionId).toBe(firstActionId);
    expect(delivered.artifactType).toBe("technical_ticket");
    expect(delivered.currentRevision).toBe(1);
    expect(delivered.status).not.toBe("archived");
  });
});
