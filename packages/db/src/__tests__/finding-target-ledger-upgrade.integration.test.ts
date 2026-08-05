import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import {
  canonicalize,
  contentHash,
  sha256Hex,
  type CanonicalValue,
} from "../hash.ts";
import { listMigrationFiles } from "../migrate.ts";
import {
  FindingTargetsRepository,
  type FindingTargetInsert,
} from "../repositories/finding-targets.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const SOURCE_DATABASE_URL = requireSafeTestDatabaseUrl(
  process.env["DATABASE_URL"],
);
const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);
const TARGET_DATABASE_PATTERN =
  /^signalframe_codex_finding_targets_0017_[a-f0-9]{12}$/u;
const CAPTURED_AT = "2026-07-22T08:17:00.000Z";
const ORIGIN = "https://targets.example";
const OTHER_ORIGIN = "https://other.targets.example";

interface FrozenSnapshot {
  readonly id: string;
  readonly siteId: string;
  readonly provider: "crawl" | "gsc" | "ga4";
  readonly datasetKey: string;
  readonly schemaVersion: string;
  readonly methodVersion: string;
  readonly checksum: string;
  readonly sourceWindow: { readonly start: null; readonly end: null };
  readonly availability: "available";
  readonly capturedAt: string;
}

interface Fixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly foreignProjectId: string;
  readonly siteId: string;
  readonly otherSiteId: string;
  readonly icpProfileId: string;
  readonly icpContentHash: string;
  readonly crawlSnapshot: FrozenSnapshot;
  readonly gscSnapshot: FrozenSnapshot;
  readonly currentRunId: string;
  readonly otherRunId: string;
  readonly directFindingId: string;
  readonly directWithoutSnapshotFindingId: string;
  readonly aggregateFindingId: string;
  readonly httpMismatchFindingId: string;
  readonly canonicalFindingId: string;
  readonly techLinkgraphFindingId: string;
  readonly croLandingFindingId: string;
  readonly unresolvedFindingId: string;
  readonly keywordFindingId: string;
  readonly userAgentFindingId: string;
  readonly newAssetFindingId: string;
  readonly concurrencyFindingId: string;
  readonly pageIds: Readonly<Record<string, string>>;
  readonly observationIds: Readonly<Record<string, string>>;
  readonly pageSnapshotIds: Readonly<Record<string, string>>;
  readonly urls: Readonly<Record<string, string>>;
}

function databaseIdentifier(databaseName: string): string {
  if (!TARGET_DATABASE_PATTERN.test(databaseName)) {
    throw new Error("generated database name failed the disposable-name policy");
  }
  return `"${databaseName}"`;
}

function deriveDisposableDatabase(): {
  readonly databaseName: string;
  readonly connectionString: string;
} {
  const databaseName =
    `signalframe_codex_finding_targets_0017_${randomBytes(6).toString("hex")}`;
  databaseIdentifier(databaseName);
  const url = new URL(SOURCE_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return {
    databaseName,
    connectionString: requireSafeTestDatabaseUrl(
      url.toString(),
      "generated DATABASE_URL",
    ),
  };
}

async function applyMigration(
  client: pg.Client,
  migrationFile: string,
): Promise<void> {
  await client.query(
    readFileSync(`${MIGRATIONS_DIRECTORY}/${migrationFile}`, "utf8"),
  );
}

function snapshotManifestEntry(snapshot: FrozenSnapshot) {
  return {
    snapshotId: snapshot.id,
    provider: snapshot.provider,
    datasetKey: snapshot.datasetKey,
    schemaVersion: snapshot.schemaVersion,
    methodVersion: snapshot.methodVersion,
    checksum: snapshot.checksum,
    availability: snapshot.availability,
    sourceWindow: snapshot.sourceWindow,
    capturedAt: snapshot.capturedAt,
  };
}

async function insertPageSnapshot(
  client: pg.Client,
  values: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly sitePageId: string;
    readonly dataSnapshotId: string;
    readonly normalizedUrl: string;
  },
): Promise<string> {
  const id = randomUUID();
  const extract = {
    depth: 0,
    projection: { fetchUrl: values.normalizedUrl },
    schemaVersion: "crawl.page-extract.v1",
    subjectUrl: values.normalizedUrl.replace(/\/$/u, ""),
  };
  const canonicalExtract = canonicalize(extract);
  await client.query(
    `INSERT INTO app.page_snapshots (
       id, workspace_id, project_id, site_page_id, data_snapshot_id,
       content_hash, canonical_extract, extract, captured_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      values.workspaceId,
      values.projectId,
      values.sitePageId,
      values.dataSnapshotId,
      sha256Hex(canonicalExtract),
      canonicalExtract,
      extract,
      CAPTURED_AT,
    ],
  );
  return id;
}

async function seedFixture(client: pg.Client): Promise<Fixture> {
  const actorId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const foreignProjectId = randomUUID();
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const icpProfileId = randomUUID();
  const icpProfile = { productName: "Finding target ledger fixture" };
  const icpContentHash = contentHash(icpProfile);

  await client.query(
    "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
    [workspaceId, "Finding target ledger fixture"],
  );
  await client.query(
    `INSERT INTO app.client_projects (
       id, workspace_id, client_name, project_name,
       default_delivery_locale, created_by
     ) VALUES
       ($1,$2,'Traceable customer','Finding targets','en-US',$3),
       ($4,$2,'Foreign customer','Foreign scope','en-US',$3)`,
    [projectId, workspaceId, actorId, foreignProjectId],
  );
  await client.query(
    `INSERT INTO app.sites (
       id, workspace_id, project_id, origin, host,
       market_codes, language_codes, is_primary
     ) VALUES
       ($1,$2,$3,$4,'targets.example',ARRAY['US'],ARRAY['en'],true),
       ($5,$2,$3,$6,'other.targets.example',ARRAY['US'],ARRAY['en'],false)`,
    [siteId, workspaceId, projectId, ORIGIN, otherSiteId, OTHER_ORIGIN],
  );
  await client.query(
    `INSERT INTO app.icp_profiles (
       id, workspace_id, project_id, version, status,
       profile, content_hash, created_by
     ) VALUES ($1,$2,$3,1,'complete',$4,$5,$6)`,
    [
      icpProfileId,
      workspaceId,
      projectId,
      icpProfile,
      icpContentHash,
      actorId,
    ],
  );

  const sourceIds = {
    crawl: randomUUID(),
    gsc: randomUUID(),
    otherGa4: randomUUID(),
  };
  await client.query(
    `INSERT INTO app.source_connections (
       id, workspace_id, project_id, site_id, provider,
       connection_type, state, external_ref, limitation,
       connected_at, created_by
     ) VALUES
       ($1,$2,$3,$4,'crawl','public','available',$5,'Exact Crawl source.',$6,$7),
       ($8,$2,$3,$4,'gsc','oauth','connected',$5,'GSC source.',$6,$7),
       ($9,$2,$3,$10,'ga4','oauth','connected',$11,'Other Site GA4 source.',$6,$7)`,
    [
      sourceIds.crawl,
      workspaceId,
      projectId,
      siteId,
      ORIGIN,
      CAPTURED_AT,
      actorId,
      sourceIds.gsc,
      sourceIds.otherGa4,
      otherSiteId,
      OTHER_ORIGIN,
    ],
  );

  const snapshots: Record<string, FrozenSnapshot> = {
    crawl: {
      id: randomUUID(),
      siteId,
      provider: "crawl",
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: "0.2.0",
      methodVersion: "crawl.site_graph.v2",
      checksum: "a".repeat(64),
      sourceWindow: { start: null, end: null },
      availability: "available",
      capturedAt: CAPTURED_AT,
    },
    gsc: {
      id: randomUUID(),
      siteId,
      provider: "gsc",
      datasetKey: "gsc.page_query_daily.v1",
      schemaVersion: "0.2.0",
      methodVersion: "gsc.search_analytics.v1",
      checksum: "b".repeat(64),
      sourceWindow: { start: null, end: null },
      availability: "available",
      capturedAt: CAPTURED_AT,
    },
    extraGsc: {
      id: randomUUID(),
      siteId,
      provider: "gsc",
      datasetKey: "gsc.page_query_daily.v1",
      schemaVersion: "0.2.0",
      methodVersion: "gsc.search_analytics.v1",
      checksum: "c".repeat(64),
      sourceWindow: { start: null, end: null },
      availability: "available",
      capturedAt: CAPTURED_AT,
    },
    extraCrawl: {
      id: randomUUID(),
      siteId,
      provider: "crawl",
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: "0.2.0",
      methodVersion: "crawl.site_graph.v2",
      checksum: "d".repeat(64),
      sourceWindow: { start: null, end: null },
      availability: "available",
      capturedAt: CAPTURED_AT,
    },
    otherGa4: {
      id: randomUUID(),
      siteId: otherSiteId,
      provider: "ga4",
      datasetKey: "ga4.organic_landing_daily.v1",
      schemaVersion: "0.2.0",
      methodVersion: "ga4.organic_landing.v1",
      checksum: "e".repeat(64),
      sourceWindow: { start: null, end: null },
      availability: "available",
      capturedAt: CAPTURED_AT,
    },
  };
  const collectionRunIds: Record<string, string> = {};
  for (const [key, snapshot] of Object.entries(snapshots)) {
    const runId = randomUUID();
    collectionRunIds[key] = runId;
    const sourceId =
      key === "otherGa4"
        ? sourceIds.otherGa4
        : snapshot.provider === "crawl"
          ? sourceIds.crawl
          : sourceIds.gsc;
    await client.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status,
         initiated_by, started_at
       ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
      [runId, workspaceId, projectId, actorId, CAPTURED_AT],
    );
    await client.query(
      `INSERT INTO app.collection_runs (
         id, workspace_id, project_id, site_id, source_connection_id,
         provider, operation, method_version, parameters_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        runId,
        workspaceId,
        projectId,
        snapshot.siteId,
        sourceId,
        snapshot.provider,
        snapshot.provider === "crawl"
          ? "site_graph"
          : snapshot.provider === "gsc"
            ? "search_analytics"
            : "organic_landing",
        snapshot.methodVersion,
        contentHash({ key, runId }),
      ],
    );
    await client.query(
      `INSERT INTO app.data_snapshots (
         id, workspace_id, project_id, site_id, collection_run_id,
         source_connection_id, provider, dataset_key, schema_version,
         method_version, captured_at, source_window, availability,
         limitation, row_count, checksum
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'available',$13,10,$14)`,
      [
        snapshot.id,
        workspaceId,
        projectId,
        snapshot.siteId,
        runId,
        sourceId,
        snapshot.provider,
        snapshot.datasetKey,
        snapshot.schemaVersion,
        snapshot.methodVersion,
        snapshot.capturedAt,
        snapshot.sourceWindow,
        `${key} immutable fixture snapshot.`,
        snapshot.checksum,
      ],
    );
  }

  const urls = {
    gscWithSnapshot: `${ORIGIN}/gsc-with-snapshot/`,
    gscWithoutSnapshot: `${ORIGIN}/gsc-without-snapshot/`,
    crawlOne: `${ORIGIN}/broken-one/`,
    crawlTwo: `${ORIGIN}/broken-two/`,
    crawlMismatch: `${ORIGIN}/status-mismatch/`,
    ambiguous: `${ORIGIN}/ambiguous`,
    ambiguousSlash: `${ORIGIN}/ambiguous/`,
    unfrozen: `${ORIGIN}/unfrozen/`,
    otherSite: `${OTHER_ORIGIN}/foreign/`,
  };
  const pageIds: Record<string, string> = {};
  for (const [key, normalizedUrl] of Object.entries(urls)) {
    const pageId = randomUUID();
    pageIds[key] = pageId;
    await client.query(
      `INSERT INTO app.site_pages (
         id, workspace_id, project_id, site_id,
         normalized_url, normalized_url_hash
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        pageId,
        workspaceId,
        projectId,
        key === "otherSite" ? otherSiteId : siteId,
        normalizedUrl,
        normalizedUrlHash(normalizedUrl),
      ],
    );
  }

  const pageSnapshotIds: Record<string, string> = {};
  for (const key of [
    "gscWithSnapshot",
    "crawlOne",
    "crawlTwo",
    "crawlMismatch",
  ] as const) {
    pageSnapshotIds[key] = await insertPageSnapshot(client, {
      workspaceId,
      projectId,
      sitePageId: pageIds[key]!,
      dataSnapshotId: snapshots.crawl!.id,
      normalizedUrl: urls[key],
    });
  }
  pageSnapshotIds.nonFrozen = await insertPageSnapshot(client, {
    workspaceId,
    projectId,
    sitePageId: pageIds.gscWithSnapshot!,
    dataSnapshotId: snapshots.extraCrawl!.id,
    normalizedUrl: urls.gscWithSnapshot,
  });

  const observationIds: Record<string, string> = {};
  async function insertObservation(values: {
    readonly key: string;
    readonly snapshot: FrozenSnapshot;
    readonly sitePageId: string | null;
    readonly subjectRef: string;
    readonly fetchUrl?: string;
    readonly finalStatus?: number;
  }): Promise<void> {
    const id = randomUUID();
    observationIds[values.key] = id;
    const isCrawl = values.snapshot.provider === "crawl";
    await client.query(
      `INSERT INTO app.normalized_observations (
         id, workspace_id, project_id, snapshot_id, site_page_id,
         provider, metric_key, subject_type, subject_ref, observed_at,
         availability, value_json, origin, grade, support, limitation
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'url',$8,$9,'available',$10,$11,$12,'supports',$13)`,
      [
        id,
        workspaceId,
        projectId,
        values.snapshot.id,
        values.sitePageId,
        values.snapshot.provider,
        isCrawl
          ? "crawl.page.v1"
          : values.snapshot.provider === "gsc"
            ? "gsc.page.v1"
            : "ga4.landing.v1",
        values.subjectRef,
        CAPTURED_AT,
        isCrawl
          ? {
              fetchUrl: values.fetchUrl,
              finalStatus: values.finalStatus ?? 404,
            }
          : { clicks: 10, impressions: 100 },
        isCrawl ? "direct_public" : "first_party",
        isCrawl ? "B" : "A",
        `${values.key} immutable observation.`,
      ],
    );
  }

  await insertObservation({
    key: "gscWithSnapshot",
    snapshot: snapshots.gsc!,
    sitePageId: pageIds.gscWithSnapshot!,
    subjectRef: urls.gscWithSnapshot.replace(/\/$/u, ""),
  });
  await insertObservation({
    key: "gscDuplicate",
    snapshot: snapshots.gsc!,
    sitePageId: pageIds.gscWithSnapshot!,
    subjectRef: urls.gscWithSnapshot.replace(/\/$/u, ""),
  });
  await insertObservation({
    key: "gscWithoutSnapshot",
    snapshot: snapshots.gsc!,
    sitePageId: pageIds.gscWithoutSnapshot!,
    subjectRef: urls.gscWithoutSnapshot.replace(/\/$/u, ""),
  });
  await insertObservation({
    key: "crawlOne",
    snapshot: snapshots.crawl!,
    sitePageId: pageIds.crawlOne!,
    subjectRef: urls.crawlOne.replace(/\/$/u, ""),
    fetchUrl: urls.crawlOne,
  });
  await insertObservation({
    key: "crawlTwo",
    snapshot: snapshots.crawl!,
    sitePageId: pageIds.crawlTwo!,
    subjectRef: urls.crawlTwo.replace(/\/$/u, ""),
    fetchUrl: urls.crawlTwo,
  });
  await insertObservation({
    key: "crawlMismatch",
    snapshot: snapshots.crawl!,
    sitePageId: pageIds.crawlMismatch!,
    subjectRef: urls.crawlMismatch.replace(/\/$/u, ""),
    fetchUrl: urls.crawlMismatch,
    finalStatus: 500,
  });
  await insertObservation({
    key: "ambiguous",
    snapshot: snapshots.gsc!,
    sitePageId: null,
    subjectRef: urls.ambiguous,
  });
  await insertObservation({
    key: "unfrozen",
    snapshot: snapshots.extraGsc!,
    sitePageId: pageIds.unfrozen!,
    subjectRef: urls.unfrozen.replace(/\/$/u, ""),
  });
  await insertObservation({
    key: "otherSite",
    snapshot: snapshots.otherGa4!,
    sitePageId: pageIds.otherSite!,
    subjectRef: urls.otherSite.replace(/\/$/u, ""),
  });

  const currentRunId = randomUUID();
  const otherRunId = randomUUID();
  const manifest = {
    projectId,
    siteId,
    ruleSetVersion: "mvp.rules.0.2.1",
    promptSetVersion: "mvp.prompts.0.2.0",
    deliveryLocale: "en-US",
    icp: {
      id: icpProfileId,
      version: 1,
      contentHash: icpContentHash,
    },
    snapshots: [
      snapshotManifestEntry(snapshots.crawl!),
      snapshotManifestEntry(snapshots.gsc!),
    ],
  };
  for (const runId of [currentRunId, otherRunId]) {
    await client.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status,
         initiated_by, started_at
       ) VALUES ($1,$2,$3,'diagnostic','running',$4,$5)`,
      [runId, workspaceId, projectId, actorId, CAPTURED_AT],
    );
    await client.query(
      `INSERT INTO app.diagnostic_runs (
         id, workspace_id, project_id, site_id, icp_profile_id,
         icp_profile_version, rule_set_version, prompt_set_version,
         output_locale, input_manifest, input_hash
       ) VALUES ($1,$2,$3,$4,$5,1,'mvp.rules.0.2.1','mvp.prompts.0.2.0','en-US',$6,$7)`,
      [
        runId,
        workspaceId,
        projectId,
        siteId,
        icpProfileId,
        manifest,
        contentHash(manifest as CanonicalValue),
      ],
    );
  }

  const directFindingId = randomUUID();
  const directWithoutSnapshotFindingId = randomUUID();
  const aggregateFindingId = randomUUID();
  const httpMismatchFindingId = randomUUID();
  const canonicalFindingId = randomUUID();
  const techLinkgraphFindingId = randomUUID();
  const croLandingFindingId = randomUUID();
  const unresolvedFindingId = randomUUID();
  const keywordFindingId = randomUUID();
  const userAgentFindingId = randomUUID();
  const newAssetFindingId = randomUUID();
  const concurrencyFindingId = randomUUID();
  const findingRows = [
    [directFindingId, "SEARCH-CTR-004", 1, "search_performance"],
    [
      directWithoutSnapshotFindingId,
      "SEARCH-CTR-004",
      1,
      "search_performance",
    ],
    [aggregateFindingId, "TECH-HTTP-001", 2, "technical_seo"],
    [httpMismatchFindingId, "TECH-HTTP-001", 2, "technical_seo"],
    [canonicalFindingId, "TECH-CANONICAL-002", 2, "technical_seo"],
    [techLinkgraphFindingId, "TECH-LINKGRAPH-005", 2, "technical_seo"],
    [croLandingFindingId, "CRO-LANDING-003", 1, "conversion_journey"],
    [unresolvedFindingId, "SEARCH-CTR-004", 1, "search_performance"],
    [keywordFindingId, "CONTENT-GAP-011", 1, "content_intent"],
    [userAgentFindingId, "GEO-CRAWLER-002", 1, "geo_ai"],
    [newAssetFindingId, "CONTENT-COVERAGE-001", 1, "content_intent"],
    [concurrencyFindingId, "CONTENT-GAP-011", 1, "content_intent"],
  ] as const;
  for (const [id, ruleId, ruleVersion, domain] of findingRows) {
    await client.query(
      `INSERT INTO app.findings (
         id, workspace_id, project_id, finding_key, rule_id, rule_version,
         rule_family, intent, domain, title_key, subject_refs,
         summary, summary_locale, severity, confidence,
         first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'fixture','investigate',$7,'fixture.title',$8,
         'Immutable fixture Finding.','en-US','high','high',$9,$9,$10,$10)`,
      [
        id,
        workspaceId,
        projectId,
        sha256Hex(id),
        ruleId,
        ruleVersion,
        domain,
        JSON.stringify([id]),
        currentRunId,
        CAPTURED_AT,
      ],
    );
  }

  return {
    actorId,
    workspaceId,
    projectId,
    foreignProjectId,
    siteId,
    otherSiteId,
    icpProfileId,
    icpContentHash,
    crawlSnapshot: snapshots.crawl!,
    gscSnapshot: snapshots.gsc!,
    currentRunId,
    otherRunId,
    directFindingId,
    directWithoutSnapshotFindingId,
    aggregateFindingId,
    httpMismatchFindingId,
    canonicalFindingId,
    techLinkgraphFindingId,
    croLandingFindingId,
    unresolvedFindingId,
    keywordFindingId,
    userAgentFindingId,
    newAssetFindingId,
    concurrencyFindingId,
    pageIds,
    observationIds,
    pageSnapshotIds,
    urls,
  };
}

function target(
  fixture: Fixture,
  overrides: Partial<FindingTargetInsert> = {},
): FindingTargetInsert {
  return {
    siteId: fixture.siteId,
    findingId: fixture.directFindingId,
    diagnosticRunId: fixture.currentRunId,
    relation: "direct_url",
    targetKind: "url",
    targetRef: fixture.urls.gscWithSnapshot!,
    resolutionState: "resolved",
    basisKind: "observation_site_page",
    sitePageId: fixture.pageIds.gscWithSnapshot!,
    pageSnapshotId: fixture.pageSnapshotIds.gscWithSnapshot!,
    sourceObservationId: fixture.observationIds.gscWithSnapshot!,
    memberRef: fixture.urls.gscWithSnapshot!.replace(/\/$/u, ""),
    limitation: null,
    ...overrides,
  };
}

async function insertRawTarget(
  client: pg.Client,
  scope: { readonly workspaceId: string; readonly projectId: string },
  value: FindingTargetInsert,
): Promise<void> {
  await client.query(
    `INSERT INTO app.finding_targets (
       workspace_id, project_id, site_id, finding_id, diagnostic_run_id,
       relation, target_kind, target_ref, resolution_state, basis_kind,
       site_page_id, page_snapshot_id, source_observation_id,
       member_ref, limitation, relation_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      scope.workspaceId,
      scope.projectId,
      value.siteId,
      value.findingId,
      value.diagnosticRunId,
      value.relation,
      value.targetKind,
      value.targetRef,
      value.resolutionState,
      value.basisKind,
      value.sitePageId ?? null,
      value.pageSnapshotId ?? null,
      value.sourceObservationId ?? null,
      value.memberRef ?? null,
      value.limitation ?? null,
      "0".repeat(64),
    ],
  );
}

async function expectCheckViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: "23514" });
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("0017 Finding target ledger upgrade", () => {
  it(
    "persists only explicit frozen per-run target relations and replays safely",
    async () => {
      const disposable = deriveDisposableDatabase();
      const admin = new pg.Client({ connectionString: SOURCE_DATABASE_URL });
      let targetClient: pg.Client | null = null;
      let handle: DbHandle | null = null;
      await admin.connect();
      try {
        await admin.query(
          `CREATE DATABASE ${databaseIdentifier(disposable.databaseName)}`,
        );
        targetClient = new pg.Client({
          connectionString: disposable.connectionString,
        });
        await targetClient.connect();
        for (const migrationFile of listMigrationFiles().filter(
          (file) => file <= "0016_observation_site_page_lineage.sql",
        )) {
          await applyMigration(targetClient, migrationFile);
        }
        const fixture = await seedFixture(targetClient);
        await applyMigration(targetClient, "0017_finding_target_ledger.sql");

        handle = createDbHandle(disposable.connectionString);
        const repository = new FindingTargetsRepository(handle.db);
        const scope = {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
        };

        const validDirect = target(fixture);
        await expect(
          repository.insertMany(scope, [
            validDirect,
            target(fixture, {
              findingId: fixture.directWithoutSnapshotFindingId,
              targetRef: fixture.urls.gscWithoutSnapshot!,
              sitePageId: fixture.pageIds.gscWithoutSnapshot!,
              pageSnapshotId: null,
              sourceObservationId:
                fixture.observationIds.gscWithoutSnapshot!,
              memberRef: fixture.urls.gscWithoutSnapshot!.replace(/\/$/u, ""),
            }),
          ]),
        ).resolves.toBe(2);

        const aggregateRows: FindingTargetInsert[] = [
          ["crawlOne", "crawlOne"],
          ["crawlTwo", "crawlTwo"],
        ].map(([pageKey, observationKey]) =>
          target(fixture, {
            findingId: fixture.aggregateFindingId,
            relation: "affected_by_http_status",
            targetKind: "http_status",
            targetRef: "404",
            basisKind: "crawl_exact_fetch",
            sitePageId: fixture.pageIds[pageKey!]!,
            pageSnapshotId: fixture.pageSnapshotIds[pageKey!]!,
            sourceObservationId: fixture.observationIds[observationKey!]!,
            memberRef: fixture.urls[pageKey!]!,
          }),
        );
        await expect(repository.insertMany(scope, aggregateRows)).resolves.toBe(
          2,
        );

        const unresolved = target(fixture, {
          findingId: fixture.unresolvedFindingId,
          targetRef: fixture.urls.ambiguous!,
          resolutionState: "unresolved",
          basisKind: "unresolved_observation",
          sitePageId: null,
          pageSnapshotId: null,
          sourceObservationId: fixture.observationIds.ambiguous!,
          memberRef: fixture.urls.ambiguous!,
          limitation: "Two exact slash variants exist; no SitePage was guessed.",
        });
        const definitions: FindingTargetInsert[] = [
          {
            ...target(fixture),
            findingId: fixture.keywordFindingId,
            relation: "affected_by_keyword_cluster",
            targetKind: "keyword_cluster",
            targetRef: "customer-onboarding",
            resolutionState: "definition_only",
            basisKind: "target_definition",
            sitePageId: null,
            pageSnapshotId: null,
            sourceObservationId: null,
            memberRef: null,
            limitation: "New asset target; no page exists yet.",
          },
          {
            ...target(fixture),
            findingId: fixture.userAgentFindingId,
            relation: "affected_by_user_agent",
            targetKind: "user_agent",
            targetRef: "ClaudeBot",
            resolutionState: "definition_only",
            basisKind: "target_definition",
            sitePageId: null,
            pageSnapshotId: null,
            sourceObservationId: null,
            memberRef: null,
            limitation: null,
          },
          {
            ...target(fixture),
            findingId: fixture.newAssetFindingId,
            relation: "affected_by_page_set",
            targetKind: "page_set",
            targetRef: "new_asset:implementation-guide",
            resolutionState: "definition_only",
            basisKind: "target_definition",
            sitePageId: null,
            pageSnapshotId: null,
            sourceObservationId: null,
            memberRef: null,
            limitation: "Planned asset has no durable SitePage.",
          },
        ];
        await expect(
          repository.insertMany(scope, [unresolved, ...definitions]),
        ).resolves.toBe(4);

        await expect(repository.insertMany(scope, [validDirect])).resolves.toBe(
          0,
        );
        const directRows = await repository.listForSitePage(
          scope,
          fixture.currentRunId,
          fixture.pageIds.gscWithSnapshot!,
        );
        expect(directRows).toHaveLength(1);
        expect(directRows[0]).toMatchObject({
          target_ref: fixture.urls.gscWithSnapshot,
          member_ref: fixture.urls.gscWithSnapshot!.replace(/\/$/u, ""),
          resolution_state: "resolved",
        });
        expect(directRows[0]!.relation_key).toMatch(/^[a-f0-9]{64}$/u);
        expect(directRows[0]!.relation_key).not.toBe("0".repeat(64));

        const aggregatePersisted = await repository.listForFindings(
          scope,
          fixture.currentRunId,
          [fixture.aggregateFindingId],
        );
        expect(aggregatePersisted).toHaveLength(2);
        expect(new Set(aggregatePersisted.map((row) => row.site_page_id))).toEqual(
          new Set([
            fixture.pageIds.crawlOne,
            fixture.pageIds.crawlTwo,
          ]),
        );
        expect(new Set(aggregatePersisted.map((row) => row.relation_key)).size).toBe(
          2,
        );
        expect(
          await repository.listForSitePage(
            scope,
            fixture.currentRunId,
            fixture.pageIds.ambiguous!,
          ),
        ).toEqual([]);

        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              limitation: "Resolved rows cannot fork identity by limitation.",
            }),
          ),
        );
        await expectPgCode(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              sourceObservationId: fixture.observationIds.gscDuplicate!,
            }),
          ),
          "23505",
        );
        await expectPgCode(
          insertRawTarget(
            targetClient,
            scope,
            {
              ...definitions[0]!,
              limitation: "A second definition row is forbidden.",
            },
          ),
          "23505",
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              findingId: fixture.keywordFindingId,
              relation: "affected_by_page_set",
              targetKind: "page_set",
              targetRef: "wrong-rule-root",
              resolutionState: "definition_only",
              basisKind: "target_definition",
              sitePageId: null,
              pageSnapshotId: null,
              sourceObservationId: null,
              memberRef: null,
              limitation: null,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              findingId: fixture.newAssetFindingId,
              relation: "affected_by_page_set",
              targetKind: "page_set",
              targetRef: "new_asset:implementation-guide",
              basisKind: "crawl_exact_fetch",
              sitePageId: fixture.pageIds.crawlOne!,
              pageSnapshotId: fixture.pageSnapshotIds.crawlOne!,
              sourceObservationId: fixture.observationIds.crawlOne!,
              memberRef: fixture.urls.crawlOne!,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              findingId: fixture.techLinkgraphFindingId,
              relation: "affected_by_page_set",
              targetKind: "page_set",
              targetRef: "low_internal_inlinks",
              resolutionState: "definition_only",
              basisKind: "target_definition",
              sitePageId: null,
              pageSnapshotId: null,
              sourceObservationId: null,
              memberRef: null,
              limitation: null,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              findingId: fixture.croLandingFindingId,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              findingId: fixture.httpMismatchFindingId,
              relation: "affected_by_http_status",
              targetKind: "http_status",
              targetRef: "404",
              basisKind: "crawl_exact_fetch",
              sitePageId: fixture.pageIds.crawlMismatch!,
              pageSnapshotId: fixture.pageSnapshotIds.crawlMismatch!,
              sourceObservationId: fixture.observationIds.crawlMismatch!,
              memberRef: fixture.urls.crawlMismatch!,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              findingId: fixture.canonicalFindingId,
              relation: "affected_by_canonical_issue",
              targetKind: "canonical_issue",
              targetRef: "invented_subtype",
              basisKind: "crawl_exact_fetch",
              sitePageId: fixture.pageIds.crawlMismatch!,
              pageSnapshotId: fixture.pageSnapshotIds.crawlMismatch!,
              sourceObservationId: fixture.observationIds.crawlMismatch!,
              memberRef: fixture.urls.crawlMismatch!,
            }),
          ),
        );

        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            { ...scope, projectId: fixture.foreignProjectId },
            target(fixture),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, { diagnosticRunId: fixture.otherRunId }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              siteId: fixture.otherSiteId,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              sitePageId: fixture.pageIds.otherSite!,
              targetRef: fixture.urls.otherSite!,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              sitePageId: fixture.pageIds.otherSite!,
              targetRef: fixture.urls.otherSite!,
              sourceObservationId: fixture.observationIds.otherSite!,
              memberRef: fixture.urls.otherSite!.replace(/\/$/u, ""),
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              pageSnapshotId: fixture.pageSnapshotIds.crawlOne!,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              pageSnapshotId: fixture.pageSnapshotIds.nonFrozen!,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              sourceObservationId: fixture.observationIds.unfrozen!,
              sitePageId: fixture.pageIds.unfrozen!,
              targetRef: fixture.urls.unfrozen!,
              memberRef: fixture.urls.unfrozen!.replace(/\/$/u, ""),
              pageSnapshotId: null,
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, { memberRef: `${ORIGIN}/wrong-member` }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, { targetRef: `${ORIGIN}/wrong-target/` }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            {
              ...aggregateRows[0]!,
              memberRef: `${ORIGIN}/wrong-fetch/`,
            },
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              relation: "affected_by_http_status",
              targetKind: "http_status",
              targetRef: "404",
            }),
          ),
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              resolutionState: "definition_only",
              basisKind: "target_definition",
              sitePageId: null,
              pageSnapshotId: null,
              sourceObservationId: null,
              memberRef: null,
            }),
          ),
        );

        const firstRoot = target(fixture, {
          findingId: fixture.concurrencyFindingId,
          relation: "affected_by_keyword_cluster",
          targetKind: "keyword_cluster",
          targetRef: "serialized-root-a",
          resolutionState: "definition_only",
          basisKind: "target_definition",
          sitePageId: null,
          pageSnapshotId: null,
          sourceObservationId: null,
          memberRef: null,
          limitation: null,
        });
        const splitRoot = {
          ...firstRoot,
          targetRef: "serialized-root-b",
        };
        const concurrentClient = new pg.Client({
          connectionString: disposable.connectionString,
        });
        await concurrentClient.connect();
        try {
          await targetClient.query("BEGIN");
          await insertRawTarget(targetClient, scope, firstRoot);
          let secondSettled = false;
          const secondOutcome = insertRawTarget(
            concurrentClient,
            scope,
            splitRoot,
          ).then(
            () => {
              secondSettled = true;
              return { ok: true as const, error: null };
            },
            (error: unknown) => {
              secondSettled = true;
              return { ok: false as const, error };
            },
          );
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 100);
          });
          expect(secondSettled).toBe(false);
          await targetClient.query("COMMIT");
          const outcome = await secondOutcome;
          expect(outcome.ok).toBe(false);
          expect(outcome.error).toMatchObject({ code: "23514" });
        } finally {
          await targetClient.query("ROLLBACK");
          await concurrentClient.end();
        }

        const targetId = directRows[0]!.id;
        await expectPgCode(
          targetClient.query(
            "UPDATE app.finding_targets SET limitation = 'changed' WHERE id = $1",
            [targetId],
          ),
          "55000",
        );
        await expectPgCode(
          targetClient.query("DELETE FROM app.finding_targets WHERE id = $1", [
            targetId,
          ]),
          "55000",
        );

        await targetClient.query(
          `UPDATE app.findings
           SET last_seen_run_id = $1, last_seen_at = $2
           WHERE id = $3`,
          [fixture.otherRunId, CAPTURED_AT, fixture.directFindingId],
        );
        await expect(repository.insertMany(scope, [validDirect])).resolves.toBe(
          0,
        );
        await expectCheckViolation(
          insertRawTarget(
            targetClient,
            scope,
            target(fixture, {
              sourceObservationId: fixture.observationIds.gscDuplicate!,
            }),
          ),
        );

        await handle.end();
        handle = null;
        const beforeReplay = await targetClient.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM app.finding_targets",
        );
        await applyMigration(targetClient, "0017_finding_target_ledger.sql");
        const afterReplay = await targetClient.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM app.finding_targets",
        );
        expect(afterReplay.rows[0]?.count).toBe(beforeReplay.rows[0]?.count);
        const version = await targetClient.query<{ migration_version: string }>(
          "SELECT migration_version FROM app.schema_migration_version",
        );
        expect(version.rows).toEqual([
          { migration_version: "0017_finding_target_ledger" },
        ]);
        await expectPgCode(
          targetClient.query(
            "UPDATE app.finding_targets SET limitation = 'replay changed' WHERE id = $1",
            [targetId],
          ),
          "55000",
        );

        for (const migrationFile of listMigrationFiles().filter(
          (file) =>
            file > "0017_finding_target_ledger.sql" &&
            file <= "0042_contextual_indexability_opportunities.sql",
        )) {
          await applyMigration(targetClient, migrationFile);
        }

        const contextualRunId = randomUUID();
        const contextualFindingId = randomUUID();
        const contextualManifest = {
          projectId: fixture.projectId,
          siteId: fixture.siteId,
          ruleSetVersion: "mvp.rules.0.2.4",
          promptSetVersion: "mvp.prompts.0.2.0",
          deliveryLocale: "en-US",
          icp: {
            id: fixture.icpProfileId,
            version: 1,
            contentHash: fixture.icpContentHash,
          },
          snapshots: [
            snapshotManifestEntry(fixture.crawlSnapshot),
            snapshotManifestEntry(fixture.gscSnapshot),
          ],
          governance: {
            projectionVersion: "growth-governance.1.0.0",
            keywordClusters: [],
            competitors: [],
          },
          contextProjection: {
            schemaVersion: "context-projection.v1",
            compilerVersion: "context-projection.compiler.1.0.0",
            profileGeneration: "legacy-icp.v1",
            productRouting: {
              sourceKind: "legacy_icp",
              productName: "Finding target ledger fixture",
              oneLiner: "A disposable legacy ICP fixture.",
              productType: "",
              businessModels: [],
              primaryMarket: null,
              primaryAudience: null,
            },
            siteLanguage: {
              sourceKind: "site",
              state: "declared_non_empty",
              languageCodes: ["en"],
            },
            primaryConversion: {
              state: "missing",
              sourceKind: "legacy_icp",
            },
            priorityUrlSubjects: {
              state: "missing",
              sourceKind: "legacy_icp",
            },
            declaredExecutionConstraints: {
              state: "missing",
              sourceKind: "legacy_icp",
            },
          },
        } as const satisfies CanonicalValue;
        await targetClient.query(
          `INSERT INTO app.async_runs (
             id, workspace_id, project_id, kind, status,
             initiated_by, started_at
           ) VALUES ($1,$2,$3,'diagnostic','running',$4,$5)`,
          [
            contextualRunId,
            fixture.workspaceId,
            fixture.projectId,
            fixture.actorId,
            CAPTURED_AT,
          ],
        );
        await targetClient.query(
          `INSERT INTO app.diagnostic_runs (
             id, workspace_id, project_id, site_id, icp_profile_id,
             icp_profile_version, rule_set_version, prompt_set_version,
             output_locale, input_manifest, input_hash
           ) VALUES (
             $1,$2,$3,$4,$5,1,'mvp.rules.0.2.4','mvp.prompts.0.2.0',
             'en-US',$6,$7
           )`,
          [
            contextualRunId,
            fixture.workspaceId,
            fixture.projectId,
            fixture.siteId,
            fixture.icpProfileId,
            contextualManifest,
            contentHash(contextualManifest),
          ],
        );
        await targetClient.query(
          `INSERT INTO app.diagnostic_run_rules (
             diagnostic_run_id, rule_id, rule_version, domain,
             status, reason, metrics, duration_ms
           ) VALUES (
             $1,'TECH-INDEXABILITY-006',1,'technical_seo',
             'candidate',NULL,'{}'::jsonb,1
           )`,
          [contextualRunId],
        );
        await targetClient.query(
          `INSERT INTO app.findings (
             id, workspace_id, project_id, finding_key, rule_id, rule_version,
             rule_family, intent, domain, title_key, subject_refs,
             summary, summary_locale, severity, confidence,
             first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
           ) VALUES (
             $1,$2,$3,$4,'TECH-INDEXABILITY-006',1,
             'indexability','investigate','technical_seo','fixture.title',$5,
             'Contextual indexability fixture.','en-US','high','high',
             $6,$6,$7,$7
           )`,
          [
            contextualFindingId,
            fixture.workspaceId,
            fixture.projectId,
            sha256Hex(contextualFindingId),
            JSON.stringify([fixture.urls.crawlOne]),
            contextualRunId,
            CAPTURED_AT,
          ],
        );

        const contextualTarget: FindingTargetInsert = {
          siteId: fixture.siteId,
          findingId: contextualFindingId,
          diagnosticRunId: contextualRunId,
          relation: "direct_url",
          targetKind: "url",
          targetRef: fixture.urls.crawlOne!,
          resolutionState: "resolved",
          basisKind: "crawl_exact_fetch",
          sitePageId: fixture.pageIds.crawlOne!,
          pageSnapshotId: fixture.pageSnapshotIds.crawlOne!,
          sourceObservationId: fixture.observationIds.crawlOne!,
          memberRef: fixture.urls.crawlOne!,
          limitation: null,
        };
        await expectCheckViolation(
          insertRawTarget(targetClient, scope, {
            ...contextualTarget,
            relation: "affected_by_page_set",
            targetKind: "page_set",
            targetRef: "indexability-pages",
          }),
        );
        await expectCheckViolation(
          insertRawTarget(targetClient, scope, {
            ...contextualTarget,
            resolutionState: "unresolved",
            basisKind: "unresolved_observation",
            sitePageId: null,
            pageSnapshotId: null,
            limitation: "An exact-crawl rule cannot emit unresolved members.",
          }),
        );
        await expectCheckViolation(
          insertRawTarget(targetClient, scope, {
            ...contextualTarget,
            targetRef: fixture.urls.gscWithSnapshot!,
            sitePageId: fixture.pageIds.gscWithSnapshot!,
            pageSnapshotId: fixture.pageSnapshotIds.gscWithSnapshot!,
            sourceObservationId: fixture.observationIds.gscWithSnapshot!,
            memberRef: fixture.urls.gscWithSnapshot!.replace(/\/$/u, ""),
          }),
        );
        await expect(
          insertRawTarget(targetClient, scope, contextualTarget),
        ).resolves.toBeUndefined();

        const contextualVersion = await targetClient.query<{
          migration_version: string;
        }>("SELECT migration_version FROM app.schema_migration_version");
        expect(contextualVersion.rows).toEqual([
          {
            migration_version:
              "0042_contextual_indexability_opportunities",
          },
        ]);
      } finally {
        await handle?.end();
        await targetClient?.end();
        await admin.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [disposable.databaseName],
        );
        await admin.query(
          `DROP DATABASE IF EXISTS ${databaseIdentifier(disposable.databaseName)}`,
        );
        await admin.end();
      }
    },
    120_000,
  );
});
