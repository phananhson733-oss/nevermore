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

import { eq } from "drizzle-orm";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  SourceConnectionsRepository,
  type ProjectScope,
} from "@sf/db";
import {
  asyncRuns,
  auditRuns,
  capabilityRuns,
  clientProjects,
  diagnosticRuns,
  icpProfiles,
  workspaces,
} from "@sf/db/schema";
import { GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION } from "@sf/contracts";
import { CRAWL_DATASET_KEY, CRAWL_METHOD_VERSION } from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGrowthAuditRun } from "@/lib/services/audit-runs";
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

interface AuditFixture {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly confirmedProfileId: string;
}

async function createAuditFixture(
  handle: DbHandle,
  workspaceId: string,
  suffix: string,
): Promise<AuditFixture> {
  const created = await createProject(
    { workspaceId },
    actor,
    randomUUID(),
    {
      clientName: `Audit ${suffix}`,
      projectName: `Audit ${suffix}`,
      siteUrl: `https://audit-${suffix}.example`,
      marketCodes: ["US"],
      siteLanguageCodes: ["en"],
      defaultDeliveryLocale: "en",
    },
    safeGuard,
  );
  const scope = { workspaceId, projectId: created.project.id };
  const siteId = created.project.site.id;

  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "Audit fixture" },
      content_hash: contentHash({ fixture: suffix }),
      created_by: actor,
    })
    .returning();
  await handle.db
    .update(clientProjects)
    .set({ current_icp_profile_id: icp!.id, confirmed_icp_profile_id: icp!.id })
    .where(eq(clientProjects.id, scope.projectId));

  const crawlSource = await new SourceConnectionsRepository(
    handle.db,
  ).findConnectedByProvider(scope, "crawl");
  if (!crawlSource) throw new Error("fixture default Crawl source missing");
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
    siteId,
    sourceConnectionId: crawlSource.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ collection: suffix }),
  });
  await new DataSnapshotsRepository(handle.db).insert({
    workspaceId,
    projectId: scope.projectId,
    siteId,
    collectionRunId: collectionRun!.id,
    sourceConnectionId: crawlSource.id,
    provider: "crawl",
    datasetKey: CRAWL_DATASET_KEY,
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Audit integration fixture.",
    rawObjectKey: null,
    rowCount: 1,
    checksum: contentHash({ snapshot: suffix }),
  });

  return { scope, siteId, confirmedProfileId: icp!.id };
}

describeDb("createGrowthAuditRun canonical projection", () => {
  let handle: DbHandle;
  let workspaceId: string;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Audit-svc-${randomUUID()}` })
      .returning();
    workspaceId = workspace!.id;
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("writes async_run, diagnostic_run, capability_run and audit_run through the provenance guard", async () => {
    queueFixture.send.mockClear();
    const fixture = await createAuditFixture(handle, workspaceId, randomUUID());

    const accepted = await createGrowthAuditRun(
      { workspaceId },
      fixture.scope.projectId,
      actor,
      randomUUID(),
      {
        siteId: fixture.siteId,
        icpProfileId: fixture.confirmedProfileId,
        scope: { kind: "site" },
        outputLocale: "en",
        capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
      },
    );

    expect(accepted.status).toBe(202);
    expect(accepted.resourceRef.type).toBe("audit_run");
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
    const runId = accepted.run.id;

    const asyncRow = await handle.db
      .select({ kind: asyncRuns.kind, activeKey: asyncRuns.active_key })
      .from(asyncRuns)
      .where(eq(asyncRuns.id, runId));
    expect(asyncRow[0]).toEqual({ kind: "diagnostic", activeKey: "growth_audit" });

    const diagnosticRow = await handle.db
      .select({ id: diagnosticRuns.id })
      .from(diagnosticRuns)
      .where(eq(diagnosticRuns.id, runId));
    expect(diagnosticRow).toHaveLength(1);

    const capabilityRow = await handle.db
      .select({
        capabilityId: capabilityRuns.capability_id,
        sideEffectClass: capabilityRuns.side_effect_class,
      })
      .from(capabilityRuns)
      .where(eq(capabilityRuns.async_run_id, runId));
    expect(capabilityRow[0]).toEqual({
      capabilityId: "growth-audit",
      sideEffectClass: "read_only",
    });

    const auditRow = await handle.db
      .select({
        id: auditRuns.id,
        diagnosticRunId: auditRuns.diagnostic_run_id,
        capabilityRunId: auditRuns.capability_run_id,
        scopeKind: auditRuns.scope_kind,
        scopeKey: auditRuns.scope_key,
      })
      .from(auditRuns)
      .where(eq(auditRuns.diagnostic_run_id, runId));
    expect(auditRow).toHaveLength(1);
    expect(auditRow[0]).toMatchObject({
      id: accepted.resourceRef.id,
      diagnosticRunId: runId,
      capabilityRunId: runId,
      scopeKind: "site",
      scopeKey: fixture.siteId,
    });
  });

  it("rejects an audit that does not reference the confirmed profile", async () => {
    queueFixture.send.mockClear();
    const fixture = await createAuditFixture(handle, workspaceId, randomUUID());
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        fixture.scope.projectId,
        actor,
        randomUUID(),
        {
          siteId: fixture.siteId,
          icpProfileId: randomUUID(),
          scope: { kind: "site" },
          outputLocale: "en",
          capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
        },
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
    expect(queueFixture.send).not.toHaveBeenCalled();
  });
});
