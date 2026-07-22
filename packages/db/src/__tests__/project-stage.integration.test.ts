import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { clientProjects, icpProfiles, workspaces } from "../schema.ts";
import { and, eq, sql } from "drizzle-orm";
import { AsyncRunsRepository } from "../repositories/async-runs.ts";
import { CollectionRunsRepository } from "../repositories/collection-runs.ts";
import { DataSnapshotsRepository } from "../repositories/data-snapshots.ts";
import { ExportBundlesRepository } from "../repositories/export-bundles.ts";
import { ProjectsRepository } from "../repositories/projects.ts";
import { SitesRepository } from "../repositories/sites.ts";
import { SourceConnectionsRepository } from "../repositories/source-connections.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("project lifecycle stage", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("moves through only the seven server-owned stages and gates diagnosis readiness", async () => {
    const actor = randomUUID();
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Stage-${randomUUID()}` })
      .returning();
    const scope = { workspaceId: workspace!.id };
    const projects = new ProjectsRepository(handle.db);
    const project = await projects.insert({
      workspaceId: scope.workspaceId,
      clientName: "Stage client",
      projectName: "Stage project",
      defaultDeliveryLocale: "en",
      createdBy: actor,
    });
    expect(project.stage).toBe("setup");
    await projects.setStage(scope, project.id, "collecting");
    expect((await projects.findById(scope, project.id))?.stage).toBe(
      "collecting",
    );

    // A complete working context alone is not a confirmed downstream input.
    const [icp] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: scope.workspaceId,
        project_id: project.id,
        version: 1,
        status: "complete",
        profile: { productName: "Acme" },
        content_hash: "1".repeat(64),
        created_by: actor,
      })
      .returning();
    await projects.setCurrentIcpProfile(scope, project.id, icp!.id);
    await expect(
      projects.setReadyToDiagnoseIfEligible(scope, project.id),
    ).resolves.toBe(false);

    const site = await new SitesRepository(handle.db).insertPrimary({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      origin: "https://stage.example",
      host: "stage.example",
      marketCodes: ["US"],
      languageCodes: ["en"],
    });
    const crawlSource = await new SourceConnectionsRepository(
      handle.db,
    ).insertDefaultCrawl({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      siteId: site.id,
      createdBy: actor,
    });
    const run = await new AsyncRunsRepository(handle.db).insertQueued({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      kind: "collection",
      activeKey: `collect:crawl:${randomUUID()}`,
      initiatedBy: actor,
      contractVersion: "2026-07-18",
    });
    await new CollectionRunsRepository(handle.db).insertPlaceholder({
      runId: run.id,
      workspaceId: scope.workspaceId,
      projectId: project.id,
      siteId: site.id,
      sourceConnectionId: crawlSource.id,
      provider: "crawl",
      operation: "site_graph",
      methodVersion: "crawl.site_graph.v2",
      parametersHash: "2".repeat(64),
    });
    await new DataSnapshotsRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      siteId: site.id,
      collectionRunId: run.id,
      sourceConnectionId: crawlSource.id,
      provider: "crawl",
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: "0.2.0",
      methodVersion: "crawl.site_graph.v2",
      capturedAt: new Date().toISOString(),
      sourceWindow: { start: null, end: null },
      availability: "partial",
      limitation: "fixture",
      rawObjectKey: null,
      rowCount: 0,
      checksum: "0".repeat(64),
    });

    await expect(
      projects.setReadyToDiagnoseIfEligible(scope, project.id),
    ).resolves.toBe(false);
    expect((await projects.findById(scope, project.id))?.stage).toBe(
      "collecting",
    );

    await expect(
      projects.setConfirmedIcpProfile(scope, project.id, icp!.id),
    ).resolves.toBe(true);
    await expect(
      projects.setReadyToDiagnoseIfEligible(scope, project.id),
    ).resolves.toBe(true);
    expect((await projects.findById(scope, project.id))?.stage).toBe(
      "ready_to_diagnose",
    );

    // A later working draft does not replace or invalidate confirmed v1.
    const [draft] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: scope.workspaceId,
        project_id: project.id,
        version: 2,
        status: "draft",
        profile: { productName: "Acme working v2" },
        content_hash: "4".repeat(64),
        created_by: actor,
      })
      .returning();
    await expect(
      projects.setCurrentIcpProfile(scope, project.id, draft!.id),
    ).resolves.toBe(true);
    await projects.setStage(scope, project.id, "collecting");
    await expect(
      projects.setReadyToDiagnoseIfEligible(scope, project.id),
    ).resolves.toBe(true);
    expect(await projects.findById(scope, project.id)).toMatchObject({
      stage: "ready_to_diagnose",
      current_icp_profile_id: draft!.id,
      confirmed_icp_profile_id: icp!.id,
    });

    for (const stage of [
      "diagnosing",
      "planning",
      "executing",
      "delivered",
    ] as const) {
      await projects.setStage(scope, project.id, stage);
      expect((await projects.findById(scope, project.id))?.stage).toBe(stage);
    }

    // Foreign workspace scope cannot mutate the project stage.
    await expect(
      projects.setStage({ workspaceId: randomUUID() }, project.id, "setup"),
    ).resolves.toBe(false);
    expect((await projects.findById(scope, project.id))?.stage).toBe(
      "delivered",
    );

    const exportRun = await new AsyncRunsRepository(handle.db).insertQueued({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      kind: "export",
      activeKey: `export:client_bundle:${randomUUID()}`,
      initiatedBy: actor,
      contractVersion: "2026-07-18",
      requestPayload: { kind: "client_bundle", outputLocale: "en" },
    });
    const bundle = await new ExportBundlesRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      asyncRunId: exportRun.id,
      kind: "client_bundle",
      outputLocale: "en",
      createdBy: actor,
    });
    await new ExportBundlesRepository(handle.db).finalize(bundle.id, {
      objectKey: `export/${project.id}/${exportRun.id}/${"a".repeat(24)}`,
      checksum: "3".repeat(64),
      byteSize: 1,
      itemCounts: {},
      manifest: {},
    });
    const runs = new AsyncRunsRepository(handle.db);
    const claimedExport = await runs.claim(
      { workspaceId: scope.workspaceId, projectId: project.id },
      exportRun.id,
    );
    expect(claimedExport).not.toBeNull();
    await runs.setTerminal(
      {
        workspaceId: scope.workspaceId,
        projectId: project.id,
        runId: exportRun.id,
        attemptCount: claimedExport!.attempt_count,
      },
      {
        status: "completed",
        resultType: "export",
        resultId: bundle.id,
      },
    );

    // Projection drift is repairable from the immutable/run ledgers.
    await projects.setStage(scope, project.id, "setup");
    await expect(
      projects.rebuildStageFromHistory(scope, project.id),
    ).resolves.toBe("delivered");
    await expect(
      projects.setStage(scope, project.id, "executing"),
    ).resolves.toBe(true);

    // Archival freezes the rebuildable lifecycle projection even when the
    // immutable history remains eligible for a different stage.
    await handle.db
      .update(clientProjects)
      .set({ archived_at: sql`now()` })
      .where(
        and(
          eq(clientProjects.workspace_id, scope.workspaceId),
          eq(clientProjects.id, project.id),
        ),
      );
    await expect(
      projects.rebuildStageFromHistory(scope, project.id),
    ).resolves.toBe("executing");
    await expect(
      projects.setReadyToDiagnoseIfEligible(scope, project.id),
    ).resolves.toBe(false);
    await expect(
      projects.setStage(scope, project.id, "setup"),
    ).resolves.toBe(false);
    expect((await projects.findById(scope, project.id))?.stage).toBe(
      "executing",
    );
  });
});
