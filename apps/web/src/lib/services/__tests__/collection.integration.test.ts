import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { eq, sql } from "drizzle-orm";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  collectionRunParametersHash,
  CollectionRunsRepository,
  contentHash,
  IdempotencyRepository,
  IcpProfilesRepository,
  ProjectsRepository,
  SitePagesRepository,
  SourceConnectionsRepository,
} from "@sf/db";
import { asyncRuns, clientProjects, sourceConnections, workspaces } from "@sf/db/schema";
import { ProblemError } from "@sf/observability";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { createCollectionRun } from "@/lib/services/collection";
import { getProjectRun } from "@/lib/services/runs";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

async function countProjectRuns(
  handle: DbHandle,
  scopedProjectId: string,
): Promise<number> {
  const rows = await handle.db
    .select({ id: asyncRuns.id })
    .from(asyncRuns)
    .where(eq(asyncRuns.project_id, scopedProjectId));
  return rows.length;
}

describeDb("createCollectionRun (AC-019, spec §7.5)", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let projectId: string;
  let siteId: string;
  const actor = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [ws] = await handle.db.insert(workspaces).values({ name: `WS-${randomUUID()}` }).returning();
    workspaceId = ws!.id;
    const created = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      {
        clientName: "Coll",
        projectName: "Coll",
        siteUrl: "https://coll.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    projectId = created.project.id;
    siteId = created.project.site.id;
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("queues a crawl collection (202) against the default crawl source", async () => {
    const result = await createCollectionRun({ workspaceId }, projectId, actor, randomUUID(), {
      provider: "crawl",
    });
    expect(result.status).toBe(202);
    expect(result.run.kind).toBe("collection");
    expect(result.run.status).toBe("queued");
    expect(result.statusUrl).toBe(`/api/mvp/projects/${projectId}/runs/${result.run.id}`);
    expect(result.resourceRef).toEqual({ type: "collection_run", id: result.run.id });

    // The run is pollable via the unified status endpoint.
    const polled = await getProjectRun({ workspaceId }, projectId, result.run.id);
    expect(polled.id).toBe(result.run.id);
    const crawlSource = await new SourceConnectionsRepository(
      handle.db,
    ).findConnectedByProvider({ workspaceId, projectId }, "crawl");
    expect(crawlSource).not.toBeNull();
    await expect(
      new CollectionRunsRepository(handle.db).findById(result.run.id),
    ).resolves.toMatchObject({
      site_id: siteId,
      source_connection_id: crawlSource!.id,
      method_version: "crawl.site_graph.v2",
      crawl_seed_site_page_id: null,
      crawl_seed_url: null,
    });
  });

  it("freezes the exact URL-first Product Profile page and hashes both seed fields", async () => {
    const [profileWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-profile-seed-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: profileWorkspace!.id },
      actor,
      randomUUID(),
      {
        mode: "product_profile",
        productUrl:
          "https://profile-seed.example.com/products/growth/?utm_source=demo&plan=pro",
        businessHint: "B2B growth software",
      },
      safeGuard,
    );
    const profileScope = {
      workspaceId: profileWorkspace!.id,
      projectId: created.project.id,
    };
    const sourcePageUrl =
      "https://profile-seed.example.com/products/growth/?plan=pro";
    const page = await new SitePagesRepository(
      handle.db,
    ).findExactNormalizedUrl(
      profileScope,
      created.project.site.id,
      sourcePageUrl,
    );
    expect(page).not.toBeNull();

    const accepted = await createCollectionRun(
      { workspaceId: profileWorkspace!.id },
      created.project.id,
      actor,
      randomUUID(),
      { provider: "crawl" },
    );
    const stored = await new CollectionRunsRepository(handle.db).findById(
      accepted.run.id,
    );
    expect(stored).toMatchObject({
      crawl_seed_site_page_id: page!.id,
      crawl_seed_url: sourcePageUrl,
      parameters_hash: collectionRunParametersHash({
        provider: "crawl",
        operation: "site_graph",
        siteId: created.project.site.id,
        crawlSeedSitePageId: page!.id,
        crawlSeedUrl: sourcePageUrl,
      }),
    });

    // A queued run is a frozen command. Repointing the mutable current profile
    // afterwards cannot alter the accepted Crawl identity.
    const legacyProfile = { productName: "Later legacy profile" };
    const replacement = await new IcpProfilesRepository(handle.db).insertVersion({
      workspaceId: profileWorkspace!.id,
      projectId: created.project.id,
      version: 2,
      status: "draft",
      profile: legacyProfile,
      contentHash: contentHash({ status: "draft", profile: legacyProfile }),
      createdBy: actor,
    });
    await new ProjectsRepository(handle.db).setCurrentIcpProfile(
      { workspaceId: profileWorkspace!.id },
      created.project.id,
      replacement.id,
    );
    await expect(
      new CollectionRunsRepository(handle.db).findById(accepted.run.id),
    ).resolves.toMatchObject({
      crawl_seed_site_page_id: page!.id,
      crawl_seed_url: sourcePageUrl,
    });
  });

  it("rejects a foreign Product Profile at persistence and a missing exact SitePage before queueing", async () => {
    const [profileWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-invalid-profile-seed-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: profileWorkspace!.id },
      actor,
      randomUUID(),
      {
        mode: "product_profile",
        productUrl: "https://invalid-profile-seed.example.com/product/",
      },
      safeGuard,
    );
    const workspaceScope = { workspaceId: profileWorkspace!.id };
    const projectScope = {
      ...workspaceScope,
      projectId: created.project.id,
    };
    const project = await new ProjectsRepository(handle.db).findById(
      workspaceScope,
      created.project.id,
    );
    const current = await new IcpProfilesRepository(handle.db).findById(
      projectScope,
      project!.current_icp_profile_id!,
    );

    const foreignSiteProfile = {
      ...current!.profile,
      sourceSiteId: randomUUID(),
    };
    await expect(
      new IcpProfilesRepository(handle.db).insertVersion({
        workspaceId: profileWorkspace!.id,
        projectId: created.project.id,
        version: 2,
        status: "draft",
        profile: foreignSiteProfile,
        contentHash: contentHash({ status: "draft", profile: foreignSiteProfile }),
        createdBy: actor,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: "23514",
        detail: expect.stringContaining("source_site_missing"),
      },
    });

    const missingPageProfile = {
      ...current!.profile,
      sourcePageUrl:
        "https://invalid-profile-seed.example.com/not-a-persisted-page/",
    };
    const v2 = await new IcpProfilesRepository(handle.db).insertVersion({
      workspaceId: profileWorkspace!.id,
      projectId: created.project.id,
      version: 2,
      status: "draft",
      profile: missingPageProfile,
      contentHash: contentHash({ status: "draft", profile: missingPageProfile }),
      createdBy: actor,
    });
    await new ProjectsRepository(handle.db).setCurrentIcpProfile(
      workspaceScope,
      created.project.id,
      v2.id,
    );
    await expect(
      createCollectionRun(
        workspaceScope,
        created.project.id,
        actor,
        randomUUID(),
        { provider: "crawl" },
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
    expect(await countProjectRuns(handle, created.project.id)).toBe(0);
  });

  it("409s a second active run for the same provider/operation (AC-019)", async () => {
    await expect(
      createCollectionRun({ workspaceId }, projectId, actor, randomUUID(), { provider: "crawl" }),
    ).rejects.toMatchObject({ code: "RUN_ALREADY_ACTIVE" });
  });

  it("repeatedly returns the winning run metadata and Location during real active-key races", async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const [raceWorkspace] = await handle.db
        .insert(workspaces)
        .values({ name: `WS-race-${attempt}-${randomUUID()}` })
        .returning();
      const raceProject = await createProject(
        { workspaceId: raceWorkspace!.id },
        actor,
        randomUUID(),
        {
          clientName: `Race ${attempt}`,
          projectName: `Race ${attempt}`,
          siteUrl: `https://collection-race-${attempt}-${randomUUID()}.example`,
          marketCodes: ["US"],
          siteLanguageCodes: ["en"],
          defaultDeliveryLocale: "en",
        },
        safeGuard,
      );

      const results = await Promise.allSettled([
        createCollectionRun(
          { workspaceId: raceWorkspace!.id },
          raceProject.project.id,
          actor,
          randomUUID(),
          { provider: "crawl" },
        ),
        createCollectionRun(
          { workspaceId: raceWorkspace!.id },
          raceProject.project.id,
          actor,
          randomUUID(),
          { provider: "crawl" },
        ),
      ]);
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createCollectionRun>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      expect(fulfilled, `attempt ${attempt}`).toHaveLength(1);
      expect(rejected, `attempt ${attempt}`).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(ProblemError);
      expect(rejected[0]!.reason).toMatchObject({
        code: "RUN_ALREADY_ACTIVE",
        status: 409,
      });

      const winningRunId = fulfilled[0]!.value.run.id;
      const winningStatusUrl = `/api/mvp/projects/${raceProject.project.id}/runs/${winningRunId}`;
      expect(Reflect.get(rejected[0]!.reason, "current")).toEqual({
        runId: winningRunId,
        statusUrl: winningStatusUrl,
      });
      expect((rejected[0]!.reason as ProblemError).extraHeaders).toEqual({
        Location: winningStatusUrl,
      });
    }
  });

  it("422s when the provider has no connected source (gsc)", async () => {
    await expect(
      createCollectionRun({ workspaceId }, projectId, actor, randomUUID(), { provider: "gsc" }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_CONNECTED" });
  });

  it("422s an explicit source id once that source has been disconnected", async () => {
    const [explicitWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: explicitWorkspace!.id },
      actor,
      randomUUID(),
      {
        clientName: "Disconnected source",
        projectName: "Disconnected source",
        siteUrl: "https://collection-disconnected-source.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const explicitScope = {
      workspaceId: explicitWorkspace!.id,
      projectId: created.project.id,
    };
    const [crawlSource] = await handle.db
      .select({ id: sourceConnections.id })
      .from(sourceConnections)
      .where(eq(sourceConnections.project_id, created.project.id));
    await new SourceConnectionsRepository(handle.db).disconnect(
      explicitScope,
      crawlSource!.id,
    );

    await expect(
      createCollectionRun(
        { workspaceId: explicitWorkspace!.id },
        created.project.id,
        actor,
        randomUUID(),
        { provider: "crawl", sourceConnectionId: crawlSource!.id },
      ),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_CONNECTED", status: 422 });
    expect(await countProjectRuns(handle, created.project.id)).toBe(0);
  });

  it("422s an operation that doesn't match the provider", async () => {
    await expect(
      createCollectionRun({ workspaceId }, projectId, actor, randomUUID(), {
        provider: "crawl",
        operation: "search_analytics",
      }),
    ).rejects.toMatchObject({ code: "INVALID_COLLECTION_OPERATION" });
  });

  it("replays the 202 for the same Idempotency-Key + body", async () => {
    // A fresh project so no active run interferes with the replay assertion.
    const [ws2] = await handle.db.insert(workspaces).values({ name: `WS-${randomUUID()}` }).returning();
    const proj = await createProject(
      { workspaceId: ws2!.id },
      actor,
      randomUUID(),
      {
        clientName: "R",
        projectName: "R",
        siteUrl: "https://r.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const key = randomUUID();
    const first = await createCollectionRun({ workspaceId: ws2!.id }, proj.project.id, actor, key, {
      provider: "crawl",
    });
    const second = await createCollectionRun({ workspaceId: ws2!.id }, proj.project.id, actor, key, {
      provider: "crawl",
    });
    expect(second.replayed).toBe(true);
    expect(second.run.id).toBe(first.run.id);

    const racedFastPath = vi
      .spyOn(IdempotencyRepository.prototype, "find")
      .mockResolvedValueOnce(null);
    try {
      const afterInitialMiss = await createCollectionRun(
        { workspaceId: ws2!.id },
        proj.project.id,
        actor,
        key,
        { provider: "crawl" },
      );
      expect(afterInitialMiss).toMatchObject({
        replayed: true,
        statusUrl: first.statusUrl,
        run: { id: first.run.id },
      });
    } finally {
      racedFastPath.mockRestore();
    }
  });

  it("returns one accepted result and one replay for concurrent exact retries", async () => {
    const [concurrentWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: concurrentWorkspace!.id },
      actor,
      randomUUID(),
      {
        clientName: "Concurrent idempotency",
        projectName: "Concurrent idempotency",
        siteUrl: "https://collection-concurrent-idem.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const key = randomUUID();
    const args = [
      { workspaceId: concurrentWorkspace!.id },
      created.project.id,
      actor,
      key,
      { provider: "crawl" as const },
    ] as const;

    const [left, right] = await Promise.all([
      createCollectionRun(...args),
      createCollectionRun(...args),
    ]);
    expect(left.run.id).toBe(right.run.id);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
  });

  it("rejects a different hash while the idempotency key is still pending", async () => {
    const [pendingWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: pendingWorkspace!.id },
      actor,
      randomUUID(),
      {
        clientName: "Pending idempotency",
        projectName: "Pending idempotency",
        siteUrl: "https://collection-pending-idem.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const key = randomUUID();
    await new IdempotencyRepository(handle.db).begin({
      workspaceId: pendingWorkspace!.id,
      scope: "createCollectionRun",
      key,
      requestHash: "0".repeat(64),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });

    await expect(
      createCollectionRun(
        { workspaceId: pendingWorkspace!.id },
        created.project.id,
        actor,
        key,
        { provider: "crawl" },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });

  it("replays the accepted command after the project is archived and its source is disconnected", async () => {
    const replayWorkspaceId = (
      await handle.db
        .insert(workspaces)
        .values({ name: `WS-${randomUUID()}` })
        .returning()
    )[0]!.id;
    const created = await createProject(
      { workspaceId: replayWorkspaceId },
      actor,
      randomUUID(),
      {
        clientName: "Mutable replay",
        projectName: "Mutable replay",
        siteUrl: "https://collection-mutable-replay.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const replayProjectId = created.project.id;
    const projectScope = {
      workspaceId: replayWorkspaceId,
      projectId: replayProjectId,
    };
    const [crawlSource] = await handle.db
      .select({ id: sourceConnections.id })
      .from(sourceConnections)
      .where(eq(sourceConnections.project_id, replayProjectId));
    const key = randomUUID();
    const body = { provider: "crawl" as const };

    const first = await createCollectionRun(
      { workspaceId: replayWorkspaceId },
      replayProjectId,
      actor,
      key,
      body,
    );
    await new SourceConnectionsRepository(handle.db).disconnect(
      projectScope,
      crawlSource!.id,
    );
    await handle.db
      .update(clientProjects)
      .set({ archived_at: sql`now()` })
      .where(eq(clientProjects.id, replayProjectId));

    const replay = await createCollectionRun(
      { workspaceId: replayWorkspaceId },
      replayProjectId,
      actor,
      key,
      body,
    );
    expect(replay).toMatchObject({
      status: 202,
      replayed: true,
      statusUrl: first.statusUrl,
      run: { id: first.run.id },
    });

    await expect(
      createCollectionRun(
        { workspaceId: replayWorkspaceId },
        replayProjectId,
        actor,
        key,
        { provider: "crawl", sourceConnectionId: randomUUID() },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });

    const otherProject = await createProject(
      { workspaceId: replayWorkspaceId },
      actor,
      randomUUID(),
      {
        clientName: "Other project",
        projectName: "Other project",
        siteUrl: "https://collection-other-project.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    await expect(
      createCollectionRun(
        { workspaceId: replayWorkspaceId },
        otherProject.project.id,
        actor,
        key,
        body,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });
});
