import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { BacklinkGrowthMapRepository } from "../repositories/backlink-growth-map.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CAPTURED_AT = "2026-07-28T03:00:00.000Z";
const CANONICAL_URL =
  "https://backlink-authority.example/customer-onboarding/";

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
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

async function expectPgConstraint(promise: Promise<unknown>): Promise<void> {
  await expectPgCode(promise, "23514");
}

describeDb("0030 Backlink Growth Map source authority", () => {
  let handle: DbHandle;
  const ids = {
    workspace: randomUUID(),
    project: randomUUID(),
    site: randomUUID(),
    page: randomUUID(),
    actor: randomUUID(),
    preview: randomUUID(),
    approvedCompetitor: randomUUID(),
    candidateCompetitor: randomUUID(),
    ahrefsSnapshot: randomUUID(),
    approvedCompetitorSnapshot: randomUUID(),
    manualSnapshot: randomUUID(),
    searchSnapshot: randomUUID(),
    mozSnapshot: randomUUID(),
    providerFact: randomUUID(),
    mozFact: randomUUID(),
  };
  const previewChecksum = "c".repeat(64);

  async function insertSnapshot(input: {
    readonly id: string;
    readonly subjectKind?: "primary_site" | "approved_competitor";
    readonly competitorId?: string | null;
    readonly sourceKind:
      | "provider_import"
      | "manual_csv"
      | "search_derived";
    readonly provider: "ahrefs" | "moz" | "manual_csv" | "search_derived";
    readonly availability: "available" | "partial" | "unavailable";
    readonly indexScope:
      | "provider_index"
      | "observed_subset"
      | "unavailable";
    readonly totalBacklinks?: number | null;
    readonly totalReferringDomains?: number | null;
    readonly observedBacklinks?: number | null;
    readonly observedReferringDomains?: number | null;
    readonly authorityKind?: "domain_rating" | "domain_authority" | null;
    readonly authorityValue?: number | null;
    readonly sourceRef: string;
    readonly checksum?: string;
    readonly rowCount?: number;
    readonly importPreviewId?: string | null;
    readonly limitation?: string | null;
  }): Promise<void> {
    await handle.pool.query(
      `INSERT INTO app.backlink_authority_snapshots (
         id, workspace_id, project_id, site_id, competitor_id,
         subject_kind, source_kind, provider, captured_at,
         availability, index_scope, total_backlinks,
         total_referring_domains, observed_backlinks,
         observed_referring_domains, authority_metric_kind,
         authority_metric_value, source_ref, checksum, row_count,
         import_preview_id, limitation
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,$21,$22
       )`,
      [
        input.id,
        ids.workspace,
        ids.project,
        ids.site,
        input.competitorId ?? null,
        input.subjectKind ?? "primary_site",
        input.sourceKind,
        input.provider,
        CAPTURED_AT,
        input.availability,
        input.indexScope,
        input.totalBacklinks ?? null,
        input.totalReferringDomains ?? null,
        input.observedBacklinks ?? null,
        input.observedReferringDomains ?? null,
        input.authorityKind ?? null,
        input.authorityValue ?? null,
        input.sourceRef,
        input.checksum ?? "a".repeat(64),
        input.rowCount ?? 0,
        input.importPreviewId ?? null,
        input.limitation ?? null,
      ],
    );
  }

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL!);
    await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);

    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
      [ids.workspace, `Backlink authority ${ids.workspace}`],
    );
    await handle.pool.query(
      `INSERT INTO app.client_projects (
         id, workspace_id, client_name, project_name,
         default_delivery_locale, created_by
       ) VALUES ($1,$2,$3,$4,'zh-CN',$5)`,
      [
        ids.project,
        ids.workspace,
        "Backlink authority client",
        `Backlink authority ${ids.project}`,
        ids.actor,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES (
         $1,$2,$3,'https://backlink-authority.example',
         'backlink-authority.example',ARRAY['US'],ARRAY['en-US'],true
       )`,
      [ids.site, ids.workspace, ids.project],
    );
    await handle.pool.query(
      `INSERT INTO app.site_pages (
         id, workspace_id, project_id, site_id,
         normalized_url, normalized_url_hash
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        ids.page,
        ids.workspace,
        ids.project,
        ids.site,
        CANONICAL_URL,
        normalizedUrlHash(CANONICAL_URL),
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.import_previews (
         id, workspace_id, project_id, site_id, created_by,
         token_hash, template_id, raw_object_key, file_checksum,
         row_count, detected_columns, suggested_mapping, preview_rows,
         validation_errors, validation_warnings, status, expires_at,
         consumed_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'backlink_v1',$7,$8,2,
         '["source_url","target_url"]'::jsonb,
         '{"source_url":"source_url","target_url":"target_url"}'::jsonb,
         '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
         'consumed','2026-08-28T03:00:00.000Z',$9
       )`,
      [
        ids.preview,
        ids.workspace,
        ids.project,
        ids.site,
        ids.actor,
        randomBytes(32),
        `backlink-preview-${ids.preview}.csv`,
        previewChecksum,
        CAPTURED_AT,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.competitor_entities (
         id, workspace_id, project_id, domain, name,
         review_status, relationship, analysis_scope
       ) VALUES (
         $1,$2,$3,'approved-rival.example','Approved Rival',
         'approved','direct',ARRAY['content']
       ),(
         $4,$2,$3,'candidate-rival.example','Candidate Rival',
         'candidate',NULL,ARRAY[]::text[]
       )`,
      [
        ids.approvedCompetitor,
        ids.workspace,
        ids.project,
        ids.candidateCompetitor,
      ],
    );

    await insertSnapshot({
      id: ids.ahrefsSnapshot,
      sourceKind: "provider_import",
      provider: "ahrefs",
      availability: "available",
      indexScope: "provider_index",
      totalBacklinks: 120,
      totalReferringDomains: 40,
      authorityKind: "domain_rating",
      authorityValue: 42,
      sourceRef: "Ahrefs RelayOps 2026-07",
      rowCount: 120,
    });
    await insertSnapshot({
      id: ids.approvedCompetitorSnapshot,
      subjectKind: "approved_competitor",
      competitorId: ids.approvedCompetitor,
      sourceKind: "provider_import",
      provider: "ahrefs",
      availability: "available",
      indexScope: "provider_index",
      totalBacklinks: 900,
      totalReferringDomains: 160,
      authorityKind: "domain_rating",
      authorityValue: 67,
      sourceRef: "Ahrefs Approved Rival 2026-07",
      rowCount: 900,
    });
    await insertSnapshot({
      id: ids.manualSnapshot,
      sourceKind: "manual_csv",
      provider: "manual_csv",
      availability: "partial",
      indexScope: "observed_subset",
      observedBacklinks: 2,
      observedReferringDomains: 2,
      sourceRef: "Customer backlink CSV 2026-07",
      checksum: previewChecksum,
      rowCount: 2,
      importPreviewId: ids.preview,
      limitation: "Only the two reviewed rows from this CSV are counted.",
    });
    await insertSnapshot({
      id: ids.searchSnapshot,
      sourceKind: "search_derived",
      provider: "search_derived",
      availability: "partial",
      indexScope: "observed_subset",
      observedBacklinks: 3,
      observedReferringDomains: 2,
      sourceRef: "Verified search discovery 2026-07",
      rowCount: 3,
      limitation: "Only verified search discoveries are counted.",
    });
    await insertSnapshot({
      id: ids.mozSnapshot,
      sourceKind: "provider_import",
      provider: "moz",
      availability: "available",
      indexScope: "provider_index",
      totalBacklinks: 115,
      totalReferringDomains: 38,
      authorityKind: "domain_authority",
      authorityValue: 41,
      sourceRef: "Moz RelayOps 2026-07",
      rowCount: 115,
    });
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("accepts Provider totals, an approved competitor, and partial built-in evidence without creating customer connections", async () => {
    const repositoryRows = await new BacklinkGrowthMapRepository(
      handle.db,
    ).listLatestAuthoritySnapshots({
      workspaceId: ids.workspace,
      projectId: ids.project,
    });
    expect(repositoryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids.ahrefsSnapshot,
          subject_kind: "primary_site",
          subject_name: `Backlink authority ${ids.project}`,
          domain: "backlink-authority.example",
        }),
        expect.objectContaining({
          id: ids.approvedCompetitorSnapshot,
          subject_kind: "approved_competitor",
          subject_name: "Approved Rival",
          domain: "approved-rival.example",
        }),
      ]),
    );
    const snapshots = await handle.pool.query<{
      source_kind: string;
      provider: string;
      availability: string;
      index_scope: string;
    }>(
      `SELECT source_kind, provider, availability, index_scope
       FROM app.backlink_authority_snapshots
       WHERE workspace_id = $1 AND project_id = $2`,
      [ids.workspace, ids.project],
    );
    expect(snapshots.rows).toEqual(
      expect.arrayContaining([
        {
          source_kind: "provider_import",
          provider: "ahrefs",
          availability: "available",
          index_scope: "provider_index",
        },
        {
          source_kind: "manual_csv",
          provider: "manual_csv",
          availability: "partial",
          index_scope: "observed_subset",
        },
        {
          source_kind: "search_derived",
          provider: "search_derived",
          availability: "partial",
          index_scope: "observed_subset",
        },
      ]),
    );
    const exposedConnections = await handle.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.source_connections
       WHERE workspace_id = $1 AND project_id = $2
         AND provider IN ('ahrefs','moz')`,
      [ids.workspace, ids.project],
    );
    expect(exposedConnections.rows[0]?.count).toBe("0");
  });

  it("rejects candidate competitors, partial totals, and missing Provider values disguised as zero", async () => {
    await expectPgConstraint(
      insertSnapshot({
        id: randomUUID(),
        subjectKind: "approved_competitor",
        competitorId: ids.candidateCompetitor,
        sourceKind: "provider_import",
        provider: "ahrefs",
        availability: "available",
        indexScope: "provider_index",
        totalBacklinks: 80,
        totalReferringDomains: 20,
        authorityKind: "domain_rating",
        authorityValue: 30,
        sourceRef: "Ahrefs Candidate Rival 2026-07",
        rowCount: 80,
      }),
    );
    await expectPgConstraint(
      insertSnapshot({
        id: randomUUID(),
        sourceKind: "search_derived",
        provider: "search_derived",
        availability: "partial",
        indexScope: "observed_subset",
        totalBacklinks: 3,
        observedBacklinks: 3,
        observedReferringDomains: 2,
        sourceRef: "Invalid search total 2026-07",
        rowCount: 3,
        limitation: "Invalid fixture.",
      }),
    );
    await expectPgConstraint(
      insertSnapshot({
        id: randomUUID(),
        sourceKind: "provider_import",
        provider: "ahrefs",
        availability: "unavailable",
        indexScope: "unavailable",
        totalBacklinks: 0,
        sourceRef: "Unavailable Ahrefs fixture",
        limitation: "Provider did not return a readable snapshot.",
      }),
    );
  });

  it("binds page and referring-domain metrics to the selected parent source semantics", async () => {
    await expect(
      handle.pool.query(
        `INSERT INTO app.backlink_page_metrics (
           snapshot_id, workspace_id, project_id, site_id, site_page_id,
           title, backlink_count, referring_domain_count, metric_semantics
         ) VALUES ($1,$2,$3,$4,$5,$6,0,0,'provider_index_total')`,
        [
          ids.ahrefsSnapshot,
          ids.workspace,
          ids.project,
          ids.site,
          ids.page,
          "Customer onboarding",
        ],
      ),
    ).resolves.toBeDefined();
    await expectPgConstraint(
      handle.pool.query(
        `INSERT INTO app.backlink_page_metrics (
           snapshot_id, workspace_id, project_id, site_id, site_page_id,
           title, backlink_count, referring_domain_count, metric_semantics
         ) VALUES ($1,$2,$3,$4,$5,$6,1,1,'provider_index_total')`,
        [
          ids.searchSnapshot,
          ids.workspace,
          ids.project,
          ids.site,
          ids.page,
          "Customer onboarding",
        ],
      ),
    );
    await expect(
      handle.pool.query(
        `INSERT INTO app.backlink_facts (
           id, snapshot_id, workspace_id, project_id, site_id,
           referring_domain, source_url, target_url, target_site_page_id,
           source_authority_metric_kind, source_authority_metric_value,
           link_kind, source_ref
         ) VALUES (
           $1,$2,$3,$4,$5,'source.example',
           'https://source.example/relayops-review',$6,$7,
           'domain_rating',63,'dofollow','Ahrefs fact 1'
         )`,
        [
          ids.providerFact,
          ids.ahrefsSnapshot,
          ids.workspace,
          ids.project,
          ids.site,
          CANONICAL_URL,
          ids.page,
        ],
      ),
    ).resolves.toBeDefined();
    await expectPgConstraint(
      handle.pool.query(
        `INSERT INTO app.backlink_facts (
           id, snapshot_id, workspace_id, project_id, site_id,
           referring_domain, source_url, target_url, target_site_page_id,
           source_authority_metric_kind, source_authority_metric_value,
           link_kind, source_ref
         ) VALUES (
           $1,$2,$3,$4,$5,'moz-source.example',
           'https://moz-source.example/relayops-review',$6,$7,
           'domain_rating',61,'dofollow','Moz fact invalid'
         )`,
        [
          randomUUID(),
          ids.mozSnapshot,
          ids.workspace,
          ids.project,
          ids.site,
          CANONICAL_URL,
          ids.page,
        ],
      ),
    );
    await expect(
      handle.pool.query(
        `INSERT INTO app.backlink_facts (
           id, snapshot_id, workspace_id, project_id, site_id,
           referring_domain, source_url, target_url, target_site_page_id,
           source_authority_metric_kind, source_authority_metric_value,
           link_kind, source_ref
         ) VALUES (
           $1,$2,$3,$4,$5,'moz-source.example',
           'https://moz-source.example/relayops-review',$6,$7,
           'domain_authority',61,'dofollow','Moz fact 1'
         )`,
        [
          ids.mozFact,
          ids.mozSnapshot,
          ids.workspace,
          ids.project,
          ids.site,
          CANONICAL_URL,
          ids.page,
        ],
      ),
    ).resolves.toBeDefined();
  });

  it("accepts only same-origin primary-site targets when no exact SitePage identity is supplied", async () => {
    await expect(
      handle.pool.query(
        `INSERT INTO app.backlink_facts (
           id, snapshot_id, workspace_id, project_id, site_id,
           referring_domain, source_url, target_url, target_site_page_id,
           source_authority_metric_kind, source_authority_metric_value,
           link_kind, source_ref
         ) VALUES (
           $1,$2,$3,$4,$5,'same-origin-source.example',
           'https://same-origin-source.example/relayops-review',
           'https://backlink-authority.example/resources/guide/',
           NULL,'domain_rating',55,'dofollow','Ahrefs same-origin fact'
         )`,
        [
          randomUUID(),
          ids.ahrefsSnapshot,
          ids.workspace,
          ids.project,
          ids.site,
        ],
      ),
    ).resolves.toBeDefined();

    for (const [targetUrl, sourceRef] of [
      [
        "https://foreign-target.example/customer-onboarding/",
        "Ahrefs foreign-host fact",
      ],
      [
        "https://backlink-authority.example@foreign-target.example/customer-onboarding/",
        "Ahrefs credential-host fact",
      ],
      [
        "https://backlink-authority.example:443/customer-onboarding/",
        "Ahrefs explicit-port fact",
      ],
      [
        "https://backlink-authority.example.evil/customer-onboarding/",
        "Ahrefs host-prefix fact",
      ],
    ] as const) {
      await expectPgConstraint(
        handle.pool.query(
          `INSERT INTO app.backlink_facts (
             id, snapshot_id, workspace_id, project_id, site_id,
             referring_domain, source_url, target_url, target_site_page_id,
             source_authority_metric_kind, source_authority_metric_value,
             link_kind, source_ref
           ) VALUES (
             $1,$2,$3,$4,$5,'foreign-source.example',
             'https://foreign-source.example/relayops-review',$6,
             NULL,'domain_rating',50,'dofollow',$7
           )`,
          [
            randomUUID(),
            ids.ahrefsSnapshot,
            ids.workspace,
            ids.project,
            ids.site,
            targetUrl,
            sourceRef,
          ],
        ),
      );
    }
  });

  it("keeps snapshot, fact, and page-metric evidence append-only", async () => {
    await expectPgCode(
      handle.pool.query(
        `UPDATE app.backlink_authority_snapshots
         SET row_count = row_count + 1 WHERE id = $1`,
        [ids.ahrefsSnapshot],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "DELETE FROM app.backlink_facts WHERE id = $1",
        [ids.providerFact],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        `UPDATE app.backlink_page_metrics
         SET backlink_count = 1
         WHERE snapshot_id = $1 AND site_page_id = $2`,
        [ids.ahrefsSnapshot, ids.page],
      ),
      "55000",
    );
  });
});
