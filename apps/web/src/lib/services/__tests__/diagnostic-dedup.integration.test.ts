import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  FindingsRepository,
  ObservationsRepository,
  SitePagesRepository,
  SourceConnectionsRepository,
  type DataSnapshotRow,
  type FindingRow,
  type ProjectScope,
} from "@sf/db";
import {
  ALL_RULES,
  DiagnosticContext,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
  parseIcp,
  runPipeline,
  type ObservationView,
  type RunFinding,
} from "@sf/engine";
import {
  CRAWL_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  type CrawlPageProjection,
} from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";

/**
 * AC-025 — running the diagnostic twice over the same inputs does NOT create a
 * duplicate Finding (spec §8.6). The cross-run identity is
 * `findingKey = sha256({projectId, domain, ruleFamily, sortedSubjectRefs, intent})`,
 * enforced by `UNIQUE (project_id, finding_key)` (migration 0001_init.sql:442).
 * The worker's `upsertFinding` (apps/worker/src/diagnostic/run-diagnostic.ts:287)
 * does `findByKey -> insert | touchSeen`; this test drives the REAL pipeline twice
 * and mirrors that exact upsert, asserting the second run re-hits the same row.
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

function page404(url: string): CrawlPageProjection {
  return {
    fetchUrl: url,
    status: 404,
    finalStatus: 404,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: false,
    robotsDirectives: [],
    title: null,
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: 0,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 12,
    contentType: "text/html",
  };
}

/** Mirror of the worker's `upsertFinding` (run-diagnostic.ts:287) — findByKey then insert|touchSeen. */
async function upsertFinding(
  repo: FindingsRepository,
  scope: ProjectScope,
  runId: string,
  finding: RunFinding,
  now: string,
): Promise<{ id: string; isRehit: boolean }> {
  const titleArgs = {
    ...finding.titleArgs,
    __priorityRelevant: finding.priorityRelevant,
  };
  const existing = await repo.findByKey(scope, finding.findingKey);
  if (!existing) {
    const row = await repo.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      findingKey: finding.findingKey,
      ruleId: finding.ruleId,
      ruleVersion: finding.ruleVersion,
      ruleFamily: finding.ruleFamily,
      intent: finding.intent,
      domain: finding.domain,
      titleKey: finding.titleKey,
      titleArgs,
      summary: finding.summary,
      summaryLocale: finding.summaryLocale,
      subjectRefs: [...finding.subjectRefs],
      severity: finding.severity,
      confidence: finding.confidence,
      reviewState: finding.reviewState,
      runId,
      seenAt: now,
    });
    return { id: row.id, isRehit: false };
  }
  const regressed = existing.resolved_at !== null || existing.active === false;
  await repo.touchSeen(existing.id, {
    ruleVersion: finding.ruleVersion,
    severity: finding.severity,
    confidence: finding.confidence,
    titleArgs,
    summary: finding.summary,
    summaryLocale: finding.summaryLocale,
    subjectRefs: [...finding.subjectRefs],
    runId,
    seenAt: now,
    regressed,
  });
  return { id: existing.id, isRehit: true };
}

describeDb("diagnostic cross-run finding dedup (AC-025, spec §8.6)", () => {
  let handle: DbHandle;
  let scope: ProjectScope;
  let siteId: string;
  let icpProfileId: string;
  let icpContentHash: string;
  let frozenSnapshot: DataSnapshotRow;
  const actor = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    const workspaceId = ws!.id;
    const created = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      {
        clientName: "Dedup",
        projectName: "Dedup",
        siteUrl: "https://dedup.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    scope = { workspaceId, projectId: created.project.id };
    siteId = created.project.site.id;

    icpContentHash = contentHash({ icp: randomUUID() });
    const [icp] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: workspaceId,
        project_id: scope.projectId,
        version: 1,
        status: "complete",
        profile: { productName: "Dedup", siteLanguageCodes: ["en"] },
        content_hash: icpContentHash,
        created_by: actor,
      })
      .returning();
    icpProfileId = icp!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  /** Run the real 11-rule pipeline over the seeded 404-page snapshot. */
  async function runOnce(snapshotId: string, observations: ObservationView[]) {
    void snapshotId;
    const capturedAt = new Date().toISOString();
    const ctx = DiagnosticContext.build({
      icp: parseIcp({
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
        priorityUrls: [],
      }),
      deliveryLocale: "en",
      observations,
      coverage: {
        crawl: "available",
        gsc: "unavailable",
        ga4: "unavailable",
        csv: "unavailable",
      },
      capturedAt: { crawl: capturedAt },
    });
    return runPipeline({
      projectId: scope.projectId,
      ctx,
      rules: ALL_RULES,
      deliveryLocale: "en",
    });
  }

  /** Insert an async + diagnostic run row, returning the run id (evidence/finding FK). */
  async function seedDiagnosticRun(snapshot: DataSnapshotRow): Promise<string> {
    const nowTs = new Date().toISOString();
    const [run] = await handle.db
      .insert(asyncRuns)
      .values({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        kind: "diagnostic",
        status: "completed",
        initiated_by: actor,
        started_at: nowTs,
        completed_at: nowTs,
      })
      .returning();
    const inputManifest = {
      projectId: scope.projectId,
      siteId,
      icp: {
        id: icpProfileId,
        version: 1,
        contentHash: icpContentHash,
      },
      snapshots: [
        {
          snapshotId: snapshot.id,
          provider: snapshot.provider,
          datasetKey: snapshot.dataset_key,
          schemaVersion: snapshot.schema_version,
          methodVersion: snapshot.method_version,
          checksum: snapshot.checksum,
          capturedAt: snapshot.captured_at,
          sourceWindow: snapshot.source_window,
          availability: snapshot.availability,
        },
      ],
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      deliveryLocale: "en",
    };
    await new DiagnosticRunsRepository(handle.db).insert({
      runId: run!.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      icpProfileId,
      icpProfileVersion: 1,
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      outputLocale: "en",
      inputManifest,
      inputHash: contentHash(
        inputManifest as Parameters<typeof contentHash>[0],
      ),
    });
    return run!.id;
  }

  async function countFindings(findingKey: string): Promise<number> {
    const res = await handle.pool.query<{ c: string }>(
      `SELECT count(*)::int AS c FROM app.findings WHERE project_id = $1 AND finding_key = $2`,
      [scope.projectId, findingKey],
    );
    return Number(res.rows[0]?.c ?? 0);
  }

  it("two runs over identical inputs re-hit ONE finding row (no duplicate)", async () => {
    // Seed one crawl snapshot with a single 404-page observation.
    const capturedAt = new Date().toISOString();
    const crawlSource = await new SourceConnectionsRepository(
      handle.db,
    ).findConnectedByProvider(scope, "crawl");
    if (!crawlSource) throw new Error("fixture Crawl connection missing");
    const [collectRun] = await handle.db
      .insert(asyncRuns)
      .values({
        workspace_id: scope.workspaceId,
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
      runId: collectRun!.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      sourceConnectionId: crawlSource.id,
      provider: "crawl",
      operation: "site_graph",
      methodVersion: CRAWL_METHOD_VERSION,
      parametersHash: contentHash({ x: 1 }),
    });
    const snapshot = await new DataSnapshotsRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      collectionRunId: collectRun!.id,
      sourceConnectionId: crawlSource.id,
      provider: "crawl",
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: "0.2.0",
      methodVersion: CRAWL_METHOD_VERSION,
      capturedAt,
      sourceWindow: { start: null, end: null },
      availability: "available",
      limitation: "static crawl",
      rawObjectKey: null,
      rowCount: 1,
      checksum: contentHash({ s: 1 }),
    });
    frozenSnapshot = snapshot;
    const gonePage = page404("https://dedup.example/gone");
    const sitePage = await new SitePagesRepository(
      handle.db,
    ).upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: gonePage.fetchUrl,
      templateKey: null,
    });
    await new ObservationsRepository(handle.db).insertMany(
      scope,
      snapshot.id,
      "crawl",
      [
        {
          sitePageId: sitePage.id,
          metricKey: METRIC_CRAWL_PAGE,
          subjectType: "url",
          subjectRef: "https://dedup.example/gone",
          observedAt: capturedAt,
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson: gonePage,
          unit: null,
          origin: "direct_public",
          grade: "B",
          support: "supports",
          limitation: "current public response",
        },
      ],
    );
    await collections.finalize(collectRun!.id, {
      rowCount: snapshot.row_count,
      sourceWindow: snapshot.source_window,
      providerUsage: { urlsFetched: 1, pagesCollected: 1 },
      stopReason: null,
    });
    await new SourceConnectionsRepository(handle.db).setLastSnapshot(
      crawlSource.id,
      snapshot.id,
      snapshot.availability,
      snapshot.limitation,
    );

    const observationRows = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(scope, [snapshot.id]);
    const observations: ObservationView[] = observationRows.map((o) => ({
      metricKey: o.metric_key,
      subjectType: o.subject_type,
      subjectRef: o.subject_ref,
      provider: o.provider,
      availability: o.availability,
      valueJson: o.value_json,
      observedAt: o.observed_at,
    }));

    // Run the PURE pipeline twice over the same inputs.
    const pipelineA = await runOnce(snapshot.id, observations);
    const pipelineB = await runOnce(snapshot.id, observations);
    const findA = pipelineA.findings.find((f) => f.ruleId === "TECH-HTTP-001");
    const findB = pipelineB.findings.find((f) => f.ruleId === "TECH-HTTP-001");
    expect(findA, "run A should surface TECH-HTTP-001").toBeDefined();
    expect(findB, "run B should surface TECH-HTTP-001").toBeDefined();
    expect(findA!.ruleVersion).toBe(2);
    expect(findB!.ruleVersion).toBe(2);
    // §8.6: cross-run identity is stable — the two runs produce the SAME key.
    expect(findB!.findingKey).toBe(findA!.findingKey);

    const repo = new FindingsRepository(handle.db);
    const findingKey = findA!.findingKey;

    // Persist run 1 (first sighting -> insert).
    const runId1 = await seedDiagnosticRun(snapshot);
    const now1 = new Date().toISOString();
    const first = await upsertFinding(repo, scope, runId1, findA!, now1);
    expect(first.isRehit).toBe(false);
    expect(await countFindings(findingKey)).toBe(1);
    const afterRun1 = (await repo.findByKey(scope, findingKey)) as FindingRow;
    expect(afterRun1.last_seen_run_id).toBe(runId1);

    // Persist run 2 (identical inputs -> re-hit the SAME row, not a duplicate).
    const runId2 = await seedDiagnosticRun(snapshot);
    const now2 = new Date().toISOString();
    const second = await upsertFinding(repo, scope, runId2, findB!, now2);
    expect(second.isRehit).toBe(true);
    expect(second.id).toBe(first.id);

    expect(await countFindings(findingKey)).toBe(1);
    const afterRun2 = (await repo.findByKey(scope, findingKey)) as FindingRow;
    expect(afterRun2.id).toBe(first.id);
    expect(afterRun2.first_seen_run_id).toBe(runId1); // first sighting preserved
    expect(afterRun2.last_seen_run_id).toBe(runId2); // advanced to run 2
    expect(afterRun2.rule_version).toBe(2);
  });

  it("the DB backstops dedup: a duplicate (project, finding_key) insert is rejected", async () => {
    // Even if code forgot findByKey, UNIQUE (project_id, finding_key) prevents a
    // second row for the same finding identity (migration 0001_init.sql:442).
    const pipeline = await runOnce("noop", [
      {
        metricKey: METRIC_CRAWL_PAGE,
        subjectType: "url",
        subjectRef: "https://dedup.example/gone",
        provider: "crawl",
        availability: "available",
        valueJson: page404("https://dedup.example/gone"),
        observedAt: new Date().toISOString(),
      },
    ]);
    const finding = pipeline.findings.find((f) => f.ruleId === "TECH-HTTP-001");
    expect(finding).toBeDefined();

    const repo = new FindingsRepository(handle.db);
    const existing = await repo.findByKey(scope, finding!.findingKey);
    expect(
      existing,
      "the finding already exists from the first test",
    ).not.toBeNull();

    if (!frozenSnapshot) throw new Error("dedup fixture snapshot missing");
    const runId = await seedDiagnosticRun(frozenSnapshot);
    let caught: unknown;
    try {
      await repo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        findingKey: finding!.findingKey,
        ruleId: finding!.ruleId,
        ruleVersion: finding!.ruleVersion,
        ruleFamily: finding!.ruleFamily,
        intent: finding!.intent,
        domain: finding!.domain,
        titleKey: finding!.titleKey,
        titleArgs: { ...finding!.titleArgs },
        summary: finding!.summary,
        summaryLocale: finding!.summaryLocale,
        subjectRefs: [...finding!.subjectRefs],
        severity: finding!.severity,
        confidence: finding!.confidence,
        reviewState: finding!.reviewState,
        runId,
        seenAt: new Date().toISOString(),
      });
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      "a duplicate finding_key insert must be rejected",
    ).toBeDefined();
    // 23505 = unique_violation.
    const code =
      (caught as { code?: string; cause?: { code?: string } })?.code ??
      (caught as { cause?: { code?: string } })?.cause?.code;
    expect(code).toBe("23505");
  });
});
