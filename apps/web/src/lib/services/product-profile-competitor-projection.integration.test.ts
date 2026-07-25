import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

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

import {
  createInitialProductProfileDraft,
  type ConfirmedProductProfile,
} from "@sf/contracts";
import {
  CompetitorsRepository,
  contentHash,
  type DbTx,
} from "@sf/db";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSafeTestDatabaseUrl } from "../../../../../packages/db/src/test-database-safety.ts";
import {
  buildProductProfileCompetitorOriginInput,
  projectConfirmedProductProfileCompetitors,
} from "./product-profile-competitor-projection";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

async function inRolledBackFixture(
  handle: DbHandle,
  test: (tx: DbTx) => Promise<void>,
): Promise<void> {
  const rollback = new Error(`rollback-competitor-projection-fixture-${randomUUID()}`);
  try {
    await handle.db.transaction(async (tx) => {
      await test(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

function confirmedProfile(project?: ProjectFixture): ConfirmedProductProfile {
  const publicHost =
    project === undefined
      ? "relayops.gengrowth.ai"
      : `p${project.projectId.slice(0, 8)}.projection.gengrowth.ai`;
  const draft = createInitialProductProfileDraft({
    sourceSiteId: project?.siteId ?? "00000000-0000-4000-8000-000000000003",
    sourcePageUrl:
      project === undefined
        ? `https://${publicHost}/product`
        : `https://${publicHost}/product`,
    businessHint: "B2B onboarding software",
  });
  return {
    ...draft,
    productName: "RelayOps",
    oneLiner: "Automate customer onboarding operations.",
    category: "Customer onboarding",
    productType: "B2B SaaS",
    businessModels: ["subscription"],
    valueProposition: "Help operations teams standardize onboarding.",
    coreFeatures: ["Workflow automation"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        candidateId: "00000000-0000-4000-8000-000000000010",
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies with 50-500 employees",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize customer onboarding"],
        triggers: ["Onboarding volume increased"],
        pains: ["Manual handoffs"],
        jtbd: ["Reduce time to value"],
        outcomes: ["Faster activation"],
        barriers: ["Fragmented systems"],
        qualificationSignals: ["Dedicated customer operations team"],
        disqualifiers: [],
      },
    ],
    competitorCandidates: [
      {
        candidateId: "00000000-0000-4000-8000-000000000011",
        name: "Competitor one",
        domain: "one.example",
        relationship: "direct",
        analysisScope: ["keyword_gap", "positioning"],
        similarity: 0.7,
        reason: "Grounded in product pages.",
        reviewStatus: "approved",
        confidence: "high",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000000012",
        name: "Competitor two",
        domain: "two.example",
        relationship: null,
        analysisScope: [],
        similarity: null,
        reason: "Candidate only.",
        reviewStatus: "candidate",
        confidence: "medium",
      },
    ],
    fieldProvenance: [
      ...draft.fieldProvenance,
      {
        path: "/competitorCandidates",
        derivation: "declared",
        confidence: "high",
        evidenceRefs: [
          {
            evidenceRefId: "00000000-0000-4000-8000-000000000020",
            kind: "userEdit",
          },
        ],
        limitation: "Customer-reviewed pool.",
        observedAt: null,
      },
      {
        path: "/competitorCandidates/0",
        derivation: "declared",
        confidence: "high",
        evidenceRefs: [
          {
            evidenceRefId: "00000000-0000-4000-8000-000000000021",
            kind: "userEdit",
          },
        ],
        limitation: "Exact candidate edit.",
        observedAt: null,
      },
    ],
    missingFields: draft.missingFields.filter(
      (path) => path !== "/competitorCandidates",
    ),
    conflictingFields: [],
  };
}

describe("product-profile competitor projection", () => {
  it("prefers exact candidate provenance over the pool anchor", () => {
    const profile = confirmedProfile();
    expect(
      buildProductProfileCompetitorOriginInput(
        { id: "00000000-0000-4000-8000-000000000100", version: 4 },
        profile,
        0,
      ),
    ).toMatchObject({
      productProfileId: "00000000-0000-4000-8000-000000000100",
      profileVersion: 4,
      candidateId: "00000000-0000-4000-8000-000000000011",
      fieldProvenancePath: "/competitorCandidates/0",
      evidenceRefs: [
        {
          evidenceRefId: "00000000-0000-4000-8000-000000000021",
          kind: "userEdit",
        },
      ],
      sourceReviewStatus: "approved",
      sourceRelationship: "direct",
      sourceAnalysisScope: ["keyword_gap", "positioning"],
    });
  });

  it("falls back to one pool-level provenance anchor only when exact candidate provenance is absent", () => {
    const profile = confirmedProfile();
    profile.fieldProvenance = profile.fieldProvenance.filter(
      (entry) => entry.path !== "/competitorCandidates/0",
    );
    expect(
      buildProductProfileCompetitorOriginInput(
        { id: "00000000-0000-4000-8000-000000000100", version: 4 },
        profile,
        1,
      ),
    ).toMatchObject({
      candidateId: "00000000-0000-4000-8000-000000000012",
      fieldProvenancePath: "/competitorCandidates",
      sourceReviewStatus: "candidate",
      sourceRelationship: null,
      sourceAnalysisScope: [],
    });
  });

  it("fails closed when no exact or pool-level traceable provenance exists", () => {
    const profile = confirmedProfile();
    profile.fieldProvenance = profile.fieldProvenance.filter(
      (entry) => !entry.path.startsWith("/competitorCandidates"),
    );
    expect(() =>
      buildProductProfileCompetitorOriginInput(
        { id: "00000000-0000-4000-8000-000000000100", version: 4 },
        profile,
        0,
      ),
    ).toThrowError(/no exact traceable provenance/i);
  });

});

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly actorId: string;
}

async function createProject(db: DbTx): Promise<ProjectFixture> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const actorId = randomUUID();
  await db.execute(sql`INSERT INTO app.workspaces (id, name) VALUES (${workspaceId}, ${`Projection ${workspaceId}`})`);
  await db.execute(sql`INSERT INTO app.client_projects (
      id, workspace_id, client_name, project_name,
      default_delivery_locale, created_by
    ) VALUES (${projectId},${workspaceId},${`Client ${projectId}`},${`Project ${projectId}`},'zh-CN',${actorId})`);
  const host = `p${projectId.slice(0, 8)}.projection.gengrowth.ai`;
  await db.execute(sql`INSERT INTO app.sites (
      id, workspace_id, project_id, origin, host,
      market_codes, language_codes, is_primary
    ) VALUES (${siteId},${workspaceId},${projectId},${`https://${host}`},${host},ARRAY['US'],ARRAY['en-US'],true)`);
  return { workspaceId, projectId, siteId, actorId };
}

async function createConfirmedProfile(
  db: DbHandle["db"],
  project: ProjectFixture,
): Promise<{
  readonly id: string;
  readonly version: number;
  readonly profile: ConfirmedProductProfile;
}> {
  const id = randomUUID();
  const version = 1;
  const profile = confirmedProfile(project);
  await db.execute(sql`INSERT INTO app.icp_profiles (
      id, workspace_id, project_id, version, status, profile, content_hash, created_by
    ) VALUES (
      ${id},
      ${project.workspaceId},
      ${project.projectId},
      ${version},
      'complete',
      ${profile},
      ${contentHash({ status: "complete", profile })},
      ${project.actorId}
    )`);
  await db.execute(sql`UPDATE app.client_projects
      SET current_icp_profile_id = ${id}, confirmed_icp_profile_id = ${id}
      WHERE workspace_id = ${project.workspaceId} AND id = ${project.projectId}`);
  return { id, version, profile };
}

async function createCsvCompetitorOrigin(
  db: DbHandle["db"],
  project: ProjectFixture,
  domain: string,
): Promise<void> {
  const repository = new CompetitorsRepository(db);
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  const importPreviewId = randomUUID();
  const sourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const capturedAt = "2026-07-22T08:00:00.000Z";

  await db.execute(sql`INSERT INTO app.import_previews (
      id, workspace_id, project_id, site_id, created_by,
      token_hash, template_id, raw_object_key, file_checksum,
      row_count, detected_columns, suggested_mapping, preview_rows,
      validation_errors, validation_warnings, status, expires_at, consumed_at
    ) VALUES (
      ${importPreviewId},${project.workspaceId},${project.projectId},${project.siteId},${project.actorId},${Buffer.alloc(32)},'keyword_gap_v1',${`raw/${importPreviewId}.csv`},${contentHash({ importPreviewId })},1,
      '[]'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
      'consumed',${"2026-07-23T08:00:00.000Z"},${capturedAt}
    )`);
  await db.execute(sql`INSERT INTO app.source_connections (
      id, workspace_id, project_id, site_id, provider,
      connection_type, state, external_ref, limitation,
      connected_at, created_by
    ) VALUES (
      ${sourceConnectionId},${project.workspaceId},${project.projectId},${project.siteId},'csv','file_import','available',${importPreviewId},
      'Customer-provided keyword-gap CSV.',${capturedAt},${project.actorId}
    )`);
  await db.execute(sql`INSERT INTO app.async_runs (
      id, workspace_id, project_id, kind, status, initiated_by, started_at
    ) VALUES (${collectionRunId},${project.workspaceId},${project.projectId},'collection','running',${project.actorId},${capturedAt})`);
  await db.execute(sql`INSERT INTO app.collection_runs (
      id, workspace_id, project_id, site_id, source_connection_id,
      import_preview_id, provider, operation, method_version, parameters_hash
    ) VALUES (
      ${collectionRunId},${project.workspaceId},${project.projectId},${project.siteId},${sourceConnectionId},${importPreviewId},'csv','keyword_gap_import',
      'csv.keyword_gap.v1',${contentHash({ collectionRunId })}
    )`);
  await db.execute(sql`INSERT INTO app.data_snapshots (
      id, workspace_id, project_id, site_id, collection_run_id,
      source_connection_id, provider, dataset_key, schema_version,
      method_version, captured_at, source_window, availability,
      limitation, row_count, checksum, summary
    ) VALUES (
      ${snapshotId},${project.workspaceId},${project.projectId},${project.siteId},${collectionRunId},${sourceConnectionId},'csv','csv.keyword_gap.v1','0.3.0',
      'csv.keyword_gap.v1',${capturedAt},'{"start":null,"end":null}'::jsonb,
      'available','Customer-provided keyword-gap CSV.',1,${contentHash({ snapshotId })},'{}'::jsonb
    )`);
  await db.execute(sql`INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, provider,
      metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    ) VALUES (
      ${observationId},${project.workspaceId},${project.projectId},${snapshotId},'csv','csv.keyword_gap.v1','keyword_cluster',
      'competitor-library',${capturedAt},'available',${{
        keyword: "customer onboarding",
        clusterKey: "customer-onboarding",
        searchVolume: 100,
        currentUrl: null,
        currentRank: null,
        competitorDomain: domain,
        competitorRank: 4,
        marketCode: "US",
        languageCode: "en-US",
      }},'user_provided','C',
      'context','Customer-provided keyword-gap CSV.'
    )`);

  await repository.upsertOrigin(
    { workspaceId: project.workspaceId, projectId: project.projectId },
    {
      originKind: "csv_keyword_gap",
      domain,
      name: null,
      snapshotId,
      observationId,
      importPreviewId,
      sourcePointer: "/valueJson/competitorDomain",
    },
  );
}

describeDb("product-profile competitor projection integration", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    // This file is DB-backed, so it belongs to the `integration` project, whose
    // setup already refuses anything but a disposable loopback database. It
    // used to sit in the `unit` project behind a hardcoded database NAME from
    // one machine, which meant `pnpm test` went red the moment DATABASE_URL was
    // exported, and its assertions ran in no gate at all when it was not.
    requireSafeTestDatabaseUrl(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("writes exact product_profile origins and stays idempotent across replay", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const project = await createProject(tx);
      const confirmed = await createConfirmedProfile(tx, project);
      const scope = {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
      };

      await projectConfirmedProductProfileCompetitors(
        tx,
        scope,
        { id: confirmed.id, version: confirmed.version },
        confirmed.profile,
      );
      await projectConfirmedProductProfileCompetitors(
        tx,
        scope,
        { id: confirmed.id, version: confirmed.version },
        confirmed.profile,
      );

      const repository = new CompetitorsRepository(tx);
      const page = await repository.listByProject(scope, { limit: 10, cursor: null });
      expect(page.rows).toHaveLength(2);
      const exact = page.rows.find((row) => row.domain === "one.example");
      const pool = page.rows.find((row) => row.domain === "two.example");
      expect(exact).toMatchObject({
        review_status: "approved",
        relationship: "direct",
        analysis_scope: ["keyword_gap", "positioning"],
        origin_count: 1,
      });
      expect(pool).toMatchObject({
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        origin_count: 1,
      });
      const exactOrigins = await repository.listOrigins(scope, exact!.id, 10);
      expect(exactOrigins).toHaveLength(1);
      expect(exactOrigins[0]).toMatchObject({
        origin_kind: "product_profile",
        product_profile_id: confirmed.id,
        profile_version: confirmed.version,
        candidate_id: "00000000-0000-4000-8000-000000000011",
        field_provenance_path: "/competitorCandidates/0",
      });
      const poolOrigins = await repository.listOrigins(scope, pool!.id, 10);
      expect(poolOrigins).toHaveLength(1);
      expect(poolOrigins[0]).toMatchObject({
        origin_kind: "product_profile",
        product_profile_id: confirmed.id,
        profile_version: confirmed.version,
        candidate_id: "00000000-0000-4000-8000-000000000012",
        field_provenance_path: "/competitorCandidates",
      });
    });
  });

  it("does not auto-promote existing csv-first candidate governance when a confirmed profile arrives later", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const project = await createProject(tx);
      await createCsvCompetitorOrigin(tx, project, "one.example");
      const confirmed = await createConfirmedProfile(tx, project);
      const scope = {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
      };

      await projectConfirmedProductProfileCompetitors(
        tx,
        scope,
        { id: confirmed.id, version: confirmed.version },
        confirmed.profile,
      );

      const repository = new CompetitorsRepository(tx);
      const page = await repository.listByProject(scope, { limit: 10, cursor: null });
      const exact = page.rows.find((row) => row.domain === "one.example");
      expect(exact).toMatchObject({
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        origin_count: 2,
      });
      const origins = await repository.listOrigins(scope, exact!.id, 10);
      expect(origins.map((origin) => origin.origin_kind).sort()).toEqual([
        "csv_keyword_gap",
        "product_profile",
      ]);
    });
  });
});
