import { randomBytes, randomUUID } from "node:crypto";

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
  ImportPreviewsRepository,
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
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
} from "@sf/sources";
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

type AuditSnapshotProvider = "gsc" | "ga4" | "csv" | "dataforseo";

const AUDIT_PROVIDER_CONFIG = {
  gsc: {
    operation: "search_analytics",
    datasetKey: "gsc.page_query_daily.v1",
    schemaVersion: "0.2.0",
    methodVersion: "gsc.page_query_daily.v1",
    connectionType: "oauth",
  },
  ga4: {
    operation: "organic_landing",
    datasetKey: "ga4.organic_landing_daily.v1",
    schemaVersion: "0.2.0",
    methodVersion: "ga4.organic_landing_daily.v1",
    connectionType: "oauth",
  },
  csv: {
    operation: "keyword_gap_import",
    datasetKey: "csv.keyword_gap.v1",
    schemaVersion: "0.2.0",
    methodVersion: "csv.keyword_gap.v1",
    connectionType: null,
  },
  dataforseo: {
    operation: "keyword_gap_import",
    datasetKey: DATAFORSEO_DATASET_KEY,
    schemaVersion: DATAFORSEO_METHOD_VERSION,
    methodVersion: DATAFORSEO_METHOD_VERSION,
    connectionType: "api_key_stub",
  },
} as const;

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
      profile: {
        productName: "Audit fixture",
        oneLineDescription: "Growth Audit integration fixture",
        productType: "saas",
        businessModels: ["subscription"],
        marketCodes: ["US"],
        segments: ["Growth teams"],
      },
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

async function insertProviderSnapshot(
  handle: DbHandle,
  fixture: AuditFixture,
  provider: AuditSnapshotProvider,
  values: {
    readonly capturedAt: string;
    readonly availability: "available" | "partial" | "unavailable";
    readonly runStatus?: "completed" | "partial" | "failed";
    readonly methodVersion?: string;
  },
) {
  const config = AUDIT_PROVIDER_CONFIG[provider];
  let sourceConnectionId: string | null = null;
  let importPreviewId: string | null = null;

  if (provider === "csv") {
    const preview = await new ImportPreviewsRepository(handle.db).insert({
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      siteId: fixture.siteId,
      createdBy: actor,
      tokenHash: randomBytes(32),
      templateId: "keyword_gap_v1",
      rawObjectKey: `raw/${randomUUID()}.csv`,
      fileChecksum: contentHash({ provider, preview: randomUUID() }),
      rowCount: 1,
      detectedColumns: ["keyword"],
      suggestedMapping: { keyword: "keyword" },
      previewRows: [{ keyword: "growth audit" }],
      validationErrors: [],
      validationWarnings: [],
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    importPreviewId = preview.id;
  } else {
    const sources = new SourceConnectionsRepository(handle.db);
    const existing = await sources.findConnectedByProvider(
      fixture.scope,
      provider,
    );
    const source =
      existing ??
      (await sources.insertConnection({
        workspaceId: fixture.scope.workspaceId,
        projectId: fixture.scope.projectId,
        siteId: fixture.siteId,
        provider,
        connectionType: config.connectionType!,
        state: "connected",
        externalRef: `${provider}:${fixture.scope.projectId}`,
        limitation: `${provider} integration fixture.`,
        connectedAt: true,
        createdBy: actor,
      }));
    sourceConnectionId = source.id;
  }

  const runStatus = values.runStatus ?? "completed";
  const runId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: fixture.scope.workspaceId,
    project_id: fixture.scope.projectId,
    kind: "collection",
    status: runStatus,
    initiated_by: actor,
    started_at: values.capturedAt,
    completed_at: values.capturedAt,
  });
  const methodVersion = values.methodVersion ?? config.methodVersion;
  await new CollectionRunsRepository(handle.db).insertPlaceholder({
    runId,
    workspaceId: fixture.scope.workspaceId,
    projectId: fixture.scope.projectId,
    siteId: fixture.siteId,
    sourceConnectionId,
    provider,
    operation: config.operation,
    methodVersion,
    parametersHash: contentHash({ provider, runId }),
    ...(importPreviewId === null ? {} : { importPreviewId }),
  });
  return new DataSnapshotsRepository(handle.db).insert({
    workspaceId: fixture.scope.workspaceId,
    projectId: fixture.scope.projectId,
    siteId: fixture.siteId,
    collectionRunId: runId,
    sourceConnectionId,
    provider,
    datasetKey: config.datasetKey,
    schemaVersion: config.schemaVersion,
    methodVersion,
    capturedAt: values.capturedAt,
    sourceWindow: { start: "2026-07-01", end: "2026-07-28" },
    availability: values.availability,
    limitation: `${provider} ${values.availability} integration fixture.`,
    rawObjectKey: null,
    rowCount: values.availability === "unavailable" ? 0 : 1,
    checksum: contentHash({ provider, runId, availability: values.availability }),
  });
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

  it("freezes the latest completed compatible usable canonical snapshot for every supported provider", async () => {
    queueFixture.send.mockClear();
    const fixture = await createAuditFixture(handle, workspaceId, randomUUID());

    const gscEligible = await insertProviderSnapshot(
      handle,
      fixture,
      "gsc",
      {
        capturedAt: "2026-07-24T00:00:00.000Z",
        availability: "available",
      },
    );
    const gscUnavailable = await insertProviderSnapshot(
      handle,
      fixture,
      "gsc",
      {
        capturedAt: "2026-07-25T00:00:00.000Z",
        availability: "unavailable",
      },
    );
    const gscIncompatible = await insertProviderSnapshot(
      handle,
      fixture,
      "gsc",
      {
        capturedAt: "2026-07-26T00:00:00.000Z",
        availability: "available",
        methodVersion: "gsc.page_query_daily.v0",
      },
    );
    const ga4Eligible = await insertProviderSnapshot(
      handle,
      fixture,
      "ga4",
      {
        capturedAt: "2026-07-24T00:00:00.000Z",
        availability: "available",
      },
    );
    const ga4FailedRun = await insertProviderSnapshot(
      handle,
      fixture,
      "ga4",
      {
        capturedAt: "2026-07-26T00:00:00.000Z",
        availability: "available",
        runStatus: "failed",
      },
    );
    const ga4MismatchedTerminal = await insertProviderSnapshot(
      handle,
      fixture,
      "ga4",
      {
        capturedAt: "2026-07-27T00:00:00.000Z",
        availability: "available",
        runStatus: "partial",
      },
    );
    const csvEligible = await insertProviderSnapshot(
      handle,
      fixture,
      "csv",
      {
        capturedAt: "2026-07-24T00:00:00.000Z",
        availability: "partial",
        runStatus: "partial",
      },
    );
    const dataForSeoEligible = await insertProviderSnapshot(
      handle,
      fixture,
      "dataforseo",
      {
        capturedAt: "2026-07-24T00:00:00.000Z",
        availability: "available",
      },
    );

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
        capabilityContractVersion:
          GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
      },
    );

    const diagnosticRow = await handle.db
      .select({ inputManifest: diagnosticRuns.input_manifest })
      .from(diagnosticRuns)
      .where(eq(diagnosticRuns.id, accepted.run.id));
    expect(Object.keys(diagnosticRow[0]!.inputManifest).sort()).toEqual([
      "contextProjection",
      "deliveryLocale",
      "governance",
      "icp",
      "projectId",
      "promptSetVersion",
      "ruleSetVersion",
      "siteId",
      "snapshots",
    ]);
    expect(diagnosticRow[0]!.inputManifest["contextProjection"]).toMatchObject({
      profileGeneration: "legacy-icp.v1",
      siteLanguage: {
        sourceKind: "site",
        state: "declared_non_empty",
        languageCodes: ["en"],
      },
    });
    const frozenSnapshots = (
      diagnosticRow[0]!.inputManifest["snapshots"] as readonly {
        readonly snapshotId: string;
        readonly provider: string;
      }[]
    );
    const frozenByProvider = new Map(
      frozenSnapshots.map((snapshot) => [
        snapshot.provider,
        snapshot.snapshotId,
      ]),
    );

    expect(frozenByProvider).toEqual(
      new Map([
        ["crawl", expect.any(String)],
        ["gsc", gscEligible.id],
        ["ga4", ga4Eligible.id],
        ["csv", csvEligible.id],
        ["dataforseo", dataForSeoEligible.id],
      ]),
    );
    expect(frozenSnapshots).toHaveLength(5);
    expect([...frozenByProvider.values()]).not.toEqual(
      expect.arrayContaining([
        gscUnavailable.id,
        gscIncompatible.id,
        ga4FailedRun.id,
        ga4MismatchedTerminal.id,
      ]),
    );
  });
});
