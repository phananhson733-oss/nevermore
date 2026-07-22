import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import type { NextRequest } from "next/server";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  ActionsRepository,
  contentHash,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
} from "@sf/db";
import { UpdateActionRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import {
  listProjectActions,
  updateProjectAction,
} from "@/lib/services/actions-service";
import { updateProjectArtifact } from "@/lib/services/artifact-update";
import { createActionArtifact } from "@/lib/services/artifacts";
import { parseJsonBody } from "@/lib/http/validate";
import {
  archiveWinsProjectRace,
  waitForLockAttempt,
  waitUntilBlockedBy,
} from "./project-archive-race";
import { seedCurrentCrawlDiagnostic } from "./current-diagnostic-fixture";

const queueFixture = vi.hoisted(() => ({
  send: vi.fn(
    async (_queue: string, payload: { runId: string }) => payload.runId,
  ),
}));
vi.mock("@/lib/boss", () => ({ getBoss: async () => queueFixture }));

/**
 * AC-030 — Action override (spec §9.3):
 *   - an invalid override payload -> 422 (schema boundary),
 *   - a stale `baseRevision` -> 409 VERSION_CONFLICT,
 *   - a valid override writes an append-only audit row (`action_override_audit`).
 *
 * Overrides never mutate the deterministic priority in place: they bump the Action
 * revision and record old/new values + reason so the next diagnostic cannot silently
 * overwrite a human decision (spec §9.3).
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

/** A real Request carrying a JSON body (parseJsonBody reads headers + text). */
const jsonRequest = (body: unknown): NextRequest =>
  new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

/** Seed a completed run + one confirmable TECH-HTTP-001 finding + its evidence. */
async function seedFinding(
  handle: DbHandle,
  scope: { workspaceId: string; projectId: string },
  siteId: string,
  actor: string,
): Promise<string> {
  const icpContentHash = contentHash({ v: randomUUID() });
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "Override", siteLanguageCodes: ["en"] },
      content_hash: icpContentHash,
      created_by: actor,
    })
    .returning();

  const diagnostic = await seedCurrentCrawlDiagnostic(handle, {
    scope,
    siteId,
    actorId: actor,
    icp: { id: icp!.id, version: 1, contentHash: icpContentHash },
  });

  const finding = await new FindingsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    findingKey: contentHash({
      projectId: scope.projectId,
      k: "http_status:404",
    }),
    ruleId: "TECH-HTTP-001",
    ruleVersion: 2,
    ruleFamily: "http-status",
    intent: "restore_or_redirect",
    domain: "technical_seo",
    titleKey: "finding.http_status",
    titleArgs: { status: "404", count: 3, __priorityRelevant: true },
    summary: "3 pages return HTTP 404.",
    summaryLocale: "en",
    subjectRefs: ["http_status:404"],
    severity: "high",
    confidence: "high",
    reviewState: "unreviewed",
    runId: diagnostic.runId,
    seenAt: diagnostic.capturedAt,
  });

  const [evidenceId] = await new EvidenceRepository(handle.db).insertMany(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: diagnostic.runId,
    },
    [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: [diagnostic.evidenceSubjectRef],
        claim: "Page returns 404.",
        observedAt: diagnostic.capturedAt,
        limitation: "Current public response only.",
        snapshotId: diagnostic.snapshot.id,
        collectionRunId: diagnostic.collectionRunId,
      },
    ],
  );
  await new EvidenceRepository(handle.db).linkObservations(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: diagnostic.runId,
    },
    [{ findingId: finding.id, evidenceId: evidenceId!, role: "primary" }],
  );
  return finding.id;
}

// --- Part 1: invalid override payloads are rejected at the schema boundary (422). ---
describe("invalid action override -> 422 VALIDATION_ERROR (AC-030, spec §9.3)", () => {
  const reject422 = async (body: unknown): Promise<void> => {
    const promise = parseJsonBody(jsonRequest(body), UpdateActionRequest);
    await expect(promise).rejects.toBeInstanceOf(ProblemError);
    await expect(promise).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
  };

  it("a missing reason is rejected (reason always required)", async () => {
    await reject422({ baseRevision: 1, status: "planned" });
  });

  it("a whitespace-only reason is rejected (trim().min(3))", async () => {
    await reject422({ baseRevision: 1, status: "planned", reason: "  " });
  });

  it("no status/priorityBand/roadmapLane is rejected (at least one required)", async () => {
    await reject422({ baseRevision: 1, reason: "reprioritize this" });
  });

  it("a bad status enum is rejected", async () => {
    await reject422({
      baseRevision: 1,
      status: "bogus",
      reason: "reprioritize",
    });
  });

  it("a baseRevision below 1 is rejected", async () => {
    await reject422({
      baseRevision: 0,
      status: "planned",
      reason: "reprioritize",
    });
  });
});

// --- Part 2: stale baseRevision -> 409, valid override -> audit trail. ---
describeDb(
  "action override: conflict + audit trail (AC-030, spec §9.3)",
  () => {
    let handle: DbHandle;
    let workspaceId: string;
    let projectId: string;
    let findingId: string;
    let actionId: string;
    let sourceDiagnosticRunId: string;
    let artifactId: string;
    const actor = randomUUID();

    beforeAll(async () => {
      handle = createDbHandle(DATABASE_URL);
      const [ws] = await handle.db
        .insert(workspaces)
        .values({ name: `WS-${randomUUID()}` })
        .returning();
      workspaceId = ws!.id;
      const created = await createProject(
        { workspaceId },
        actor,
        randomUUID(),
        {
          clientName: "Override",
          projectName: "Override",
          siteUrl: "https://override.example",
          marketCodes: ["US"],
          siteLanguageCodes: ["en"],
          defaultDeliveryLocale: "en",
        },
        safeGuard,
      );
      projectId = created.project.id;
      const siteId = created.project.site.id;
      findingId = await seedFinding(
        handle,
        { workspaceId, projectId },
        siteId,
        actor,
      );

      // Confirm the finding to create the template Action (starts at revision 1).
      const confirmed = await reviewProjectFinding(
        { workspaceId },
        projectId,
        findingId,
        actor,
        { reviewState: "confirmed", baseRevision: 0 },
      );
      expect(confirmed.action).not.toBeNull();
      actionId = confirmed.action!.id;
      // Derived priority for high/high is high/now (spec §9.3 clause 2).
      expect(confirmed.action!.roadmapLane).toBe("now");
      expect(confirmed.action!.revision).toBe(1);
      const confirmedAction = await new ActionsRepository(handle.db).findById(
        { workspaceId, projectId },
        actionId,
      );
      sourceDiagnosticRunId = confirmedAction!.source_diagnostic_run_id;

      const nowTs = new Date().toISOString();
      const [artifactRun] = await handle.db
        .insert(asyncRuns)
        .values({
          workspace_id: workspaceId,
          project_id: projectId,
          kind: "artifact_generation",
          status: "completed",
          initiated_by: actor,
          started_at: nowTs,
          completed_at: nowTs,
        })
        .returning();
      const artifactRepo = new ExecutionArtifactsRepository(handle.db);
      const artifact = await artifactRepo.insert({
        workspaceId,
        projectId,
        actionId,
        artifactType: "technical_ticket",
        generationMode: "template",
        outputLocale: "en",
        latestGenerationRunId: artifactRun!.id,
        createdBy: actor,
      });
      artifactId = artifact.id;
      const initialContent = ticket("initial");
      const initialHash = contentHash({ text: initialContent });
      await artifactRepo.insertRevision({
        workspaceId,
        projectId,
        artifactId,
        revision: 1,
        outputLocale: "en",
        contentFormat: "markdown",
        contentText: initialContent,
        contentJson: null,
        contentHash: initialHash,
        generatedBy: "template",
        editorId: null,
        analysisInvocationId: null,
        note: null,
        validationErrors: [],
      });
      await artifactRepo.setGenerated(artifactId, {
        status: "draft",
        currentRevision: 1,
        validationState: "valid",
        contentHash: initialHash,
      });
    });

    afterAll(async () => {
      await handle?.end();
    });

    async function seedArtifactInStatus(
      status: "generating" | "draft" | "ready" | "failed" | "archived",
      validationState: "valid" | "invalid" = "valid",
    ): Promise<{ id: string; revision: number }> {
      const marker = randomUUID();
      const action = await new ActionsRepository(handle.db).insert({
        workspaceId,
        projectId,
        sourceFindingId: findingId,
        sourceDiagnosticRunId,
        actionKey: contentHash({ projectId, marker }),
        templateId: `artifact_state_fixture_${marker}.v1`,
        templateVersion: 1,
        title: `Artifact state fixture ${status}`,
        description: "Exercise the frozen artifact state machine.",
        contentLocale: "en",
        priorityBand: "medium",
        roadmapLane: "next",
        status: "planned",
        effort: "small",
        risk: "low",
        expectedOutcome: "State transitions remain linearizable.",
        evidenceRefs: [],
        createdBy: actor,
      });
      const nowTs = new Date().toISOString();
      const [run] = await handle.db
        .insert(asyncRuns)
        .values({
          workspace_id: workspaceId,
          project_id: projectId,
          kind: "artifact_generation",
          status: status === "generating" ? "running" : "completed",
          initiated_by: actor,
          started_at: nowTs,
          ...(status === "generating" ? {} : { completed_at: nowTs }),
        })
        .returning();
      const repo = new ExecutionArtifactsRepository(handle.db);
      const artifact = await repo.insert({
        workspaceId,
        projectId,
        actionId: action.id,
        artifactType: "technical_ticket",
        generationMode: "template",
        outputLocale: "en",
        latestGenerationRunId: run!.id,
        createdBy: actor,
      });

      if (status === "failed") {
        await repo.setFailed(artifact.id);
        return { id: artifact.id, revision: 0 };
      }
      if (status === "generating") {
        return { id: artifact.id, revision: 0 };
      }

      const content = ticket(`seed-${status}-${marker}`);
      const hash = contentHash({ text: content });
      await repo.insertRevision({
        workspaceId,
        projectId,
        artifactId: artifact.id,
        revision: 1,
        outputLocale: "en",
        contentFormat: "markdown",
        contentText: content,
        contentJson: null,
        contentHash: hash,
        generatedBy: "template",
        editorId: null,
        analysisInvocationId: null,
        note: null,
        validationErrors:
          validationState === "valid" ? [] : ["fixture validation error"],
      });
      await repo.setGenerated(artifact.id, {
        status: "draft",
        currentRevision: 1,
        validationState,
        contentHash: hash,
      });
      if (status === "ready" || status === "archived") {
        await repo.setStatus(
          { workspaceId, projectId },
          artifact.id,
          status,
        );
      }
      return { id: artifact.id, revision: 1 };
    }

    async function seedRaceAction(label: string): Promise<{
      workspaceId: string;
      projectId: string;
      findingId: string;
      actionId: string;
    }> {
      const suffix = randomUUID();
      const [workspace] = await handle.db
        .insert(workspaces)
        .values({ name: `${label}-${suffix}` })
        .returning();
      const created = await createProject(
        { workspaceId: workspace!.id },
        actor,
        randomUUID(),
        {
          clientName: label,
          projectName: label,
          siteUrl: `https://${label.toLowerCase().replaceAll(" ", "-")}-${suffix}.example`,
          marketCodes: ["US"],
          siteLanguageCodes: ["en"],
          defaultDeliveryLocale: "en",
        },
        safeGuard,
      );
      const raceFindingId = await seedFinding(
        handle,
        { workspaceId: workspace!.id, projectId: created.project.id },
        created.project.site.id,
        actor,
      );
      const confirmed = await reviewProjectFinding(
        { workspaceId: workspace!.id },
        created.project.id,
        raceFindingId,
        actor,
        { reviewState: "confirmed", baseRevision: 0 },
      );
      return {
        workspaceId: workspace!.id,
        projectId: created.project.id,
        findingId: raceFindingId,
        actionId: confirmed.action!.id,
      };
    }

    async function seedRaceArtifact(fixture: {
      workspaceId: string;
      projectId: string;
      actionId: string;
    }): Promise<string> {
      const now = new Date().toISOString();
      const [run] = await handle.db
        .insert(asyncRuns)
        .values({
          workspace_id: fixture.workspaceId,
          project_id: fixture.projectId,
          kind: "artifact_generation",
          status: "completed",
          initiated_by: actor,
          started_at: now,
          completed_at: now,
        })
        .returning();
      const repo = new ExecutionArtifactsRepository(handle.db);
      const artifact = await repo.insert({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        actionId: fixture.actionId,
        artifactType: "technical_ticket",
        generationMode: "template",
        outputLocale: "en",
        latestGenerationRunId: run!.id,
        createdBy: actor,
      });
      const content = ticket(`archive-race-${randomUUID()}`);
      const hash = contentHash({ text: content });
      await repo.insertRevision({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        artifactId: artifact.id,
        revision: 1,
        outputLocale: "en",
        contentFormat: "markdown",
        contentText: content,
        contentJson: null,
        contentHash: hash,
        generatedBy: "template",
        editorId: null,
        analysisInvocationId: null,
        note: null,
        validationErrors: [],
      });
      await repo.setGenerated(artifact.id, {
        status: "draft",
        currentRevision: 1,
        validationState: "valid",
        contentHash: hash,
      });
      return artifact.id;
    }

    async function raceAfterSharedArtifactRead<T, U>(
      targetArtifactId: string,
      first: () => Promise<T>,
      second: () => Promise<U>,
    ): Promise<readonly [PromiseSettledResult<T>, PromiseSettledResult<U>]> {
      const original = ExecutionArtifactsRepository.prototype.findById;
      let arrivals = 0;
      let release!: () => void;
      const bothRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      const spy = vi
        .spyOn(ExecutionArtifactsRepository.prototype, "findById")
        .mockImplementation(async function (
          this: ExecutionArtifactsRepository,
          scope,
          id,
        ) {
          const row = await original.call(this, scope, id);
          if (id === targetArtifactId && arrivals < 2) {
            arrivals += 1;
            if (arrivals === 2) release();
            await bothRead;
          }
          return row;
        });
      try {
        const settled = await Promise.allSettled([first(), second()]);
        expect(arrivals).toBe(2);
        return settled as [PromiseSettledResult<T>, PromiseSettledResult<U>];
      } finally {
        spy.mockRestore();
      }
    }

    it("a stale baseRevision returns 409 VERSION_CONFLICT", async () => {
      const promise = updateProjectAction(
        { workspaceId },
        projectId,
        actionId,
        actor,
        { baseRevision: 0, status: "planned", reason: "move to planned" },
      );
      await expect(promise).rejects.toBeInstanceOf(ProblemError);
      await expect(promise).rejects.toMatchObject({
        status: 409,
        code: "VERSION_CONFLICT",
      });
    });

    it("rejects an illegal candidate -> done transition without changing the action or audit trail", async () => {
      const promise = updateProjectAction(
        { workspaceId },
        projectId,
        actionId,
        actor,
        {
          baseRevision: 1,
          status: "done",
          reason: "attempt to skip the required planning workflow",
        },
      );

      await expect(promise).rejects.toBeInstanceOf(ProblemError);
      await expect(promise).rejects.toMatchObject({
        status: 409,
        code: "VERSION_CONFLICT",
        message: "Requested action status transition is not allowed.",
      });

      const stored = await handle.pool.query<{
        status: string;
        revision: number;
      }>(`SELECT status, revision FROM app.actions WHERE id = $1`, [actionId]);
      expect(stored.rows[0]).toEqual({ status: "candidate", revision: 1 });

      const audits = await handle.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.action_override_audit WHERE action_id = $1`,
        [actionId],
      );
      expect(audits.rows[0]?.count).toBe("0");
    });

    it("a valid override applies the change and writes an audit row", async () => {
      const updated = await updateProjectAction(
        { workspaceId },
        projectId,
        actionId,
        actor,
        {
          baseRevision: 1,
          status: "planned",
          roadmapLane: "next",
          reason: "client asked to sequence this in the next window",
        },
      );

      // The Action reflects the human override with a bumped revision.
      expect(updated.status).toBe("planned");
      expect(updated.roadmapLane).toBe("next");
      expect(updated.revision).toBe(2);

      // Exactly one append-only audit row records the old -> new transition + reason.
      const audit = await handle.pool.query<{
        from_revision: number;
        to_revision: number;
        old_values: Record<string, unknown>;
        new_values: Record<string, unknown>;
        reason: string;
      }>(
        `SELECT from_revision, to_revision, old_values, new_values, reason
       FROM app.action_override_audit WHERE action_id = $1 ORDER BY to_revision`,
        [actionId],
      );
      expect(audit.rowCount).toBe(1);
      const row = audit.rows[0]!;
      expect(row.from_revision).toBe(1);
      expect(row.to_revision).toBe(2);
      expect(row.old_values["roadmapLane"]).toBe("now");
      expect(row.old_values["status"]).toBe("candidate");
      expect(row.new_values["roadmapLane"]).toBe("next");
      expect(row.new_values["status"]).toBe("planned");
      expect(row.reason).toContain("next window");
    });

    it("two concurrent overrides with one baseRevision yield one commit and one atomic 409", async () => {
      const results = await Promise.allSettled([
        updateProjectAction(
          { workspaceId },
          projectId,
          actionId,
          actor,
          {
            baseRevision: 2,
            priorityBand: "critical",
            reason: "the first concurrent operator escalated this",
          },
        ),
        updateProjectAction(
          { workspaceId },
          projectId,
          actionId,
          actor,
          {
            baseRevision: 2,
            priorityBand: "medium",
            reason: "the second concurrent operator reprioritized this",
          },
        ),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(ProblemError);
      expect(rejected[0]!.reason).toMatchObject({
        status: 409,
        code: "VERSION_CONFLICT",
      });

      const stored = await handle.pool.query<{ revision: number }>(
        `SELECT revision FROM app.actions WHERE id = $1`,
        [actionId],
      );
      expect(stored.rows[0]?.revision).toBe(3);
      const audits = await handle.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.action_override_audit WHERE action_id = $1`,
        [actionId],
      );
      expect(audits.rows[0]?.count).toBe("2");
    });

    it("lets an archive winner block an Action override and its audit row", async () => {
      const fixture = await seedRaceAction("Action archive race");
      const result = await archiveWinsProjectRace(
        handle,
        fixture.projectId,
        () =>
          updateProjectAction(
            { workspaceId: fixture.workspaceId },
            fixture.projectId,
            fixture.actionId,
            actor,
            {
              baseRevision: 1,
              status: "planned",
              reason: "exercise the project archive transaction fence",
            },
          ),
      );

      expect(result.status).toBe("rejected");
      if (result.status === "fulfilled") {
        throw new Error("archived Action override unexpectedly committed");
      }
      expect(result.reason).toBeInstanceOf(ProblemError);
      expect(result.reason).toMatchObject({
        code: "PROJECT_ARCHIVED",
        status: 422,
      });

      const stored = await handle.pool.query<{
        status: string;
        revision: number;
        audit_count: number;
      }>(
        `select a.status,
                a.revision,
                (select count(*)::int
                   from app.action_override_audit audit
                  where audit.action_id = a.id) as audit_count
           from app.actions a
          where a.id = $1`,
        [fixture.actionId],
      );
      expect(stored.rows[0]).toEqual({
        status: "candidate",
        revision: 1,
        audit_count: 0,
      });
    });

    it("serializes dismiss against artifact creation without leaving a new run", async () => {
      const fixture = await seedRaceAction("Action dismiss race");
      const blocker = await handle.pool.connect();
      const original = ActionsRepository.prototype.findByIdForUpdate;
      let signalAttempt!: () => void;
      const attempted = new Promise<void>((resolve) => {
        signalAttempt = resolve;
      });
      const lockSpy = vi
        .spyOn(ActionsRepository.prototype, "findByIdForUpdate")
        .mockImplementation(async function (
          this: ActionsRepository,
          scope,
          id,
        ) {
          if (id === fixture.actionId) signalAttempt();
          return original.call(this, scope, id);
        });
      let creation:
        | Promise<Awaited<ReturnType<typeof createActionArtifact>>>
        | undefined;

      try {
        await blocker.query("begin");
        const pid = await blocker.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        );
        await blocker.query(
          `update app.actions
              set status = 'dismissed', revision = revision + 1, updated_at = now()
            where id = $1`,
          [fixture.actionId],
        );

        queueFixture.send.mockClear();
        creation = createActionArtifact(
          { workspaceId: fixture.workspaceId },
          fixture.projectId,
          fixture.actionId,
          actor,
          randomUUID(),
          {
            artifactType: "technical_ticket",
            generationMode: "template",
            outputLocale: "en",
            operatorInstructions: null,
          },
        );
        await waitForLockAttempt(attempted);
        await waitUntilBlockedBy(handle, pid.rows[0]!.pid);
        await blocker.query("commit");

        const [result] = await Promise.allSettled([creation]);
        expect(result!.status).toBe("rejected");
        if (result!.status === "fulfilled") {
          throw new Error("dismissed Action unexpectedly produced an Artifact");
        }
        expect(result!.reason).toBeInstanceOf(ProblemError);
        expect(result!.reason).toMatchObject({
          code: "ACTION_NOT_EXECUTABLE",
          status: 422,
        });
      } catch (error) {
        await blocker.query("rollback").catch(() => undefined);
        if (creation) await Promise.allSettled([creation]);
        throw error;
      } finally {
        lockSpy.mockRestore();
        blocker.release();
      }

      const state = await handle.pool.query<{
        status: string;
        artifact_count: number;
        run_count: number;
      }>(
        `select a.status,
                (select count(*)::int
                   from app.execution_artifacts artifact
                  where artifact.action_id = a.id) as artifact_count,
                (select count(*)::int
                   from app.async_runs run
                  where run.project_id = a.project_id
                    and run.kind = 'artifact_generation') as run_count
           from app.actions a
          where a.id = $1`,
        [fixture.actionId],
      );
      expect(state.rows[0]).toEqual({
        status: "dismissed",
        artifact_count: 0,
        run_count: 0,
      });
      expect(queueFixture.send).not.toHaveBeenCalled();
    });

    it("allows and audits the remaining frozen transitions, including done/dismissed recovery to planned", async () => {
      const transitions = [
        "in_progress",
        "done",
        "planned",
        "blocked",
        "in_progress",
        "done",
        "planned",
        "dismissed",
        "planned",
      ] as const;
      let revision = 3;

      for (const status of transitions) {
        const updated = await updateProjectAction(
          { workspaceId },
          projectId,
          actionId,
          actor,
          {
            baseRevision: revision,
            status,
            reason: `Operator approved transition to ${status}.`,
          },
        );
        revision += 1;
        expect(updated).toMatchObject({ status, revision });
      }

      const audits = await handle.pool.query<{
        from_revision: number;
        to_revision: number;
        reason: string;
      }>(
        `SELECT from_revision, to_revision, reason
         FROM app.action_override_audit
         WHERE action_id = $1
         ORDER BY to_revision`,
        [actionId],
      );
      expect(audits.rowCount).toBe(11);
      expect(audits.rows.slice(-9)).toEqual(
        transitions.map((status, index) => ({
          from_revision: index + 3,
          to_revision: index + 4,
          reason: `Operator approved transition to ${status}.`,
        })),
      );
    });

    it("a stale baseRevision rejects an artifact status update with STALE_REVISION", async () => {
      const promise = updateProjectArtifact(
        { workspaceId },
        projectId,
        artifactId,
        actor,
        { baseRevision: 0, status: "ready" },
      );
      await expect(promise).rejects.toBeInstanceOf(ProblemError);
      await expect(promise).rejects.toMatchObject({
        status: 409,
        code: "STALE_REVISION",
      });
    });

    it("two concurrent artifact edits append one revision and map the loser to atomic 409", async () => {
      const results = await Promise.allSettled([
        updateProjectArtifact(
          { workspaceId },
          projectId,
          artifactId,
          actor,
          {
            baseRevision: 1,
            contentFormat: "markdown",
            content: ticket("operator-a"),
          },
        ),
        updateProjectArtifact(
          { workspaceId },
          projectId,
          artifactId,
          actor,
          {
            baseRevision: 1,
            contentFormat: "markdown",
            content: ticket("operator-b"),
          },
        ),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(ProblemError);
      expect(rejected[0]!.reason).toMatchObject({
        status: 409,
        code: "STALE_REVISION",
      });

      const repo = new ExecutionArtifactsRepository(handle.db);
      const artifact = await repo.findById(
        { workspaceId, projectId },
        artifactId,
      );
      expect(artifact?.current_revision).toBe(2);
      await expect(
        repo.listRevisions({ workspaceId, projectId }, artifactId),
      ).resolves.toHaveLength(2);
    });

    it("lets an archive winner block an Artifact edit and immutable revision write", async () => {
      const fixture = await seedRaceAction("Artifact archive race");
      const raceArtifactId = await seedRaceArtifact(fixture);
      const before = await new ExecutionArtifactsRepository(handle.db).findById(
        { workspaceId: fixture.workspaceId, projectId: fixture.projectId },
        raceArtifactId,
      );

      const result = await archiveWinsProjectRace(
        handle,
        fixture.projectId,
        () =>
          updateProjectArtifact(
            { workspaceId: fixture.workspaceId },
            fixture.projectId,
            raceArtifactId,
            actor,
            {
              baseRevision: 1,
              contentFormat: "markdown",
              content: ticket("archive-winner-must-block-this-edit"),
            },
          ),
      );

      expect(result.status).toBe("rejected");
      if (result.status === "fulfilled") {
        throw new Error("archived Artifact edit unexpectedly committed");
      }
      expect(result.reason).toBeInstanceOf(ProblemError);
      expect(result.reason).toMatchObject({
        code: "PROJECT_ARCHIVED",
        status: 422,
      });

      const stored = await handle.pool.query<{
        status: string;
        current_revision: number;
        content_hash: string | null;
        revision_count: number;
        operator_revision_count: number;
      }>(
        `select a.status,
                a.current_revision,
                a.content_hash,
                (select count(*)::int
                   from app.artifact_revisions r
                  where r.artifact_id = a.id) as revision_count,
                (select count(*)::int
                   from app.artifact_revisions r
                  where r.artifact_id = a.id and r.generated_by = 'operator')
                  as operator_revision_count
           from app.execution_artifacts a
          where a.id = $1`,
        [raceArtifactId],
      );
      expect(stored.rows[0]).toEqual({
        status: "draft",
        current_revision: 1,
        content_hash: before!.content_hash,
        revision_count: 1,
        operator_revision_count: 0,
      });
    });

    it("AC-034: only same-hash + same-format is a no-op; wrong format appends an invalid draft", async () => {
      const scope = { workspaceId, projectId };
      const repo = new ExecutionArtifactsRepository(handle.db);
      const before = await repo.findById(scope, artifactId);
      expect(before?.current_revision).toBe(2);
      const current = await repo.findRevision(
        scope,
        artifactId,
        before!.current_revision,
      );
      expect(current?.content_text).not.toBeNull();
      const immutableHash = current!.content_hash;

      const ready = await updateProjectArtifact(
        { workspaceId },
        projectId,
        artifactId,
        actor,
        { baseRevision: 2, status: "ready" },
      );
      expect(ready.status).toBe("ready");

      // Saving byte-identical content must preserve both revision and READY.
      const noOp = await updateProjectArtifact(
        { workspaceId },
        projectId,
        artifactId,
        actor,
        {
          baseRevision: 2,
          contentFormat: "markdown",
          content: current!.content_text!,
        },
      );
      expect(noOp.currentRevision).toBe(2);
      expect(noOp.status).toBe("ready");
      await expect(repo.listRevisions(scope, artifactId)).resolves.toHaveLength(
        2,
      );

      // The same bytes under another format are a different (invalid) command,
      // because format drives validation and export serialization.
      const wrongFormat = await updateProjectArtifact(
        { workspaceId },
        projectId,
        artifactId,
        actor,
        {
          baseRevision: 2,
          contentFormat: "csv",
          content: current!.content_text!,
        },
      );
      expect(wrongFormat).toMatchObject({
        currentRevision: 3,
        status: "draft",
        validationState: "invalid",
        current: {
          contentFormat: "csv",
          contentHash: immutableHash,
          outputLocale: "en",
        },
      });

      const stale = updateProjectArtifact(
        { workspaceId },
        projectId,
        artifactId,
        actor,
        {
          baseRevision: 2,
          contentFormat: "markdown",
          content: ticket("stale-editor"),
        },
      );
      await expect(stale).rejects.toBeInstanceOf(ProblemError);
      await expect(stale).rejects.toMatchObject({
        status: 409,
        code: "STALE_REVISION",
      });
      await expect(repo.findById(scope, artifactId)).resolves.toMatchObject({
        status: "draft",
        current_revision: 3,
      });

      const edited = await updateProjectArtifact(
        { workspaceId },
        projectId,
        artifactId,
        actor,
        {
          baseRevision: 3,
          contentFormat: "markdown",
          content: ticket("ready-editor"),
        },
      );
      expect(edited.currentRevision).toBe(4);
      expect(edited.status).toBe("draft");

      const revisions = await repo.listRevisions(scope, artifactId);
      expect(revisions.map((revision) => revision.revision).sort()).toEqual([
        1, 2, 3, 4,
      ]);
      expect(
        (await repo.findRevision(scope, artifactId, 2))?.content_hash,
      ).toBe(immutableHash);
      expect(
        (await repo.findRevision(scope, artifactId, 3)),
      ).toMatchObject({
        content_format: "csv",
        content_hash: immutableHash,
        validation_errors: expect.arrayContaining([expect.any(String)]),
      });
      expect(
        (await repo.findRevision(scope, artifactId, 4))?.generated_by,
      ).toBe("operator");
    });

    it.each([
      ["generating", "draft", 0],
      ["generating", "ready", 0],
      ["generating", "archived", 0],
      ["failed", "draft", 0],
      ["failed", "ready", 0],
      ["failed", "archived", 0],
      ["archived", "draft", 1],
      ["archived", "ready", 1],
      ["ready", "draft", 1],
    ] as const)(
      "rejects illegal manual artifact transition %s -> %s without mutation",
      async (currentStatus, requestedStatus, baseRevision) => {
        const seeded = await seedArtifactInStatus(currentStatus);
        const repo = new ExecutionArtifactsRepository(handle.db);
        const before = await repo.findById(
          { workspaceId, projectId },
          seeded.id,
        );

        const promise = updateProjectArtifact(
          { workspaceId },
          projectId,
          seeded.id,
          actor,
          { baseRevision, status: requestedStatus },
        );
        await expect(promise).rejects.toBeInstanceOf(ProblemError);
        await expect(promise).rejects.toMatchObject({
          status: 409,
          code: "VERSION_CONFLICT",
          message: "Requested artifact state transition is not allowed.",
        });

        await expect(
          repo.findById({ workspaceId, projectId }, seeded.id),
        ).resolves.toEqual(before);
      },
    );

    it.each(["generating", "failed", "archived"] as const)(
      "rejects content edits while artifact is %s",
      async (currentStatus) => {
        const seeded = await seedArtifactInStatus(currentStatus);
        const repo = new ExecutionArtifactsRepository(handle.db);
        const before = await repo.findById(
          { workspaceId, projectId },
          seeded.id,
        );

        const promise = updateProjectArtifact(
          { workspaceId },
          projectId,
          seeded.id,
          actor,
          {
            baseRevision: seeded.revision,
            contentFormat: "markdown",
            content: ticket(`illegal-${currentStatus}`),
          },
        );
        await expect(promise).rejects.toMatchObject({
          status: 409,
          code: "VERSION_CONFLICT",
        });
        await expect(
          repo.findById({ workspaceId, projectId }, seeded.id),
        ).resolves.toEqual(before);
        await expect(
          repo.listRevisions({ workspaceId, projectId }, seeded.id),
        ).resolves.toHaveLength(seeded.revision);
      },
    );

    it.each(["draft", "ready", "archived"] as const)(
      "treats an idempotent %s status retry as a timestamp-preserving no-op",
      async (status) => {
        const seeded = await seedArtifactInStatus(status);
        const repo = new ExecutionArtifactsRepository(handle.db);
        const before = await repo.findById(
          { workspaceId, projectId },
          seeded.id,
        );

        const result = await updateProjectArtifact(
          { workspaceId },
          projectId,
          seeded.id,
          actor,
          { baseRevision: seeded.revision, status },
        );
        expect(result.status).toBe(status);
        await expect(
          repo.findById({ workspaceId, projectId }, seeded.id),
        ).resolves.toEqual(before);
      },
    );

    it("blocks draft -> ready when the current revision is invalid", async () => {
      const seeded = await seedArtifactInStatus("draft", "invalid");
      const promise = updateProjectArtifact(
        { workspaceId },
        projectId,
        seeded.id,
        actor,
        { baseRevision: 1, status: "ready" },
      );
      await expect(promise).rejects.toMatchObject({
        status: 422,
        code: "ARTIFACT_VALIDATION_FAILED",
      });
      await expect(
        new ExecutionArtifactsRepository(handle.db).findById(
          { workspaceId, projectId },
          seeded.id,
        ),
      ).resolves.toMatchObject({ status: "draft", current_revision: 1 });
    });

    it("allows the frozen draft -> archived edge", async () => {
      const seeded = await seedArtifactInStatus("draft");
      const result = await updateProjectArtifact(
        { workspaceId },
        projectId,
        seeded.id,
        actor,
        { baseRevision: 1, status: "archived" },
      );
      expect(result).toMatchObject({ status: "archived", currentRevision: 1 });
    });

    it("linearizes a simultaneous content edit and archive without resurrecting the artifact", async () => {
      const seeded = await seedArtifactInStatus("draft");
      const settled = await raceAfterSharedArtifactRead(
        seeded.id,
        () =>
          updateProjectArtifact(
            { workspaceId },
            projectId,
            seeded.id,
            actor,
            {
              baseRevision: 1,
              contentFormat: "markdown",
              content: ticket("concurrent-content"),
            },
          ),
        () =>
          updateProjectArtifact(
            { workspaceId },
            projectId,
            seeded.id,
            actor,
            { baseRevision: 1, status: "archived" },
          ),
      );
      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(
        1,
      );
      const rejected = settled.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected?.reason).toMatchObject({ status: 409 });

      const repo = new ExecutionArtifactsRepository(handle.db);
      const stored = await repo.findById(
        { workspaceId, projectId },
        seeded.id,
      );
      expect([
        { status: "archived", current_revision: 1 },
        { status: "draft", current_revision: 2 },
      ]).toContainEqual({
        status: stored?.status,
        current_revision: stored?.current_revision,
      });
      await expect(
        repo.listRevisions({ workspaceId, projectId }, seeded.id),
      ).resolves.toHaveLength(stored!.current_revision);
    });

    it("allows exactly one simultaneous draft status transition", async () => {
      const seeded = await seedArtifactInStatus("draft");
      const settled = await raceAfterSharedArtifactRead(
        seeded.id,
        () =>
          updateProjectArtifact(
            { workspaceId },
            projectId,
            seeded.id,
            actor,
            { baseRevision: 1, status: "ready" },
          ),
        () =>
          updateProjectArtifact(
            { workspaceId },
            projectId,
            seeded.id,
            actor,
            { baseRevision: 1, status: "archived" },
          ),
      );
      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(
        1,
      );
      const rejected = settled.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected?.reason).toMatchObject({
        status: 409,
        code: "VERSION_CONFLICT",
      });
      await expect(
        new ExecutionArtifactsRepository(handle.db).findById(
          { workspaceId, projectId },
          seeded.id,
        ),
      ).resolves.toMatchObject({
        status: expect.stringMatching(/^(ready|archived)$/),
        current_revision: 1,
      });
    });

    it("filters lane/status inside keyset pagination without leaking non-matching actions", async () => {
      const repo = new ActionsRepository(handle.db);
      const fixtures = [
        {
          marker: "match-oldest",
          lane: "next",
          status: "done",
        },
        {
          marker: "lane-only",
          lane: "next",
          status: "planned",
        },
        {
          marker: "match-middle",
          lane: "next",
          status: "done",
        },
        {
          marker: "status-only",
          lane: "now",
          status: "done",
        },
        {
          marker: "match-newest",
          lane: "next",
          status: "done",
        },
      ] as const;
      const ids = new Map<string, string>();

      for (const fixture of fixtures) {
        const row = await repo.insert({
          workspaceId,
          projectId,
          sourceFindingId: findingId,
          sourceDiagnosticRunId,
          actionKey: contentHash({ projectId, marker: fixture.marker }),
          templateId: `action_list_${fixture.marker}.v1`,
          templateVersion: 1,
          title: fixture.marker,
          description: `Filter fixture ${fixture.marker}`,
          contentLocale: "en",
          priorityBand: "medium",
          roadmapLane: fixture.lane,
          status: fixture.status,
          effort: "small",
          risk: "low",
          expectedOutcome: "Exercise action list filters.",
          evidenceRefs: [],
          createdBy: actor,
        });
        ids.set(fixture.marker, row.id);
      }

      const laneOnly = await listProjectActions(
        { workspaceId },
        projectId,
        { limit: 100, cursor: null, lane: "next", status: null },
      );
      expect(laneOnly.data.length).toBeGreaterThanOrEqual(4);
      expect(laneOnly.data.every((action) => action.roadmapLane === "next")).toBe(
        true,
      );

      const statusOnly = await listProjectActions(
        { workspaceId },
        projectId,
        { limit: 100, cursor: null, lane: null, status: "done" },
      );
      expect(statusOnly.data).toHaveLength(4);
      expect(statusOnly.data.every((action) => action.status === "done")).toBe(
        true,
      );

      const firstPage = await listProjectActions(
        { workspaceId },
        projectId,
        { limit: 2, cursor: null, lane: "next", status: "done" },
      );
      expect(firstPage.data.map((action) => action.id)).toEqual([
        ids.get("match-newest"),
        ids.get("match-middle"),
      ]);
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPage = await listProjectActions(
        { workspaceId },
        projectId,
        {
          limit: 2,
          cursor: firstPage.nextCursor,
          lane: "next",
          status: "done",
        },
      );
      expect(secondPage.data.map((action) => action.id)).toEqual([
        ids.get("match-oldest"),
      ]);
      expect(secondPage.nextCursor).toBeNull();
    });

    it("rejects a direct SQL bypass of the Artifact state machine", async () => {
      await expect(
        handle.pool.query(
          `UPDATE app.execution_artifacts SET status = 'failed' WHERE id = $1`,
          [artifactId],
        ),
      ).rejects.toThrow(/artifact status transition is not allowed/);
      await expect(
        new ExecutionArtifactsRepository(handle.db).findById(
          { workspaceId, projectId },
          artifactId,
        ),
      ).resolves.toMatchObject({ status: "draft", current_revision: 4 });
    });

    it("rejects direct SQL revision smuggling and requires a fresh regeneration owner", async () => {
      const ready = await seedArtifactInStatus("ready");
      await expect(
        handle.pool.query(
          `UPDATE app.execution_artifacts
              SET status = 'draft'
            WHERE id = $1`,
          [ready.id],
        ),
      ).rejects.toThrow(/artifact status transition is not allowed/);

      const draft = await seedArtifactInStatus("draft");
      await expect(
        handle.pool.query(
          `UPDATE app.execution_artifacts
              SET status = 'archived', current_revision = current_revision + 1
            WHERE id = $1`,
          [draft.id],
        ),
      ).rejects.toThrow(/artifact status transition is not allowed/);

      const failed = await seedArtifactInStatus("failed");
      await expect(
        handle.pool.query(
          `UPDATE app.execution_artifacts
              SET status = 'generating'
            WHERE id = $1`,
          [failed.id],
        ),
      ).rejects.toThrow(/artifact status transition is not allowed/);

      const [freshRun] = await handle.db
        .insert(asyncRuns)
        .values({
          workspace_id: workspaceId,
          project_id: projectId,
          kind: "artifact_generation",
          status: "queued",
          initiated_by: actor,
        })
        .returning();
      await expect(
        handle.pool.query(
          `UPDATE app.execution_artifacts
              SET status = 'generating', latest_generation_run_id = $2
            WHERE id = $1`,
          [failed.id, freshRun!.id],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        handle.pool.query(
          `UPDATE app.execution_artifacts
              SET status = 'draft', current_revision = current_revision + 2
            WHERE id = $1`,
          [failed.id],
        ),
      ).rejects.toThrow(/artifact status transition is not allowed/);
    });

    it("the override audit row is append-only (cannot be updated)", async () => {
      await expect(
        handle.pool.query(
          `UPDATE app.action_override_audit SET reason = 'tampered' WHERE action_id = $1`,
          [actionId],
        ),
      ).rejects.toThrow(/append-only/);
    });
  },
);

function ticket(marker: string): string {
  return [
    "## Problem",
    marker,
    "## Affected Scope",
    "- /pricing",
    "## Evidence",
    "- [evidence] observed issue",
    "## Implementation Steps",
    "1. Apply the change.",
    "## Acceptance Tests",
    "- [ ] Verified",
    "## Risk",
    "medium",
  ].join("\n\n");
}
