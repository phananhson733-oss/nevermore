import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["OPENAI_API_KEY"] ??= "sk-test";
process.env["OPENAI_MODEL"] ??= "gpt-4o-mini";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  ActionsRepository,
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
  FindingTargetsRepository,
  IcpProfilesRepository,
  ImportPreviewsRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  TelemetryRepository,
  contentHash,
  type CanonicalValue,
  type ObservationInsert,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import {
  FINDING_REGISTRY,
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
  findingKey,
  type RuleId,
} from "@sf/engine";
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
  LocalFsBlobStore,
  METRIC_CRAWL_PAGE,
  METRIC_CRAWL_ROBOTS,
  METRIC_CSV_KEYWORD_GAP,
  METRIC_GA4_LANDING,
  METRIC_GSC_PAGE,
  subjectUrlOf,
  type CrawlLinkProjection,
  type CrawlPageProjection,
  type CrawlRobotsProjection,
  type CsvKeywordProjection,
  type Ga4LandingProjection,
  type GscPageProjection,
} from "@sf/sources";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { CRAWL_PAGE_EXTRACT_SCHEMA_VERSION } from "../../collection/materialize-crawl-pages.ts";
import { runDiagnostic } from "../run-diagnostic.ts";

/**
 * AC-026 / AC-028 — the diagnostic runner's cross-run resolution + identity
 * (spec §8.6, §9.2), exercised end-to-end against a real local Postgres:
 *  - a `completed` run (every rule ran) auto-resolves stale findings;
 *  - a `partial` run (a skipped dataset rule) resolves NOTHING;
 *  - a re-hit of a resolved finding flips it to `regressed`;
 *  - a cross-run re-hit preserves the human review priority/status and only
 *    MERGES new evidence into an existing non-dismissed Action.
 *
 * The runner hard-codes `ALL_RULES`, so a `completed` run is produced from a
 * fully-clean, full-coverage fixture where all 11 rules pass; a `partial` run is
 * produced by a crawl-only manifest (search/GA4/CSV rules are `skipped`).
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const OBSERVED_AT = new Date().toISOString();

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

afterEach(() => {
  vi.restoreAllMocks();
});

interface Seed {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly origin: string;
  readonly actor: string;
}

type SourceProvider = "crawl" | "gsc" | "ga4" | "csv" | "dataforseo";

interface SeededSnapshot {
  readonly id: string;
  readonly collectionRunId: string;
  readonly provider: SourceProvider;
  readonly availability: "available";
  readonly capturedAt: string;
  readonly datasetKey: string;
  readonly schemaVersion: string;
  readonly methodVersion: string;
  readonly checksum: string;
  readonly sourceWindow: Record<string, unknown>;
}

interface SeedSnapshotOptions {
  readonly analyticsLineage?: "subject" | "slash" | "ambiguous";
}

describeDb("diagnostic runner cross-run resolution (spec §8.6, §9.2)", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
    ctx = {
      db: handle.db,
      boss: {} as unknown as PgBoss, // the diagnostic runner never enqueues
      blobStore: new LocalFsBlobStore(
        mkdtempSync(path.join(os.tmpdir(), "sf-diagnostic-test-")),
      ),
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test-client", clientSecret: "test-secret" },
      openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
      findingSummariesEnabled: true,
      logger: testLogger,
    };
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("AC-026: a completed (all-rules-ran) run auto-resolves a stale finding", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, cleanProfile(seed.origin));
    const crawlSnapshot = await seedSnapshot(
      handle,
      seed,
      cleanObservations(seed.origin).filter(
        (observation) => observation.metricKey !== METRIC_GA4_LANDING,
      ),
    );
    const gscSnapshot = await seedSnapshot(handle, seed, [], "gsc");
    const ga4Snapshot = await seedSnapshot(
      handle,
      seed,
      cleanObservations(seed.origin).filter(
        (observation) => observation.metricKey === METRIC_GA4_LANDING,
      ),
      "ga4",
    );
    const csvSnapshot = await seedSnapshot(handle, seed, [], "csv");

    const priorRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([crawlSnapshot]),
      "completed",
    );
    const stale = await seedFinding(
      handle,
      seed,
      priorRunId,
      crawlSnapshot,
      "TECH-HTTP-001",
      ["http_status:404"],
    );

    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([crawlSnapshot, gscSnapshot, ga4Snapshot, csvSnapshot]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const run = await new DiagnosticRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).not.toBeNull();
    const runStatus = await runStatusOf(handle, seed.scope, runId);
    expect(runStatus).toBe("completed");

    const resolved = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      stale.key,
    );
    expect(resolved?.active).toBe(false);
    expect(resolved?.resolved_at).not.toBeNull();
  });

  it("persists source evidence with the exact frozen snapshot and collection run", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const crawlSnapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/lineage`),
        mkPage({
          fetchUrl: `${seed.origin}/lineage`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([crawlSnapshot]),
      "queued",
    );

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(await runStatusOf(handle, seed.scope, runId)).toBe("partial");
    const persisted = await handle.pool.query<{
      source_provider: string;
      snapshot_id: string | null;
      collection_run_id: string | null;
      analysis_invocation_id: string | null;
    }>(
      `select source_provider, snapshot_id, collection_run_id, analysis_invocation_id
         from app.evidence
        where diagnostic_run_id = $1
        order by id`,
      [runId],
    );
    expect(persisted.rows.length).toBeGreaterThan(0);
    expect(persisted.rows).toEqual(
      persisted.rows.map(() => ({
        source_provider: "crawl",
        snapshot_id: crawlSnapshot.id,
        collection_run_id: crawlSnapshot.collectionRunId,
        analysis_invocation_id: null,
      })),
    );
  });

  it("persists one exact target-ledger member for every URL in a multi-page technical finding", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const fetchUrls = [`${seed.origin}/broken-a`, `${seed.origin}/broken-b`];
    const crawlSnapshot = await seedSnapshot(
      handle,
      seed,
      fetchUrls.map((fetchUrl) =>
        crawlPage(
          su(fetchUrl),
          mkPage({
            fetchUrl,
            status: 404,
            finalStatus: 404,
            robotsIndexable: false,
          }),
        ),
      ),
    );
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([crawlSnapshot]),
      "queued",
    );

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(await runStatusOf(handle, seed.scope, runId)).toBe("partial");
    const finding = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", [
        "http_status:404",
      ]),
    );
    expect(finding).not.toBeNull();
    const observations = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [crawlSnapshot.id]);
    const crawlObservations = observations
      .filter((row) => row.metric_key === METRIC_CRAWL_PAGE)
      .sort((left, right) => left.subject_ref.localeCompare(right.subject_ref));
    const frozenPages = await new PageSnapshotsRepository(
      handle.db,
    ).listByDataSnapshotWithSitePageIdentity(
      seed.scope,
      crawlSnapshot.id,
    );
    const frozenPageBySitePage = new Map(
      frozenPages.map((page) => [page.site_page_id, page]),
    );
    const rows = await new FindingTargetsRepository(handle.db).listForFindings(
      seed.scope,
      runId,
      [finding!.id],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.member_ref).sort()).toEqual(fetchUrls);
    expect(
      rows.map((row) => {
        const observation = crawlObservations.find(
          (candidate) => candidate.id === row.source_observation_id,
        );
        const frozenPage = observation?.site_page_id
          ? frozenPageBySitePage.get(observation.site_page_id)
          : undefined;
        return {
          relation: row.relation,
          targetKind: row.target_kind,
          targetRef: row.target_ref,
          resolutionState: row.resolution_state,
          basisKind: row.basis_kind,
          sitePageId: row.site_page_id,
          pageSnapshotId: row.page_snapshot_id,
          sourceObservationId: row.source_observation_id,
          memberRef: row.member_ref,
          limitation: row.limitation,
          exactObservationSitePageId: observation?.site_page_id ?? null,
          exactFrozenPageSnapshotId: frozenPage?.page_snapshot_id ?? null,
        };
      }),
    ).toEqual(
      rows.map((row) => ({
        relation: "affected_by_http_status",
        targetKind: "http_status",
        targetRef: "404",
        resolutionState: "resolved",
        basisKind: "crawl_exact_fetch",
        sitePageId: row.site_page_id,
        pageSnapshotId: row.page_snapshot_id,
        sourceObservationId: row.source_observation_id,
        memberRef: row.member_ref,
        limitation: null,
        exactObservationSitePageId: row.site_page_id,
        exactFrozenPageSnapshotId: row.page_snapshot_id,
      })),
    );
  });

  it("persists each mixed keyword contribution against only its own frozen source lineage", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const crawlSnapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/pricing`),
        mkPage({ fetchUrl: `${seed.origin}/pricing`, title: "Pricing" }),
      ),
    ]);
    const csvSnapshot = await seedSnapshot(
      handle,
      seed,
      [
        keywordGap({
          keyword: "project portfolio planning",
          clusterKey: "project management",
          searchVolume: 50,
          currentUrl: null,
          currentRank: null,
          competitorDomain: "competitor.example",
          competitorRank: 7,
          marketCode: "US",
          languageCode: "en",
        }),
        ...Array.from({ length: 10 }, (_, index) =>
          keywordGap({
            keyword: `project management workflow ${index}`,
            clusterKey: "project management",
            searchVolume: 900,
            currentUrl: null,
            currentRank: null,
            competitorDomain: "competitor.example",
            competitorRank: 4 + index,
            marketCode: "US",
            languageCode: "en",
          }),
        ),
      ],
      "csv",
    );
    const dataForSeoSnapshot = await seedSnapshot(
      handle,
      seed,
      Array.from({ length: 10 }, (_, index) =>
        keywordGap(
          {
            keyword: `project management workflow ${index}`,
            clusterKey: "project management",
            searchVolume: 100,
            currentUrl: `${seed.origin}/workflow`,
            currentRank: 8 + index,
            competitorDomain: null,
            competitorRank: null,
            marketCode: "US",
            languageCode: "en",
          },
          "dataforseo",
        ),
      ),
      "dataforseo",
    );
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([crawlSnapshot, csvSnapshot, dataForSeoSnapshot]),
      "queued",
    );

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(await runStatusOf(handle, seed.scope, runId)).toBe("partial");
    const persisted = await handle.pool.query<{
      source_provider: string;
      snapshot_id: string;
      collection_run_id: string;
      claim: string;
    }>(
      `select source_provider, snapshot_id, collection_run_id, claim
         from app.evidence
        where diagnostic_run_id = $1
          and source_provider in ('csv', 'dataforseo')
        order by source_provider`,
      [runId],
    );
    expect(persisted.rows).toEqual([
      {
        source_provider: "csv",
        snapshot_id: csvSnapshot.id,
        collection_run_id: csvSnapshot.collectionRunId,
        claim: expect.stringContaining(
          "contributes 1 keyword with 50 combined available monthly search volume",
        ),
      },
      {
        source_provider: "dataforseo",
        snapshot_id: dataForSeoSnapshot.id,
        collection_run_id: dataForSeoSnapshot.collectionRunId,
        claim: expect.stringContaining(
          "contributes 10 keywords with 1000 combined available monthly search volume",
        ),
      },
    ]);
    expect(persisted.rows.every((row) => !row.claim.includes("1050"))).toBe(
      true,
    );
    const finding = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "CONTENT-GAP-011", [
        "keyword_cluster:project management",
      ]),
    );
    expect(finding).not.toBeNull();
    await expect(
      new FindingTargetsRepository(handle.db).listForFindings(
        seed.scope,
        runId,
        [finding!.id],
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        site_id: seed.siteId,
        finding_id: finding!.id,
        diagnostic_run_id: runId,
        relation: "affected_by_keyword_cluster",
        target_kind: "keyword_cluster",
        target_ref: "project management",
        resolution_state: "definition_only",
        basis_kind: "target_definition",
        site_page_id: null,
        page_snapshot_id: null,
        source_observation_id: null,
        member_ref: null,
        limitation: null,
      }),
    ]);
  });

  it("preserves a canonical GSC subject while targeting its exact slash SitePage", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const subjectRef = `${seed.origin}/search-page`;
    const crawlSnapshot = await seedSnapshot(handle, seed, []);
    const gscSnapshot = await seedSnapshot(
      handle,
      seed,
      [gscPage(subjectRef, lowCtrProjection())],
      "gsc",
      { analyticsLineage: "slash" },
    );
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([crawlSnapshot, gscSnapshot]),
      "queued",
    );

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const finding = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "SEARCH-CTR-004", [subjectRef]),
    );
    expect(finding?.subject_refs).toEqual([subjectRef]);
    await expect(
      new FindingTargetsRepository(handle.db).listForFindings(
        seed.scope,
        runId,
        [finding!.id],
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        relation: "direct_url",
        target_kind: "url",
        target_ref: `${subjectRef}/`,
        resolution_state: "resolved",
        basis_kind: "observation_site_page",
        site_page_id: expect.any(String),
        page_snapshot_id: null,
        source_observation_id: expect.any(String),
        member_ref: subjectRef,
        limitation: null,
      }),
    ]);
  });

  it("persists deliberately ambiguous GSC SitePage lineage as an explicit unresolved target", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const subjectRef = `${seed.origin}/ambiguous-search-page`;
    const crawlSnapshot = await seedSnapshot(handle, seed, []);
    const gscSnapshot = await seedSnapshot(
      handle,
      seed,
      [gscPage(subjectRef, lowCtrProjection())],
      "gsc",
      { analyticsLineage: "ambiguous" },
    );
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([crawlSnapshot, gscSnapshot]),
      "queued",
    );

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const finding = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "SEARCH-CTR-004", [subjectRef]),
    );
    expect(finding).not.toBeNull();
    const rows = await new FindingTargetsRepository(handle.db).listForFindings(
      seed.scope,
      runId,
      [finding!.id],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        relation: "direct_url",
        target_kind: "url",
        target_ref: subjectRef,
        resolution_state: "unresolved",
        basis_kind: "unresolved_observation",
        site_page_id: null,
        page_snapshot_id: null,
        source_observation_id: expect.any(String),
        member_ref: subjectRef,
        limitation: expect.stringContaining("no unambiguous persisted SitePage"),
      }),
    ]);
  });

  it("fails at the database boundary when a manifest provider masquerades as its immutable snapshot", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const crawlSnapshot = await seedSnapshot(handle, seed, [
      crawlPage(su(`${seed.origin}/`), mkPage({ fetchUrl: `${seed.origin}/` })),
    ]);
    const corruptedManifest = manifestOf([crawlSnapshot]);
    const entries = corruptedManifest["snapshots"] as Record<string, unknown>[];
    entries[0] = { ...entries[0], provider: "ga4" };
    await expect(
      seedDiagnosticRun(
        handle,
        seed,
        icpId,
        corruptedManifest,
        "queued",
      ),
    ).rejects.toThrow();
  });

  it("fails at the database boundary when an observation drifts from its immutable snapshot provider", async () => {
    const seed = await seedProject(handle);
    const crawlSnapshot = await seedSnapshot(handle, seed, []);
    const drifted = await attachExactSitePageLineage(
      handle,
      seed,
      [
        ga4Landing(`${seed.origin}/drifted`, {
          sessions: 10,
          engagedSessions: null,
          engagementRate: null,
          keyEvents: 1,
          keyEventUnavailableReason: null,
        }),
      ],
      "ga4",
      crawlSnapshot.id,
      crawlSnapshot.capturedAt,
    );
    await expect(
      new ObservationsRepository(handle.db).insertMany(
        seed.scope,
        crawlSnapshot.id,
        "ga4",
        drifted,
      ),
    ).rejects.toThrow();
  });

  it("fails at the database boundary when crawl carries another provider's metric", async () => {
    const seed = await seedProject(handle);
    const sourceUrl = su(`${seed.origin}/metric-injection`);
    const crawlObservation = crawlPage(
      sourceUrl,
      mkPage({ fetchUrl: sourceUrl }),
    );
    await expect(
      seedSnapshot(handle, seed, [
        { ...crawlObservation, metricKey: METRIC_GA4_LANDING },
      ]),
    ).rejects.toThrow();
  });

  it("fails at the database boundary when an observation timestamp differs from its snapshot", async () => {
    const seed = await seedProject(handle);
    const sourceUrl = su(`${seed.origin}/historical-row`);
    const crawlObservation = crawlPage(
      sourceUrl,
      mkPage({ fetchUrl: sourceUrl }),
    );
    const historicalAt = new Date(
      Date.parse(OBSERVED_AT) - 60_000,
    ).toISOString();
    await expect(
      seedSnapshot(handle, seed, [
        { ...crawlObservation, observedAt: historicalAt },
      ]),
    ).rejects.toThrow();
  });

  it("AC-026: a partial run (skipped dataset) resolves NOTHING", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshot = await seedSnapshot(handle, seed, [
      crawlPage(su(`${seed.origin}/`), mkPage({ fetchUrl: `${seed.origin}/` })),
    ]);

    const priorRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "completed",
    );
    const stale = await seedFinding(
      handle,
      seed,
      priorRunId,
      snapshot,
      "TECH-HTTP-001",
      ["http_status:404"],
    );

    // Only crawl is declared available → GSC/GA4/CSV rules are `skipped` → partial.
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(await runStatusOf(handle, seed.scope, runId)).toBe("partial");
    const untouched = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      stale.key,
    );
    expect(untouched?.active).toBe(true);
    expect(untouched?.resolved_at).toBeNull();
  });

  it("AC-026: a re-hit of a resolved finding flips it to regressed", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/gone`),
        mkPage({
          fetchUrl: `${seed.origin}/gone`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);

    const priorRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "completed",
    );
    const finding = await seedFinding(
      handle,
      seed,
      priorRunId,
      snapshot,
      "TECH-HTTP-001",
      ["http_status:404"],
    );
    // Resolve it (as a prior clean run would have).
    await new FindingsRepository(handle.db).resolveByKeysExcept(
      seed.scope,
      ["TECH-HTTP-001"],
      [],
      new Date().toISOString(),
    );
    const before = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      finding.key,
    );
    expect(before?.active).toBe(false);

    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const after = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      finding.key,
    );
    expect(after?.active).toBe(true);
    expect(after?.regressed).toBe(true);
    expect(after?.resolved_at).toBeNull();
  });

  it("appends current-run target rows on re-hit without mutating the prior run ledger", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/rehit-target`),
        mkPage({
          fetchUrl: `${seed.origin}/rehit-target`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);
    const firstRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId: firstRunId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });
    const finding = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", [
        "http_status:404",
      ]),
    );
    expect(finding).not.toBeNull();
    const targets = new FindingTargetsRepository(handle.db);
    const priorRows = await targets.listForFindings(
      seed.scope,
      firstRunId,
      [finding!.id],
    );
    expect(priorRows).toHaveLength(1);

    const currentRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId: currentRunId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const priorRowsAfterRehit = await targets.listForFindings(
      seed.scope,
      firstRunId,
      [finding!.id],
    );
    const currentRows = await targets.listForFindings(
      seed.scope,
      currentRunId,
      [finding!.id],
    );
    expect(priorRowsAfterRehit).toEqual(priorRows);
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]).toMatchObject({
      finding_id: finding!.id,
      diagnostic_run_id: currentRunId,
      relation: priorRows[0]!.relation,
      target_kind: priorRows[0]!.target_kind,
      target_ref: priorRows[0]!.target_ref,
      resolution_state: priorRows[0]!.resolution_state,
      basis_kind: priorRows[0]!.basis_kind,
      site_page_id: priorRows[0]!.site_page_id,
      page_snapshot_id: priorRows[0]!.page_snapshot_id,
      source_observation_id: priorRows[0]!.source_observation_id,
      member_ref: priorRows[0]!.member_ref,
      limitation: priorRows[0]!.limitation,
    });
    expect(currentRows[0]!.id).not.toBe(priorRows[0]!.id);
  });

  it("replays the exact target rows idempotently inside one accepted attempt", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/idempotent-target`),
        mkPage({
          fetchUrl: `${seed.origin}/idempotent-target`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    const insertMany = FindingTargetsRepository.prototype.insertMany;
    let replayInsertCount: number | null = null;
    vi.spyOn(
      FindingTargetsRepository.prototype,
      "insertMany",
    ).mockImplementation(async function (
      this: FindingTargetsRepository,
      scope,
      rows,
    ) {
      const inserted = await insertMany.call(this, scope, rows);
      replayInsertCount = await insertMany.call(this, scope, rows);
      return inserted;
    });

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(replayInsertCount).toBe(0);
    const persisted = await handle.pool.query<{ count: string }>(
      `select count(*)::text as count
         from app.finding_targets
        where diagnostic_run_id = $1`,
      [runId],
    );
    expect(persisted.rows[0]?.count).toBe("1");
  });

  it("rolls back target rows with the terminal transaction and retries cleanly", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/rollback-target`),
        mkPage({
          fetchUrl: `${seed.origin}/rollback-target`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    const tailFailure = vi
      .spyOn(TelemetryRepository.prototype, "emit")
      .mockRejectedValueOnce(
        Object.assign(new Error("forced serialization failure"), {
          code: "40001",
        }),
      );

    await expect(
      runDiagnostic(ctx, {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      }),
    ).rejects.toMatchObject({ code: "40001" });

    expect(await runStatusOf(handle, seed.scope, runId)).toBe("queued");
    const rolledBack = await handle.pool.query<{
      target_count: string;
      evidence_count: string;
      finding_count: string;
      rule_count: string;
    }>(
      `select
         (select count(*) from app.finding_targets where diagnostic_run_id = $1)::text as target_count,
         (select count(*) from app.evidence where diagnostic_run_id = $1)::text as evidence_count,
         (select count(*) from app.findings where last_seen_run_id = $1)::text as finding_count,
         (select count(*) from app.diagnostic_run_rules where diagnostic_run_id = $1)::text as rule_count`,
      [runId],
    );
    expect(rolledBack.rows[0]).toEqual({
      target_count: "0",
      evidence_count: "0",
      finding_count: "0",
      rule_count: "0",
    });

    tailFailure.mockRestore();
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });
    expect(await runStatusOf(handle, seed.scope, runId)).toBe("partial");
    const retried = await handle.pool.query<{ count: string }>(
      `select count(*)::text as count
         from app.finding_targets
        where diagnostic_run_id = $1`,
      [runId],
    );
    expect(retried.rows[0]?.count).toBe("1");
  });

  it("writes no target rows when the terminal transaction detects a stale attempt", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/stale-target`),
        mkPage({
          fetchUrl: `${seed.origin}/stale-target`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(null);

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const persisted = await handle.pool.query<{ count: string }>(
      `select count(*)::text as count
         from app.finding_targets
        where diagnostic_run_id = $1`,
      [runId],
    );
    expect(persisted.rows[0]?.count).toBe("0");
    expect(await runStatusOf(handle, seed.scope, runId)).toBe("running");
  });

  it("AC-028: a cross-run re-hit preserves the human review state and merges evidence into the existing Action", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/gone`),
        mkPage({
          fetchUrl: `${seed.origin}/gone`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);

    const priorRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "completed",
    );
    const finding = await seedFinding(
      handle,
      seed,
      priorRunId,
      snapshot,
      "TECH-HTTP-001",
      ["http_status:404"],
    );
    // The operator confirmed this finding (review revision advanced by a human).
    const reviewed = await new FindingsRepository(handle.db).updateReview(
      seed.scope,
      finding.id,
      {
        reviewState: "confirmed",
        reviewRevision: 2,
        reason: null,
        note: null,
        expectedRevision: 0,
      },
    );
    expect(reviewed).toBe(true);

    const existingEvidenceRef = randomUUID();
    const action = await new ActionsRepository(handle.db).insert({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      sourceFindingId: finding.id,
      sourceDiagnosticRunId: priorRunId,
      actionKey: contentHash({ action: finding.id }),
      templateId: "tech-http-fix",
      templateVersion: 1,
      title: "Fix broken pages",
      description: "Repair the 404 responses.",
      contentLocale: "en",
      priorityBand: "high",
      roadmapLane: "now",
      status: "planned",
      effort: "small",
      risk: "low",
      expectedOutcome: "The pages return 200.",
      evidenceRefs: [existingEvidenceRef],
      createdBy: seed.actor,
    });

    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    // Human review projection is preserved on the re-hit (never reset).
    const rehit = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      finding.key,
    );
    expect(rehit?.review_state).toBe("confirmed");
    expect(rehit?.review_revision).toBe(2);
    expect(rehit?.rule_version).toBe(2);

    // The Action's human priority/status are untouched; only evidence is merged.
    const mergedAction = await new ActionsRepository(handle.db).findById(
      seed.scope,
      action.id,
    );
    expect(mergedAction?.priority_band).toBe("high");
    expect(mergedAction?.status).toBe("planned");
    const refs = mergedAction?.evidence_refs as string[];
    expect(refs).toContain(existingEvidenceRef);
    expect(refs.length).toBeGreaterThan(1);
  });

  it("caps confidence only when an unresolved discrepancy overlaps this frozen manifest finding/evidence", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const conflictingSubject = su(`${seed.origin}/conflicting`);
    const cleanSubject = su(`${seed.origin}/clean-500`);
    const frozenSnapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        conflictingSubject,
        mkPage({
          fetchUrl: conflictingSubject,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
      crawlPage(
        cleanSubject,
        mkPage({
          fetchUrl: cleanSubject,
          status: 500,
          finalStatus: 500,
          robotsIndexable: false,
        }),
      ),
    ]);
    const comparisonSnapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        conflictingSubject,
        mkPage({ fetchUrl: conflictingSubject }),
      ),
    ]);
    const frozenRows = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [frozenSnapshot.id]);
    const comparisonRows = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [comparisonSnapshot.id]);
    const left = frozenRows.find(
      (row) => row.subject_ref === conflictingSubject,
    );
    const right = comparisonRows.find(
      (row) => row.subject_ref === conflictingSubject,
    );
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    await new ProviderDiscrepanciesRepository(handle.db).insert(seed.scope, {
      metricKey: METRIC_CRAWL_PAGE,
      subjectType: "url",
      subjectRef: conflictingSubject,
      // Deliberately reverse lexical order; the repository canonicalizes it.
      leftObservationId: right!.id,
      rightObservationId: left!.id,
    });

    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([frozenSnapshot]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const conflictingFinding = await new FindingsRepository(
      handle.db,
    ).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", [
        "http_status:404",
      ]),
    );
    const cleanFinding = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", [
        "http_status:500",
      ]),
    );
    expect(conflictingFinding?.confidence).toBe("medium");
    expect(cleanFinding?.confidence).toBe("high");

    // A later run freezes a third snapshot. Although it has the same subjects,
    // neither side of the recorded pair belongs to that manifest, so confidence
    // must not be downgraded by stale/non-frozen data.
    const unrelatedSnapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        conflictingSubject,
        mkPage({
          fetchUrl: conflictingSubject,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
      crawlPage(
        cleanSubject,
        mkPage({
          fetchUrl: cleanSubject,
          status: 500,
          finalStatus: 500,
          robotsIndexable: false,
        }),
      ),
    ]);
    const unrelatedRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([unrelatedSnapshot]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId: unrelatedRunId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });
    const refreshed = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", [
        "http_status:404",
      ]),
    );
    expect(refreshed?.confidence).toBe("high");
  });

  it("finishes an accepted diagnostic after archive while keeping the project stage frozen", async () => {
    const seed = await seedProject(handle);
    const projects = new ProjectsRepository(handle.db);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshot = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/archived-diagnostic`),
        mkPage({
          fetchUrl: `${seed.origin}/archived-diagnostic`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);
    await projects.setStage(
      { workspaceId: seed.scope.workspaceId },
      seed.scope.projectId,
      "diagnosing",
    );
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf([snapshot]),
      "queued",
    );
    await handle.pool.query(
      `update app.client_projects
          set archived_at = now()
        where workspace_id = $1
          and id = $2`,
      [seed.scope.workspaceId, seed.scope.projectId],
    );

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(await runStatusOf(handle, seed.scope, runId)).toBe("partial");
    expect(
      await new DiagnosticRunsRepository(handle.db).listRuleResults(runId),
    ).not.toHaveLength(0);
    await expect(
      projects.findById(
        { workspaceId: seed.scope.workspaceId },
        seed.scope.projectId,
      ),
    ).resolves.toMatchObject({
      stage: "diagnosing",
      archived_at: expect.any(String),
    });
  });
});

// --- seeding helpers --------------------------------------------------------

async function seedProject(handle: DbHandle): Promise<Seed> {
  const actor = randomUUID();
  const [ws] = await handle.db
    .insert(workspaces)
    .values({ name: `WS-${randomUUID()}` })
    .returning();
  const workspaceId = ws!.id;
  const project = await new ProjectsRepository(handle.db).insert({
    workspaceId,
    clientName: "Diag",
    projectName: "Diag",
    defaultDeliveryLocale: "en",
    createdBy: actor,
  });
  const host = `diag-${randomUUID().slice(0, 8)}.example`;
  const origin = `https://${host}`;
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId,
    projectId: project.id,
    origin,
    host,
    marketCodes: ["US"],
    languageCodes: ["en"],
  });
  return {
    scope: { workspaceId, projectId: project.id },
    siteId: site.id,
    origin,
    actor,
  };
}

async function seedIcp(
  handle: DbHandle,
  seed: Seed,
  profile: Record<string, unknown>,
): Promise<string> {
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: seed.scope.workspaceId,
      project_id: seed.scope.projectId,
      version: 1,
      status: "complete",
      profile,
      content_hash: contentHash({ icp: randomUUID() }),
      created_by: seed.actor,
    })
    .returning();
  return icp!.id;
}

const PROVIDER_FIXTURE_CONFIG: Record<
  SourceProvider,
  {
    readonly operation: string;
    readonly datasetKey: string;
    readonly methodVersion: string;
  }
> = {
  crawl: {
    operation: "site_graph",
    datasetKey: CRAWL_DATASET_KEY,
    methodVersion: CRAWL_METHOD_VERSION,
  },
  gsc: {
    operation: "search_analytics",
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.page_query_daily.v1",
  },
  ga4: {
    operation: "organic_landing",
    datasetKey: "ga4.organic_landing_daily.v1",
    methodVersion: "ga4.organic_landing_daily.v1",
  },
  csv: {
    operation: "keyword_gap_import",
    datasetKey: "csv.keyword_gap.v1",
    methodVersion: "csv.keyword_gap.v1",
  },
  dataforseo: {
    operation: "keyword_gap_import",
    datasetKey: DATAFORSEO_DATASET_KEY,
    methodVersion: DATAFORSEO_METHOD_VERSION,
  },
};

/** Insert one provider-honest immutable snapshot and its collection run. */
async function seedSnapshot(
  handle: DbHandle,
  seed: Seed,
  observations: readonly ObservationInsert[],
  provider: SourceProvider = "crawl",
  options: SeedSnapshotOptions = {},
): Promise<SeededSnapshot> {
  const collectionRunId = randomUUID();
  const config = PROVIDER_FIXTURE_CONFIG[provider];
  const sources = new SourceConnectionsRepository(handle.db);
  const existingSource =
    provider === "csv"
      ? null
      : await sources.findConnectedByProvider(seed.scope, provider);
  const sourceConnectionId =
    provider === "csv"
      ? null
      : existingSource
        ? existingSource.id
      : provider === "crawl"
        ? (
            await sources.insertDefaultCrawl({
              workspaceId: seed.scope.workspaceId,
              projectId: seed.scope.projectId,
              siteId: seed.siteId,
              createdBy: seed.actor,
            })
          ).id
        : (
            await sources.insertConnection({
              workspaceId: seed.scope.workspaceId,
              projectId: seed.scope.projectId,
              siteId: seed.siteId,
              provider,
              connectionType:
                provider === "dataforseo" ? "api_key_stub" : "oauth",
              state: "connected",
              limitation: `test ${provider} source connection`,
              connectedAt: true,
              createdBy: seed.actor,
            })
          ).id;
  const importPreviewId = provider === "csv"
    ? (
        await new ImportPreviewsRepository(handle.db).insert({
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
          siteId: seed.siteId,
          createdBy: seed.actor,
          tokenHash: Buffer.from(
            contentHash({ preview: collectionRunId }),
            "hex",
          ),
          templateId: "keyword_gap_v1",
          rawObjectKey: `diagnostic-fixture/${collectionRunId}.csv`,
          fileChecksum: contentHash({ csv: collectionRunId }),
          rowCount: observations.length,
          detectedColumns: [],
          suggestedMapping: {},
          previewRows: [],
          validationErrors: [],
          validationWarnings: [],
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })
      ).id
    : null;
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: seed.scope.workspaceId,
    project_id: seed.scope.projectId,
    kind: "collection",
    status: "completed",
    initiated_by: seed.actor,
    started_at: OBSERVED_AT,
    completed_at: OBSERVED_AT,
  });
  await new CollectionRunsRepository(handle.db).insertPlaceholder({
    runId: collectionRunId,
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    sourceConnectionId,
    provider,
    operation: config.operation,
    methodVersion: config.methodVersion,
    parametersHash: contentHash({ c: collectionRunId }),
    importPreviewId,
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    collectionRunId,
    sourceConnectionId,
    provider,
    datasetKey: config.datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: config.methodVersion,
    capturedAt: OBSERVED_AT,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: `test ${provider} snapshot`,
    rawObjectKey: null,
    rowCount: observations.length,
    checksum: contentHash({ s: collectionRunId }),
  });
  const observationsWithLineage = await attachExactSitePageLineage(
    handle,
    seed,
    observations,
    provider,
    snapshot.id,
    snapshot.captured_at,
    options,
  );
  await new ObservationsRepository(handle.db).insertMany(
    seed.scope,
    snapshot.id,
    provider,
    observationsWithLineage,
  );
  return {
    id: snapshot.id,
    collectionRunId,
    provider,
    availability: "available",
    capturedAt: snapshot.captured_at,
    datasetKey: snapshot.dataset_key,
    schemaVersion: snapshot.schema_version,
    methodVersion: snapshot.method_version,
    checksum: snapshot.checksum,
    sourceWindow: snapshot.source_window,
  };
}

async function attachExactSitePageLineage(
  handle: DbHandle,
  seed: Seed,
  observations: readonly ObservationInsert[],
  provider: SourceProvider,
  dataSnapshotId: string,
  capturedAt: string,
  options: SeedSnapshotOptions = {},
): Promise<readonly ObservationInsert[]> {
  const sitePages = new SitePagesRepository(handle.db);
  const pageSnapshots = new PageSnapshotsRepository(handle.db);
  const bound: ObservationInsert[] = [];
  for (const observation of observations) {
    let exactUrl: string | null = null;
    if (
      provider === "crawl" &&
      observation.metricKey === METRIC_CRAWL_PAGE &&
      observation.subjectType === "url"
    ) {
      const value = observation.valueJson;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("diagnostic fixture Crawl page projection is invalid");
      }
      const fetchUrl = (value as Record<string, unknown>)["fetchUrl"];
      if (typeof fetchUrl !== "string") {
        throw new Error("diagnostic fixture Crawl page fetchUrl is missing");
      }
      exactUrl = fetchUrl;
    } else if (
      (provider === "gsc" || provider === "ga4") &&
      observation.subjectType === "url" &&
      observation.metricKey ===
        (provider === "gsc" ? METRIC_GSC_PAGE : METRIC_GA4_LANDING)
    ) {
      if (options.analyticsLineage === "ambiguous") {
        for (const normalizedUrl of [
          observation.subjectRef,
          `${observation.subjectRef}/`,
        ]) {
          await sitePages.upsertNormalizedUrl({
            workspaceId: seed.scope.workspaceId,
            projectId: seed.scope.projectId,
            siteId: seed.siteId,
            normalizedUrl,
            templateKey: null,
          });
        }
        bound.push(observation);
        continue;
      }
      exactUrl =
        options.analyticsLineage === "slash"
          ? `${observation.subjectRef}/`
          : observation.subjectRef;
    }

    if (exactUrl === null) {
      bound.push(observation);
      continue;
    }
    const sitePage = await sitePages.upsertNormalizedUrl({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      normalizedUrl: exactUrl,
      templateKey: null,
    });
    if (provider === "crawl") {
      const extract = {
        schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
        subjectUrl: observation.subjectRef,
        depth: 0,
        projection: observation.valueJson,
      };
      await pageSnapshots.create({
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
        sitePageId: sitePage.id,
        dataSnapshotId,
        contentHash: contentHash(extract as CanonicalValue),
        extract,
        capturedAt,
      });
    }
    bound.push({ ...observation, sitePageId: sitePage.id });
  }
  return bound;
}

async function seedDiagnosticRun(
  handle: DbHandle,
  seed: Seed,
  icpProfileId: string,
  inputManifest: Record<string, unknown>,
  status: "queued" | "completed",
): Promise<string> {
  const runId = randomUUID();
  const icp = await new IcpProfilesRepository(handle.db).findById(
    seed.scope,
    icpProfileId,
  );
  if (!icp) throw new Error("diagnostic test ICP missing");
  const frozenManifest = {
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    icp: {
      id: icp.id,
      version: icp.version,
      contentHash: icp.content_hash,
    },
    snapshots: inputManifest["snapshots"],
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en",
    governance: {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [],
    },
  };
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: seed.scope.workspaceId,
    project_id: seed.scope.projectId,
    kind: "diagnostic",
    status,
    initiated_by: seed.actor,
    ...(status === "completed"
      ? { started_at: OBSERVED_AT, completed_at: OBSERVED_AT }
      : {}),
  });
  await new DiagnosticRunsRepository(handle.db).insert({
    runId,
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    icpProfileId,
    icpProfileVersion: 1,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: "en",
    inputManifest: frozenManifest,
    inputHash: contentHash(frozenManifest as unknown as CanonicalValue),
  });
  return runId;
}

async function seedFinding(
  handle: DbHandle,
  seed: Seed,
  runId: string,
  snapshot: SeededSnapshot,
  ruleId: RuleId,
  subjectRefs: readonly string[],
): Promise<{ id: string; key: string }> {
  const meta = FINDING_REGISTRY[ruleId];
  const key = findingKey(seed.scope.projectId, ruleId, subjectRefs);
  const row = await new FindingsRepository(handle.db).insert({
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    findingKey: key,
    ruleId,
    ruleVersion: [
      "TECH-HTTP-001",
      "TECH-CANONICAL-002",
      "TECH-LINKGRAPH-005",
    ].includes(ruleId)
      ? 2
      : 1,
    ruleFamily: meta.ruleFamily,
    intent: meta.intent,
    domain: meta.domain,
    titleKey: meta.titleKey,
    titleArgs: {},
    summary: "seeded prior-run finding",
    summaryLocale: "en",
    subjectRefs: [...subjectRefs],
    severity: "high",
    confidence: "high",
    reviewState: "unreviewed",
    runId,
    seenAt: OBSERVED_AT,
  });
  const [evidenceId] = await new EvidenceRepository(handle.db).insertMany(
    {
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      diagnosticRunId: runId,
    },
    [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: [...subjectRefs],
        claim: "Seeded prior-run finding observation.",
        observedAt: OBSERVED_AT,
        limitation: "Disposable diagnostic integration fixture.",
        snapshotId: snapshot.id,
        collectionRunId: snapshot.collectionRunId,
      },
    ],
  );
  await new EvidenceRepository(handle.db).linkObservations(
    {
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      diagnosticRunId: runId,
    },
    [{ findingId: row.id, evidenceId: evidenceId!, role: "primary" }],
  );
  return { id: row.id, key };
}

async function runStatusOf(
  handle: DbHandle,
  scope: ProjectScope,
  runId: string,
): Promise<string> {
  const run = await new AsyncRunsRepository(handle.db).findById(scope, runId);
  return run?.status ?? "missing";
}

// --- fixture builders -------------------------------------------------------

function manifestOf(snapshots: readonly SeededSnapshot[]): Record<string, unknown> {
  return {
    snapshots: snapshots.map((snapshot) => ({
      snapshotId: snapshot.id,
      provider: snapshot.provider,
      datasetKey: snapshot.datasetKey,
      schemaVersion: snapshot.schemaVersion,
      methodVersion: snapshot.methodVersion,
      checksum: snapshot.checksum,
      availability: snapshot.availability,
      capturedAt: snapshot.capturedAt,
      sourceWindow: snapshot.sourceWindow,
    })),
  };
}

/** An English ICP whose single conversion target is the (commercial) pricing page. */
function cleanProfile(origin: string): Record<string, unknown> {
  return {
    productName: "Acme",
    oneLineDescription: "B2B widgets for busy teams.",
    siteLanguageCodes: ["en"],
    defaultDeliveryLocale: "en",
    marketCodes: ["US"],
    offers: [],
    useCases: [],
    differentiators: [],
    priorityUrls: [],
    primaryConversion: {
      label: "Buy",
      type: "purchase",
      targetUrl: `${origin}/pricing`,
    },
  };
}

function minimalProfile(): Record<string, unknown> {
  return {
    productName: "Acme",
    oneLineDescription: "Widgets.",
    siteLanguageCodes: ["en"],
    defaultDeliveryLocale: "en",
    marketCodes: ["US"],
  };
}

/**
 * A fully-clean, full-coverage crawl fixture: a healthy commercial page (the
 * conversion target) with structured entity + proof coverage, two non-commercial
 * pages that give it 2 internal inlinks, and one GA4 landing row with a usable
 * baseline. Every one of the 11 rules passes → the run is `completed`.
 */
function cleanObservations(origin: string): ObservationInsert[] {
  const pricing = su(`${origin}/pricing`);
  const home = su(`${origin}/`);
  const about = su(`${origin}/about`);
  return [
    crawlRobots(origin),
    crawlPage(
      pricing,
      mkPage({
        fetchUrl: `${origin}/pricing`,
        title: "Pricing",
        h1: ["Pricing"],
        jsonLdTypes: ["Organization"],
        paragraphs: [
          "Acme Corp helped 1,200 teams and grew revenue by 40% last year.",
        ],
      }),
    ),
    crawlPage(
      home,
      mkPage({ fetchUrl: `${origin}/`, internalOutlinks: [link(pricing)] }),
    ),
    crawlPage(
      about,
      mkPage({
        fetchUrl: `${origin}/about`,
        internalOutlinks: [link(pricing)],
      }),
    ),
    ga4Landing(`${origin}/landing`, {
      sessions: 100,
      engagedSessions: null,
      engagementRate: null,
      keyEvents: 5,
      keyEventUnavailableReason: null,
    }),
  ];
}

function crawlRobots(subjectRef: string): ObservationInsert {
  return {
    metricKey: METRIC_CRAWL_ROBOTS,
    subjectType: "site",
    subjectRef,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: {
      fetched: true,
      groups: [{ userAgent: "*", disallow: [], allow: [] }],
      sitemaps: [],
    } satisfies CrawlRobotsProjection,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "public robots.txt fetch",
  };
}

function su(url: string): string {
  const subject = subjectUrlOf(url);
  if (!subject) throw new Error(`unparseable url: ${url}`);
  return subject;
}

function link(targetSubjectUrl: string): CrawlLinkProjection {
  return { targetSubjectUrl, rel: null, anchorText: null };
}

function mkPage(o: {
  fetchUrl: string;
  status?: number;
  finalStatus?: number;
  robotsIndexable?: boolean;
  title?: string;
  h1?: readonly string[];
  jsonLdTypes?: readonly string[];
  paragraphs?: readonly string[];
  internalOutlinks?: readonly CrawlLinkProjection[];
}): CrawlPageProjection {
  return {
    fetchUrl: o.fetchUrl,
    status: o.status ?? 200,
    finalStatus: o.finalStatus ?? 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: o.robotsIndexable ?? true,
    robotsDirectives: o.robotsIndexable === false ? ["noindex"] : [],
    title: o.title ?? null,
    metaDescription: null,
    h1: o.h1 ?? [],
    headings: [],
    wordCount: 100,
    internalOutlinks: o.internalOutlinks ?? [],
    jsonLd: { types: o.jsonLdTypes ?? [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: o.paragraphs ?? [],
    responseMs: 10,
    contentType: "text/html",
  };
}

function crawlPage(
  subjectRef: string,
  projection: CrawlPageProjection,
): ObservationInsert {
  return {
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "public crawl fetch",
  };
}

function lowCtrProjection(): GscPageProjection {
  return {
    current28d: { clicks: 1, impressions: 2_000, position: 2 },
    previous28d: { clicks: 0, impressions: 0, position: null },
    topQueries: [
      {
        query: "widget pricing",
        clicks: 1,
        impressions: 2_000,
        position: 2,
      },
    ],
  };
}

function gscPage(
  subjectRef: string,
  projection: GscPageProjection,
): ObservationInsert {
  return {
    metricKey: METRIC_GSC_PAGE,
    subjectType: "url",
    subjectRef,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "first_party",
    grade: "A",
    support: "supports",
    limitation: "gsc page metrics",
  };
}

function ga4Landing(
  subjectRef: string,
  projection: Ga4LandingProjection,
): ObservationInsert {
  return {
    metricKey: METRIC_GA4_LANDING,
    subjectType: "url",
    subjectRef,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "first_party",
    grade: "A",
    support: "supports",
    limitation: "ga4 landing metrics",
  };
}

function keywordGap(
  projection: CsvKeywordProjection,
  provider: "csv" | "dataforseo" = "csv",
): ObservationInsert {
  return {
    metricKey: METRIC_CSV_KEYWORD_GAP,
    subjectType: "keyword_cluster",
    subjectRef: projection.clusterKey,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: provider === "dataforseo" ? "vendor_observation" : "user_provided",
    grade: provider === "dataforseo" ? "B" : "C",
    support: "supports",
    limitation: `${provider} keyword-gap fixture`,
  };
}
