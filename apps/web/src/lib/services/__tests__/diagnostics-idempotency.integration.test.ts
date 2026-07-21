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
  type ProjectScope,
} from "@sf/db";
import {
  asyncRuns,
  clientProjects,
  diagnosticRuns,
  icpProfiles,
  workspaces,
} from "@sf/db/schema";
import { ProblemError } from "@sf/observability";
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
  opts: { crawlAvailability?: "available" | "partial" | "unavailable" } = {},
): Promise<{ scope: ProjectScope; snapshotId: string; confirmedProfileId: string }> {
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
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "Diagnostic fixture" },
      content_hash: contentHash({ fixture: suffix }),
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
  await new CollectionRunsRepository(handle.db).insertPlaceholder({
    runId: collectionRun!.id,
    workspaceId,
    projectId: scope.projectId,
    siteId: created.project.site.id,
    sourceConnectionId: null,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: "crawl.site_graph.v1",
    parametersHash: contentHash({ collection: suffix }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId,
    projectId: scope.projectId,
    siteId: created.project.site.id,
    collectionRunId: collectionRun!.id,
    sourceConnectionId: null,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: "crawl.site_graph.v1",
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: opts.crawlAvailability ?? "available",
    limitation: "Deterministic idempotency fixture.",
    rawObjectKey: null,
    rowCount: 0,
    checksum: contentHash({ snapshot: suffix }),
  });
  return { scope, snapshotId: snapshot.id, confirmedProfileId: icp!.id };
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
      { snapshotIds: [fixture.snapshotId], outputLocale: "en" as const },
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
      snapshotIds: [fixture.snapshotId],
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
        { snapshotIds: [fixture.snapshotId], outputLocale: "en" },
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
      { snapshotIds: [fixture.snapshotId], outputLocale: "en" },
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

  it("replays the original 202 after archive and ICP pointer changes", async () => {
    queueFixture.send.mockClear();
    const fixture = await createDiagnosticFixture(handle, workspaceId, randomUUID());
    const key = randomUUID();
    const body = { snapshotIds: [fixture.snapshotId], outputLocale: "en" as const };
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
        { snapshotIds: [fixture.snapshotId], outputLocale: "zh-CN" },
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
