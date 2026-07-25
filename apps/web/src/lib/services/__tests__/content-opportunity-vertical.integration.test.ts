import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  CONTRACT_VERSION,
  RULE_OPPORTUNITY_PROJECTION,
  type ActionStatus,
} from "@sf/contracts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "@sf/flow-shadow";
import {
  ActionsRepository,
  AsyncRunsRepository,
  CapabilityRunsRepository,
  contentHash,
  CONTENT_SHADOW_PROJECTION_VERSION,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  FlowShadowRunsRepository,
  ProjectsRepository,
  type ProjectScope,
} from "@sf/db";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import { createActionArtifact } from "@/lib/services/artifacts";
import {
  buildContentShadowFrozenInput,
  createContentShadowRun,
} from "@/lib/services/content-shadow";
import { updateProjectAction } from "@/lib/services/actions-service";
import { isPostgresUniqueViolation } from "@/lib/services/db-errors";
import {
  buildCtx,
  createDbHandle,
  DATABASE_URL,
  DB_AVAILABLE,
  listProjectFindings,
  runArtifact,
  runCommonChain,
  stopSharedBoss,
  type DbHandle,
  type WorkerContext,
} from "./full-chain-harness.ts";

/**
 * Vertical proof of Slice 2 red line B: one confirmed content Finding owns
 * EXACTLY one Action, that Action owns exactly one live `content_brief`, and no
 * second path can mint either.
 *
 * The technical vertical (Task 7) proves the same shape for
 * `TECH-HTTP-001 -> technical_ticket`; this file is its content twin and adds
 * the counter-examples the invariant actually needs: re-confirm must not create
 * a second Action, a dismissed Action must not be silently revived, the DB
 * unique constraint must be the thing that stops a duplicate, and the parts of
 * the invariant the database deliberately does NOT know about must be refused
 * in the service.
 *
 * Everything is driven through the REAL services and the REAL worker runner.
 */

const describeDb = DB_AVAILABLE ? describe : describe.skip;

/** Every content rule whose ActionTemplate mints a content_brief. */
const CONTENT_RULE_IDS = [
  "CONTENT-COVERAGE-001",
  "CRO-LANDING-003",
  "CONTENT-GAP-011",
  "SEARCH-DECAY-002",
] as const;

function shadowBody(actionId: string) {
  return {
    actionId,
    competitorEntityIds: [],
    searchCluster: {
      clusterKey: "content-vertical",
      keywordEntityIds: [randomUUID()],
    },
    generativeQueryEntityIds: [],
    outputLocale: "en" as const,
    capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  };
}

describeDb("content opportunity vertical single chain", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;
  let scope: ProjectScope;
  let actor: string;
  let diagRunId: string;

  let contentFindingId: string;
  let contentRuleId: string;
  let secondContentFindingId: string;

  let firstActionId: string;
  let replayActionId: string;
  let firstTemplateId: string;
  let briefArtifactId: string;
  let actionCountAfterReplay: number;
  let reviewEventCountAfterReplay: number;
  let briefRevisionAfterReplay: number;
  let briefRowsAfterReplay: number;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    ctx = buildCtx(handle);

    // The shared golden chain confirms TECH-HTTP-001 only, so every content
    // Finding it produces is still unreviewed and this file owns their confirm.
    const chain = await runCommonChain(handle, ctx, "content-vertical");
    scope = chain.scope;
    actor = chain.actor;
    diagRunId = chain.diagRunId;

    const findings = await listProjectFindings(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      { limit: 100, cursor: null, activeOnly: false },
    );
    const contentFindings = CONTENT_RULE_IDS.flatMap((ruleId) =>
      findings.data.filter((f) => f.ruleId === ruleId),
    );
    const primary = contentFindings[0];
    const secondary = contentFindings[1];
    if (!primary || !secondary) {
      throw new Error(
        `golden fixture produced ${contentFindings.length} content findings, need 2`,
      );
    }
    contentFindingId = primary.id;
    contentRuleId = primary.ruleId;
    secondContentFindingId = secondary.id;

    const firstReview = await reviewProjectFinding(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      contentFindingId,
      actor,
      { reviewState: "confirmed", baseRevision: primary.reviewRevision },
    );
    if (!firstReview.action)
      throw new Error("confirm did not create an Action");
    firstActionId = firstReview.action.id;
    firstTemplateId = firstReview.action.templateId;

    // The one content brief the confirmed Action fixes.
    const artifact = await createActionArtifact(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      firstActionId,
      actor,
      randomUUID(),
      {
        artifactType: "content_brief",
        generationMode: "template",
        outputLocale: "en",
        operatorInstructions: null,
      },
    );
    briefArtifactId = artifact.resourceRef.id;
    await runArtifact(ctx, {
      runId: artifact.run.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });

    // Red line B, literally: confirming a second time must reuse the Action and
    // must not touch the artifact it already produced.
    const replay = await reviewProjectFinding(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      contentFindingId,
      actor,
      {
        reviewState: "confirmed",
        baseRevision: firstReview.finding.reviewRevision,
      },
    );
    if (!replay.action) throw new Error("replay did not return the Action");
    replayActionId = replay.action.id;

    actionCountAfterReplay = await new ActionsRepository(
      handle.db,
    ).countActionsForFinding(scope, contentFindingId);
    const counts = await handle.pool.query<{
      actions: number;
      events: number;
      briefs: number;
      revision: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM app.actions WHERE source_finding_id = $1) AS actions,
         (SELECT count(*)::int FROM app.finding_review_events WHERE finding_id = $1) AS events,
         (SELECT count(*)::int FROM app.execution_artifacts WHERE action_id = $2 AND artifact_type = 'content_brief') AS briefs,
         (SELECT current_revision FROM app.execution_artifacts WHERE id = $3) AS revision`,
      [contentFindingId, firstActionId, briefArtifactId],
    );
    reviewEventCountAfterReplay = counts.rows[0]!.events;
    briefRowsAfterReplay = counts.rows[0]!.briefs;
    briefRevisionAfterReplay = counts.rows[0]!.revision;
  }, 180_000);

  afterAll(async () => {
    await stopSharedBoss();
    await handle?.end();
  });

  /**
   * Drive an Action to `dismissed` through the REAL override service, one legal
   * edge at a time. A freshly confirmed Action can start at `candidate` or
   * `blocked` depending on the rule's confidence, and the Slice 1 override
   * state machine has no direct `blocked -> dismissed` edge — walking it keeps
   * this a genuine human-override path instead of a hand-written UPDATE.
   */
  async function dismissThroughOverrides(actionId: string): Promise<void> {
    const nextTowardsDismissed: Readonly<Record<string, ActionStatus>> = {
      blocked: "in_progress",
      in_progress: "done",
      done: "planned",
      candidate: "dismissed",
      planned: "dismissed",
    };
    for (let step = 0; step < 6; step += 1) {
      const row = await new ActionsRepository(handle.db).findById(
        scope,
        actionId,
      );
      if (!row) throw new Error("Action to dismiss is missing");
      if (row.status === "dismissed") return;
      const next = nextTowardsDismissed[row.status];
      if (!next) throw new Error(`no dismissal path from ${row.status}`);
      await updateProjectAction(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        actionId,
        actor,
        {
          baseRevision: row.revision,
          status: next,
          reason: "Not this quarter.",
        },
      );
    }
    throw new Error("Action never reached dismissed");
  }

  it("confirms one content Finding into one canonical Action with a rule-fixed brief", async () => {
    expect(CONTENT_RULE_IDS).toContain(contentRuleId);
    expect(
      RULE_OPPORTUNITY_PROJECTION[
        contentRuleId as keyof typeof RULE_OPPORTUNITY_PROJECTION
      ].artifactType,
    ).toBe("content_brief");

    const artifact = await new ExecutionArtifactsRepository(handle.db).findById(
      scope,
      briefArtifactId,
    );
    expect(artifact).toMatchObject({
      action_id: firstActionId,
      artifact_type: "content_brief",
      status: "draft",
      current_revision: 1,
      validation_state: "valid",
    });
    const live = await new ExecutionArtifactsRepository(
      handle.db,
    ).findLiveByActionType(scope, firstActionId, "content_brief");
    expect(live?.id).toBe(briefArtifactId);
  });

  it("a second confirmation returns the same Action and recasts nothing", async () => {
    expect(replayActionId).toBe(firstActionId);
    expect(actionCountAfterReplay).toBe(1);
    // One Action row for the Finding, two append-only review events, and the
    // brief's revision is exactly where the single generation left it.
    expect(reviewEventCountAfterReplay).toBe(2);
    expect(briefRowsAfterReplay).toBe(1);
    expect(briefRevisionAfterReplay).toBe(1);
  });

  it("the database itself refuses a second Action for the same Finding and template", async () => {
    // The upper bound of red line B is a DB constraint, not a service habit:
    // UNIQUE (source_finding_id, template_id). Proven by bypassing the service.
    const duplicate = await new ActionsRepository(handle.db)
      .insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        sourceFindingId: contentFindingId,
        sourceDiagnosticRunId: diagRunId,
        // A DIFFERENT action_key, so the (project_id, action_key) unique index
        // cannot be what stops this: only the lineage constraint can.
        actionKey: contentHash({ duplicate: randomUUID() }),
        templateId: firstTemplateId,
        templateVersion: 1,
        title: "A duplicate Action",
        description: "A second Action for the same confirmed Finding.",
        contentLocale: "en",
        priorityBand: "high",
        roadmapLane: "now",
        status: "planned",
        effort: "medium",
        risk: "low",
        expectedOutcome: "Never reached.",
        evidenceRefs: [],
        createdBy: actor,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(
      isPostgresUniqueViolation(
        duplicate,
        "actions_source_finding_id_template_id_key",
      ),
    ).toBe(true);

    await expect(
      new ActionsRepository(handle.db).countActionsForFinding(
        scope,
        contentFindingId,
      ),
    ).resolves.toBe(1);
  });

  it("reports another workspace's Finding as absent, never forbidden", async () => {
    await expect(
      reviewProjectFinding(
        { workspaceId: randomUUID() },
        scope.projectId,
        contentFindingId,
        actor,
        { reviewState: "confirmed", baseRevision: 2 },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("refuses to mint an english_blog_draft through the operator artifact route", async () => {
    const before = await handle.pool.query<{ artifacts: number; runs: number }>(
      `SELECT
         (SELECT count(*)::int FROM app.execution_artifacts WHERE project_id = $1) AS artifacts,
         (SELECT count(*)::int FROM app.async_runs WHERE project_id = $1) AS runs`,
      [scope.projectId],
    );

    await expect(
      createActionArtifact(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        firstActionId,
        actor,
        randomUUID(),
        {
          artifactType: "english_blog_draft",
          generationMode: "structured_llm",
          outputLocale: "en",
          operatorInstructions: null,
        },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [
        expect.objectContaining({
          pointer: "/artifactType",
          code: "type_not_operator_mintable",
        }),
      ],
    });

    const after = await handle.pool.query<{ artifacts: number; runs: number }>(
      `SELECT
         (SELECT count(*)::int FROM app.execution_artifacts WHERE project_id = $1) AS artifacts,
         (SELECT count(*)::int FROM app.async_runs WHERE project_id = $1) AS runs`,
      [scope.projectId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("answers 409 when a later diagnosis claims the Finding mid-confirm", async () => {
    // TOCTOU: the Finding is read BEFORE the confirm transaction, and its
    // `last_seen_run_id` is carried into the Action INSERT. A diagnostic run
    // finishing in that window used to surface as an unhandled 23514 (a 500)
    // from `enforce_action_source_lineage`.
    const diagnosticRuns = new DiagnosticRunsRepository(handle.db);
    const sourceRun = await diagnosticRuns.findById(scope, diagRunId);
    if (!sourceRun) throw new Error("chain diagnostic run is missing");

    const asyncRuns = new AsyncRunsRepository(handle.db);
    const laterRun = await asyncRuns.insertQueued({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      kind: "diagnostic",
      activeKey: `diagnostic:confirm-toctou:${randomUUID()}`,
      initiatedBy: actor,
      contractVersion: CONTRACT_VERSION,
      requestPayload: { confirmToctouFixture: true },
    });
    await diagnosticRuns.insert({
      runId: laterRun.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId: sourceRun.site_id,
      icpProfileId: sourceRun.icp_profile_id,
      icpProfileVersion: sourceRun.icp_profile_version,
      ruleSetVersion: sourceRun.rule_set_version,
      promptSetVersion: sourceRun.prompt_set_version,
      outputLocale: sourceRun.output_locale,
      inputManifest: sourceRun.input_manifest,
      inputHash: sourceRun.input_hash,
    });

    const findings = new FindingsRepository(handle.db);
    const target = await findings.findById(scope, secondContentFindingId);
    if (!target) throw new Error("second content finding is missing");
    const stateBefore = target.review_state;

    // Interleave the two transactions deterministically: the advance commits on
    // its own connection after the confirm took the project lock and before the
    // review UPDATE locks the Finding row.
    const original = ProjectsRepository.prototype.findByIdForUpdate;
    const spy = vi
      .spyOn(ProjectsRepository.prototype, "findByIdForUpdate")
      .mockImplementationOnce(async function (
        this: ProjectsRepository,
        ...args: Parameters<typeof original>
      ) {
        const project = await original.apply(this, args);
        await handle.pool.query(
          "UPDATE app.findings SET last_seen_run_id = $1 WHERE id = $2",
          [laterRun.id, secondContentFindingId],
        );
        return project;
      });

    try {
      await expect(
        reviewProjectFinding(
          { workspaceId: scope.workspaceId },
          scope.projectId,
          secondContentFindingId,
          actor,
          {
            reviewState: "confirmed",
            baseRevision: target.review_revision,
          },
        ),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    } finally {
      spy.mockRestore();
    }

    // The whole confirm rolled back: no Action, and the review never landed.
    const rows = await handle.pool.query<{ actions: number; state: string }>(
      `SELECT
         (SELECT count(*)::int FROM app.actions WHERE source_finding_id = $1) AS actions,
         (SELECT review_state FROM app.findings WHERE id = $1) AS state`,
      [secondContentFindingId],
    );
    expect(rows.rows[0]).toEqual({ actions: 0, state: stateBefore });
  });

  it("refuses an archived brief in the service while the trigger still admits it", async () => {
    // The `flow_shadow_runs` provenance trigger checks lineage, not the human
    // artifact state machine: it never reads `status` or `validation_state`.
    // That is why A5 has to live in the service — and why deleting the service
    // assertion would NOT be caught by the database.
    const artifacts = new ExecutionArtifactsRepository(handle.db);
    await artifacts.setStatus(scope, briefArtifactId, "archived");

    // An archived brief is not a live brief, so the service reports the same
    // "there is no confirmed brief to freeze" refusal an absent one gets.
    await expect(
      createContentShadowRun(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        actor,
        randomUUID(),
        shadowBody(firstActionId),
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });

    const asyncRun = await new AsyncRunsRepository(handle.db).insertQueued({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      kind: "content_shadow",
      activeKey: `content_shadow:trigger-proof:${randomUUID()}`,
      initiatedBy: actor,
      contractVersion: CONTRACT_VERSION,
      requestPayload: { archivedBriefTriggerProof: true },
    });
    await new CapabilityRunsRepository(handle.db).create({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      asyncRunId: asyncRun.id,
      capabilityId: "content-shadow",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({
        archivedBriefTriggerProof: asyncRun.id,
      }),
      mode: "shadow",
      sideEffectClass: "internal_write",
    });
    const sourceRun = await new DiagnosticRunsRepository(handle.db).findById(
      scope,
      diagRunId,
    );
    if (!sourceRun) throw new Error("chain diagnostic run is missing");
    const frozen = buildContentShadowFrozenInput({
      inputs: {
        siteId: sourceRun.site_id,
        actionId: firstActionId,
        findingId: contentFindingId,
        sourceDiagnosticRunId: diagRunId,
        contentBriefArtifactId: briefArtifactId,
        contentBriefRevision: 1,
        competitorEntityIds: [],
        clusterKey: "content-vertical",
        keywordEntityIds: [randomUUID()],
        generativeQueryEntityIds: [],
      },
      outputLocale: "en",
    });

    // Same tuple, straight into the table: the trigger admits an ARCHIVED brief.
    const shadowRun = await new FlowShadowRunsRepository(handle.db).create({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId: sourceRun.site_id,
      capabilityRunId: asyncRun.id,
      sourceFindingId: contentFindingId,
      sourceActionId: firstActionId,
      contentBriefArtifactId: briefArtifactId,
      contentBriefRevision: 1,
      flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
      frozenInputManifest: frozen.manifest as unknown as Record<
        string,
        unknown
      >,
      contentHash: frozen.contentHash,
      projectionVersion: CONTENT_SHADOW_PROJECTION_VERSION,
    });
    expect(shadowRun.content_brief_artifact_id).toBe(briefArtifactId);
  });

  it("keeps a dismissed Action dismissed across a re-confirm and refuses the shadow run", async () => {
    // Dismissal is a human decision. Re-confirming the Finding must not revive
    // it — that would be exactly the implicit second confirmation path red
    // line B forbids — so the Finding stays confirmed with nothing live.
    await dismissThroughOverrides(firstActionId);

    const finding = await new FindingsRepository(handle.db).findById(
      scope,
      contentFindingId,
    );
    const reconfirm = await reviewProjectFinding(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      contentFindingId,
      actor,
      { reviewState: "confirmed", baseRevision: finding!.review_revision },
    );
    expect(reconfirm.action?.id).toBe(firstActionId);
    expect(reconfirm.action?.status).toBe("dismissed");

    const actions = new ActionsRepository(handle.db);
    await expect(
      actions.countActionsForFinding(scope, contentFindingId),
    ).resolves.toBe(0);

    const before = await handle.pool.query<{ shadows: number }>(
      "SELECT count(*)::int AS shadows FROM app.flow_shadow_runs WHERE project_id = $1",
      [scope.projectId],
    );
    await expect(
      createContentShadowRun(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        actor,
        randomUUID(),
        shadowBody(firstActionId),
      ),
    ).rejects.toMatchObject({ code: "ACTION_NOT_EXECUTABLE", status: 422 });
    const after = await handle.pool.query<{ shadows: number }>(
      "SELECT count(*)::int AS shadows FROM app.flow_shadow_runs WHERE project_id = $1",
      [scope.projectId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
