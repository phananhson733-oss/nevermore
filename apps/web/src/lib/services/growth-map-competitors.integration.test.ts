import { randomBytes, randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import {
  AnalysisRefreshRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  CompetitorsRepository,
  GROWTH_AUDIT_PROJECTION_VERSION,
  contentHash,
  createDbHandle,
  type CanonicalValue,
  type DbHandle,
  type DbTx,
} from "@sf/db";
import {
  buildContextProjectionV1,
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
  type GovernanceCompetitorAnalysisScope,
  type GovernanceCompetitorOriginRefV1,
  type GovernanceCompetitorRelationship,
  type GovernanceCompetitorReviewStatus,
} from "@sf/engine";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  dataSnapshots,
  diagnosticRuns,
  icpProfiles,
  importPreviews,
  normalizedObservations,
  sites,
  sourceConnections,
  workspaces,
} from "@sf/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getProjectAuditCompetitor,
  getProjectAuditCompetitorReviewDetail,
  listProjectAuditCompetitors,
  reviewProjectAuditCompetitor,
} from "./growth-map-competitors.ts";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const OBSERVED_AT = "2026-07-22T09:00:00.000Z";

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly actorId: string;
  readonly host: string;
}

interface CompetitorFixture {
  readonly competitorId: string;
  readonly profileOriginId: string;
  readonly csvOriginId: string;
  readonly manualOriginId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly candidateId: string;
  readonly evidenceRefId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly importPreviewId: string;
  readonly privateProfilePayload: string;
  readonly privateRawObjectKey: string;
  readonly privateObservationPayload: string;
  readonly profileContentHash: string;
}

interface ProfileOriginFixture {
  readonly profileOriginId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly profileContentHash: string;
  readonly candidateId: string;
  readonly evidenceRefId: string;
}

interface SerpOriginFixture {
  readonly originId: string;
  readonly collectionRunId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly sourceConnectionId: string;
  readonly checksum: string;
}

async function inRolledBackFixture(
  handle: DbHandle,
  test: (tx: DbTx) => Promise<void>,
): Promise<void> {
  const rollback = new Error(`rollback-competitor-fixture-${randomUUID()}`);
  try {
    await handle.db.transaction(async (tx) => {
      await test(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function seedProject(
  tx: DbTx,
  workspaceId: string,
  label: string,
): Promise<ProjectFixture> {
  const projectId = randomUUID();
  const siteId = randomUUID();
  const actorId = randomUUID();
  const host = `${label.toLowerCase()}-${projectId}.example.com`;
  await tx.insert(clientProjects).values({
    id: projectId,
    workspace_id: workspaceId,
    client_name: `${label} client`,
    project_name: `${label} project`,
    default_delivery_locale: "zh-CN",
    created_by: actorId,
  });
  await tx.insert(sites).values({
    id: siteId,
    workspace_id: workspaceId,
    project_id: projectId,
    origin: `https://${host}`,
    host,
    market_codes: ["US"],
    language_codes: ["en-US"],
    is_primary: true,
  });
  return { workspaceId, projectId, siteId, actorId, host };
}

async function seedCanonicalCompetitor(
  tx: DbTx,
  project: ProjectFixture,
): Promise<CompetitorFixture> {
  const domain = "canonical-competitor.example";
  const name = "Canonical Competitor";
  const profileId = randomUUID();
  const profileVersion = 1;
  const candidateId = randomUUID();
  const evidenceRefId = randomUUID();
  const privateProfilePayload = `private-profile-${randomUUID()}`;
  const evidenceRefs = [
    { evidenceRefId, kind: "userEdit" as const },
  ];
  const profile = {
    profileSchemaVersion: "product-profile.0.3.0",
    productName: "Competitor research fixture",
    oneLiner: "Deterministic competitor research for growth planning",
    productType: "saas",
    businessModels: ["subscription"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        reviewStatus: "primary",
        targetCompanyOrAudience: "Growth teams",
      },
    ],
    sourceSiteId: project.siteId,
    sourcePageUrl: `https://${project.host}/`,
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    competitorCandidates: [
      {
        candidateId,
        name,
        domain,
        relationship: "direct",
        analysisScope: ["keyword_gap", "positioning"],
        similarity: null,
        reason: "Customer-confirmed direct competitor.",
        reviewStatus: "approved",
        confidence: "high",
      },
    ],
    fieldProvenance: [
      {
        path: "/competitorCandidates/0",
        derivation: "declared",
        confidence: "high",
        evidenceRefs,
        limitation: "Confirmed by the customer.",
        observedAt: null,
      },
    ],
    privateProfilePayload,
  };
  await tx.insert(icpProfiles).values({
    id: profileId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    version: profileVersion,
    status: "complete",
    profile,
    content_hash: contentHash(profile),
    created_by: project.actorId,
  });
  await tx
    .update(clientProjects)
    .set({
      current_icp_profile_id: profileId,
      confirmed_icp_profile_id: profileId,
    })
    .where(eq(clientProjects.id, project.projectId));

  const repository = new CompetitorsRepository(tx);
  const scope = {
    workspaceId: project.workspaceId,
    projectId: project.projectId,
  };
  const importPreviewId = randomUUID();
  const sourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  const privateRawObjectKey = `private/csv/${randomUUID()}.csv`;
  const privateObservationPayload = `private-observation-${randomUUID()}`;
  await tx.insert(importPreviews).values({
    id: importPreviewId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    created_by: project.actorId,
    token_hash: randomBytes(32),
    template_id: "keyword_gap_v1",
    raw_object_key: privateRawObjectKey,
    file_checksum: contentHash({ importPreviewId }),
    row_count: 1,
    detected_columns: [],
    suggested_mapping: {},
    preview_rows: [],
    validation_errors: [],
    validation_warnings: [],
    status: "consumed",
    expires_at: "2026-07-23T09:00:00.000Z",
    consumed_at: OBSERVED_AT,
  });
  await tx.insert(sourceConnections).values({
    id: sourceConnectionId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    provider: "csv",
    connection_type: "file_import",
    state: "available",
    external_ref: importPreviewId,
    limitation: "Customer-provided keyword-gap CSV.",
    connected_at: OBSERVED_AT,
    created_by: project.actorId,
  });
  await tx.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    kind: "collection",
    status: "running",
    initiated_by: project.actorId,
    started_at: OBSERVED_AT,
  });
  await tx.insert(collectionRuns).values({
    id: collectionRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    source_connection_id: sourceConnectionId,
    import_preview_id: importPreviewId,
    provider: "csv",
    operation: "keyword_gap_import",
    method_version: "csv.keyword_gap.v1",
    parameters_hash: contentHash({ collectionRunId, importPreviewId }),
  });
  await tx.insert(dataSnapshots).values({
    id: snapshotId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    collection_run_id: collectionRunId,
    source_connection_id: sourceConnectionId,
    provider: "csv",
    dataset_key: "csv.keyword_gap.v1",
    schema_version: "0.3.0",
    method_version: "csv.keyword_gap.v1",
    captured_at: OBSERVED_AT,
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "Customer-provided keyword-gap CSV.",
    raw_object_key: privateRawObjectKey,
    row_count: 1,
    checksum: contentHash({ snapshotId, observationId }),
    summary: { privateImportPayload: privateRawObjectKey },
  });
  await tx.insert(normalizedObservations).values({
    id: observationId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    snapshot_id: snapshotId,
    site_page_id: null,
    provider: "csv",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: "customer-onboarding",
    observed_at: OBSERVED_AT,
    availability: "available",
    value_json: {
      keyword: "customer onboarding",
      clusterKey: "customer-onboarding",
      searchVolume: 100,
      currentUrl: null,
      currentRank: null,
      competitorDomain: domain,
      competitorRank: 4,
      marketCode: "US",
      languageCode: "en-US",
      privateProviderPayload: privateObservationPayload,
    },
    origin: "user_provided",
    method: "observed",
    grade: "C",
    support: "supports",
    limitation: "Customer-provided keyword-gap CSV.",
  });
  const csv = await repository.upsertOrigin(scope, {
    originKind: "csv_keyword_gap",
    domain,
    name: null,
    snapshotId,
    observationId,
    importPreviewId,
    sourcePointer: "/valueJson/competitorDomain",
  });
  const productProfile = await repository.upsertOrigin(scope, {
    originKind: "product_profile",
    domain,
    name,
    productProfileId: profileId,
    profileVersion,
    candidateId,
    fieldProvenancePath: "/competitorCandidates/0",
    evidenceRefs,
    sourceReviewStatus: "approved",
    sourceRelationship: "direct",
    sourceAnalysisScope: ["keyword_gap", "positioning"],
  });
  const manualOriginId = randomUUID();
  const manual = await repository.upsertOrigin(scope, {
    originKind: "manual",
    domain,
    name,
    manualEntryId: manualOriginId,
  });
  expect(csv.competitorId).toBe(productProfile.competitorId);
  expect(manual.competitorId).toBe(productProfile.competitorId);

  return {
    competitorId: productProfile.competitorId,
    profileOriginId: productProfile.occurrenceId,
    csvOriginId: csv.occurrenceId,
    manualOriginId: manual.occurrenceId,
    profileId,
    profileVersion,
    candidateId,
    evidenceRefId,
    snapshotId,
    observationId,
    importPreviewId,
    privateProfilePayload,
    privateRawObjectKey,
    privateObservationPayload,
    profileContentHash: contentHash(profile),
  };
}

async function confirmNextProfileOrigin(
  tx: DbTx,
  project: ProjectFixture,
  competitor: CompetitorFixture,
): Promise<ProfileOriginFixture> {
  const profileId = randomUUID();
  const profileVersion = competitor.profileVersion + 1;
  const candidateId = randomUUID();
  const evidenceRefId = randomUUID();
  const evidenceRefs = [
    { evidenceRefId, kind: "userEdit" as const },
  ];
  const profile = {
    profileSchemaVersion: "product-profile.0.3.0",
    productName: "Competitor research fixture",
    oneLiner: "Deterministic competitor research for growth planning",
    productType: "saas",
    businessModels: ["subscription"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        reviewStatus: "primary",
        targetCompanyOrAudience: "Growth teams",
      },
    ],
    sourceSiteId: project.siteId,
    sourcePageUrl: `https://${project.host}/`,
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    competitorCandidates: [
      {
        candidateId,
        name: "Canonical Competitor",
        domain: "canonical-competitor.example",
        relationship: "direct",
        analysisScope: ["keyword_gap", "positioning"],
        similarity: null,
        reason: "Customer-confirmed direct competitor in V2.",
        reviewStatus: "approved",
        confidence: "high",
      },
    ],
    fieldProvenance: [
      {
        path: "/competitorCandidates/0",
        derivation: "declared",
        confidence: "high",
        evidenceRefs,
        limitation: "Confirmed by the customer in V2.",
        observedAt: null,
      },
    ],
  };
  await tx.insert(icpProfiles).values({
    id: profileId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    version: profileVersion,
    status: "complete",
    profile,
    content_hash: contentHash(profile),
    created_by: project.actorId,
  });
  await tx
    .update(clientProjects)
    .set({
      current_icp_profile_id: profileId,
      confirmed_icp_profile_id: profileId,
    })
    .where(eq(clientProjects.id, project.projectId));

  const origin = await new CompetitorsRepository(tx).upsertOrigin(
    {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    },
    {
      originKind: "product_profile",
      domain: "canonical-competitor.example",
      name: "Canonical Competitor",
      productProfileId: profileId,
      profileVersion,
      candidateId,
      fieldProvenancePath: "/competitorCandidates/0",
      evidenceRefs,
      sourceReviewStatus: "approved",
      sourceRelationship: "direct",
      sourceAnalysisScope: ["keyword_gap", "positioning"],
    },
  );
  expect(origin.competitorId).toBe(competitor.competitorId);
  return {
    profileOriginId: origin.occurrenceId,
    profileId,
    profileVersion,
    profileContentHash: contentHash(profile),
    candidateId,
    evidenceRefId,
  };
}

async function seedSerpOverlapOrigin(
  tx: DbTx,
  project: ProjectFixture,
  competitor: CompetitorFixture,
): Promise<SerpOriginFixture> {
  const sourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  const checksum = contentHash({ snapshotId, observationId });
  const limitation =
    "DataForSEO competitor-domain data is updated weekly and has no exact vendor dataset timestamp.";

  await tx.insert(sourceConnections).values({
    id: sourceConnectionId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    provider: "dataforseo",
    connection_type: "api_key_stub",
    state: "available",
    external_ref: project.host,
    limitation,
    connected_at: OBSERVED_AT,
    created_by: project.actorId,
  });
  await tx.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    kind: "collection",
    status: "completed",
    result_type: "collection_run",
    result_id: collectionRunId,
    initiated_by: project.actorId,
    queued_at: OBSERVED_AT,
    started_at: OBSERVED_AT,
    completed_at: OBSERVED_AT,
  });
  await tx.insert(collectionRuns).values({
    id: collectionRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    operation: "search_landscape",
    method_version: "dataforseo.search_landscape.v2",
    parameters_hash: contentHash({
      provider: "dataforseo",
      operation: "search_landscape",
      siteId: project.siteId,
      target: project.host,
    }),
  });
  await tx.insert(dataSnapshots).values({
    id: snapshotId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    collection_run_id: collectionRunId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    dataset_key: "dataforseo.search_landscape.v2",
    schema_version: "dataforseo.search_landscape.v2",
    method_version: "dataforseo.search_landscape.v2",
    captured_at: OBSERVED_AT,
    source_window: { start: null, end: null },
    availability: "available",
    limitation,
    raw_object_key: null,
    row_count: 1,
    checksum,
    summary: {
      collectionScope: {
        target: project.host,
        marketCode: "US",
        languageTag: "en-US",
      },
    },
  });
  await tx
    .update(collectionRuns)
    .set({
      row_count: 1,
      source_window: { start: null, end: null },
      provider_usage: {
        apiCalls: 2,
        rowsReturned: 1,
        rowsRetained: 1,
        costUsd: 0,
      },
      stop_reason: "completed",
    })
    .where(eq(collectionRuns.id, collectionRunId));
  await tx.insert(normalizedObservations).values({
    id: observationId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    snapshot_id: snapshotId,
    site_page_id: null,
    provider: "dataforseo",
    metric_key: "dataforseo.competitor_domain.v1",
    subject_type: "site",
    subject_ref: "canonical-competitor.example",
    observed_at: OBSERVED_AT,
    availability: "available",
    value_numeric: null,
    value_text: null,
    value_json: {
      targetDomain: project.host,
      competitorDomain: "canonical-competitor.example",
      intersections: 17,
      averagePosition: 8.5,
      summedPosition: 144,
      organicEstimatedTrafficVolume: 901.25,
      marketCode: "US",
      languageCode: "en",
    },
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "supports",
    limitation,
  });

  const projected = await new CompetitorsRepository(tx).upsertOrigin(
    {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    },
    {
      originKind: "serp_overlap",
      domain: "canonical-competitor.example",
      name: null,
      snapshotId,
      observationId,
      sourcePointer: "/valueJson/competitorDomain",
    },
  );
  expect(projected.competitorId).toBe(competitor.competitorId);
  return {
    originId: projected.occurrenceId,
    collectionRunId,
    snapshotId,
    observationId,
    sourceConnectionId,
    checksum,
  };
}

interface PublishedCompetitorGovernance {
  readonly reviewStatus: GovernanceCompetitorReviewStatus;
  readonly revision: number;
  readonly relationship: GovernanceCompetitorRelationship | null;
  readonly analysisScopes: readonly GovernanceCompetitorAnalysisScope[];
  readonly originRefs: readonly GovernanceCompetitorOriginRefV1[];
}

interface PublishedGenerationFixture {
  readonly diagnosticRunId: string;
  readonly crawlSourceConnectionId: string;
}

function competitorOriginRefs(
  competitor: CompetitorFixture,
  additionalProfileOrigins: readonly ProfileOriginFixture[] = [],
  additionalOrigins: readonly GovernanceCompetitorOriginRefV1[] = [],
): GovernanceCompetitorOriginRefV1[] {
  return [
    {
      occurrenceId: competitor.csvOriginId,
      originKind: "csv_keyword_gap",
      snapshotId: competitor.snapshotId,
      observationId: competitor.observationId,
    },
    {
      occurrenceId: competitor.profileOriginId,
      originKind: "product_profile",
      snapshotId: null,
      observationId: null,
    },
    ...additionalProfileOrigins.map((origin) => ({
      occurrenceId: origin.profileOriginId,
      originKind: "product_profile" as const,
      snapshotId: null,
      observationId: null,
    })),
    {
      occurrenceId: competitor.manualOriginId,
      originKind: "manual",
      snapshotId: null,
      observationId: null,
    },
    ...additionalOrigins,
  ];
}

async function seedPublishedCompetitorGeneration(
  tx: DbTx,
  project: ProjectFixture,
  competitor: CompetitorFixture,
  input: {
    readonly completedAt: string;
    readonly governance: PublishedCompetitorGovernance;
    readonly profile?: {
      readonly id: string;
      readonly version: number;
      readonly contentHash: string;
    };
    readonly crawlSourceConnectionId?: string;
    readonly dataForSeo?: SerpOriginFixture;
    readonly publish?: boolean;
  },
): Promise<PublishedGenerationFixture> {
  const crawlSourceConnectionId =
    input.crawlSourceConnectionId ?? randomUUID();
  const crawlCollectionRunId = randomUUID();
  const crawlSnapshotId = randomUUID();
  const crawlChecksum = contentHash({ crawlSnapshotId });
  const sourceWindow = { start: null, end: null };

  if (input.crawlSourceConnectionId === undefined) {
    await tx.insert(sourceConnections).values({
      id: crawlSourceConnectionId,
      workspace_id: project.workspaceId,
      project_id: project.projectId,
      site_id: project.siteId,
      provider: "crawl",
      connection_type: "public",
      state: "available",
      external_ref: `https://${project.host}`,
      limitation: "Bounded public crawl fixture.",
      connected_at: input.completedAt,
      created_by: project.actorId,
    });
  }
  await tx.insert(asyncRuns).values({
    id: crawlCollectionRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    kind: "collection",
    status: "completed",
    result_type: "collection_run",
    result_id: crawlCollectionRunId,
    initiated_by: project.actorId,
    queued_at: input.completedAt,
    started_at: input.completedAt,
    completed_at: input.completedAt,
  });
  await tx.insert(collectionRuns).values({
    id: crawlCollectionRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    source_connection_id: crawlSourceConnectionId,
    provider: "crawl",
    operation: "site_graph",
    method_version: "crawl.site_graph.v2",
    parameters_hash: contentHash({ crawlCollectionRunId }),
  });
  await tx.insert(dataSnapshots).values({
    id: crawlSnapshotId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    collection_run_id: crawlCollectionRunId,
    source_connection_id: crawlSourceConnectionId,
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "0.3.0",
    method_version: "crawl.site_graph.v2",
    captured_at: input.completedAt,
    source_window: sourceWindow,
    availability: "available",
    limitation: "Bounded public crawl fixture.",
    raw_object_key: null,
    row_count: 1,
    checksum: crawlChecksum,
    summary: {},
  });
  await tx
    .update(collectionRuns)
    .set({
      row_count: 1,
      source_window: sourceWindow,
      provider_usage: {},
      stop_reason: "completed",
    })
    .where(eq(collectionRuns.id, crawlCollectionRunId));

  const diagnosticRunId = randomUUID();
  const csvChecksum = contentHash({
    snapshotId: competitor.snapshotId,
    observationId: competitor.observationId,
  });
  const profile = input.profile ?? {
    id: competitor.profileId,
    version: competitor.profileVersion,
    contentHash: competitor.profileContentHash,
  };
  const [profileSource] = await tx
    .select({
      profile: icpProfiles.profile,
      contentHash: icpProfiles.content_hash,
    })
    .from(icpProfiles)
    .where(eq(icpProfiles.id, profile.id));
  if (!profileSource || profileSource.contentHash !== profile.contentHash) {
    throw new Error("Published generation fixture Profile lineage is invalid");
  }
  const [siteSource] = await tx
    .select({ languageCodes: sites.language_codes })
    .from(sites)
    .where(eq(sites.id, project.siteId));
  if (!siteSource) {
    throw new Error("Published generation fixture Site is missing");
  }
  const contextProjection = buildContextProjectionV1({
    profile: profileSource.profile,
    profileContentHash: profileSource.contentHash,
    siteLanguageCodes: siteSource.languageCodes,
  });
  const manifest = {
    projectId: project.projectId,
    siteId: project.siteId,
    icp: {
      id: profile.id,
      version: profile.version,
      contentHash: profile.contentHash,
    },
    snapshots: [
      {
        snapshotId: crawlSnapshotId,
        provider: "crawl",
        datasetKey: "crawl.site_graph.v1",
        schemaVersion: "0.3.0",
        methodVersion: "crawl.site_graph.v2",
        checksum: crawlChecksum,
        capturedAt: input.completedAt,
        sourceWindow,
        availability: "available",
      },
      {
        snapshotId: competitor.snapshotId,
        provider: "csv",
        datasetKey: "csv.keyword_gap.v1",
        schemaVersion: "0.3.0",
        methodVersion: "csv.keyword_gap.v1",
        checksum: csvChecksum,
        capturedAt: OBSERVED_AT,
        sourceWindow,
        availability: "available",
      },
      ...(input.dataForSeo
        ? [
            {
              snapshotId: input.dataForSeo.snapshotId,
              provider: "dataforseo",
              datasetKey: "dataforseo.search_landscape.v2",
              schemaVersion: "dataforseo.search_landscape.v2",
              methodVersion: "dataforseo.search_landscape.v2",
              checksum: input.dataForSeo.checksum,
              capturedAt: OBSERVED_AT,
              sourceWindow,
              availability: "available",
            },
          ]
        : []),
    ],
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "zh-CN",
    governance: {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [
        {
          competitorEntityId: competitor.competitorId,
          domain: "canonical-competitor.example",
          reviewStatus: input.governance.reviewStatus,
          revision: input.governance.revision,
          relationship: input.governance.relationship,
          analysisScopes: [...input.governance.analysisScopes],
          originRefs: [...input.governance.originRefs],
        },
      ],
    },
    contextProjection,
  };
  const manifestHash = contentHash(
    manifest as unknown as CanonicalValue,
  );

  await tx.insert(asyncRuns).values({
    id: diagnosticRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    kind: "diagnostic",
    status: "completed",
    result_type: "diagnostic_run",
    result_id: diagnosticRunId,
    initiated_by: project.actorId,
    queued_at: input.completedAt,
    started_at: input.completedAt,
    completed_at: input.completedAt,
  });
  await tx.insert(diagnosticRuns).values({
    id: diagnosticRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    icp_profile_id: profile.id,
    icp_profile_version: profile.version,
    rule_set_version: RULE_SET_VERSION,
    prompt_set_version: PROMPT_SET_VERSION,
    output_locale: "zh-CN",
    input_manifest: manifest,
    input_hash: manifestHash,
    coverage: {},
    created_at: input.completedAt,
  });
  await new CapabilityRunsRepository(tx).create({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    asyncRunId: diagnosticRunId,
    capabilityId: "growth-audit",
    capabilityVersion: "0.3.0",
    inputManifestHash: contentHash({ diagnosticRunId }),
    mode: "production",
    sideEffectClass: "read_only",
  });
  await new AuditRunsRepository(tx).create({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    diagnosticRunId,
    capabilityRunId: diagnosticRunId,
    scopeKind: "site",
    scopeKey: project.siteId,
    projectionVersion: GROWTH_AUDIT_PROJECTION_VERSION,
  });

  if (input.publish === false) {
    return {
      diagnosticRunId,
      crawlSourceConnectionId,
    };
  }

  const analysisRefreshRunId = randomUUID();
  await tx.insert(asyncRuns).values({
    id: analysisRefreshRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    kind: "analysis_refresh",
    status: "running",
    result_type: "analysis_refresh_run",
    result_id: analysisRefreshRunId,
    initiated_by: project.actorId,
    queued_at: input.completedAt,
    started_at: input.completedAt,
  });
  const refreshes = new AnalysisRefreshRunsRepository(tx);
  await refreshes.create({
    runId: analysisRefreshRunId,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    siteId: project.siteId,
    icpProfileId: profile.id,
  });
  const projectScope = {
    workspaceId: project.workspaceId,
    projectId: project.projectId,
  };
  if (
    !(await refreshes.startStep(
      projectScope,
      analysisRefreshRunId,
      "crawl",
      crawlCollectionRunId,
    )) ||
    !(await refreshes.completeStep(
      projectScope,
      analysisRefreshRunId,
      "crawl",
      {
        childAsyncRunId: crawlCollectionRunId,
        resultSnapshotId: crawlSnapshotId,
      },
    ))
  ) {
    throw new Error("Could not publish the fixture Crawl step.");
  }
  for (const stepKey of ["gsc", "ga4"] as const) {
    if (
      !(await refreshes.skipStep(
        projectScope,
        analysisRefreshRunId,
        stepKey,
        "Provider is not configured in this competitor fixture.",
      ))
    ) {
      throw new Error(`Could not skip the fixture ${stepKey} step.`);
    }
  }
  if (input.dataForSeo) {
    if (
      !(await refreshes.startStep(
        projectScope,
        analysisRefreshRunId,
        "dataforseo",
        input.dataForSeo.collectionRunId,
      )) ||
      !(await refreshes.completeStep(
        projectScope,
        analysisRefreshRunId,
        "dataforseo",
        {
          childAsyncRunId: input.dataForSeo.collectionRunId,
          resultSnapshotId: input.dataForSeo.snapshotId,
        },
      ))
    ) {
      throw new Error("Could not publish the fixture DataForSEO step.");
    }
  } else if (
    !(await refreshes.skipStep(
      projectScope,
      analysisRefreshRunId,
      "dataforseo",
      "Provider is not configured in this competitor fixture.",
    ))
  ) {
    throw new Error("Could not skip the fixture dataforseo step.");
  }
  if (
    !(await refreshes.skipStep(
      projectScope,
      analysisRefreshRunId,
      "dataforseo_backlinks",
      "Provider is not configured in this competitor fixture.",
    ))
  ) {
    throw new Error("Could not skip the fixture dataforseo backlinks step.");
  }
  if (
    !(await refreshes.startStep(
      projectScope,
      analysisRefreshRunId,
      "growth_audit",
      diagnosticRunId,
    )) ||
    !(await refreshes.completeStep(
      projectScope,
      analysisRefreshRunId,
      "growth_audit",
      {
        childAsyncRunId: diagnosticRunId,
        resultSnapshotId: null,
      },
    ))
  ) {
    throw new Error("Could not publish the fixture Growth Audit step.");
  }
  await tx
    .update(asyncRuns)
    .set({
      status: "completed",
      completed_at: input.completedAt,
      updated_at: input.completedAt,
    })
    .where(eq(asyncRuns.id, analysisRefreshRunId));

  return {
    diagnosticRunId,
    crawlSourceConnectionId,
  };
}

describeDb("Growth Map Competitor Library real Postgres projection", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("projects exact canonical origins with project isolation and no private raw leakage", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: `Competitor read integration ${workspaceId}`,
      });
      const localProject = await seedProject(tx, workspaceId, "Local");
      const foreignProject = await seedProject(tx, workspaceId, "Foreign");
      const local = await seedCanonicalCompetitor(tx, localProject);
      const published = await seedPublishedCompetitorGeneration(
        tx,
        localProject,
        local,
        {
          completedAt: "2026-07-22T10:00:00.000Z",
          governance: {
            reviewStatus: "candidate",
            revision: 0,
            relationship: null,
            analysisScopes: [],
            originRefs: competitorOriginRefs(local),
          },
        },
      );
      const foreignManualId = randomUUID();
      const foreign = await new CompetitorsRepository(tx).upsertOrigin(
        {
          workspaceId,
          projectId: foreignProject.projectId,
        },
        {
          originKind: "manual",
          domain: "foreign-only-competitor.example",
          name: "Foreign Competitor",
          manualEntryId: foreignManualId,
        },
      );
      const scope = { workspaceId };

      const list = await listProjectAuditCompetitors(
        scope,
        localProject.projectId,
        { limit: 50, cursor: null, diagnosticRunId: null },
        tx,
      );
      expect(list.projectId).toBe(localProject.projectId);
      expect(list.data).toHaveLength(1);
      const item = list.data[0]!;
      expect(item).toMatchObject({
        projectId: localProject.projectId,
        competitorId: local.competitorId,
        domain: "canonical-competitor.example",
        name: null,
        reviewStatus: "candidate",
        relationship: null,
        analysisScope: [],
        revision: 0,
        lastObservedAt: OBSERVED_AT,
        serpOverlap: {
          availability: "unavailable",
          value: null,
          limitation: expect.stringMatching(
            /no immutable.*source.*recorded.*no canonical derived.*ratio/i,
          ),
        },
        aiCitationInsight: {
          availability: "unavailable",
          value: null,
          limitation: expect.stringMatching(/canonical.*writer/i),
        },
        coverage: {
          availability: "partial",
        },
      });
      expect(
        item.coverage.limitations.some((limitation) =>
          /still a candidate.*not been approved/i.test(limitation),
        ),
      ).toBe(true);
      expect(item.originOccurrences).toEqual(
        expect.arrayContaining([
          {
            occurrenceId: local.profileOriginId,
            originKind: "product_profile",
            productProfileId: local.profileId,
            profileVersion: local.profileVersion,
            candidateId: local.candidateId,
            fieldProvenancePath: "/competitorCandidates/0",
            evidenceRefs: [
              { evidenceRefId: local.evidenceRefId, kind: "userEdit" },
            ],
            observedAt: null,
          },
          {
            occurrenceId: local.csvOriginId,
            originKind: "csv_keyword_gap",
            snapshotId: local.snapshotId,
            observationId: local.observationId,
            sourcePointer: "/valueJson/competitorDomain",
            importPreviewId: local.importPreviewId,
            evidenceRefs: [],
            observedAt: OBSERVED_AT,
          },
          {
            occurrenceId: local.manualOriginId,
            originKind: "manual",
            manualEntryId: local.manualOriginId,
            evidenceRefs: [],
            observedAt: null,
          },
        ]),
      );

      const reviewDetail = await getProjectAuditCompetitorReviewDetail(
        scope,
        localProject.projectId,
        local.competitorId,
        tx,
      );
      expect(reviewDetail).toMatchObject({
        projectId: localProject.projectId,
        data: {
          competitorId: local.competitorId,
          reviewStatus: "candidate",
          revision: 0,
        },
      });
      const publishedList = await listProjectAuditCompetitors(
        scope,
        localProject.projectId,
        {
          limit: 50,
          cursor: null,
          diagnosticRunId: published.diagnosticRunId,
        },
        tx,
      );
      expect(publishedList.data[0]).toMatchObject({
        competitorId: local.competitorId,
        reviewStatus: "candidate",
        revision: 0,
      });
      expect(
        publishedList.data[0]?.coverage.limitations.some((limitation) =>
          /display name.*(?:froze|frozen)/i.test(limitation),
        ),
      ).toBe(true);
      const detail = await getProjectAuditCompetitor(
        scope,
        localProject.projectId,
        local.competitorId,
        tx,
      );
      expect(detail).toEqual({
        projectId: localProject.projectId,
        data: publishedList.data[0],
      });
      await expect(
        getProjectAuditCompetitor(
          scope,
          localProject.projectId,
          local.competitorId,
          { diagnosticRunId: published.diagnosticRunId },
          tx,
        ),
      ).resolves.toEqual({
        projectId: localProject.projectId,
        data: publishedList.data[0],
      });

      const serialized = JSON.stringify({ list, reviewDetail, publishedList, detail });
      expect(serialized).not.toContain(foreign.competitorId);
      expect(serialized).not.toContain("foreign-only-competitor.example");
      expect(serialized).not.toContain(local.privateProfilePayload);
      expect(serialized).not.toContain(local.privateRawObjectKey);
      expect(serialized).not.toContain(local.privateObservationPayload);
      expect(serialized).not.toContain("privateProfilePayload");
      expect(serialized).not.toContain("privateProviderPayload");

      await expect(
        getProjectAuditCompetitor(
          scope,
          localProject.projectId,
          foreign.competitorId,
          tx,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });

  it("preserves mixed CSV and Product Profile V1 history after V2 becomes confirmed", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: `Historical competitor origin ${workspaceId}`,
      });
      const project = await seedProject(tx, workspaceId, "Historical");
      const v1 = await seedCanonicalCompetitor(tx, project);
      const v2 = await confirmNextProfileOrigin(tx, project, v1);
      await seedPublishedCompetitorGeneration(tx, project, v1, {
        completedAt: "2026-07-22T10:00:00.000Z",
        profile: {
          id: v2.profileId,
          version: v2.profileVersion,
          contentHash: v2.profileContentHash,
        },
        governance: {
          reviewStatus: "candidate",
          revision: 0,
          relationship: null,
          analysisScopes: [],
          originRefs: competitorOriginRefs(v1, [v2]),
        },
      });

      const list = await listProjectAuditCompetitors(
        { workspaceId },
        project.projectId,
        { limit: 50, cursor: null, diagnosticRunId: null },
        tx,
      );

      expect(list.data).toHaveLength(1);
      expect(list.data[0]?.originOccurrences).toHaveLength(4);
      expect(list.data[0]?.originOccurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            occurrenceId: v1.csvOriginId,
            originKind: "csv_keyword_gap",
          }),
          {
            occurrenceId: v1.profileOriginId,
            originKind: "product_profile",
            productProfileId: v1.profileId,
            profileVersion: v1.profileVersion,
            candidateId: v1.candidateId,
            fieldProvenancePath: "/competitorCandidates/0",
            evidenceRefs: [
              { evidenceRefId: v1.evidenceRefId, kind: "userEdit" },
            ],
            observedAt: null,
          },
          {
            occurrenceId: v2.profileOriginId,
            originKind: "product_profile",
            productProfileId: v2.profileId,
            profileVersion: v2.profileVersion,
            candidateId: v2.candidateId,
            fieldProvenancePath: "/competitorCandidates/0",
            evidenceRefs: [
              { evidenceRefId: v2.evidenceRefId, kind: "userEdit" },
            ],
            observedAt: null,
          },
        ]),
      );
    });
  });

  it("exposes an exact DataForSEO origin only in the published generation that froze it", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: `Pinned SERP origin ${workspaceId}`,
      });
      const project = await seedProject(tx, workspaceId, "PinnedSerp");
      const competitor = await seedCanonicalCompetitor(tx, project);
      const oldGeneration = await seedPublishedCompetitorGeneration(
        tx,
        project,
        competitor,
        {
          completedAt: "2026-07-22T10:00:00.000Z",
          governance: {
            reviewStatus: "candidate",
            revision: 0,
            relationship: null,
            analysisScopes: [],
            originRefs: competitorOriginRefs(competitor),
          },
        },
      );
      const serp = await seedSerpOverlapOrigin(tx, project, competitor);
      const serpRef: GovernanceCompetitorOriginRefV1 = {
        occurrenceId: serp.originId,
        originKind: "serp_overlap",
        snapshotId: serp.snapshotId,
        observationId: serp.observationId,
      };
      const latestGeneration = await seedPublishedCompetitorGeneration(
        tx,
        project,
        competitor,
        {
          completedAt: "2026-07-22T11:00:00.000Z",
          crawlSourceConnectionId: oldGeneration.crawlSourceConnectionId,
          dataForSeo: serp,
          governance: {
            reviewStatus: "candidate",
            revision: 0,
            relationship: null,
            analysisScopes: [],
            originRefs: competitorOriginRefs(competitor, [], [serpRef]),
          },
        },
      );
      const scope = { workspaceId };

      const latest = await listProjectAuditCompetitors(
        scope,
        project.projectId,
        {
          limit: 50,
          cursor: null,
          diagnosticRunId: latestGeneration.diagnosticRunId,
        },
        tx,
      );
      expect(latest.data).toHaveLength(1);
      expect(latest.data[0]?.originOccurrences).toEqual(
        expect.arrayContaining([
          {
            occurrenceId: serp.originId,
            originKind: "serp_overlap",
            snapshotId: serp.snapshotId,
            observationId: serp.observationId,
            evidenceRefs: [],
            observedAt: OBSERVED_AT,
          },
        ]),
      );
      expect(latest.data[0]?.lastObservedAt).toBe(OBSERVED_AT);
      expect(latest.data[0]?.serpOverlap).toEqual({
        availability: "unavailable",
        value: null,
        limitation: expect.stringMatching(
          /immutable.*source.*recorded.*no canonical derived.*ratio/i,
        ),
      });
      await expect(
        getProjectAuditCompetitor(
          scope,
          project.projectId,
          competitor.competitorId,
          { diagnosticRunId: latestGeneration.diagnosticRunId },
          tx,
        ),
      ).resolves.toEqual({
        projectId: project.projectId,
        data: latest.data[0],
      });

      const older = await listProjectAuditCompetitors(
        scope,
        project.projectId,
        {
          limit: 50,
          cursor: null,
          diagnosticRunId: oldGeneration.diagnosticRunId,
        },
        tx,
      );
      expect(older.data[0]?.originOccurrences).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ originKind: "serp_overlap" }),
        ]),
      );
      expect(older.data[0]?.serpOverlap).toEqual({
        availability: "unavailable",
        value: null,
        limitation: expect.stringMatching(
          /no immutable.*source.*recorded.*no canonical derived.*ratio/i,
        ),
      });

      const review = await getProjectAuditCompetitorReviewDetail(
        scope,
        project.projectId,
        competitor.competitorId,
        tx,
      );
      expect(review.data.originOccurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            occurrenceId: serp.originId,
            originKind: "serp_overlap",
            snapshotId: serp.snapshotId,
            observationId: serp.observationId,
          }),
        ]),
      );
      expect(review.data.serpOverlap).toEqual(latest.data[0]?.serpOverlap);
    });
  });

  it("pins exact published generations while review reads and mutations remain live", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: `Pinned competitor generation ${workspaceId}`,
      });
      const project = await seedProject(tx, workspaceId, "Pinned");
      const competitor = await seedCanonicalCompetitor(tx, project);
      const scope = { workspaceId };
      const oldGeneration = await seedPublishedCompetitorGeneration(
        tx,
        project,
        competitor,
        {
          completedAt: "2026-07-22T10:00:00.000Z",
          governance: {
            reviewStatus: "candidate",
            revision: 0,
            relationship: null,
            analysisScopes: [],
            originRefs: competitorOriginRefs(competitor),
          },
        },
      );

      const firstReview = await reviewProjectAuditCompetitor(
        scope,
        project.projectId,
        competitor.competitorId,
        {
          expectedRevision: 0,
          name: "Published Review",
          reviewStatus: "approved",
          relationship: "benchmark",
          analysisScope: ["positioning"],
        },
        tx,
      );
      expect(firstReview.data).toMatchObject({
        name: "Published Review",
        reviewStatus: "approved",
        relationship: "benchmark",
        analysisScope: ["positioning"],
        revision: 1,
      });

      const latestGeneration = await seedPublishedCompetitorGeneration(
        tx,
        project,
        competitor,
        {
          completedAt: "2026-07-22T11:00:00.000Z",
          crawlSourceConnectionId: oldGeneration.crawlSourceConnectionId,
          governance: {
            reviewStatus: "approved",
            revision: 1,
            relationship: "benchmark",
            analysisScopes: ["positioning"],
            originRefs: competitorOriginRefs(competitor),
          },
        },
      );

      const secondReview = await reviewProjectAuditCompetitor(
        scope,
        project.projectId,
        competitor.competitorId,
        {
          expectedRevision: 1,
          name: "Current Review",
          reviewStatus: "approved",
          relationship: "publisher",
          analysisScope: ["content"],
        },
        tx,
      );
      expect(secondReview.data).toMatchObject({
        name: "Current Review",
        relationship: "publisher",
        analysisScope: ["content"],
        revision: 2,
      });

      const latest = await listProjectAuditCompetitors(
        scope,
        project.projectId,
        { limit: 50, cursor: null, diagnosticRunId: null },
        tx,
      );
      expect(latest.data).toHaveLength(1);
      expect(latest.data[0]).toMatchObject({
        competitorId: competitor.competitorId,
        name: "Current Review",
        reviewStatus: "approved",
        relationship: "publisher",
        analysisScope: ["content"],
        revision: 2,
      });
      const latestPublished = await listProjectAuditCompetitors(
        scope,
        project.projectId,
        {
          limit: 50,
          cursor: null,
          diagnosticRunId: latestGeneration.diagnosticRunId,
        },
        tx,
      );
      expect(latestPublished.data[0]).toMatchObject({
        competitorId: competitor.competitorId,
        name: null,
        reviewStatus: "approved",
        relationship: "benchmark",
        analysisScope: ["positioning"],
        revision: 1,
      });
      await expect(
        getProjectAuditCompetitor(
          scope,
          project.projectId,
          competitor.competitorId,
          { diagnosticRunId: latestGeneration.diagnosticRunId },
          tx,
        ),
      ).resolves.toEqual({
        projectId: project.projectId,
        data: latestPublished.data[0],
      });

      const older = await listProjectAuditCompetitors(
        scope,
        project.projectId,
        {
          limit: 50,
          cursor: null,
          diagnosticRunId: oldGeneration.diagnosticRunId,
        },
        tx,
      );
      expect(older.data).toHaveLength(1);
      expect(older.data[0]).toMatchObject({
        competitorId: competitor.competitorId,
        name: null,
        reviewStatus: "candidate",
        relationship: null,
        analysisScope: [],
        revision: 0,
      });
      await expect(
        getProjectAuditCompetitor(
          scope,
          project.projectId,
          competitor.competitorId,
          { diagnosticRunId: oldGeneration.diagnosticRunId },
          tx,
        ),
      ).resolves.toEqual({
        projectId: project.projectId,
        data: older.data[0],
      });

      await expect(
        getProjectAuditCompetitorReviewDetail(
          scope,
          project.projectId,
          competitor.competitorId,
          tx,
        ),
      ).resolves.toMatchObject({
        projectId: project.projectId,
        data: {
          name: "Current Review",
          reviewStatus: "approved",
          relationship: "publisher",
          analysisScope: ["content"],
          revision: 2,
        },
      });

      const unpublished = await seedPublishedCompetitorGeneration(
        tx,
        project,
        competitor,
        {
          completedAt: "2026-07-22T12:00:00.000Z",
          crawlSourceConnectionId: oldGeneration.crawlSourceConnectionId,
          governance: {
            reviewStatus: "approved",
            revision: 2,
            relationship: "publisher",
            analysisScopes: ["content"],
            originRefs: competitorOriginRefs(competitor),
          },
          publish: false,
        },
      );
      const foreignProject = await seedProject(
        tx,
        workspaceId,
        "PinnedForeign",
      );
      const foreignCompetitor = await seedCanonicalCompetitor(
        tx,
        foreignProject,
      );
      const foreign = await seedPublishedCompetitorGeneration(
        tx,
        foreignProject,
        foreignCompetitor,
        {
          completedAt: "2026-07-22T13:00:00.000Z",
          governance: {
            reviewStatus: "candidate",
            revision: 0,
            relationship: null,
            analysisScopes: [],
            originRefs: competitorOriginRefs(foreignCompetitor),
          },
        },
      );

      for (const diagnosticRunId of [
        unpublished.diagnosticRunId,
        foreign.diagnosticRunId,
      ]) {
        await expect(
          listProjectAuditCompetitors(
            scope,
            project.projectId,
            { limit: 50, cursor: null, diagnosticRunId },
            tx,
          ),
        ).rejects.toMatchObject({
          code: "GROWTH_MAP_AUDIT_NOT_FOUND",
          status: 404,
        });
        await expect(
          getProjectAuditCompetitor(
            scope,
            project.projectId,
            competitor.competitorId,
            { diagnosticRunId },
            tx,
          ),
        ).rejects.toMatchObject({
          code: "GROWTH_MAP_AUDIT_NOT_FOUND",
          status: 404,
        });
      }

      await expect(
        listProjectAuditCompetitors(
          scope,
          project.projectId,
          { limit: 50, cursor: null, diagnosticRunId: null },
          tx,
        ),
      ).resolves.toEqual(latest);
    });
  });
});
