import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { icpProfiles, workspaces } from "@sf/db/schema";
import {
  ActionsRepository,
  EvidenceRepository,
  FindingsRepository,
  contentHash,
} from "@sf/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProblemError } from "@sf/observability";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import { archiveWinsProjectRace } from "./project-archive-race";
import { seedCurrentCrawlDiagnostic } from "./current-diagnostic-fixture";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

/** Seed a completed diagnostic run with one TECH-HTTP-001 finding + evidence. */
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
      profile: {
        productName: "Acme",
        oneLineDescription: "x",
        productType: "saas",
        businessModels: ["subscription"],
        marketCodes: ["US"],
        segments: ["Growth teams"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
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

describeDb(
  "reviewProjectFinding — confirm → Action upsert (spec §9.1, §9.2)",
  () => {
    let handle: DbHandle;
    let workspaceId: string;
    let projectId: string;
    let siteId: string;
    let findingId: string;
    let actionSourceDiagnosticRunId: string;
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
          clientName: "Diag",
          projectName: "Diag",
          siteUrl: "https://diag.example",
          marketCodes: ["US"],
          siteLanguageCodes: ["en"],
          defaultDeliveryLocale: "en",
        },
        safeGuard,
      );
      projectId = created.project.id;
      siteId = created.project.site.id;
      findingId = await seedFinding(
        handle,
        { workspaceId, projectId },
        siteId,
        actor,
      );
    });
    afterAll(async () => {
      await handle?.end();
    });

    it("confirm creates the template Action with derived priority", async () => {
      const result = await reviewProjectFinding(
        { workspaceId },
        projectId,
        findingId,
        actor,
        {
          reviewState: "confirmed",
          baseRevision: 0,
        },
      );
      expect(result.finding.reviewState).toBe("confirmed");
      expect(result.finding.reviewRevision).toBe(1);
      expect(result.action).not.toBeNull();
      expect(result.action?.templateId).toBe("fix_http_status.v1");
      // severity high + confidence high → high/now (spec §9.3).
      expect(result.action?.priorityBand).toBe("high");
      expect(result.action?.roadmapLane).toBe("now");
      expect(result.action?.status).toBe("candidate");
      expect(result.finding.evidence.length).toBeGreaterThan(0);

      const lineage = await handle.pool.query<{
        source_diagnostic_run_id: string;
        last_seen_run_id: string;
      }>(
        `select action.source_diagnostic_run_id, finding.last_seen_run_id
           from app.actions action
           join app.findings finding on finding.id = action.source_finding_id
          where action.source_finding_id = $1`,
        [findingId],
      );
      expect(lineage.rows).toHaveLength(1);
      expect(lineage.rows[0]?.source_diagnostic_run_id).toBe(
        lineage.rows[0]?.last_seen_run_id,
      );
      actionSourceDiagnosticRunId = lineage.rows[0]!.source_diagnostic_run_id;
    });

    it("re-confirm is idempotent (same action, no duplicate)", async () => {
      const again = await reviewProjectFinding(
        { workspaceId },
        projectId,
        findingId,
        actor,
        {
          reviewState: "confirmed",
          baseRevision: 1,
        },
      );
      expect(again.action?.templateId).toBe("fix_http_status.v1");
      const actions = await new ActionsRepository(handle.db).list(
        { workspaceId, projectId },
        { limit: 50, cursor: null },
      );
      const forFinding = actions.rows.filter(
        (a) => a.source_finding_id === findingId,
      );
      expect(forFinding.length).toBe(1);
      expect(forFinding[0]?.source_diagnostic_run_id).toBe(
        actionSourceDiagnosticRunId,
      );
    });

    it("a stale baseRevision returns 409 VERSION_CONFLICT", async () => {
      await expect(
        reviewProjectFinding({ workspaceId }, projectId, findingId, actor, {
          reviewState: "confirmed",
          baseRevision: 0,
        }),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    });

    it("ignoring a confirmed finding with an active Action is blocked (409)", async () => {
      await expect(
        reviewProjectFinding({ workspaceId }, projectId, findingId, actor, {
          reviewState: "ignored",
          baseRevision: 2,
          reason: "not relevant right now",
        }),
      ).rejects.toBeInstanceOf(ProblemError);
      await expect(
        reviewProjectFinding({ workspaceId }, projectId, findingId, actor, {
          reviewState: "ignored",
          baseRevision: 2,
          reason: "not relevant right now",
        }),
      ).rejects.toMatchObject({ code: "FINDING_ACTION_ACTIVE" });
    });

    it("lets an archive winner block review writes and audit rows", async () => {
      const suffix = randomUUID();
      const [raceWorkspace] = await handle.db
        .insert(workspaces)
        .values({ name: `Finding-archive-${suffix}` })
        .returning();
      const created = await createProject(
        { workspaceId: raceWorkspace!.id },
        actor,
        randomUUID(),
        {
          clientName: "Finding archive race",
          projectName: "Finding archive race",
          siteUrl: `https://finding-archive-${suffix}.example`,
          marketCodes: ["US"],
          siteLanguageCodes: ["en"],
          defaultDeliveryLocale: "en",
        },
        safeGuard,
      );
      const raceFindingId = await seedFinding(
        handle,
        { workspaceId: raceWorkspace!.id, projectId: created.project.id },
        created.project.site.id,
        actor,
      );

      const result = await archiveWinsProjectRace(
        handle,
        created.project.id,
        () =>
          reviewProjectFinding(
            { workspaceId: raceWorkspace!.id },
            created.project.id,
            raceFindingId,
            actor,
            { reviewState: "confirmed", baseRevision: 0 },
          ),
      );

      expect(result.status).toBe("rejected");
      if (result.status === "fulfilled") {
        throw new Error("archived finding review unexpectedly committed");
      }
      expect(result.reason).toBeInstanceOf(ProblemError);
      expect(result.reason).toMatchObject({
        code: "PROJECT_ARCHIVED",
        status: 422,
      });

      const state = await handle.pool.query<{
        review_state: string;
        review_revision: number;
      }>(
        `select review_state, review_revision
           from app.findings
          where id = $1`,
        [raceFindingId],
      );
      expect(state.rows[0]).toEqual({
        review_state: "unreviewed",
        review_revision: 0,
      });
      const writes = await handle.pool.query<{
        event_count: number;
        action_count: number;
        telemetry_count: number;
      }>(
        `select
           (select count(*)::int
              from app.finding_review_events
             where finding_id = $1) as event_count,
           (select count(*)::int
              from app.actions
             where source_finding_id = $1) as action_count,
           (select count(*)::int
              from app.telemetry_events
             where project_id = $2 and event_name = 'action_confirmed') as telemetry_count`,
        [raceFindingId, created.project.id],
      );
      expect(writes.rows[0]).toEqual({
        event_count: 0,
        action_count: 0,
        telemetry_count: 0,
      });
    });
  },
);
