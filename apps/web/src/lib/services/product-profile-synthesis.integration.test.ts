import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { and, eq } from "drizzle-orm";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  collectionRunParametersHash,
  contentHash,
  DataSnapshotsRepository,
  IcpProfilesRepository,
  PageSnapshotsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type CanonicalValue,
} from "@sf/db";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  asyncRuns,
  auditRuns,
  clientProjects,
  diagnosticRuns,
  productProfileRuns,
  workspaces,
} from "@sf/db/schema";
import { CRAWL_DATASET_KEY, CRAWL_METHOD_VERSION } from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type UrlGuard } from "./projects";

const queueFixture = vi.hoisted(() => ({
  send: vi.fn(async () => randomUUID()),
}));
vi.mock("@/lib/boss", () => ({ getBoss: async () => queueFixture }));

const { createProductProfileSynthesisRun } = await import(
  "./product-profile-synthesis.ts"
);

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const actorId = randomUUID();
const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

describeDb("Product Profile synthesis command persistence", () => {
  let handle: DbHandle;
  let workspaceId: string;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Product Profile synthesis Web ${randomUUID()}`, plan_tier: "internal" })
      .returning();
    workspaceId = workspace!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("atomically freezes exact PageSnapshot lineage, enqueues once and replays before later project mutation", async () => {
    queueFixture.send.mockClear();
    const host = `${randomUUID()}.example.com`;
    const sourcePageUrl = `https://${host}/customer-onboarding/`;
    const created = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        mode: "product_profile",
        productUrl: sourcePageUrl,
        businessHint: "B2B customer onboarding operations software.",
      },
      safeGuard,
    );
    const projectId = created.project.id;
    const scope = { workspaceId, projectId };
    const [project] = await handle.db
      .select()
      .from(clientProjects)
      .where(eq(clientProjects.id, projectId));
    const site = await new SitesRepository(handle.db).findPrimary(scope);
    const baseProfile = project?.current_icp_profile_id
      ? await new IcpProfilesRepository(handle.db).findById(
          scope,
          project.current_icp_profile_id,
        )
      : null;
    const source = await new SourceConnectionsRepository(
      handle.db,
    ).findConnectedByProvider(scope, "crawl");
    const sourcePage =
      site === null
        ? null
        : await new SitePagesRepository(handle.db).findExactNormalizedUrl(
            scope,
            site.id,
            sourcePageUrl,
          );
    if (!project || !site || !baseProfile || !source || !sourcePage) {
      throw new Error("Product Profile integration fixture was not created");
    }

    const collectionRun = await new AsyncRunsRepository(handle.db).insertQueued({
      workspaceId,
      projectId,
      kind: "collection",
      activeKey: `profile-source:${randomUUID()}`,
      initiatedBy: actorId,
      contractVersion: "0.3.0",
    });
    const parametersHash = collectionRunParametersHash({
      provider: "crawl",
      operation: "site_graph",
      siteId: site.id,
      crawlSeedSitePageId: sourcePage.id,
      crawlSeedUrl: sourcePageUrl,
    });
    await new CollectionRunsRepository(handle.db).insertPlaceholder({
      runId: collectionRun.id,
      workspaceId,
      projectId,
      siteId: site.id,
      sourceConnectionId: source.id,
      provider: "crawl",
      operation: "site_graph",
      methodVersion: CRAWL_METHOD_VERSION,
      parametersHash,
      crawlSeedSitePageId: sourcePage.id,
      crawlSeedUrl: sourcePageUrl,
    });
    const capturedAt = "2026-07-22T01:02:03.000Z";
    const snapshot = await new DataSnapshotsRepository(handle.db).insert({
      workspaceId,
      projectId,
      siteId: site.id,
      collectionRunId: collectionRun.id,
      sourceConnectionId: source.id,
      provider: "crawl",
      datasetKey: CRAWL_DATASET_KEY,
      schemaVersion: CRAWL_METHOD_VERSION,
      methodVersion: CRAWL_METHOD_VERSION,
      capturedAt,
      sourceWindow: { start: null, end: null },
      availability: "partial",
      limitation: "Static public HTML fixture; client rendering was not executed.",
      rawObjectKey: null,
      rowCount: 1,
      checksum: contentHash({ collectionRunId: collectionRun.id }),
    });
    const subjectUrl = sourcePageUrl.slice(0, -1);
    const extract = {
      schemaVersion: "crawl.page-extract.v1",
      subjectUrl,
      depth: 0,
      projection: {
        fetchUrl: sourcePageUrl,
        status: 200,
        finalStatus: 200,
        redirectChain: [],
        canonicalTarget: sourcePageUrl,
        robotsIndexable: true,
        robotsDirectives: ["index", "follow"],
        title: "RelayOps customer onboarding",
        metaDescription: "Customer onboarding operations software.",
        h1: ["Customer onboarding, standardized"],
        headings: ["Built for Customer Operations"],
        wordCount: 420,
        internalOutlinks: [],
        jsonLd: { types: ["SoftwareApplication"], errorCount: 0 },
        sitemapMember: true,
        bodyExcerpt: "A bounded first-party Product Profile source page.",
        paragraphs: ["Standardize customer onboarding across B2B teams."],
        responseMs: 42,
        contentType: "text/html; charset=utf-8",
      },
    };
    const pageSnapshot = await new PageSnapshotsRepository(handle.db).create({
      workspaceId,
      projectId,
      sitePageId: sourcePage.id,
      dataSnapshotId: snapshot.id,
      contentHash: contentHash(extract),
      extract,
      capturedAt,
    });
    await new CollectionRunsRepository(handle.db).finalize(collectionRun.id, {
      rowCount: 1,
      sourceWindow: { start: null, end: null },
      providerUsage: { urlsFetched: 1, pagesCollected: 1 },
      stopReason: "fixture_partial",
    });

    const idempotencyKey = randomUUID();
    const accepted = await createProductProfileSynthesisRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      { baseVersion: baseProfile.version },
    );

    const [run] = await handle.db
      .select()
      .from(asyncRuns)
      .where(eq(asyncRuns.id, accepted.run.id));
    const [projectAfterCommand] = await handle.db
      .select({ stage: clientProjects.stage })
      .from(clientProjects)
      .where(eq(clientProjects.id, projectId));
    const [ledger] = await handle.db
      .select()
      .from(productProfileRuns)
      .where(eq(productProfileRuns.id, accepted.run.id));
    expect(run).toMatchObject({
      kind: "product_profile_synthesis",
      status: "queued",
      active_key: "product-profile:synthesis",
      request_payload: {
        baseVersion: baseProfile.version,
        sourceSnapshotId: snapshot.id,
        inputHash: ledger?.input_hash,
      },
    });
    expect(ledger).toMatchObject({
      workspace_id: workspaceId,
      project_id: projectId,
      site_id: site.id,
      base_icp_profile_id: baseProfile.id,
      base_icp_profile_version: baseProfile.version,
      base_icp_profile_content_hash: baseProfile.content_hash,
      source_snapshot_id: snapshot.id,
      input_manifest: {
        sourcePageUrl,
        crawlSnapshot: expect.objectContaining({
          id: snapshot.id,
          availability: "partial",
          limitation:
            "Static public HTML fixture; client rendering was not executed.",
        }),
        pages: [
          expect.objectContaining({
            pageSnapshotId: pageSnapshot.id,
            sitePageId: sourcePage.id,
            dataSnapshotId: snapshot.id,
            normalizedUrl: sourcePageUrl,
          }),
        ],
      },
    });
    expect(ledger!.input_hash).toBe(
      contentHash(ledger!.input_manifest as CanonicalValue),
    );
    expect(JSON.stringify(ledger!.input_manifest)).not.toContain(
      "bounded first-party",
    );
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
    expect(queueFixture.send).toHaveBeenCalledWith(
      "profile.synthesize",
      {
        runId: accepted.run.id,
        workspaceId,
        projectId,
        contractVersion: expect.any(String),
      },
      expect.objectContaining({ id: accepted.run.id }),
    );

    const [diagnosticRows, auditRows] = await Promise.all([
      handle.db
        .select({ id: diagnosticRuns.id })
        .from(diagnosticRuns)
        .where(eq(diagnosticRuns.project_id, projectId)),
      handle.db
        .select({ id: auditRuns.id })
        .from(auditRuns)
        .where(eq(auditRuns.project_id, projectId)),
    ]);
    expect(diagnosticRows).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
    expect(projectAfterCommand?.stage).toBe("setup");

    await handle.db
      .update(clientProjects)
      .set({
        archived_at: new Date().toISOString(),
        current_icp_profile_id: null,
      })
      .where(
        and(
          eq(clientProjects.workspace_id, workspaceId),
          eq(clientProjects.id, projectId),
        ),
      );
    const replayed = await createProductProfileSynthesisRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      { baseVersion: baseProfile.version },
    );
    expect(replayed).toMatchObject({
      replayed: true,
      run: { id: accepted.run.id },
      statusUrl: accepted.statusUrl,
    });
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
  });

  it("rejects a confirmed current profile without creating a run, ledger, or queue job", async () => {
    queueFixture.send.mockClear();
    const host = `${randomUUID()}.example.com`;
    const sourcePageUrl = `https://${host}/customer-onboarding/`;
    const created = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        mode: "product_profile",
        productUrl: sourcePageUrl,
        businessHint: "B2B customer onboarding operations software.",
      },
      safeGuard,
    );
    const projectId = created.project.id;
    const scope = { workspaceId, projectId };
    const [project] = await handle.db
      .select()
      .from(clientProjects)
      .where(eq(clientProjects.id, projectId));
    const baseProfile = project?.current_icp_profile_id
      ? await new IcpProfilesRepository(handle.db).findById(
          scope,
          project.current_icp_profile_id,
        )
      : null;
    if (!project || !baseProfile) {
      throw new Error("Product Profile integration fixture was not created");
    }

    const completeProfile = await new IcpProfilesRepository(
      handle.db,
    ).insertVersion({
      workspaceId,
      projectId,
      version: baseProfile.version + 1,
      status: "complete",
      profile: baseProfile.profile,
      contentHash: contentHash({
        status: "complete",
        profile: baseProfile.profile as CanonicalValue,
      }),
      createdBy: actorId,
    });
    await handle.db
      .update(clientProjects)
      .set({
        current_icp_profile_id: completeProfile.id,
        confirmed_icp_profile_id: completeProfile.id,
      })
      .where(
        and(
          eq(clientProjects.workspace_id, workspaceId),
          eq(clientProjects.id, projectId),
        ),
      );

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        randomUUID(),
        { baseVersion: completeProfile.version },
      ),
    ).rejects.toMatchObject({
      code: "CONTEXT_INCOMPLETE",
      status: 422,
      message: "A current Product Profile draft is required for synthesis.",
    });

    const [runRows, ledgerRows] = await Promise.all([
      handle.db
        .select({ id: asyncRuns.id })
        .from(asyncRuns)
        .where(
          and(
            eq(asyncRuns.workspace_id, workspaceId),
            eq(asyncRuns.project_id, projectId),
            eq(asyncRuns.kind, "product_profile_synthesis"),
          ),
        ),
      handle.db
        .select({ id: productProfileRuns.id })
        .from(productProfileRuns)
        .where(
          and(
            eq(productProfileRuns.workspace_id, workspaceId),
            eq(productProfileRuns.project_id, projectId),
          ),
        ),
    ]);
    expect(runRows).toHaveLength(0);
    expect(ledgerRows).toHaveLength(0);
    expect(queueFixture.send).not.toHaveBeenCalled();
  });
});
