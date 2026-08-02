import {
  AsyncRunsRepository,
  canonicalize,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  enqueueRunInTx,
  IcpProfilesRepository,
  IdempotencyRepository,
  normalizedUrlHash,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProductProfileRunsRepository,
  ProjectsRepository,
  sha256Hex,
  SitesRepository,
  SourceConnectionsRepository,
  type CanonicalValue,
  type DataSnapshotRow,
  type ObservationRow,
  type WorkspaceScope,
} from "@sf/db";
import {
  Bcp47Locale,
  CONTRACT_VERSION,
  MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES,
  PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_VERSION,
  ProductProfileDraft,
  ProductProfileSynthesisCompetitorDiscovery,
  ProductProfileSynthesisCompetitorObservation as ProductProfileSynthesisCompetitorObservationSchema,
  ProductProfileSynthesisInputManifest,
  type CreateProductProfileSynthesisRunRequest,
  type ProductProfileSynthesisCompetitorObservation as ProductProfileSynthesisCompetitorObservationValue,
} from "@sf/contracts";
import { PRODUCT_PROFILE_PROMPT_SET_VERSION } from "@sf/artifacts";
import { ProblemError } from "@sf/observability";
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  createDataForSeoSearchLandscapeScope,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
  parseDataForSeoSearchLandscapeScope,
} from "@sf/sources";
import { getEnv } from "@/env";
import { getBoss } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { isPostgresUniqueViolation } from "./db-errors";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

const IDEMPOTENCY_SCOPE = "createProductProfileSynthesisRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const PRODUCT_PROFILE_SYNTHESIS_ACTIVE_KEY = "product-profile:synthesis";
const PRODUCT_PROFILE_COMPETITOR_DISCOVERY_ACTIVE_KEY =
  "collect:dataforseo:search_landscape";
const MAX_FROZEN_PRODUCT_PROFILE_COMPETITORS = 100;

/**
 * The bounded joined projection the command is allowed to freeze. `extract`
 * and `canonical_extract` are read only to prove the immutable content hash;
 * neither field is copied into the manifest or the async request payload.
 */
export interface ProductProfileSynthesisPageRow {
  readonly page_snapshot_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_page_id: string;
  readonly data_snapshot_id: string;
  readonly content_hash: string;
  readonly canonical_extract: string | null;
  readonly extract: Record<string, unknown>;
  readonly captured_at: string;
  readonly created_at: string;
  readonly normalized_url: string;
  readonly normalized_url_hash: string;
  readonly site_id: string;
}

interface ProductProfileSynthesisSnapshotRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly collection_run_id: string;
  readonly source_connection_id: string | null;
  readonly provider: string;
  readonly dataset_key: string;
  readonly schema_version: string;
  readonly method_version: string;
  readonly captured_at: string;
  readonly availability: string;
  readonly limitation: string;
  readonly row_count: number;
  readonly checksum: string;
  readonly created_at: string;
}

interface ProductProfileSynthesisBaseRow {
  readonly id: string;
  readonly version: number;
  readonly status: "draft" | "complete";
  readonly content_hash: string;
}

export interface ProductProfileSynthesisAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "product_profile_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

export interface ProductProfileSynthesisCommandContext {
  readonly outputLocale?: string;
  readonly dataForSeoDiscovery?: {
    readonly enabled: boolean;
    readonly maxKeywords: number;
    readonly maxCompetitors: number;
  };
}

interface ProductProfileCompetitorDiscoveryRun {
  readonly id: string;
}

function dataForSeoLocationName(marketCode: string): string | null {
  return new Intl.DisplayNames(["en"], { type: "region" }).of(marketCode) ?? null;
}

function dataForSeoDiscoveryConfig(
  commandContext: ProductProfileSynthesisCommandContext,
): NonNullable<ProductProfileSynthesisCommandContext["dataForSeoDiscovery"]> {
  if (commandContext.dataForSeoDiscovery) {
    return commandContext.dataForSeoDiscovery;
  }
  if (process.env["DATAFORSEO_ENABLED"] !== "true") {
    return { enabled: false, maxKeywords: 200, maxCompetitors: 100 };
  }
  const env = getEnv();
  return {
    enabled: env.DATAFORSEO_ENABLED === "true",
    maxKeywords: env.DATAFORSEO_MAX_KEYWORDS,
    maxCompetitors: env.DATAFORSEO_MAX_COMPETITORS,
  };
}

/**
 * Existing products created before initial search-landscape discovery was
 * introduced have neither a DataForSEO connection nor a snapshot. Repair that
 * gap before synthesis so "regenerate" follows the same evidence path as new
 * product creation. The collection commits independently; the caller then
 * returns the normal active-run conflict that the UI already polls and retries.
 */
async function ensureProductProfileCompetitorDiscovery(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  outputLocale: string,
  config: NonNullable<
    ProductProfileSynthesisCommandContext["dataForSeoDiscovery"]
  >,
): Promise<ProductProfileCompetitorDiscoveryRun | null> {
  if (!config.enabled) return null;
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  let discovered: ProductProfileCompetitorDiscoveryRun | null;
  try {
    discovered = await db.transaction(async (tx) => {
      const active = await new AsyncRunsRepository(tx).findActive(
        projectScope,
        PRODUCT_PROFILE_COMPETITOR_DISCOVERY_ACTIVE_KEY,
      );
      if (active) return active;

      const project = await new ProjectsRepository(tx).findByIdForUpdate(
        scope,
        projectId,
      );
      if (
        !project ||
        project.archived_at ||
        project.current_icp_profile_id === null
      ) {
        return null;
      }
      const profileRow = await new IcpProfilesRepository(tx).findById(
        projectScope,
        project.current_icp_profile_id,
      );
      const parsedProfile = ProductProfileDraft.safeParse(profileRow?.profile);
      if (!profileRow || profileRow.status !== "draft" || !parsedProfile.success) {
        return null;
      }
      const site = await new SitesRepository(tx).findPrimary(projectScope);
      if (!site) return null;

      const [existingSnapshot] = await new DataSnapshotsRepository(
        tx,
      ).findLatestEligibleBySite(projectScope, site.id, [
        {
          provider: "dataforseo",
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
          collectionOperation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
          collectionMethodVersion:
            DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        },
      ]);
      if (existingSnapshot) return null;

      const marketCode = parsedProfile.data.targetMarkets.find(
        (market) => market.priority === "primary",
      )?.marketCode;
      if (!marketCode) return null;
      const locationName = dataForSeoLocationName(marketCode);
      if (!locationName) return null;
      const collectionScope = createDataForSeoSearchLandscapeScope({
        target: site.host,
        marketCode,
        locationName,
        languageTag: outputLocale,
        rankedKeywordsLimit: config.maxKeywords,
        competitorsDomainLimit: config.maxCompetitors,
      });

      const sources = new SourceConnectionsRepository(tx);
      const existingConnection = await sources.findConnectedByProviderForUpdate(
        projectScope,
        "dataforseo",
      );
      const connection =
        existingConnection ??
        (await sources.insertConnection({
          workspaceId: scope.workspaceId,
          projectId,
          siteId: site.id,
          provider: "dataforseo",
          connectionType: "api_key_stub",
          state: "connected",
          externalRef: collectionScope.target,
          config: {
            target: collectionScope.target,
            marketCode: collectionScope.marketCode,
            locationName,
            languageCode: collectionScope.providerLanguageCode,
            maxKeywords: collectionScope.rankedKeywords.limit,
            maxCompetitors: collectionScope.competitorsDomain.limit,
          },
          limitation: `Automatic DataForSEO competitor discovery for ${collectionScope.target}; ${collectionScope.marketCode}/${collectionScope.providerLanguageCode}; ranked keywords capped at ${collectionScope.rankedKeywords.limit} and competitor domains at ${collectionScope.competitorsDomain.limit}. Intersections are counts, not similarity percentages.`,
          connectedAt: true,
          createdBy: actorId,
        }));
      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "collection",
        activeKey: PRODUCT_PROFILE_COMPETITOR_DISCOVERY_ACTIVE_KEY,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          provider: "dataforseo",
          operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
          sourceConnectionId: connection.id,
          collectionScope,
        },
      });
      await new CollectionRunsRepository(tx).insertPlaceholder({
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        siteId: site.id,
        sourceConnectionId: connection.id,
        provider: "dataforseo",
        operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
        methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        parametersHash: contentHash({
          provider: "dataforseo",
          operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
          siteId: site.id,
          collectionScope,
        }),
      });
      await enqueueRunInTx(await getBoss(), tx, "collect.dataforseo", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });
      return run;
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")) {
      discovered = await new AsyncRunsRepository(db).findActive(
        projectScope,
        PRODUCT_PROFILE_COMPETITOR_DISCOVERY_ACTIVE_KEY,
      );
      if (discovered) return discovered;
    }
    throw error;
  }
  return discovered;
}

function crawlSnapshotRequired(): never {
  throw new ProblemError(
    "CRAWL_SNAPSHOT_REQUIRED",
    "A current Crawl snapshot containing the product page is required to synthesize the Product Profile.",
  );
}

function snapshotIdentityMismatch(): never {
  throw new ProblemError(
    "SNAPSHOT_PROJECT_MISMATCH",
    "Crawl snapshot identity failed integrity validation.",
  );
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalUtcInstant(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) snapshotIdentityMismatch();
  return new Date(milliseconds).toISOString();
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function competitorObservation(
  snapshot: DataSnapshotRow,
  observation: ObservationRow,
  collectionScope: ReturnType<typeof parseDataForSeoSearchLandscapeScope>,
): ProductProfileSynthesisCompetitorObservationValue | null {
  if (observation.metric_key !== METRIC_DATAFORSEO_COMPETITOR_DOMAIN) {
    return null;
  }
  const value = record(observation.value_json);
  const domain = value?.["competitorDomain"];
  const intersections = value?.["intersections"];
  const organicEstimatedTrafficVolume =
    value?.["organicEstimatedTrafficVolume"];
  const expectedKeys = [
    "targetDomain",
    "competitorDomain",
    "intersections",
    "averagePosition",
    "summedPosition",
    "organicEstimatedTrafficVolume",
    "marketCode",
    "languageCode",
  ];
  const parsed = ProductProfileSynthesisCompetitorObservationSchema.safeParse({
    observationId: observation.id,
    domain,
    intersections,
    organicEstimatedTrafficVolume,
    observedAt: observation.observed_at,
  });
  if (
    !parsed.success ||
    value === null ||
    Object.keys(value).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key)) ||
    observation.workspace_id !== snapshot.workspace_id ||
    observation.project_id !== snapshot.project_id ||
    observation.snapshot_id !== snapshot.id ||
    observation.provider !== "dataforseo" ||
    observation.subject_type !== "site" ||
    observation.subject_ref !== parsed.data.domain ||
    observation.site_page_id !== null ||
    observation.observed_at !== snapshot.captured_at ||
    observation.availability !== "available" ||
    observation.value_numeric !== null ||
    observation.value_text !== null ||
    observation.unit !== null ||
    observation.origin !== "vendor_observation" ||
    observation.method !== "observed" ||
    observation.grade !== "B" ||
    observation.support !== "supports" ||
    value["targetDomain"] !== collectionScope.target ||
    value["competitorDomain"] !== parsed.data.domain ||
    value["marketCode"] !== collectionScope.marketCode ||
    value["languageCode"] !== collectionScope.providerLanguageCode ||
    typeof value["averagePosition"] !== "number" ||
    !Number.isFinite(value["averagePosition"]) ||
    value["averagePosition"] < 0 ||
    typeof value["summedPosition"] !== "number" ||
    !Number.isFinite(value["summedPosition"]) ||
    value["summedPosition"] < 0
  ) {
    snapshotIdentityMismatch();
  }
  return parsed.data;
}

/** Freeze only exact canonical DataForSEO competitor-domain facts. */
export function buildProductProfileCompetitorDiscovery(
  snapshot: DataSnapshotRow,
  observations: readonly ObservationRow[],
): ProductProfileSynthesisCompetitorDiscovery {
  if (
    snapshot.provider !== "dataforseo" ||
    snapshot.dataset_key !== DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY ||
    snapshot.schema_version !== DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION ||
    snapshot.method_version !== DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION ||
    snapshot.source_connection_id === null ||
    (snapshot.availability !== "available" &&
      snapshot.availability !== "partial")
  ) {
    snapshotIdentityMismatch();
  }
  let collectionScope: ReturnType<
    typeof parseDataForSeoSearchLandscapeScope
  >;
  try {
    collectionScope = parseDataForSeoSearchLandscapeScope(
      snapshot.summary["collectionScope"],
    );
  } catch {
    snapshotIdentityMismatch();
  }
  const competitorObservations = observations
    .map((observation) =>
      competitorObservation(snapshot, observation, collectionScope),
    )
    .filter(
      (
        observation,
      ): observation is ProductProfileSynthesisCompetitorObservationValue =>
        observation !== null,
    )
    .sort(
      (left, right) =>
        right.intersections - left.intersections ||
        right.organicEstimatedTrafficVolume -
          left.organicEstimatedTrafficVolume ||
        left.domain.localeCompare(right.domain),
    )
    .slice(0, MAX_FROZEN_PRODUCT_PROFILE_COMPETITORS);
  return ProductProfileSynthesisCompetitorDiscovery.parse({
    snapshotId: snapshot.id,
    collectionRunId: snapshot.collection_run_id,
    sourceConnectionId: snapshot.source_connection_id,
    datasetKey: snapshot.dataset_key,
    schemaVersion: snapshot.schema_version,
    methodVersion: snapshot.method_version,
    capturedAt: canonicalUtcInstant(snapshot.captured_at),
    checksum: snapshot.checksum,
    availability: snapshot.availability,
    rowCount: snapshot.row_count,
    limitation: snapshot.limitation,
    targetDomain: collectionScope.target,
    marketCode: collectionScope.marketCode,
    languageCode: collectionScope.providerLanguageCode,
    observations: competitorObservations,
  });
}

const CORE_PATH_BUCKETS: readonly ReadonlySet<string>[] = [
  new Set(["product", "products"]),
  new Set(["feature", "features"]),
  new Set(["solution", "solutions"]),
  new Set(["use-case", "use-cases", "usecase", "usecases"]),
  new Set([
    "compare",
    "comparison",
    "comparisons",
    "competitor",
    "competitors",
    "alternative",
    "alternatives",
    "versus",
    "vs",
  ]),
  new Set(["pricing", "plans"]),
  new Set(["integration", "integrations"]),
  new Set(["about", "company", "about-us"]),
];

function selectionBucket(normalizedUrl: string, sourcePageUrl: string): number {
  if (normalizedUrl === sourcePageUrl) return 0;
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return CORE_PATH_BUCKETS.length + 2;
  }
  if (parsed.pathname === "/" && parsed.search === "") return 1;

  const segments = parsed.pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/_/gu, "-"));
  const matched = CORE_PATH_BUCKETS.findIndex((tokens) =>
    segments.some((segment) => tokens.has(segment)),
  );
  return matched < 0 ? CORE_PATH_BUCKETS.length + 2 : matched + 2;
}

/**
 * Deterministic bounded page policy. Input order and database collation cannot
 * affect the manifest: source URL wins, followed by root and the fixed core
 * product path buckets, then URL byte/ASCII order and PageSnapshot id.
 */
export function selectProductProfileSynthesisPages<
  T extends Pick<
    ProductProfileSynthesisPageRow,
    "normalized_url" | "page_snapshot_id"
  >,
>(rows: readonly T[], sourcePageUrl: string): T[] {
  if (!rows.some((row) => row.normalized_url === sourcePageUrl)) {
    crawlSnapshotRequired();
  }

  return [...rows]
    .sort((left, right) => {
      const bucket =
        selectionBucket(left.normalized_url, sourcePageUrl) -
        selectionBucket(right.normalized_url, sourcePageUrl);
      if (bucket !== 0) return bucket;
      const urlOrder = compareAscii(left.normalized_url, right.normalized_url);
      return urlOrder !== 0
        ? urlOrder
        : compareAscii(left.page_snapshot_id, right.page_snapshot_id);
    })
    .slice(0, MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES);
}

/**
 * Recompute every persisted identity before the joined rows may enter a frozen
 * manifest. A repository predicate is necessary but not sufficient evidence:
 * this check makes scope/content/URL drift fail closed at the command boundary.
 */
export function assertProductProfileSynthesisPageRows(
  scope: { readonly workspaceId: string; readonly projectId: string },
  siteId: string,
  dataSnapshotId: string,
  rows: readonly ProductProfileSynthesisPageRow[],
): void {
  const pageSnapshotIds = new Set<string>();
  const sitePageIds = new Set<string>();
  const normalizedUrls = new Set<string>();

  for (const row of rows) {
    let canonicalExtract: string;
    try {
      canonicalExtract = canonicalize(row.extract as CanonicalValue);
    } catch {
      snapshotIdentityMismatch();
    }
    if (
      row.workspace_id !== scope.workspaceId ||
      row.project_id !== scope.projectId ||
      row.site_id !== siteId ||
      row.data_snapshot_id !== dataSnapshotId ||
      row.canonical_extract === null ||
      row.canonical_extract !== canonicalExtract ||
      sha256Hex(canonicalExtract) !== row.content_hash ||
      normalizedUrlHash(row.normalized_url) !== row.normalized_url_hash ||
      !Number.isFinite(Date.parse(row.captured_at)) ||
      pageSnapshotIds.has(row.page_snapshot_id) ||
      sitePageIds.has(row.site_page_id) ||
      normalizedUrls.has(row.normalized_url)
    ) {
      snapshotIdentityMismatch();
    }
    pageSnapshotIds.add(row.page_snapshot_id);
    sitePageIds.add(row.site_page_id);
    normalizedUrls.add(row.normalized_url);
  }
}

function assertEligibleCrawlSnapshot(
  scope: { readonly workspaceId: string; readonly projectId: string },
  siteId: string,
  snapshot: ProductProfileSynthesisSnapshotRow | null,
): asserts snapshot is ProductProfileSynthesisSnapshotRow & {
  readonly provider: "crawl";
  readonly dataset_key: typeof CRAWL_DATASET_KEY;
  readonly method_version: typeof CRAWL_METHOD_VERSION;
  readonly availability: "available" | "partial";
} {
  if (
    snapshot === null ||
    snapshot.provider !== "crawl" ||
    snapshot.dataset_key !== CRAWL_DATASET_KEY ||
    snapshot.method_version !== CRAWL_METHOD_VERSION ||
    (snapshot.availability !== "available" &&
      snapshot.availability !== "partial")
  ) {
    crawlSnapshotRequired();
  }
  if (
    snapshot.workspace_id !== scope.workspaceId ||
    snapshot.project_id !== scope.projectId ||
    snapshot.site_id !== siteId ||
    snapshot.row_count < 1 ||
    !Number.isSafeInteger(snapshot.row_count) ||
    !/^[a-f0-9]{64}$/u.test(snapshot.checksum) ||
    snapshot.schema_version.trim() === "" ||
    snapshot.limitation.trim() === "" ||
    !Number.isFinite(Date.parse(snapshot.captured_at))
  ) {
    snapshotIdentityMismatch();
  }
}

/** Construct and JCS-address the exact metadata-only synthesis manifest. */
export function buildProductProfileSynthesisFrozenInput(input: {
  readonly projectId: string;
  readonly siteId: string;
  readonly sourcePageUrl: string;
  readonly outputLocale: string;
  readonly baseProfile: ProductProfileSynthesisBaseRow;
  readonly crawlSnapshot: ProductProfileSynthesisSnapshotRow;
  readonly pages: readonly ProductProfileSynthesisPageRow[];
  readonly competitorDiscovery?: ProductProfileSynthesisCompetitorDiscovery | null;
}): {
  readonly manifest: ProductProfileSynthesisInputManifest;
  readonly inputHash: string;
} {
  const manifest = ProductProfileSynthesisInputManifest.parse({
    schemaVersion: PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
    selectionPolicyVersion: PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
    projectId: input.projectId,
    siteId: input.siteId,
    sourcePageUrl: input.sourcePageUrl,
    outputLocale: input.outputLocale,
    competitorDiscovery: input.competitorDiscovery ?? null,
    baseProfile: {
      id: input.baseProfile.id,
      version: input.baseProfile.version,
      contentHash: input.baseProfile.content_hash,
      status: input.baseProfile.status,
    },
    crawlSnapshot: {
      id: input.crawlSnapshot.id,
      collectionRunId: input.crawlSnapshot.collection_run_id,
      sourceConnectionId: input.crawlSnapshot.source_connection_id,
      provider: "crawl",
      datasetKey: CRAWL_DATASET_KEY,
      schemaVersion: input.crawlSnapshot.schema_version,
      methodVersion: CRAWL_METHOD_VERSION,
      capturedAt: canonicalUtcInstant(input.crawlSnapshot.captured_at),
      checksum: input.crawlSnapshot.checksum,
      availability: input.crawlSnapshot.availability,
      rowCount: input.crawlSnapshot.row_count,
      limitation: input.crawlSnapshot.limitation,
    },
    pages: input.pages.map((page) => ({
      pageSnapshotId: page.page_snapshot_id,
      sitePageId: page.site_page_id,
      dataSnapshotId: page.data_snapshot_id,
      normalizedUrl: page.normalized_url,
      normalizedUrlHash: page.normalized_url_hash,
      contentHash: page.content_hash,
      capturedAt: canonicalUtcInstant(page.captured_at),
    })),
  });
  return {
    manifest,
    inputHash: contentHash(manifest as unknown as CanonicalValue),
  };
}

function replayProductProfileSynthesis(
  row: {
    readonly request_hash: string;
    readonly status: string;
    readonly resource_id: string | null;
    readonly response_body: unknown;
  },
  requestHash: string,
): ProductProfileSynthesisAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key was already used with a different request body.",
    );
  }
  if (row.status !== "completed" || row.resource_id === null) return null;
  const response = row.response_body as
    | {
        readonly run: AsyncRunDto;
        readonly statusUrl: string;
        readonly resourceRef: {
          readonly type: "product_profile_run";
          readonly id: string;
        };
      }
    | null;
  if (
    response?.run === undefined ||
    response.resourceRef?.type !== "product_profile_run" ||
    response.resourceRef.id !== row.resource_id
  ) {
    return null;
  }
  return {
    status: 202,
    run: response.run,
    statusUrl: response.statusUrl,
    resourceRef: response.resourceRef,
    location: response.statusUrl,
    replayed: true,
  };
}

function activeConflict(projectId: string, runId: string): ProblemError {
  const statusUrl = runStatusUrl(projectId, runId);
  return new ProblemError(
    "RUN_ALREADY_ACTIVE",
    "A Product Profile synthesis run is already active.",
    {
      headers: { Location: statusUrl },
      current: { runId, statusUrl },
    },
  );
}

function competitorDiscoveryConflict(
  projectId: string,
  runId: string,
): ProblemError {
  const statusUrl = runStatusUrl(projectId, runId);
  return new ProblemError(
    "RUN_ALREADY_ACTIVE",
    "Initial competitor discovery is still running.",
    {
      headers: { Location: statusUrl },
      current: {
        runId,
        statusUrl,
        activeKey: PRODUCT_PROFILE_COMPETITOR_DISCOVERY_ACTIVE_KEY,
      },
    },
  );
}

/**
 * Freeze and queue one Product Profile synthesis without starting a Diagnostic
 * or Audit lifecycle. The base profile, Crawl snapshot and selected pages are
 * re-read under the project lock; the manifest, typed run and pg-boss job commit
 * atomically.
 */
export async function createProductProfileSynthesisRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateProductProfileSynthesisRunRequest,
  commandContext: ProductProfileSynthesisCommandContext = {},
): Promise<ProductProfileSynthesisAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const outputLocale = Bcp47Locale.parse(
    commandContext.outputLocale ?? "en",
  );
  const { db } = getDb();
  const requestHash = contentHash({ projectId, baseVersion: body.baseVersion });
  const idem = new IdempotencyRepository(db);

  // A completed command is immutable and must replay before any mutable project
  // pointer, active run or Crawl availability is consulted.
  const existingKey = await idem.find(
    scope.workspaceId,
    IDEMPOTENCY_SCOPE,
    idempotencyKey,
  );
  if (existingKey) {
    const replayed = replayProductProfileSynthesis(existingKey, requestHash);
    if (replayed) return replayed;
  }

  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    PRODUCT_PROFILE_SYNTHESIS_ACTIVE_KEY,
  );
  if (active) {
    const now = await idem.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
    );
    const replayed = now
      ? replayProductProfileSynthesis(now, requestHash)
      : null;
    if (replayed) return replayed;
    throw activeConflict(projectId, active.id);
  }

  const discovery = await ensureProductProfileCompetitorDiscovery(
    scope,
    projectId,
    actorId,
    outputLocale,
    dataForSeoDiscoveryConfig(commandContext),
  );
  if (discovery) {
    throw competitorDiscoveryConflict(projectId, discovery.id);
  }

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
      const reserved = await txIdem.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const now = await txIdem.find(
          scope.workspaceId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
        );
        const replayed = now
          ? replayProductProfileSynthesis(now, requestHash)
          : null;
        if (replayed) return replayed;
        throw new ProblemError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key is being processed.",
        );
      }

      const currentProject = await new ProjectsRepository(tx).findByIdForUpdate(
        scope,
        projectId,
      );
      if (!currentProject) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }
      if (currentProject.archived_at) {
        throw new ProblemError(
          "PROJECT_ARCHIVED",
          "Project is archived and read-only.",
        );
      }
      if (!currentProject.current_icp_profile_id) {
        throw new ProblemError(
          "CONTEXT_INCOMPLETE",
          "A current Product Profile draft is required for synthesis.",
        );
      }

      const baseProfile = await new IcpProfilesRepository(tx).findById(
        projectScope,
        currentProject.current_icp_profile_id,
      );
      if (!baseProfile) {
        throw new ProblemError(
          "CONTEXT_INCOMPLETE",
          "The current Product Profile could not be read.",
        );
      }
      if (baseProfile.status !== "draft") {
        throw new ProblemError(
          "CONTEXT_INCOMPLETE",
          "A current Product Profile draft is required for synthesis.",
        );
      }
      if (baseProfile.version !== body.baseVersion) {
        throw new ProblemError(
          "VERSION_CONFLICT",
          "The Product Profile changed; refetch and retry.",
        );
      }
      const parsedProfile = ProductProfileDraft.safeParse(baseProfile.profile);
      if (!parsedProfile.success) {
        throw new ProblemError(
          "CONTEXT_INCOMPLETE",
          "The current Product Profile is not synthesis-ready.",
        );
      }
      let derivedProfileHash: string;
      try {
        // Hash the exact persisted JSONB value. Zod is allowed to normalize
        // strings for semantic use, but that normalized projection must never
        // be substituted for the bytes represented by the durable content hash.
        derivedProfileHash = contentHash({
          status: baseProfile.status,
          profile: baseProfile.profile as CanonicalValue,
        });
      } catch {
        throw new ProblemError(
          "CONTEXT_INCOMPLETE",
          "The current Product Profile failed integrity validation.",
        );
      }
      if (derivedProfileHash !== baseProfile.content_hash) {
        throw new ProblemError(
          "CONTEXT_INCOMPLETE",
          "The current Product Profile failed integrity validation.",
        );
      }

      const primarySite = await new SitesRepository(tx).findPrimary(projectScope);
      if (!primarySite) {
        throw new ProblemError("NOT_FOUND", "Project has no primary site.");
      }
      let sourceOrigin: string;
      try {
        sourceOrigin = new URL(parsedProfile.data.sourcePageUrl).origin;
      } catch {
        snapshotIdentityMismatch();
      }
      if (
        primarySite.workspace_id !== scope.workspaceId ||
        primarySite.project_id !== projectId ||
        primarySite.id !== parsedProfile.data.sourceSiteId ||
        primarySite.origin !== sourceOrigin
      ) {
        snapshotIdentityMismatch();
      }

      const crawlSnapshot = await new DataSnapshotsRepository(
        tx,
      ).findLatestEligibleCrawlBySite(
        projectScope,
        primarySite.id,
        CRAWL_DATASET_KEY,
        CRAWL_METHOD_VERSION,
      );
      assertEligibleCrawlSnapshot(
        projectScope,
        primarySite.id,
        crawlSnapshot,
      );

      const activeCompetitorDiscovery = await new AsyncRunsRepository(
        tx,
      ).findActive(
        projectScope,
        PRODUCT_PROFILE_COMPETITOR_DISCOVERY_ACTIVE_KEY,
      );
      if (activeCompetitorDiscovery) {
        throw competitorDiscoveryConflict(
          projectId,
          activeCompetitorDiscovery.id,
        );
      }

      const [dataForSeoSnapshot] = await new DataSnapshotsRepository(
        tx,
      ).findLatestEligibleBySite(projectScope, primarySite.id, [
        {
          provider: "dataforseo",
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
          collectionOperation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
          collectionMethodVersion:
            DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        },
      ]);
      const competitorDiscovery = dataForSeoSnapshot
        ? buildProductProfileCompetitorDiscovery(
            dataForSeoSnapshot,
            await new ObservationsRepository(tx).listBySnapshotIds(
              projectScope,
              [dataForSeoSnapshot.id],
            ),
          )
        : null;

      const pageRows = (await new PageSnapshotsRepository(
        tx,
      ).listByDataSnapshotWithSitePageIdentity(
        projectScope,
        crawlSnapshot.id,
      )) as ProductProfileSynthesisPageRow[];
      assertProductProfileSynthesisPageRows(
        projectScope,
        primarySite.id,
        crawlSnapshot.id,
        pageRows,
      );
      const selectedPages = selectProductProfileSynthesisPages(
        pageRows,
        parsedProfile.data.sourcePageUrl,
      );
      const frozen = buildProductProfileSynthesisFrozenInput({
        projectId,
        siteId: primarySite.id,
        sourcePageUrl: parsedProfile.data.sourcePageUrl,
        outputLocale,
        baseProfile,
        crawlSnapshot,
        pages: selectedPages,
        competitorDiscovery,
      });

      const boss = await getBoss();
      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "product_profile_synthesis",
        activeKey: PRODUCT_PROFILE_SYNTHESIS_ACTIVE_KEY,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          baseVersion: body.baseVersion,
          sourceSnapshotId: crawlSnapshot.id,
          outputLocale,
          inputHash: frozen.inputHash,
        },
      });
      await new ProductProfileRunsRepository(tx).insertPlaceholder({
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        siteId: primarySite.id,
        baseIcpProfileId: baseProfile.id,
        baseIcpProfileVersion: baseProfile.version,
        baseIcpProfileContentHash: baseProfile.content_hash,
        sourceSnapshotId: crawlSnapshot.id,
        synthesisVersion: PRODUCT_PROFILE_SYNTHESIS_VERSION,
        promptSetVersion: PRODUCT_PROFILE_PROMPT_SET_VERSION,
        inputManifest: frozen.manifest,
        inputHash: frozen.inputHash,
      });
      await enqueueRunInTx(boss, tx, "profile.synthesize", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });

      const dto = toAsyncRunDto(run);
      const statusUrl = runStatusUrl(projectId, run.id);
      const resourceRef = {
        type: "product_profile_run" as const,
        id: run.id,
      };
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody: { run: dto, statusUrl, resourceRef },
        resourceType: "product_profile_run",
        resourceId: run.id,
      });
      return {
        status: 202,
        run: dto,
        statusUrl,
        resourceRef,
        location: statusUrl,
        replayed: false,
      };
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")) {
      const winnerKey = await idem.find(
        scope.workspaceId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
      );
      const replayed = winnerKey
        ? replayProductProfileSynthesis(winnerKey, requestHash)
        : null;
      if (replayed) return replayed;
      const winner = await new AsyncRunsRepository(db).findActive(
        projectScope,
        PRODUCT_PROFILE_SYNTHESIS_ACTIVE_KEY,
      );
      if (winner) throw activeConflict(projectId, winner.id);
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A Product Profile synthesis run is already active.",
      );
    }
    throw error;
  }
}
