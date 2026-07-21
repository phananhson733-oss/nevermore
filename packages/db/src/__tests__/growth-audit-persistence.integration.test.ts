import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type Db, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import { AuditRunsRepository } from "../repositories/audit-runs.ts";
import { CapabilityRunsRepository } from "../repositories/capability-runs.ts";
import { PageSnapshotsRepository } from "../repositories/page-snapshots.ts";
import { SitePagesRepository } from "../repositories/site-pages.ts";
import {
  asyncRuns,
  auditModuleResults,
  auditRuns,
  capabilityRuns,
  clientProjects,
  collectionRuns,
  dataSnapshots,
  diagnosticRuns,
  icpProfiles,
  pageSnapshots,
  sitePages,
  sites,
  workspaces,
} from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

interface CanonicalFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  readonly dataSnapshotId: string;
  readonly otherWorkspaceId: string;
  readonly otherProjectId: string;
}

async function createCanonicalFixture(db: Db): Promise<CanonicalFixture> {
  const actorId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const icpProfileId = randomUUID();
  const diagnosticRunId = randomUUID();
  const collectionRunId = randomUUID();
  const dataSnapshotId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const otherProjectId = randomUUID();

  await db.insert(workspaces).values([
    { id: workspaceId, name: `Growth audit ${workspaceId}` },
    { id: otherWorkspaceId, name: `Growth audit ${otherWorkspaceId}` },
  ]);
  await db.insert(clientProjects).values([
    {
      id: projectId,
      workspace_id: workspaceId,
      client_name: `Client ${projectId}`,
      project_name: `Project ${projectId}`,
      default_delivery_locale: "en",
      created_by: actorId,
    },
    {
      id: otherProjectId,
      workspace_id: otherWorkspaceId,
      client_name: `Client ${otherProjectId}`,
      project_name: `Project ${otherProjectId}`,
      default_delivery_locale: "en",
      created_by: actorId,
    },
  ]);
  await db.insert(sites).values({
    id: siteId,
    workspace_id: workspaceId,
    project_id: projectId,
    origin: `https://${projectId}.example.test`,
    host: `${projectId}.example.test`,
    market_codes: ["US"],
    language_codes: ["en"],
  });
  await db.insert(icpProfiles).values({
    id: icpProfileId,
    workspace_id: workspaceId,
    project_id: projectId,
    version: 1,
    status: "complete",
    profile: { fixtureId: randomUUID() },
    content_hash: contentHash({ fixtureId: randomUUID() }),
    created_by: actorId,
  });
  await db.insert(asyncRuns).values([
    {
      id: diagnosticRunId,
      workspace_id: workspaceId,
      project_id: projectId,
      kind: "diagnostic",
      initiated_by: actorId,
    },
    {
      id: collectionRunId,
      workspace_id: workspaceId,
      project_id: projectId,
      kind: "collection",
      initiated_by: actorId,
    },
  ]);
  await db.insert(diagnosticRuns).values({
    id: diagnosticRunId,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    icp_profile_id: icpProfileId,
    icp_profile_version: 1,
    rule_set_version: "mvp.rules.0.2.0",
    prompt_set_version: "mvp.prompts.0.2.0",
    output_locale: "en",
    input_manifest: { fixtureId: randomUUID() },
    input_hash: contentHash({ fixtureId: randomUUID() }),
  });
  await db.insert(collectionRuns).values({
    id: collectionRunId,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    provider: "crawl",
    operation: "site_graph",
    method_version: "integration.fixture.v1",
    parameters_hash: contentHash({ fixtureId: randomUUID() }),
  });
  await db.insert(dataSnapshots).values({
    id: dataSnapshotId,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    collection_run_id: collectionRunId,
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "integration.fixture.v1",
    method_version: "integration.fixture.v1",
    captured_at: new Date().toISOString(),
    source_window: { fixtureId: randomUUID() },
    availability: "available",
    limitation: "Disposable integration fixture.",
    row_count: 1,
    checksum: contentHash({ fixtureId: randomUUID() }),
  });

  return {
    actorId,
    workspaceId,
    projectId,
    siteId,
    diagnosticRunId,
    dataSnapshotId,
    otherWorkspaceId,
    otherProjectId,
  };
}

async function createAuditProjection(
  db: Db,
  fixture: CanonicalFixture,
): Promise<{
  readonly auditId: string;
  readonly pageId: string;
  readonly pageSnapshotId: string;
  readonly normalizedUrlHash: string;
}> {
  const capabilityRunsRepository = new CapabilityRunsRepository(db);
  const auditRunsRepository = new AuditRunsRepository(db);
  const sitePagesRepository = new SitePagesRepository(db);
  const pageSnapshotsRepository = new PageSnapshotsRepository(db);
  const normalizedUrl = `https://${fixture.projectId}.example.test/${randomUUID()}`;
  const normalizedUrlHash = contentHash({ normalizedUrl });

  const capability = await capabilityRunsRepository.create({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    asyncRunId: fixture.diagnosticRunId,
    capabilityId: "growth-audit",
    capabilityVersion: "0.3.0",
    inputManifestHash: contentHash({ fixtureId: randomUUID() }),
    mode: "production",
    sideEffectClass: "internal_write",
  });
  const audit = await auditRunsRepository.create({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    diagnosticRunId: fixture.diagnosticRunId,
    capabilityRunId: capability.async_run_id,
    scopeKind: "site",
    scopeKey: fixture.siteId,
    projectionVersion: "growth-audit.0.3.0",
  });
  await auditRunsRepository.insertModuleResults(
    {
      auditRunId: audit.id,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    },
    [
      {
        moduleId: "technical_search",
        coverageState: "available",
        summary: { fixtureId: randomUUID() },
      },
      {
        moduleId: "ai_geo",
        coverageState: "no_data",
        summary: { limitation: "No canonical source snapshot was available." },
      },
    ],
  );
  const page = await sitePagesRepository.upsertNormalizedUrl({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    normalizedUrl,
    normalizedUrlHash,
    templateKey: null,
  });
  const pageSnapshot = await pageSnapshotsRepository.create({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    sitePageId: page.id,
    dataSnapshotId: fixture.dataSnapshotId,
    contentHash: contentHash({ fixtureId: randomUUID() }),
    extract: { canonical: normalizedUrl, fixtureId: randomUUID() },
    capturedAt: new Date().toISOString(),
  });

  return {
    auditId: audit.id,
    pageId: page.id,
    pageSnapshotId: pageSnapshot.id,
    normalizedUrlHash,
  };
}

describeDb("growth audit persistence boundary", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("anchors a tenant-scoped audit projection to canonical runs and snapshots", async () => {
    const fixture = await createCanonicalFixture(handle.db);
    const created = await createAuditProjection(handle.db, fixture);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    const foreignScope = {
      workspaceId: fixture.otherWorkspaceId,
      projectId: fixture.otherProjectId,
    };

    const capabilityRunsRepository = new CapabilityRunsRepository(handle.db);
    const auditRunsRepository = new AuditRunsRepository(handle.db);
    const sitePagesRepository = new SitePagesRepository(handle.db);
    const pageSnapshotsRepository = new PageSnapshotsRepository(handle.db);

    await expect(
      capabilityRunsRepository.findByAsyncRunId(fixture.diagnosticRunId),
    ).resolves.toMatchObject({ async_run_id: fixture.diagnosticRunId });
    await expect(
      auditRunsRepository.findById(scope, created.auditId),
    ).resolves.toMatchObject({
      diagnostic_run_id: fixture.diagnosticRunId,
      capability_run_id: fixture.diagnosticRunId,
    });
    await expect(
      auditRunsRepository.findById(foreignScope, created.auditId),
    ).resolves.toBeNull();
    await expect(
      auditRunsRepository.listModuleResults(scope, created.auditId),
    ).resolves.toEqual([
      expect.objectContaining({
        audit_run_id: created.auditId,
        module_id: "ai_geo",
        coverage_state: "no_data",
      }),
      expect.objectContaining({
        audit_run_id: created.auditId,
        module_id: "technical_search",
        coverage_state: "available",
      }),
    ]);
    await expect(
      auditRunsRepository.listModuleResults(foreignScope, created.auditId),
    ).resolves.toEqual([]);
    await expect(
      sitePagesRepository.findById(scope, created.pageId),
    ).resolves.toMatchObject({
      id: created.pageId,
      normalized_url_hash: created.normalizedUrlHash,
    });
    await expect(
      sitePagesRepository.findById(foreignScope, created.pageId),
    ).resolves.toBeNull();
    await expect(
      pageSnapshotsRepository.findById(scope, created.pageSnapshotId),
    ).resolves.toMatchObject({
      id: created.pageSnapshotId,
      site_page_id: created.pageId,
      data_snapshot_id: fixture.dataSnapshotId,
    });
    await expect(
      pageSnapshotsRepository.findById(foreignScope, created.pageSnapshotId),
    ).resolves.toBeNull();
  });

  it("enforces canonical identity, immutability, and restrictive provenance FKs", async () => {
    const fixture = await createCanonicalFixture(handle.db);
    const created = await createAuditProjection(handle.db, fixture);

    await expectPgCode(
      handle.db.insert(capabilityRuns).values({
        async_run_id: fixture.diagnosticRunId,
        capability_id: "growth-audit",
        capability_version: "0.3.0",
        input_manifest_hash: contentHash({ fixtureId: randomUUID() }),
        mode: "shadow",
        side_effect_class: "read_only",
      }),
      "23505",
    );
    await expectPgCode(
      handle.db.insert(auditRuns).values({
        workspace_id: fixture.workspaceId,
        project_id: fixture.projectId,
        diagnostic_run_id: fixture.diagnosticRunId,
        capability_run_id: fixture.diagnosticRunId,
        scope_kind: "site",
        scope_key: fixture.siteId,
        projection_version: "growth-audit.0.3.0",
      }),
      "23505",
    );
    await expectPgCode(
      handle.db.insert(auditModuleResults).values({
        audit_run_id: created.auditId,
        module_id: "technical_search",
        coverage_state: "partial",
        summary: { fixtureId: randomUUID() },
      }),
      "23505",
    );
    await expectPgCode(
      handle.db.insert(sitePages).values({
        workspace_id: fixture.workspaceId,
        project_id: fixture.projectId,
        site_id: fixture.siteId,
        normalized_url: `https://${fixture.projectId}.example.test/duplicate`,
        normalized_url_hash: created.normalizedUrlHash,
      }),
      "23505",
    );
    await expectPgCode(
      handle.db.insert(pageSnapshots).values({
        workspace_id: fixture.workspaceId,
        project_id: fixture.projectId,
        site_page_id: created.pageId,
        data_snapshot_id: randomUUID(),
        content_hash: contentHash({ fixtureId: randomUUID() }),
        extract: { fixtureId: randomUUID() },
        captured_at: new Date().toISOString(),
      }),
      "23514",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.page_snapshots SET extract = '{}'::jsonb WHERE id = $1",
        [created.pageSnapshotId],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query("DELETE FROM app.page_snapshots WHERE id = $1", [
        created.pageSnapshotId,
      ]),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.capability_runs SET mode = 'shadow' WHERE async_run_id = $1",
        [fixture.diagnosticRunId],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.audit_runs SET scope_key = $1 WHERE id = $2",
        [randomUUID(), created.auditId],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.audit_module_results SET coverage_state = 'partial' WHERE audit_run_id = $1 AND module_id = 'technical_search'",
        [created.auditId],
      ),
      "55000",
    );
    const restrictiveForeignKeys = await handle.db.execute(sql<{
        readonly table_name: string;
        readonly column_name: string;
        readonly constraint_name: string;
        readonly delete_action: string;
      }>`
        SELECT tc.table_name, kcu.column_name, tc.constraint_name,
               rc.delete_rule AS delete_action
        FROM information_schema.table_constraints tc
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_schema = tc.constraint_schema
         AND rc.constraint_name = tc.constraint_name
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
        WHERE tc.table_schema = 'app'
          AND tc.table_name IN (
            'capability_runs',
            'audit_runs',
            'audit_module_results',
            'site_pages',
            'page_snapshots'
          )
        ORDER BY tc.table_name, kcu.column_name
      `);
    expect(restrictiveForeignKeys.rows).toEqual([
      {
        table_name: "audit_module_results",
        column_name: "audit_run_id",
        constraint_name: "audit_module_results_audit_run_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "audit_runs",
        column_name: "capability_run_id",
        constraint_name: "audit_runs_capability_run_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "audit_runs",
        column_name: "diagnostic_run_id",
        constraint_name: "audit_runs_diagnostic_run_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "audit_runs",
        column_name: "project_id",
        constraint_name: "audit_runs_project_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "audit_runs",
        column_name: "workspace_id",
        constraint_name: "audit_runs_workspace_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "capability_runs",
        column_name: "async_run_id",
        constraint_name: "capability_runs_async_run_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "page_snapshots",
        column_name: "data_snapshot_id",
        constraint_name: "page_snapshots_data_snapshot_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "page_snapshots",
        column_name: "project_id",
        constraint_name: "page_snapshots_project_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "page_snapshots",
        column_name: "site_page_id",
        constraint_name: "page_snapshots_site_page_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "page_snapshots",
        column_name: "workspace_id",
        constraint_name: "page_snapshots_workspace_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "site_pages",
        column_name: "project_id",
        constraint_name: "site_pages_project_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "site_pages",
        column_name: "site_id",
        constraint_name: "site_pages_site_id_fkey",
        delete_action: "RESTRICT",
      },
      {
        table_name: "site_pages",
        column_name: "workspace_id",
        constraint_name: "site_pages_workspace_id_fkey",
        delete_action: "RESTRICT",
      },
    ]);
    const browserRoleGrants = await handle.db.execute(sql<{
      readonly grantee: string;
      readonly table_name: string;
      readonly privilege_type: string;
    }>`
      SELECT role.rolname AS grantee, relation.relname AS table_name,
             privilege.privilege_type
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(relation.relacl, acldefault('r', relation.relowner))
      ) privilege
      JOIN pg_roles role ON role.oid = privilege.grantee
      WHERE namespace.nspname = 'app'
        AND relation.relname IN (
          'capability_runs',
          'audit_runs',
          'audit_module_results',
          'site_pages',
          'page_snapshots'
        )
        AND role.rolname IN ('anon', 'authenticated')
      ORDER BY role.rolname, relation.relname, privilege.privilege_type
    `);
    expect(browserRoleGrants.rows).toEqual([]);
    const forbiddenStatusColumns = await handle.db.execute(sql<{
        readonly column_name: string;
      }>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'app'
          AND table_name IN ('capability_runs', 'audit_runs')
          AND column_name = 'status'
      `);
    expect(forbiddenStatusColumns.rows).toEqual([]);

    const before = await handle.db
      .select({ updated_at: sitePages.updated_at })
      .from(sitePages)
      .where(eq(sitePages.id, created.pageId));
    await handle.db
      .update(sitePages)
      .set({ template_key: `template-${randomUUID()}` })
      .where(
        and(
          eq(sitePages.workspace_id, fixture.workspaceId),
          eq(sitePages.project_id, fixture.projectId),
          eq(sitePages.id, created.pageId),
        ),
      );
    const after = await handle.db
      .select({ updated_at: sitePages.updated_at })
      .from(sitePages)
      .where(eq(sitePages.id, created.pageId));
    expect(Date.parse(after[0]!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(before[0]!.updated_at),
    );

    await expect(
      handle.db
        .select({ id: capabilityRuns.async_run_id })
        .from(capabilityRuns)
        .where(eq(capabilityRuns.async_run_id, fixture.diagnosticRunId)),
    ).resolves.toHaveLength(1);
    await expect(
      handle.db
        .select({ audit_run_id: auditModuleResults.audit_run_id })
        .from(auditModuleResults)
        .where(eq(auditModuleResults.audit_run_id, created.auditId)),
    ).resolves.toHaveLength(2);
  });

  it("rejects cross-tenant and cross-lineage provenance at the database boundary", async () => {
    const fixture = await createCanonicalFixture(handle.db);
    const created = await createAuditProjection(handle.db, fixture);
    const unrelatedAsyncRunId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: unrelatedAsyncRunId,
      workspace_id: fixture.workspaceId,
      project_id: fixture.projectId,
      kind: "diagnostic",
      initiated_by: fixture.actorId,
    });
    await new CapabilityRunsRepository(handle.db).create({
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      asyncRunId: unrelatedAsyncRunId,
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({ fixtureId: randomUUID() }),
      mode: "production",
      sideEffectClass: "internal_write",
    });

    await expectPgCode(
      handle.db.insert(auditRuns).values({
        workspace_id: fixture.otherWorkspaceId,
        project_id: fixture.otherProjectId,
        diagnostic_run_id: fixture.diagnosticRunId,
        capability_run_id: fixture.diagnosticRunId,
        scope_kind: "site",
        scope_key: fixture.siteId,
        projection_version: "growth-audit.0.3.0",
      }),
      "23514",
    );
    await expectPgCode(
      handle.db.insert(auditRuns).values({
        workspace_id: fixture.workspaceId,
        project_id: fixture.projectId,
        diagnostic_run_id: fixture.diagnosticRunId,
        capability_run_id: unrelatedAsyncRunId,
        scope_kind: "site",
        scope_key: fixture.siteId,
        projection_version: "growth-audit.0.3.0",
      }),
      "23514",
    );
    await expectPgCode(
      handle.db.insert(sitePages).values({
        workspace_id: fixture.otherWorkspaceId,
        project_id: fixture.otherProjectId,
        site_id: fixture.siteId,
        normalized_url: `https://${fixture.projectId}.example.test/${randomUUID()}`,
        normalized_url_hash: contentHash({ fixtureId: randomUUID() }),
      }),
      "23514",
    );
    await expectPgCode(
      handle.db.insert(pageSnapshots).values({
        workspace_id: fixture.otherWorkspaceId,
        project_id: fixture.otherProjectId,
        site_page_id: created.pageId,
        data_snapshot_id: fixture.dataSnapshotId,
        content_hash: contentHash({ fixtureId: randomUUID() }),
        extract: { fixtureId: randomUUID() },
        captured_at: new Date().toISOString(),
      }),
      "23514",
    );
  });

  it("converges exact append-only replays and rejects conflicting replays", async () => {
    const fixture = await createCanonicalFixture(handle.db);
    const capabilityRunsRepository = new CapabilityRunsRepository(handle.db);
    const auditRunsRepository = new AuditRunsRepository(handle.db);
    const sitePagesRepository = new SitePagesRepository(handle.db);
    const pageSnapshotsRepository = new PageSnapshotsRepository(handle.db);
    const capabilityValues = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      asyncRunId: fixture.diagnosticRunId,
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({ fixtureId: randomUUID() }),
      mode: "production" as const,
      sideEffectClass: "internal_write" as const,
    };
    const capability = await capabilityRunsRepository.create(capabilityValues);
    await expect(
      capabilityRunsRepository.create(capabilityValues),
    ).resolves.toEqual(capability);
    await expect(
      capabilityRunsRepository.create({
        ...capabilityValues,
        mode: "shadow",
      }),
    ).rejects.toThrow("capability run replay conflicts");

    const auditValues = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      diagnosticRunId: fixture.diagnosticRunId,
      capabilityRunId: capability.async_run_id,
      scopeKind: "site" as const,
      scopeKey: fixture.siteId,
      projectionVersion: "growth-audit.0.3.0",
    };
    const audit = await auditRunsRepository.create(auditValues);
    await expect(auditRunsRepository.create(auditValues)).resolves.toEqual(
      audit,
    );
    await expect(
      auditRunsRepository.create({ ...auditValues, scopeKind: "url" }),
    ).rejects.toThrow("audit run replay conflicts");

    const moduleResults = [
      {
        moduleId: "technical_search",
        coverageState: "available" as const,
        summary: { fixtureId: randomUUID() },
      },
      {
        moduleId: "ai_geo",
        coverageState: "no_data" as const,
        summary: { limitation: "No canonical source snapshot was available." },
      },
    ];
    const moduleScope = {
      auditRunId: audit.id,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    await auditRunsRepository.insertModuleResults(
      moduleScope,
      [moduleResults[0]!],
    );
    await expect(
      auditRunsRepository.insertModuleResults(
        moduleScope,
        moduleResults,
      ),
    ).resolves.toBeUndefined();
    await expect(
      auditRunsRepository.insertModuleResults(
        moduleScope,
        [{ ...moduleResults[0]!, coverageState: "partial" }],
      ),
    ).rejects.toThrow("audit module result replay conflicts");
    await expect(
      auditRunsRepository.listModuleResults(
        {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
        },
        audit.id,
      ),
    ).resolves.toHaveLength(2);

    const normalizedUrl = `https://${fixture.projectId}.example.test/${randomUUID()}`;
    const pageValues = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      siteId: fixture.siteId,
      normalizedUrl,
      normalizedUrlHash: contentHash({ normalizedUrl }),
      templateKey: null,
    };
    const page = await sitePagesRepository.upsertNormalizedUrl(pageValues);
    await expect(
      sitePagesRepository.upsertNormalizedUrl(pageValues),
    ).resolves.toMatchObject({ id: page.id });

    const pageSnapshotValues = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      sitePageId: page.id,
      dataSnapshotId: fixture.dataSnapshotId,
      contentHash: contentHash({ fixtureId: randomUUID() }),
      extract: { canonical: normalizedUrl, fixtureId: randomUUID() },
      capturedAt: new Date().toISOString(),
    };
    const pageSnapshot = await pageSnapshotsRepository.create(
      pageSnapshotValues,
    );
    await expect(
      pageSnapshotsRepository.create(pageSnapshotValues),
    ).resolves.toEqual(pageSnapshot);
    await expect(
      pageSnapshotsRepository.create({
        ...pageSnapshotValues,
        extract: { canonical: normalizedUrl, fixtureId: randomUUID() },
      }),
    ).rejects.toThrow("page snapshot replay conflicts");
  });

  it("replays the complete append-only projection inside one PostgreSQL transaction", async () => {
    const fixture = await createCanonicalFixture(handle.db);
    await expect(
      handle.db.transaction(async (tx) => {
        const capabilityRunsRepository = new CapabilityRunsRepository(tx);
        const auditRunsRepository = new AuditRunsRepository(tx);
        const sitePagesRepository = new SitePagesRepository(tx);
        const pageSnapshotsRepository = new PageSnapshotsRepository(tx);
        const capabilityValues = {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          asyncRunId: fixture.diagnosticRunId,
          capabilityId: "growth-audit",
          capabilityVersion: "0.3.0",
          inputManifestHash: contentHash({ fixtureId: randomUUID() }),
          mode: "production" as const,
          sideEffectClass: "internal_write" as const,
        };
        const capability = await capabilityRunsRepository.create(
          capabilityValues,
        );
        await capabilityRunsRepository.create(capabilityValues);

        const auditValues = {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          diagnosticRunId: fixture.diagnosticRunId,
          capabilityRunId: capability.async_run_id,
          scopeKind: "site" as const,
          scopeKey: fixture.siteId,
          projectionVersion: "growth-audit.0.3.0",
        };
        const audit = await auditRunsRepository.create(auditValues);
        await auditRunsRepository.create(auditValues);

        const moduleScope = {
          auditRunId: audit.id,
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
        };
        const moduleResults = [
          {
            moduleId: "technical_search",
            coverageState: "available" as const,
            summary: { fixtureId: randomUUID() },
          },
        ];
        await auditRunsRepository.insertModuleResults(
          moduleScope,
          moduleResults,
        );
        await auditRunsRepository.insertModuleResults(
          moduleScope,
          moduleResults,
        );

        const normalizedUrl = `https://${fixture.projectId}.example.test/${randomUUID()}`;
        const page = await sitePagesRepository.upsertNormalizedUrl({
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          siteId: fixture.siteId,
          normalizedUrl,
          normalizedUrlHash: contentHash({ normalizedUrl }),
          templateKey: null,
        });
        const pageSnapshotValues = {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          sitePageId: page.id,
          dataSnapshotId: fixture.dataSnapshotId,
          contentHash: contentHash({ fixtureId: randomUUID() }),
          extract: { canonical: normalizedUrl, fixtureId: randomUUID() },
          capturedAt: new Date().toISOString(),
        };
        await pageSnapshotsRepository.create(pageSnapshotValues);
        await pageSnapshotsRepository.create(pageSnapshotValues);
      }),
    ).resolves.toBeUndefined();
  });
});
