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
  contentHash,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
} from "@sf/db";
import { UpdateActionRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import { updateProjectAction } from "@/lib/services/actions-service";
import { updateProjectArtifact } from "@/lib/services/artifact-update";
import { parseJsonBody } from "@/lib/http/validate";

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
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "Override", siteLanguageCodes: ["en"] },
      content_hash: contentHash({ v: randomUUID() }),
      created_by: actor,
    })
    .returning();

  const nowTs = new Date().toISOString();
  const [run] = await handle.db
    .insert(asyncRuns)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "completed",
      initiated_by: actor,
      started_at: nowTs,
      completed_at: nowTs,
    })
    .returning();
  await new DiagnosticRunsRepository(handle.db).insert({
    runId: run!.id,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    icpProfileId: icp!.id,
    icpProfileVersion: 1,
    ruleSetVersion: "mvp.rules.0.2.0",
    promptSetVersion: "mvp.prompts.0.2.0",
    outputLocale: "en",
    inputManifest: { snapshots: [] },
    inputHash: contentHash({ run: run!.id }),
  });

  const finding = await new FindingsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    findingKey: contentHash({
      projectId: scope.projectId,
      k: "http_status:404",
    }),
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
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
    runId: run!.id,
    seenAt: nowTs,
  });

  const [evidenceId] = await new EvidenceRepository(handle.db).insertMany(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: run!.id,
    },
    [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: ["https://override.example/gone"],
        claim: "Page returns 404.",
        observedAt: nowTs,
        limitation: "Current public response only.",
      },
    ],
  );
  await new EvidenceRepository(handle.db).linkObservations(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: run!.id,
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
    let actionId: string;
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
      const findingId = await seedFinding(
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

    it("AC-034: READY same-hash save is a true no-op, stale edit is 409, and a valid edit returns to draft", async () => {
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

      const stale = updateProjectArtifact(
        { workspaceId },
        projectId,
        artifactId,
        actor,
        {
          baseRevision: 1,
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
        status: "ready",
        current_revision: 2,
      });

      const edited = await updateProjectArtifact(
        { workspaceId },
        projectId,
        artifactId,
        actor,
        {
          baseRevision: 2,
          contentFormat: "markdown",
          content: ticket("ready-editor"),
        },
      );
      expect(edited.currentRevision).toBe(3);
      expect(edited.status).toBe("draft");

      const revisions = await repo.listRevisions(scope, artifactId);
      expect(revisions.map((revision) => revision.revision).sort()).toEqual([
        1, 2, 3,
      ]);
      expect(
        (await repo.findRevision(scope, artifactId, 2))?.content_hash,
      ).toBe(immutableHash);
      expect(
        (await repo.findRevision(scope, artifactId, 3))?.generated_by,
      ).toBe("operator");
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
