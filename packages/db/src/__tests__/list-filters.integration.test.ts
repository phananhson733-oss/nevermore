import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import { icpProfiles, workspaces } from "../schema.ts";
import { AsyncRunsRepository } from "../repositories/async-runs.ts";
import { CollectionRunsRepository } from "../repositories/collection-runs.ts";
import { DataSnapshotsRepository } from "../repositories/data-snapshots.ts";
import { DiagnosticRunsRepository } from "../repositories/diagnostic-runs.ts";
import { FindingsRepository } from "../repositories/findings.ts";
import { ProjectsRepository } from "../repositories/projects.ts";
import { SitesRepository } from "../repositories/sites.ts";
import { SourceConnectionsRepository } from "../repositories/source-connections.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("OpenAPI list filters", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("filters snapshots and findings in SQL before applying the page limit", async () => {
    const actorId = randomUUID();
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `List-filter-${randomUUID()}` })
      .returning();
    const workspaceScope = { workspaceId: workspace!.id };
    const project = await new ProjectsRepository(handle.db).insert({
      workspaceId: workspaceScope.workspaceId,
      clientName: "Filter client",
      projectName: "Filter project",
      defaultDeliveryLocale: "en",
      createdBy: actorId,
    });
    const projectScope = {
      workspaceId: workspaceScope.workspaceId,
      projectId: project.id,
    };
    const site = await new SitesRepository(handle.db).insertPrimary({
      ...projectScope,
      origin: "https://list-filter.example",
      host: "list-filter.example",
      marketCodes: ["US"],
      languageCodes: ["en"],
    });

    const sourceConnections = new SourceConnectionsRepository(handle.db);
    const crawlSource = await sourceConnections.insertDefaultCrawl({
      ...projectScope,
      siteId: site.id,
      createdBy: actorId,
    });
    const gscSource = await sourceConnections.insertConnection({
      ...projectScope,
      siteId: site.id,
      provider: "gsc",
      connectionType: "oauth",
      state: "connected",
      externalRef: "sc-domain:list-filter.example",
      scopes: ["webmasters.readonly"],
      config: { propertyType: "domain" },
      limitation: "Disposable GSC list-filter fixture.",
      connectedAt: true,
      createdBy: actorId,
    });

    const snapshots = new DataSnapshotsRepository(handle.db);
    const collectionRuns = new CollectionRunsRepository(handle.db);
    for (const provider of ["crawl", "gsc", "gsc"] as const) {
      const sourceConnectionId =
        provider === "crawl" ? crawlSource.id : gscSource.id;
      const methodVersion =
        provider === "crawl"
          ? "crawl.site_graph.v2"
          : "gsc.page_query_daily.v1";
      const sourceWindow = { start: null, end: null };
      const capturedAt = new Date().toISOString();
      const run = await new AsyncRunsRepository(handle.db).insertQueued({
        ...projectScope,
        kind: "collection",
        activeKey: `collection:${provider}:${randomUUID()}`,
        initiatedBy: actorId,
        contractVersion: "2026-07-18",
      });
      await new CollectionRunsRepository(handle.db).insertPlaceholder({
        runId: run.id,
        ...projectScope,
        siteId: site.id,
        sourceConnectionId,
        provider,
        operation: provider === "crawl" ? "site_graph" : "search_analytics",
        methodVersion,
        parametersHash: "1".repeat(64),
      });
      await snapshots.insert({
        ...projectScope,
        siteId: site.id,
        collectionRunId: run.id,
        sourceConnectionId,
        provider,
        datasetKey:
          provider === "crawl"
            ? "crawl.site_graph.v1"
            : "gsc.page_query_daily.v1",
        schemaVersion: methodVersion,
        methodVersion,
        capturedAt,
        sourceWindow,
        availability: "available",
        limitation: "fixture",
        rawObjectKey: null,
        rowCount: 1,
        checksum: provider === "crawl" ? "2".repeat(64) : "3".repeat(64),
      });
      await collectionRuns.finalize(run.id, {
        rowCount: 1,
        sourceWindow,
        providerUsage: {},
        stopReason: null,
      });
    }

    const gscPage = await snapshots.listByProject(projectScope, {
      limit: 1,
      cursor: null,
      provider: "gsc",
    });
    expect(gscPage.rows).toHaveLength(1);
    expect(gscPage.rows[0]?.provider).toBe("gsc");
    expect(gscPage.nextCursor).not.toBeNull();
    const secondGscPage = await snapshots.listByProject(projectScope, {
      limit: 1,
      cursor: gscPage.nextCursor,
      provider: "gsc",
    });
    expect(secondGscPage.rows).toHaveLength(1);
    expect(secondGscPage.rows[0]?.provider).toBe("gsc");
    expect(secondGscPage.rows[0]?.id).not.toBe(gscPage.rows[0]?.id);

    const [icp] = await handle.db
      .insert(icpProfiles)
      .values({
        ...{
          workspace_id: projectScope.workspaceId,
          project_id: projectScope.projectId,
        },
        version: 1,
        status: "complete",
        profile: { productName: "Filter fixture" },
        content_hash: "4".repeat(64),
        created_by: actorId,
      })
      .returning();
    const diagnosticRun = await new AsyncRunsRepository(handle.db).insertQueued({
      ...projectScope,
      kind: "diagnostic",
      activeKey: `diagnostic:${randomUUID()}`,
      initiatedBy: actorId,
      contractVersion: "2026-07-18",
    });
    await new DiagnosticRunsRepository(handle.db).insert({
      runId: diagnosticRun.id,
      ...projectScope,
      siteId: site.id,
      icpProfileId: icp!.id,
      icpProfileVersion: 1,
      ruleSetVersion: "mvp.rules.0.2.0",
      promptSetVersion: "mvp.prompts.0.2.0",
      outputLocale: "en",
      inputManifest: { snapshots: [] },
      inputHash: contentHash({ snapshots: [] }),
    });

    const findings = new FindingsRepository(handle.db);
    for (const fixture of [
      {
        key: "6".repeat(64),
        domain: "technical_seo",
        reviewState: "unreviewed",
      },
      {
        key: "7".repeat(64),
        domain: "geo_ai",
        reviewState: "confirmed",
      },
      {
        key: "8".repeat(64),
        domain: "geo_ai",
        reviewState: "confirmed",
      },
    ]) {
      await findings.insert({
        ...projectScope,
        findingKey: fixture.key,
        ruleId:
          fixture.domain === "geo_ai" ? "GEO-ENTITY-001" : "TECH-HTTP-001",
        ruleVersion: 1,
        ruleFamily: fixture.domain,
        intent: "fix",
        domain: fixture.domain,
        titleKey: "finding.fixture",
        titleArgs: {},
        summary: "Fixture finding",
        summaryLocale: "en",
        subjectRefs: ["https://list-filter.example/"],
        severity: "medium",
        confidence: "high",
        reviewState: fixture.reviewState,
        runId: diagnosticRun.id,
        seenAt: new Date().toISOString(),
      });
    }

    const geoConfirmedPage = await findings.list(projectScope, {
      limit: 1,
      cursor: null,
      activeOnly: true,
      domain: "geo_ai",
      reviewState: "confirmed",
    });
    expect(geoConfirmedPage.rows).toHaveLength(1);
    expect(geoConfirmedPage.rows[0]).toMatchObject({
      domain: "geo_ai",
      review_state: "confirmed",
    });
    expect(geoConfirmedPage.nextCursor).not.toBeNull();
    const secondGeoConfirmedPage = await findings.list(projectScope, {
      limit: 1,
      cursor: geoConfirmedPage.nextCursor,
      activeOnly: true,
      domain: "geo_ai",
      reviewState: "confirmed",
    });
    expect(secondGeoConfirmedPage.rows).toHaveLength(1);
    expect(secondGeoConfirmedPage.rows[0]).toMatchObject({
      domain: "geo_ai",
      review_state: "confirmed",
    });
    expect(secondGeoConfirmedPage.rows[0]?.id).not.toBe(
      geoConfirmedPage.rows[0]?.id,
    );

    await expect(
      findings.list(projectScope, {
        limit: 1,
        cursor: null,
        activeOnly: true,
        domain: "geo_ai",
        reviewState: "unreviewed",
      }),
    ).resolves.toEqual({ rows: [], nextCursor: null });
  });
});
