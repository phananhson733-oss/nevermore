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

import { and, eq, sql } from "drizzle-orm";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  IdempotencyRepository,
  SourceConnectionsRepository,
  type DataSnapshotRow,
  type ProjectScope,
} from "@sf/db";
import {
  asyncRuns,
  clientProjects,
  diagnosticRuns,
  icpProfiles,
  sites,
  workspaces,
} from "@sf/db/schema";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import { ProblemError } from "@sf/observability";
import { CRAWL_METHOD_VERSION } from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDiagnosticRun } from "@/lib/services/diagnostics";
import { createProject, type UrlGuard } from "@/lib/services/projects";

const queueFixture = vi.hoisted(() => ({ send: vi.fn(async () => randomUUID()) }));
vi.mock("@/lib/boss", () => ({ getBoss: async () => queueFixture }));

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const actor = randomUUID();
const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

async function createDiagnosticFixture(
  handle: DbHandle,
  workspaceId: string,
  suffix: string,
  opts: {
    crawlAvailability?: "available" | "partial" | "unavailable";
    crawlMethodVersion?: string;
    useSecondarySite?: boolean;
  } = {},
): Promise<{
  scope: ProjectScope;
  siteId: string;
  snapshot: DataSnapshotRow;
  confirmedProfileId: string;
  confirmedProfileHash: string;
}> {
  const created = await createProject(
    { workspaceId },
    actor,
    randomUUID(),
    {
      clientName: `Diagnostic ${suffix}`,
      projectName: `Diagnostic ${suffix}`,
      siteUrl: `https://diagnostic-${suffix}.example`,
      marketCodes: ["US"],
      siteLanguageCodes: ["en"],
      defaultDeliveryLocale: "en",
    },
    safeGuard,
  );
  const scope = { workspaceId, projectId: created.project.id };
  let siteId = created.project.site.id;
  const sources = new SourceConnectionsRepository(handle.db);
  let crawlSource = await sources.findConnectedByProvider(scope, "crawl");
  if (!crawlSource) throw new Error("fixture default Crawl source missing");
  if (opts.useSecondarySite) {
    const [secondarySite] = await handle.db
      .insert(sites)
      .values({
        workspace_id: workspaceId,
        project_id: scope.projectId,
        origin: `https://secondary-${suffix}.example`,
        host: `secondary-${suffix}.example`,
        market_codes: ["US"],
        language_codes: ["en"],
        is_primary: false,
      })
      .returning();
    await sources.disconnect(scope, crawlSource.id);
    crawlSource = await sources.insertConnection({
      workspaceId,
      projectId: scope.projectId,
      siteId: secondarySite!.id,
      provider: "crawl",
      connectionType: "public",
      state: "connected",
      limitation: "Static public crawl fixture.",
      connectedAt: true,
      createdBy: actor,
    });
    siteId = secondarySite!.id;
  }
  const confirmedProfileHash = contentHash({ fixture: suffix });
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "Diagnostic fixture" },
      content_hash: confirmedProfileHash,
      created_by: actor,
    })
    .returning();
  await handle.db
    .update(clientProjects)
    .set({
      current_icp_profile_id: icp!.id,
      confirmed_icp_profile_id: icp!.id,
    })
    .where(eq(clientProjects.id, scope.projectId));

  const capturedAt = new Date().toISOString();
  const [collectionRun] = await handle.db
    .insert(asyncRuns)
    .values({
      workspace_id: workspaceId,
      project_id: scope.projectId,
      kind: "collection",
      status: "completed",
      initiated_by: actor,
      started_at: capturedAt,
      completed_at: capturedAt,
    })
    .returning();
  const collections = new CollectionRunsRepository(handle.db);
  await collections.insertPlaceholder({
    runId: collectionRun!.id,
    workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: crawlSource.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: opts.crawlMethodVersion ?? CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ collection: suffix }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId,
    projectId: scope.projectId,
    siteId,
    collectionRunId: collectionRun!.id,
    sourceConnectionId: crawlSource.id,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: opts.crawlMethodVersion ?? CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: opts.crawlAvailability ?? "available",
    limitation: "Deterministic idempotency fixture.",
    rawObjectKey: null,
    rowCount: 0,
    checksum: contentHash({ snapshot: suffix }),
  });
  await collections.finalize(collectionRun!.id, {
    rowCount: snapshot.row_count,
    sourceWindow: snapshot.source_window,
    providerUsage: { urlsFetched: 0, pagesCollected: 0 },
    stopReason: null,
  });
  await sources.setLastSnapshot(
    crawlSource.id,
    snapshot.id,
    snapshot.availability,
    snapshot.limitation,
  );
  return {
    scope,
    siteId,
    snapshot,
    confirmedProfileId: icp!.id,
    confirmedProfileHash,
  };
}

describeDb("createDiagnosticRun idempotency ordering", () => {
  let handle: DbHandle;
  let workspaceId: string;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Diagnostic-idem-${randomUUID()}` })
      .returning();
    workspaceId = workspace!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("serializes concurrent exact retries into one diagnostic run", async () => {
    queueFixture.send.mockClear();
    const fixture = await createDiagnosticFixture(handle, workspaceId, randomUUID());
    const key = randomUUID();
    const args = [
      { workspaceId },
      fixture.scope.projectId,
      actor,
      key,
      { snapshotIds: [fixture.snapshot.id], outputLocale: "en" as const },
    ] as const;

    const [left, right] = await Promise.all([
      createDiagnosticRun(...args),
      createDiagnosticRun(...args),
    ]);
    expect(left.run.id).toBe(right.run.id);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(queueFixture.send).toHaveBeenCalledTimes(1);

    const racedFastPath = vi
      .spyOn(IdempotencyRepository.prototype, "find")
      .mockResolvedValueOnce(null);
    try {
      const afterInitialMiss = await createDiagnosticRun(...args);
      expect(afterInitialMiss).toMatchObject({
        replayed: true,
        statusUrl: left.statusUrl,
        run: { id: left.run.id },
      });
    } finally {
      racedFastPath.mockRestore();
    }
  });

  it("maps a real different-key active race to the winning diagnostic run", async () => {
    queueFixture.send.mockClear();
    const fixture = await createDiagnosticFixture(handle, workspaceId, randomUUID());
    const body = {
      snapshotIds: [fixture.snapshot.id],
      outputLocale: "en" as const,
    };
    const results = await Promise.allSettled([
      createDiagnosticRun(
        { workspaceId },
        fixture.scope.projectId,
        actor,
        randomUUID(),
        body,
      ),
      createDiagnosticRun(
        { workspaceId },
        fixture.scope.projectId,
        actor,
        randomUUID(),
        body,
      ),
    ]);
    const fulfilled = results.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createDiagnosticRun>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toBeDefined();
    expect(rejected?.reason).toBeInstanceOf(ProblemError);
    expect(rejected?.reason).toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      extraHeaders: { Location: fulfilled!.value.statusUrl },
    });
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
  });

  it("rejects an unavailable crawl snapshot before enqueueing a diagnostic run", async () => {
    queueFixture.send.mockClear();
    const fixture = await createDiagnosticFixture(
      handle,
      workspaceId,
      randomUUID(),
      { crawlAvailability: "unavailable" },
    );

    await expect(
      createDiagnosticRun(
        { workspaceId },
        fixture.scope.projectId,
        actor,
        randomUUID(),
        { snapshotIds: [fixture.snapshot.id], outputLocale: "en" },
      ),
    ).rejects.toMatchObject({
      code: "CRAWL_SNAPSHOT_REQUIRED",
      status: 422,
    });
    expect(queueFixture.send).not.toHaveBeenCalled();

    const runs = await handle.db
      .select({ id: asyncRuns.id })
      .from(asyncRuns)
      .where(
        and(
          eq(asyncRuns.project_id, fixture.scope.projectId),
          eq(asyncRuns.kind, "diagnostic"),
        ),
      );
    expect(runs).toHaveLength(0);
  });

  it("rejects an obsolete crawl method before enqueueing a diagnostic run", async () => {
    queueFixture.send.mockClear();
    const fixture = await createDiagnosticFixture(
      handle,
      workspaceId,
      randomUUID(),
      { crawlMethodVersion: "crawl.site_graph.v1" },
    );

    await expect(
      createDiagnosticRun(
        { workspaceId },
        fixture.scope.projectId,
        actor,
        randomUUID(),
        { snapshotIds: [fixture.snapshot.id], outputLocale: "en" },
      ),
    ).rejects.toMatchObject({
      code: "CRAWL_SNAPSHOT_REQUIRED",
      status: 422,
    });
    expect(queueFixture.send).not.toHaveBeenCalled();
  });

  it("freezes the confirmed profile even when the working pointer advances to a later draft", async () => {
    queueFixture.send.mockClear();
    const fixture = await createDiagnosticFixture(
      handle,
      workspaceId,
      randomUUID(),
    );
    const [draft] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: workspaceId,
        project_id: fixture.scope.projectId,
        version: 2,
        status: "draft",
        profile: { productName: "Unconfirmed working edit" },
        content_hash: contentHash({
          status: "draft",
          profile: { productName: "Unconfirmed working edit" },
        }),
        created_by: actor,
      })
      .returning();
    await handle.db
      .update(clientProjects)
      .set({ current_icp_profile_id: draft!.id })
      .where(eq(clientProjects.id, fixture.scope.projectId));

    const accepted = await createDiagnosticRun(
      { workspaceId },
      fixture.scope.projectId,
      actor,
      randomUUID(),
      { snapshotIds: [fixture.snapshot.id], outputLocale: "en" },
    );
    const [persisted] = await handle.db
      .select({
        icpProfileId: diagnosticRuns.icp_profile_id,
        icpProfileVersion: diagnosticRuns.icp_profile_version,
      })
      .from(diagnosticRuns)
      .where(eq(diagnosticRuns.id, accepted.run.id));

    expect(persisted).toEqual({
      icpProfileId: fixture.confirmedProfileId,
      icpProfileVersion: 1,
    });
  });

  it("derives the exact Site and freezes a complete JCS-addressed manifest", async () => {
    queueFixture.send.mockClear();
    const fixture = await createDiagnosticFixture(
      handle,
      workspaceId,
      randomUUID(),
      { useSecondarySite: true },
    );

    const accepted = await createDiagnosticRun(
      { workspaceId },
      fixture.scope.projectId,
      actor,
      randomUUID(),
      { snapshotIds: [fixture.snapshot.id], outputLocale: "en-US" },
    );
    const [persisted] = await handle.db
      .select()
      .from(diagnosticRuns)
      .where(eq(diagnosticRuns.id, accepted.run.id));
    const expectedManifest = {
      projectId: fixture.scope.projectId,
      siteId: fixture.siteId,
      icp: {
        id: fixture.confirmedProfileId,
        version: 1,
        contentHash: fixture.confirmedProfileHash,
      },
      snapshots: [
        {
          snapshotId: fixture.snapshot.id,
          provider: fixture.snapshot.provider,
          datasetKey: fixture.snapshot.dataset_key,
          schemaVersion: fixture.snapshot.schema_version,
          methodVersion: CRAWL_METHOD_VERSION,
          checksum: fixture.snapshot.checksum,
          capturedAt: fixture.snapshot.captured_at,
          sourceWindow: fixture.snapshot.source_window,
          availability: fixture.snapshot.availability,
        },
      ],
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      deliveryLocale: "en-US",
    };

    expect(persisted).toMatchObject({
      site_id: fixture.siteId,
      rule_set_version: RULE_SET_VERSION,
      prompt_set_version: PROMPT_SET_VERSION,
      output_locale: "en-US",
      input_manifest: expectedManifest,
      input_hash: contentHash(
        expectedManifest as Parameters<typeof contentHash>[0],
      ),
    });
    expect(persisted!.input_hash).toBe(
      contentHash(
        persisted!.input_manifest as Parameters<typeof contentHash>[0],
      ),
    );
  });

  it("replays the original 202 after archive and ICP pointer changes", async () => {
    queueFixture.send.mockClear();
    const fixture = await createDiagnosticFixture(handle, workspaceId, randomUUID());
    const key = randomUUID();
    const body = {
      snapshotIds: [fixture.snapshot.id],
      outputLocale: "en" as const,
    };
    const first = await createDiagnosticRun(
      { workspaceId },
      fixture.scope.projectId,
      actor,
      key,
      body,
    );

    await handle.db
      .update(clientProjects)
      .set({ archived_at: sql`now()`, current_icp_profile_id: null })
      .where(eq(clientProjects.id, fixture.scope.projectId));

    const replay = await createDiagnosticRun(
      { workspaceId },
      fixture.scope.projectId,
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
    expect(queueFixture.send).toHaveBeenCalledTimes(1);

    await expect(
      createDiagnosticRun(
        { workspaceId },
        fixture.scope.projectId,
        actor,
        key,
        { snapshotIds: [fixture.snapshot.id], outputLocale: "zh-CN" },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });

    const other = await createDiagnosticFixture(handle, workspaceId, randomUUID());
    await expect(
      createDiagnosticRun(
        { workspaceId },
        other.scope.projectId,
        actor,
        key,
        body,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });
});
