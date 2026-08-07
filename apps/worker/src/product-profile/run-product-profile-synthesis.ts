import { isDeepStrictEqual } from "node:util";
import {
  AsyncRunsRepository,
  canonicalize,
  contentHash,
  DataSnapshotsRepository,
  IcpProfilesRepository,
  normalizedUrlHash,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProductProfileInvocationAttemptsRepository,
  ProductProfileRunsRepository,
  ProjectsRepository,
  sha256Hex,
  sameTimestamptzInstant,
  toRunAttempt,
  type CanonicalValue,
  type DataSnapshotRow,
  type IcpProfileRow,
  type ProductProfileRunRow,
  type ProductProfileInvocationMetadata,
  type ProjectScope,
  type RunAttempt,
} from "@sf/db";
import {
  buildProductProfileDraft,
  createOpenAIProductProfileClient,
  discoverProductProfileCompetitors,
  LLMError,
  MAX_PRODUCT_PROFILE_H1,
  MAX_PRODUCT_PROFILE_HEADINGS,
  MAX_PRODUCT_PROFILE_JSON_LD_TYPES,
  MAX_PRODUCT_PROFILE_PARAGRAPHS,
  PRODUCT_PROFILE_DECLARED_CONTEXT_PROMPT_SET_VERSION,
  PRODUCT_PROFILE_LEGACY_PROMPT_SET_VERSION,
  PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION,
  PRODUCT_PROFILE_PROMPT_SET_VERSION,
  prepareProductProfileSynthesis,
  productProfilePageKeyForIndex,
  type AnalysisInvocationRecord,
  type ProductProfileClientOptions,
  type ProductProfileDeclaredContext,
  type ProductProfileDiscoveredCompetitor,
  type ProductProfilePageDescriptor,
  type ProductProfilePageKeyMapEntry,
  type ProductProfilePromptSetVersion,
  type ProductProfileSemanticCandidateEnvelope,
  type ProductProfileSynthesisClient,
  type ProductProfileSynthesisInput,
} from "@sf/artifacts";
import {
  ProductProfileDraft,
  PRODUCT_PROFILE_SYNTHESIS_LEGACY_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_OUTPUT_LOCALE_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
  ProductProfileSynthesisInputManifest,
  PRODUCT_PROFILE_SYNTHESIS_VERSION,
  type ProductProfileSynthesisCompetitorDiscovery,
  type ProductProfileSynthesisPage,
} from "@sf/contracts";
import {
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
  METRIC_DATAFORSEO_SERP_COMPETITOR,
  parseDataForSeoSearchLandscapeScope,
  parseDataForSeoSearchLandscapeV2Scope,
  type CrawlPageProjection,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "../handlers/transient-errors.ts";
import {
  parseCrawlPageExtract,
  type CrawlPageExtract,
} from "../collection/materialize-crawl-pages.ts";

/**
 * Product Profile synthesis worker.
 *
 * Every semantic conclusion is derived from the exact, content-addressed Crawl
 * PageSnapshots frozen by the command. Mutable project pointers are consulted
 * only under the completion lock, after the provider invocation has received an
 * immutable audit row. The worker never reads provider blobs or current crawl
 * state and never confirms a profile or starts another workflow.
 */

export interface ProductProfileSynthesisJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface ProductProfileSynthesisDependencies {
  readonly createClient?: (
    options: ProductProfileClientOptions,
  ) => ProductProfileSynthesisClient;
  readonly now?: () => Date;
}

export const PRODUCT_PROFILE_SYNTHESIS_REQUEST_TIMEOUT_MS = 45_000;

const SUPERSEDED = {
  status: "cancelled" as const,
  lastErrorCode: "PRODUCT_PROFILE_SYNTHESIS_SUPERSEDED",
  lastErrorSummary: "Product Profile synthesis was superseded.",
};
const SAFE_FAILURE_SUMMARY = "Product Profile synthesis failed.";
const SAFE_RETRY_SUMMARY = "Product Profile synthesis will be retried.";
const INVOCATION_OUTCOME_UNKNOWN_CODE =
  "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN";
const INVOCATION_OUTCOME_UNKNOWN_SUMMARY =
  "The provider invocation outcome could not be safely recovered.";
const INVOCATION_PERSISTENCE_UNKNOWN = "INVOCATION_PERSISTENCE_UNKNOWN";
const INVOCATION_IDENTITY_MISMATCH = "INVOCATION_IDENTITY_MISMATCH";
const PROVIDER_OUTCOME_UNKNOWN = "PROVIDER_OUTCOME_UNKNOWN";
const SHA256_HEX = /^[a-f0-9]{64}$/u;

function productProfilePromptSetVersion(
  value: string,
): ProductProfilePromptSetVersion {
  if (
    value === PRODUCT_PROFILE_LEGACY_PROMPT_SET_VERSION ||
    value === PRODUCT_PROFILE_DECLARED_CONTEXT_PROMPT_SET_VERSION ||
    value === PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION ||
    value === PRODUCT_PROFILE_PROMPT_SET_VERSION
  ) {
    return value;
  }
  invalidInput();
}

type FrozenPageRow = Awaited<
  ReturnType<PageSnapshotsRepository["findByIdsWithSitePageIdentity"]>
>[number];

interface FrozenSynthesisInput {
  readonly ledger: ProductProfileRunRow;
  readonly manifest: ProductProfileSynthesisInputManifest;
  readonly base: ProductProfileDraft;
  readonly snapshot: DataSnapshotRow;
  readonly descriptors: readonly ProductProfilePageDescriptor[];
  readonly discoveredCompetitors: readonly ProductProfileDiscoveredCompetitor[];
}

class ProductProfileInputError extends Error {
  constructor() {
    super("frozen Product Profile synthesis input is invalid");
    this.name = "ProductProfileInputError";
  }
}

class ProductProfileResultError extends Error {
  constructor() {
    super("Product Profile synthesis result is invalid");
    this.name = "ProductProfileResultError";
  }
}

function pathIsWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isCustomerAuthoredProvenance(
  entry: ProductProfileDraft["fieldProvenance"][number],
): boolean {
  return (
    entry.derivation === "declared" ||
    entry.evidenceRefs.some((ref) => ref.kind === "userEdit")
  );
}

function hasCustomerAuthoredFact(
  profile: ProductProfileDraft,
  root: string,
): boolean {
  return profile.fieldProvenance.some(
    (entry) =>
      pathIsWithin(entry.path, root) && isCustomerAuthoredProvenance(entry),
  );
}

/**
 * Project only customer-authored planning facts into the external-model input.
 * These values remain distinct from `businessHint`: the response contract has
 * no way to cite them as evidence, so they can guide prioritization without
 * laundering a declaration into an observed website fact.
 */
export function buildProductProfileDeclaredContext(
  profile: ProductProfileDraft,
): ProductProfileDeclaredContext | undefined {
  const context: ProductProfileDeclaredContext = {
    ...(profile.productName !== null &&
    hasCustomerAuthoredFact(profile, "/productName")
      ? { productName: profile.productName }
      : {}),
    ...(profile.customerModel !== undefined &&
    hasCustomerAuthoredFact(profile, "/customerModel")
      ? { customerModel: profile.customerModel }
      : {}),
    ...(profile.growthObjectives !== undefined &&
    profile.growthObjectives.length > 0 &&
    hasCustomerAuthoredFact(profile, "/growthObjectives")
      ? { growthObjectives: [...profile.growthObjectives] }
      : {}),
    ...(profile.targetMarkets.length > 0 &&
    hasCustomerAuthoredFact(profile, "/targetMarkets")
      ? {
          targetMarkets: profile.targetMarkets.map((market) => ({
            ...market,
          })),
        }
      : {}),
  };
  return Object.keys(context).length === 0 ? undefined : context;
}

function invalidInput(): never {
  throw new ProductProfileInputError();
}

function invalidResult(): never {
  throw new ProductProfileResultError();
}

function exactObjectHash(value: unknown, expected: string): boolean {
  try {
    const canonical = canonicalize(value as CanonicalValue);
    return sha256Hex(canonical) === expected;
  } catch {
    return false;
  }
}

function sameScope(
  row: { readonly workspace_id: string; readonly project_id: string },
  scope: ProjectScope,
): boolean {
  return (
    row.workspace_id === scope.workspaceId &&
    row.project_id === scope.projectId
  );
}

function validateLedger(
  scope: ProjectScope,
  runId: string,
  ledger: ProductProfileRunRow | null,
): {
  readonly ledger: ProductProfileRunRow;
  readonly manifest: ProductProfileSynthesisInputManifest;
} {
  if (
    ledger === null ||
    ledger.id !== runId ||
    !sameScope(ledger, scope) ||
    ledger.synthesis_version !== PRODUCT_PROFILE_SYNTHESIS_VERSION ||
    ![
      PRODUCT_PROFILE_LEGACY_PROMPT_SET_VERSION,
      PRODUCT_PROFILE_DECLARED_CONTEXT_PROMPT_SET_VERSION,
      PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION,
      PRODUCT_PROFILE_PROMPT_SET_VERSION,
    ].includes(ledger.prompt_set_version as ProductProfilePromptSetVersion) ||
    ledger.result_icp_profile_id !== null ||
    !SHA256_HEX.test(ledger.input_hash) ||
    contentHash(ledger.input_manifest as CanonicalValue) !== ledger.input_hash
  ) {
    invalidInput();
  }

  const parsed = ProductProfileSynthesisInputManifest.safeParse(
    ledger.input_manifest,
  );
  if (!parsed.success) invalidInput();
  const manifest = parsed.data;
  const versionPairIsValid =
    (ledger.prompt_set_version === PRODUCT_PROFILE_PROMPT_SET_VERSION &&
      manifest.schemaVersion ===
        PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION) ||
    (ledger.prompt_set_version ===
      PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION &&
      manifest.schemaVersion ===
        PRODUCT_PROFILE_SYNTHESIS_OUTPUT_LOCALE_INPUT_SCHEMA_VERSION) ||
    ((ledger.prompt_set_version ===
      PRODUCT_PROFILE_LEGACY_PROMPT_SET_VERSION ||
      ledger.prompt_set_version ===
        PRODUCT_PROFILE_DECLARED_CONTEXT_PROMPT_SET_VERSION) &&
      manifest.schemaVersion ===
        PRODUCT_PROFILE_SYNTHESIS_LEGACY_INPUT_SCHEMA_VERSION);
  if (
    !versionPairIsValid ||
    manifest.baseProfile.status !== "draft" ||
    manifest.projectId !== scope.projectId ||
    manifest.siteId !== ledger.site_id ||
    manifest.baseProfile.id !== ledger.base_icp_profile_id ||
    manifest.baseProfile.version !== ledger.base_icp_profile_version ||
    manifest.baseProfile.contentHash !==
      ledger.base_icp_profile_content_hash ||
    manifest.crawlSnapshot.id !== ledger.source_snapshot_id
  ) {
    invalidInput();
  }
  return { ledger, manifest };
}

function validateBaseProfile(
  scope: ProjectScope,
  ledger: ProductProfileRunRow,
  manifest: ProductProfileSynthesisInputManifest,
  row: IcpProfileRow | null,
): { readonly row: IcpProfileRow; readonly profile: ProductProfileDraft } {
  if (
    row === null ||
    !sameScope(row, scope) ||
    row.id !== ledger.base_icp_profile_id ||
    row.version !== ledger.base_icp_profile_version ||
    row.content_hash !== ledger.base_icp_profile_content_hash ||
    row.status !== manifest.baseProfile.status ||
    contentHash({ status: row.status, profile: row.profile } as CanonicalValue) !==
      row.content_hash
  ) {
    invalidInput();
  }
  const parsed = ProductProfileDraft.safeParse(row.profile);
  if (!parsed.success) invalidInput();
  if (
    parsed.data.sourceSiteId !== ledger.site_id ||
    parsed.data.sourcePageUrl !== manifest.sourcePageUrl
  ) {
    invalidInput();
  }
  return { row, profile: parsed.data };
}

function validateCrawlSnapshot(
  scope: ProjectScope,
  ledger: ProductProfileRunRow,
  manifest: ProductProfileSynthesisInputManifest,
  row: DataSnapshotRow | null,
): DataSnapshotRow {
  const frozen = manifest.crawlSnapshot;
  if (
    row === null ||
    !sameScope(row, scope) ||
    row.id !== ledger.source_snapshot_id ||
    row.site_id !== ledger.site_id ||
    row.collection_run_id !== frozen.collectionRunId ||
    row.source_connection_id !== frozen.sourceConnectionId ||
    row.provider !== frozen.provider ||
    row.dataset_key !== frozen.datasetKey ||
    row.schema_version !== frozen.schemaVersion ||
    row.method_version !== frozen.methodVersion ||
    !sameTimestamptzInstant(row.captured_at, frozen.capturedAt) ||
    row.checksum !== frozen.checksum ||
    row.availability !== frozen.availability ||
    row.row_count !== frozen.rowCount ||
    row.limitation !== frozen.limitation
  ) {
    invalidInput();
  }
  return row;
}

function pageAtSourceOrigin(url: string, sourcePageUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(sourcePageUrl).origin;
  } catch {
    return false;
  }
}

function validateOnePage(
  scope: ProjectScope,
  siteId: string,
  sourceSnapshotId: string,
  sourcePageUrl: string,
  frozen: ProductProfileSynthesisPage,
  row: FrozenPageRow | undefined,
): CrawlPageExtract {
  if (
    row === undefined ||
    !sameScope(row, scope) ||
    row.page_snapshot_id !== frozen.pageSnapshotId ||
    row.site_page_id !== frozen.sitePageId ||
    row.data_snapshot_id !== sourceSnapshotId ||
    row.data_snapshot_id !== frozen.dataSnapshotId ||
    row.site_id !== siteId ||
    row.normalized_url !== frozen.normalizedUrl ||
    row.normalized_url_hash !== frozen.normalizedUrlHash ||
    row.normalized_url_hash !== normalizedUrlHash(row.normalized_url) ||
    row.content_hash !== frozen.contentHash ||
    !sameTimestamptzInstant(row.captured_at, frozen.capturedAt) ||
    row.canonical_extract === null ||
    !pageAtSourceOrigin(row.normalized_url, sourcePageUrl)
  ) {
    invalidInput();
  }

  let canonicalExtract: string;
  try {
    canonicalExtract = canonicalize(row.extract as CanonicalValue);
  } catch {
    invalidInput();
  }
  if (
    canonicalExtract !== row.canonical_extract ||
    sha256Hex(canonicalExtract) !== row.content_hash ||
    !exactObjectHash(row.extract, frozen.contentHash)
  ) {
    invalidInput();
  }

  let extract: CrawlPageExtract;
  try {
    extract = parseCrawlPageExtract(row.extract);
  } catch {
    invalidInput();
  }
  if (
    extract.projection.fetchUrl !== row.normalized_url ||
    extract.projection.fetchUrl !== frozen.normalizedUrl
  ) {
    invalidInput();
  }
  return extract;
}

export function buildBoundedProductProfilePageDescriptor(
  frozen: ProductProfileSynthesisPage,
  extract: CrawlPageExtract,
): ProductProfilePageDescriptor {
  const projection: CrawlPageProjection = extract.projection;
  return {
    pageSnapshotId: frozen.pageSnapshotId,
    sitePageId: frozen.sitePageId,
    snapshotId: frozen.dataSnapshotId,
    contentHash: frozen.contentHash,
    subjectUrl: extract.subjectUrl,
    fetchUrl: projection.fetchUrl,
    title: projection.title,
    metaDescription: projection.metaDescription,
    h1: projection.h1.slice(0, MAX_PRODUCT_PROFILE_H1),
    headings: projection.headings.slice(0, MAX_PRODUCT_PROFILE_HEADINGS),
    bodyExcerpt: projection.bodyExcerpt,
    paragraphs: projection.paragraphs.slice(
      0,
      MAX_PRODUCT_PROFILE_PARAGRAPHS,
    ),
    jsonLdTypes: projection.jsonLd.types.slice(
      0,
      MAX_PRODUCT_PROFILE_JSON_LD_TYPES,
    ),
    canonicalTarget: projection.canonicalTarget,
    contentType: projection.contentType,
  };
}

function validatePages(
  scope: ProjectScope,
  ledger: ProductProfileRunRow,
  manifest: ProductProfileSynthesisInputManifest,
  rows: readonly FrozenPageRow[],
): readonly ProductProfilePageDescriptor[] {
  if (rows.length !== manifest.pages.length) invalidInput();
  const byId = new Map<string, FrozenPageRow>();
  for (const row of rows) {
    if (byId.has(row.page_snapshot_id)) invalidInput();
    byId.set(row.page_snapshot_id, row);
  }
  const descriptors = manifest.pages.map((frozen) => {
    const extract = validateOnePage(
      scope,
      ledger.site_id,
      ledger.source_snapshot_id,
      manifest.sourcePageUrl,
      frozen,
      byId.get(frozen.pageSnapshotId),
    );
    return buildBoundedProductProfilePageDescriptor(frozen, extract);
  });
  if (
    descriptors[0]?.fetchUrl !== manifest.sourcePageUrl ||
    descriptors[0]?.pageSnapshotId !== manifest.pages[0]?.pageSnapshotId
  ) {
    invalidInput();
  }
  return descriptors;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validateCompetitorDiscoveryObservation(
  scope: ProjectScope,
  snapshot: DataSnapshotRow,
  frozen: ProductProfileSynthesisCompetitorDiscovery["observations"][number],
  row: Awaited<
    ReturnType<ObservationsRepository["listBySnapshotIds"]>
  >[number] | undefined,
): void {
  const value = objectRecord(row?.value_json);
  const isSerp =
    "sourceKind" in frozen && frozen.sourceKind === "serp_competitor";
  const expectedKeys = isSerp
    ? [
        "targetDomain",
        "competitorDomain",
        "averagePosition",
        "medianPosition",
        "rating",
        "organicEstimatedTrafficVolume",
        "keywordsCount",
        "visibility",
        "relevantSerpItems",
        "seedCount",
        "marketCode",
        "languageCode",
      ]
    : [
        "targetDomain",
        "competitorDomain",
        "intersections",
        "averagePosition",
        "summedPosition",
        "organicEstimatedTrafficVolume",
        "marketCode",
        "languageCode",
      ];
  if (
    row === undefined ||
    value === null ||
    Object.keys(value).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key)) ||
    !sameScope(row, scope) ||
    row.id !== frozen.observationId ||
    row.snapshot_id !== snapshot.id ||
    row.site_page_id !== null ||
    row.provider !== "dataforseo" ||
    row.metric_key !==
      (isSerp
        ? METRIC_DATAFORSEO_SERP_COMPETITOR
        : METRIC_DATAFORSEO_COMPETITOR_DOMAIN) ||
    row.subject_type !== "site" ||
    row.subject_ref !== frozen.domain ||
    !sameTimestamptzInstant(row.observed_at, frozen.observedAt) ||
    row.availability !== "available" ||
    row.value_numeric !== null ||
    row.value_text !== null ||
    row.unit !== null ||
    row.origin !== "vendor_observation" ||
    row.method !== "observed" ||
    row.grade !== "B" ||
    row.support !== "supports" ||
    value["competitorDomain"] !== frozen.domain ||
    value["organicEstimatedTrafficVolume"] !==
      frozen.organicEstimatedTrafficVolume ||
    typeof value["averagePosition"] !== "number" ||
    !Number.isFinite(value["averagePosition"]) ||
    value["averagePosition"] < 0
  ) {
    invalidInput();
  }
  if (
    isSerp
      ? !("rating" in frozen) ||
        value["rating"] !== frozen.rating ||
        value["keywordsCount"] !== frozen.keywordsCount ||
        value["relevantSerpItems"] !== frozen.relevantSerpItems ||
        typeof value["medianPosition"] !== "number" ||
        !Number.isFinite(value["medianPosition"]) ||
        value["medianPosition"] < 0 ||
        typeof value["visibility"] !== "number" ||
        !Number.isFinite(value["visibility"]) ||
        value["visibility"] < 0
      : !("intersections" in frozen) ||
        value["intersections"] !== frozen.intersections ||
        typeof value["summedPosition"] !== "number" ||
        !Number.isFinite(value["summedPosition"]) ||
        value["summedPosition"] < 0
  ) {
    invalidInput();
  }
}

function validateCompetitorDiscovery(
  scope: ProjectScope,
  siteId: string,
  frozen: ProductProfileSynthesisCompetitorDiscovery,
  snapshot: DataSnapshotRow | null,
  observations: Awaited<
    ReturnType<ObservationsRepository["listBySnapshotIds"]>
  >,
  outputLocale: string,
): readonly ProductProfileDiscoveredCompetitor[] {
  const isV1 =
    snapshot?.provider === "dataforseo" &&
    snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY &&
    snapshot.schema_version === DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION &&
    snapshot.method_version === DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION;
  const isV2 =
    snapshot?.provider === "dataforseo" &&
    snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY &&
    snapshot.schema_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION &&
    snapshot.method_version === DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION;
  let collectionScope:
    | ReturnType<typeof parseDataForSeoSearchLandscapeScope>
    | ReturnType<typeof parseDataForSeoSearchLandscapeV2Scope>;
  try {
    collectionScope = isV2
      ? parseDataForSeoSearchLandscapeV2Scope(
          snapshot?.summary["collectionScope"],
        )
      : parseDataForSeoSearchLandscapeScope(
          snapshot?.summary["collectionScope"],
        );
  } catch {
    invalidInput();
  }
  if (
    snapshot === null ||
    !sameScope(snapshot, scope) ||
    snapshot.id !== frozen.snapshotId ||
    snapshot.site_id !== siteId ||
    snapshot.collection_run_id !== frozen.collectionRunId ||
    snapshot.source_connection_id !== frozen.sourceConnectionId ||
    snapshot.provider !== "dataforseo" ||
    (!isV1 && !isV2) ||
    snapshot.dataset_key !== frozen.datasetKey ||
    snapshot.schema_version !== frozen.schemaVersion ||
    snapshot.method_version !== frozen.methodVersion ||
    !sameTimestamptzInstant(snapshot.captured_at, frozen.capturedAt) ||
    snapshot.checksum !== frozen.checksum ||
    snapshot.availability !== frozen.availability ||
    snapshot.row_count !== frozen.rowCount ||
    snapshot.limitation !== frozen.limitation ||
    collectionScope.target !== frozen.targetDomain ||
    collectionScope.marketCode !== frozen.marketCode ||
    collectionScope.providerLanguageCode !== frozen.languageCode
  ) {
    invalidInput();
  }
  const competitorRows = observations.filter(
    (row) =>
      row.metric_key === METRIC_DATAFORSEO_COMPETITOR_DOMAIN ||
      row.metric_key === METRIC_DATAFORSEO_SERP_COMPETITOR,
  );
  const rowsById = new Map(competitorRows.map((row) => [row.id, row]));
  for (const observation of frozen.observations) {
    validateCompetitorDiscoveryObservation(
      scope,
      snapshot,
      observation,
      rowsById.get(observation.observationId),
    );
    const value = objectRecord(
      rowsById.get(observation.observationId)?.value_json,
    );
    if (
      value?.["targetDomain"] !== collectionScope.target ||
      value?.["marketCode"] !== collectionScope.marketCode ||
      value?.["languageCode"] !== collectionScope.providerLanguageCode
    ) {
      invalidInput();
    }
    if (
      "sourceKind" in observation &&
      observation.sourceKind === "serp_competitor" &&
      (!("serpCompetitors" in collectionScope) ||
        value?.["seedCount"] !==
          collectionScope.serpCompetitors.seeds.length)
    ) {
      invalidInput();
    }
  }
  return discoverProductProfileCompetitors({
    targetDomain: frozen.targetDomain,
    marketCode: frozen.marketCode,
    outputLocale,
    observations: frozen.observations,
  });
}

async function loadFrozenSynthesisInput(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
): Promise<FrozenSynthesisInput> {
  const ledgerResult = validateLedger(
    scope,
    runId,
    await new ProductProfileRunsRepository(ctx.db).findById(scope, runId),
  );
  const baseResult = validateBaseProfile(
    scope,
    ledgerResult.ledger,
    ledgerResult.manifest,
    await new IcpProfilesRepository(ctx.db).findById(
      scope,
      ledgerResult.ledger.base_icp_profile_id,
    ),
  );
  const snapshot = validateCrawlSnapshot(
    scope,
    ledgerResult.ledger,
    ledgerResult.manifest,
    await new DataSnapshotsRepository(ctx.db).findById(
      scope,
      ledgerResult.ledger.source_snapshot_id,
    ),
  );
  const pageRows = await new PageSnapshotsRepository(
    ctx.db,
  ).findByIdsWithSitePageIdentity(
    scope,
    ledgerResult.manifest.pages.map((page) => page.pageSnapshotId),
  );
  const descriptors = validatePages(
    scope,
    ledgerResult.ledger,
    ledgerResult.manifest,
    pageRows,
  );
  let discoveredCompetitors: readonly ProductProfileDiscoveredCompetitor[] = [];
  if (
    ledgerResult.manifest.schemaVersion ===
      PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION &&
    ledgerResult.manifest.competitorDiscovery !== null
  ) {
    const frozenDiscovery = ledgerResult.manifest.competitorDiscovery;
    const discoverySnapshot = await new DataSnapshotsRepository(ctx.db).findById(
      scope,
      frozenDiscovery.snapshotId,
    );
    const discoveryObservations = await new ObservationsRepository(
      ctx.db,
    ).listBySnapshotIds(scope, [frozenDiscovery.snapshotId]);
    discoveredCompetitors = validateCompetitorDiscovery(
      scope,
      ledgerResult.ledger.site_id,
      frozenDiscovery,
      discoverySnapshot,
      discoveryObservations,
      ledgerResult.manifest.outputLocale,
    );
  }
  return {
    ledger: ledgerResult.ledger,
    manifest: ledgerResult.manifest,
    base: baseResult.profile,
    snapshot,
    descriptors,
    discoveredCompetitors,
  };
}

function descriptorText(page: ProductProfilePageDescriptor): string {
  return [
    page.subjectUrl,
    page.fetchUrl,
    page.title,
    page.metaDescription,
    ...page.h1,
    ...page.headings,
    page.bodyExcerpt,
    ...page.paragraphs,
    ...page.jsonLdTypes,
    page.canonicalTarget,
    page.contentType,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase();
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasExactHostnameToken(text: string, domain: string): boolean {
  const pattern = new RegExp(
    `(?:^|[^a-z0-9.-])${regexEscape(domain)}(?=$|[^a-z0-9.-])`,
    "iu",
  );
  return pattern.test(text);
}

function validatedPageKeyMap(
  descriptors: readonly ProductProfilePageDescriptor[],
  pageKeyMap: readonly ProductProfilePageKeyMapEntry[],
): ReadonlyMap<string, ProductProfilePageDescriptor> {
  if (pageKeyMap.length !== descriptors.length) invalidResult();
  const pages = new Map<string, ProductProfilePageDescriptor>();
  pageKeyMap.forEach((entry, index) => {
    if (
      entry.inputIndex !== index ||
      entry.pageKey !== productProfilePageKeyForIndex(index) ||
      pages.has(entry.pageKey) ||
      descriptors[entry.inputIndex] === undefined
    ) {
      invalidResult();
    }
    pages.set(entry.pageKey, descriptors[entry.inputIndex]!);
  });
  return pages;
}

/**
 * The model may propose only candidates, never durable competitor facts. Keep a
 * candidate only when the exact normalized hostname appears in one of the same
 * bounded pages it cited. Substrings in a larger hostname/token are rejected.
 */
export function retainExactlyGroundedCompetitors(
  candidate: ProductProfileSemanticCandidateEnvelope,
  descriptors: readonly ProductProfilePageDescriptor[],
  pageKeyMap: readonly ProductProfilePageKeyMapEntry[],
): ProductProfileSemanticCandidateEnvelope {
  const pages = validatedPageKeyMap(descriptors, pageKeyMap);
  const productHostname = new URL(descriptors[0]!.subjectUrl).hostname
    .toLowerCase()
    .replace(/^www\./u, "");
  const competitorCandidates = candidate.competitorCandidates.filter(
    (competitor) =>
      competitor.domain.toLowerCase().replace(/^www\./u, "") !==
        productHostname &&
      competitor.sourcePageKeys.some((pageKey) => {
        const page = pages.get(pageKey);
        return (
          page !== undefined &&
          hasExactHostnameToken(
            descriptorText(page),
            competitor.domain.toLowerCase(),
          )
        );
      }),
  );
  return { ...candidate, competitorCandidates };
}

interface ExpectedInvocationIdentity {
  readonly provider: string;
  readonly model: string;
  readonly promptSetVersion: string;
  readonly inputHash: string;
}

function invocationMetadata(
  invocation: AnalysisInvocationRecord,
  ledger: ProductProfileRunRow,
  expected: ExpectedInvocationIdentity,
): ProductProfileInvocationMetadata {
  if (
    invocation.task !== "product_profile_synthesis" ||
    invocation.promptSetVersion !== ledger.prompt_set_version ||
    invocation.provider !== expected.provider ||
    invocation.model !== expected.model ||
    invocation.promptSetVersion !== expected.promptSetVersion ||
    invocation.inputHash !== expected.inputHash ||
    !SHA256_HEX.test(invocation.inputHash) ||
    (invocation.outputHash !== null &&
      !SHA256_HEX.test(invocation.outputHash)) ||
    (invocation.status === "succeeded"
      ? invocation.outputHash === null || invocation.errorCode !== null
      : invocation.outputHash !== null || invocation.errorCode === null) ||
    !["succeeded", "failed", "rejected"].includes(invocation.status)
  ) {
    invalidResult();
  }
  return {
    provider: invocation.provider,
    model: invocation.model,
    promptSetVersion: invocation.promptSetVersion,
    inputHash: invocation.inputHash,
    outputHash: invocation.outputHash,
    status: invocation.status,
    inputTokens: invocation.inputTokens,
    outputTokens: invocation.outputTokens,
    costUsd: invocation.costUsd,
    latencyMs: invocation.latencyMs,
    errorCode: invocation.errorCode,
  };
}

type InvocationPersistenceResult =
  | { readonly kind: "finalized"; readonly invocationId: string }
  | { readonly kind: "outcome_unknown" };

function logRecordedInvocation(
  ctx: WorkerContext,
  invocation: AnalysisInvocationRecord,
): void {
  try {
    ctx.logger.info("product_profile_synthesis_invocation_recorded", {
      task: "product_profile_synthesis",
      status: invocation.status,
      provider: invocation.provider,
      model: invocation.model,
      inputTokens: invocation.inputTokens,
      outputTokens: invocation.outputTokens,
      latencyMs: invocation.latencyMs,
      errorCode: invocation.errorCode,
    });
  } catch {
    // The immutable audit row, not logging, is the source of truth.
  }
}

async function finalizeReservedInvocation(
  ctx: WorkerContext,
  attempts: ProductProfileInvocationAttemptsRepository,
  attempt: RunAttempt,
  reservationId: string,
  ledger: ProductProfileRunRow,
  expected: ExpectedInvocationIdentity,
  invocation: AnalysisInvocationRecord,
): Promise<InvocationPersistenceResult> {
  let metadata: ProductProfileInvocationMetadata;
  try {
    metadata = invocationMetadata(invocation, ledger, expected);
  } catch {
    await attempts.markOutcomeUnknown(
      attempt,
      reservationId,
      INVOCATION_IDENTITY_MISMATCH,
    );
    return { kind: "outcome_unknown" };
  }

  try {
    const finalized = await attempts.finalizeWithInvocation(
      attempt,
      reservationId,
      metadata,
    );
    if (finalized.kind !== "finalized") {
      return { kind: "outcome_unknown" };
    }
    logRecordedInvocation(ctx, invocation);
    return { kind: "finalized", invocationId: finalized.invocationId };
  } catch {
    const marked = await attempts.markOutcomeUnknown(
      attempt,
      reservationId,
      INVOCATION_PERSISTENCE_UNKNOWN,
    );
    if (marked.kind === "finalized") {
      logRecordedInvocation(ctx, invocation);
      return { kind: "finalized", invocationId: marked.invocationId };
    }
    return { kind: "outcome_unknown" };
  }
}

function isTransientProductProfileError(error: unknown): boolean {
  return (
    (error instanceof LLMError &&
      [
        "NETWORK_ERROR",
        "TIMEOUT",
        "RATE_LIMITED",
        "SERVER_ERROR",
      ].includes(error.code)) ||
    isTransientInfrastructureError(error)
  );
}

function stableErrorCode(error: unknown): string {
  if (error instanceof LLMError) return error.code;
  if (error instanceof ProductProfileResultError) {
    return "PRODUCT_PROFILE_SYNTHESIS_RESULT_INVALID";
  }
  return "PRODUCT_PROFILE_SYNTHESIS_FAILED";
}

async function terminalizeFailure(
  ctx: WorkerContext,
  attempt: RunAttempt,
  code: string,
  summary = SAFE_FAILURE_SUMMARY,
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const runs = new AsyncRunsRepository(tx);
    if (!(await runs.lockAttemptForUpdate(attempt))) return false;
    const terminalized = await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: code,
      lastErrorSummary: summary,
    });
    if (!terminalized) {
      throw new Error("Product Profile attempt ownership changed while locked");
    }
    return true;
  });
}

async function resetForRetry(
  ctx: WorkerContext,
  runs: AsyncRunsRepository,
  attempt: RunAttempt,
  error: unknown,
): Promise<boolean> {
  const code =
    error instanceof LLMError
      ? error.code
      : transientFailureCode(error);
  const reset = await runs.resetToQueued(attempt, {
    code,
    summary: SAFE_RETRY_SUMMARY,
  });
  if (!reset) {
    try {
      ctx.logger.info("product_profile_synthesis_stale_attempt", { code });
    } catch {
      // Attempt fencing is canonical even when the log sink is unavailable.
    }
    return false;
  }
  try {
    ctx.logger.warn("product_profile_synthesis_retry", { code });
  } catch {
    // Retry state is already durable.
  }
  return true;
}

async function commitDraft(
  ctx: WorkerContext,
  scope: ProjectScope,
  attempt: RunAttempt,
  run: { readonly initiated_by: string },
  frozen: FrozenSynthesisInput,
  profile: ProductProfileDraft,
): Promise<boolean> {
  const profileHash = contentHash({
    status: "draft",
    profile,
  } as CanonicalValue);
  return ctx.db.transaction(async (tx) => {
    const runs = new AsyncRunsRepository(tx);
    if (!(await runs.lockAttemptForUpdate(attempt))) return false;

    // Global lock order for Project-scoped completion is AsyncRun → Project.
    const projects = new ProjectsRepository(tx);
    const project = await projects.findByIdForUpdate(
      { workspaceId: scope.workspaceId },
      scope.projectId,
    );
    if (
      project === null ||
      project.workspace_id !== scope.workspaceId ||
      project.id !== scope.projectId ||
      project.archived_at !== null ||
      project.current_icp_profile_id !== frozen.ledger.base_icp_profile_id
    ) {
      const cancelled = await runs.setTerminal(attempt, SUPERSEDED);
      if (!cancelled) {
        throw new Error("Product Profile attempt ownership changed while locked");
      }
      return false;
    }

    const profiles = new IcpProfilesRepository(tx);
    let result = await profiles.findByContentHash(scope, profileHash);
    if (result !== null) {
      const parsed = ProductProfileDraft.safeParse(result.profile);
      if (
        !sameScope(result, scope) ||
        result.status !== "draft" ||
        result.content_hash !== profileHash ||
        contentHash({
          status: result.status,
          profile: result.profile,
        } as CanonicalValue) !== profileHash ||
        !parsed.success ||
        !isDeepStrictEqual(parsed.data, profile)
      ) {
        throw new ProductProfileResultError();
      }
    } else {
      result = await profiles.insertVersion({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        version: (await profiles.maxVersion(scope)) + 1,
        status: "draft",
        profile,
        contentHash: profileHash,
        createdBy: run.initiated_by,
      });
    }

    const currentSet = await projects.setCurrentIcpProfile(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      result.id,
    );
    if (!currentSet) {
      throw new Error("Product Profile current pointer update failed");
    }

    // The frozen ledger result must be installed before AsyncRun completion;
    // database provenance guards bind the public result to this exact pointer.
    const resultSet = await new ProductProfileRunsRepository(tx).setResult(
      scope,
      attempt.runId,
      result.id,
    );
    if (!resultSet) {
      throw new Error("Product Profile result binding failed");
    }
    const completed = await runs.setTerminal(attempt, {
      status: "completed",
      resultType: "icp_profile",
      resultId: result.id,
    });
    if (!completed) {
      throw new Error("Product Profile attempt ownership changed while locked");
    }
    return true;
  });
}

export async function runProductProfileSynthesis(
  ctx: WorkerContext,
  payload: ProductProfileSynthesisJobPayload,
  dependencies: ProductProfileSynthesisDependencies = {},
): Promise<void> {
  const scope: ProjectScope = {
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
  };
  const runs = new AsyncRunsRepository(ctx.db);
  const claimed = await runs.claim(scope, payload.runId);
  if (!claimed) return;
  const attempt = toRunAttempt(claimed);

  if (
    claimed.id !== payload.runId ||
    claimed.workspace_id !== scope.workspaceId ||
    claimed.project_id !== scope.projectId ||
    claimed.kind !== "product_profile_synthesis"
  ) {
    await terminalizeFailure(
      ctx,
      attempt,
      "PRODUCT_PROFILE_SYNTHESIS_RUN_INVALID",
    );
    return;
  }

  let frozen: FrozenSynthesisInput;
  try {
    frozen = await loadFrozenSynthesisInput(ctx, scope, payload.runId);
  } catch (error) {
    if (isTransientProductProfileError(error)) {
      if (await resetForRetry(ctx, runs, attempt, error)) throw error;
      return;
    }
    await terminalizeFailure(
      ctx,
      attempt,
      "PRODUCT_PROFILE_SYNTHESIS_INPUT_INVALID",
    );
    return;
  }

  const promptSetVersion = productProfilePromptSetVersion(
    frozen.ledger.prompt_set_version,
  );
  const declaredContext =
    promptSetVersion !== PRODUCT_PROFILE_LEGACY_PROMPT_SET_VERSION
      ? buildProductProfileDeclaredContext(frozen.base)
      : undefined;
  const providerInput: ProductProfileSynthesisInput = {
    sourcePageUrl: frozen.manifest.sourcePageUrl,
    ...((promptSetVersion === PRODUCT_PROFILE_PROMPT_SET_VERSION ||
      promptSetVersion === PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION) &&
    (frozen.manifest.schemaVersion ===
      PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION ||
      frozen.manifest.schemaVersion ===
        PRODUCT_PROFILE_SYNTHESIS_OUTPUT_LOCALE_INPUT_SCHEMA_VERSION)
      ? { outputLocale: frozen.manifest.outputLocale }
      : {}),
    ...(frozen.base.businessHint === null
      ? {}
      : { businessHint: frozen.base.businessHint }),
    ...(declaredContext === undefined ? {} : { declaredContext }),
    pages: frozen.descriptors,
  };
  const createClient =
    dependencies.createClient ?? createOpenAIProductProfileClient;
  let client: ProductProfileSynthesisClient;
  let preflight: ReturnType<typeof prepareProductProfileSynthesis>;
  try {
    preflight = prepareProductProfileSynthesis(
      providerInput,
      promptSetVersion,
    );
    client = createClient({
      apiKey: ctx.openai.apiKey,
      model: ctx.openai.model,
      ...(ctx.openai.temperature !== undefined
        ? { temperature: ctx.openai.temperature }
        : {}),
      promptSetVersion,
      ...(ctx.openai.baseUrl ? { baseUrl: ctx.openai.baseUrl } : {}),
      ...(ctx.openai.authScheme
        ? { authScheme: ctx.openai.authScheme }
        : {}),
      timeoutMs: PRODUCT_PROFILE_SYNTHESIS_REQUEST_TIMEOUT_MS,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
  } catch (error) {
    await terminalizeFailure(ctx, attempt, stableErrorCode(error));
    return;
  }

  const expectedInvocation: ExpectedInvocationIdentity = {
    provider: "openai",
    model: ctx.openai.model,
    promptSetVersion: frozen.ledger.prompt_set_version,
    inputHash: preflight.inputHash,
  };
  const invocationAttempts = new ProductProfileInvocationAttemptsRepository(
    ctx.db,
  );
  let reserved: Awaited<ReturnType<typeof invocationAttempts.reserve>>;
  try {
    reserved = await invocationAttempts.reserve(attempt, expectedInvocation);
  } catch (error) {
    if (await resetForRetry(ctx, runs, attempt, error)) throw error;
    return;
  }
  if (reserved.kind === "stale" || reserved.kind === "existing") return;
  if (reserved.kind === "budget_exhausted") {
    await terminalizeFailure(
      ctx,
      attempt,
      "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_BUDGET_EXHAUSTED",
      "Product Profile synthesis invocation budget was exhausted.",
    );
    return;
  }
  if (reserved.kind === "unresolved") {
    await terminalizeFailure(
      ctx,
      attempt,
      INVOCATION_OUTCOME_UNKNOWN_CODE,
      INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
    );
    return;
  }
  if (reserved.kind === "configuration_mismatch") {
    await terminalizeFailure(
      ctx,
      attempt,
      "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_CONFIGURATION_MISMATCH",
    );
    return;
  }
  if (reserved.kind !== "reserved") return;
  const reservation = reserved.reservation;
  if (
    reservation.workspace_id !== attempt.workspaceId ||
    reservation.project_id !== attempt.projectId ||
    reservation.product_profile_run_id !== attempt.runId ||
    reservation.async_attempt_count !== attempt.attemptCount ||
    reservation.provider !== expectedInvocation.provider ||
    reservation.model !== expectedInvocation.model ||
    reservation.prompt_set_version !== expectedInvocation.promptSetVersion ||
    reservation.input_hash !== expectedInvocation.inputHash ||
    reservation.status !== "reserved"
  ) {
    await terminalizeFailure(
      ctx,
      attempt,
      "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_CONFIGURATION_MISMATCH",
    );
    return;
  }

  let result: Awaited<
    ReturnType<ProductProfileSynthesisClient["synthesizeProductProfile"]>
  >;
  let invocationId: string;
  try {
    // The durable reservation is authoritative before this network boundary.
    result = await client.synthesizeProductProfile(providerInput);
    if (result.droppedCompetitorCount > 0) {
      // A succeeded invocation that silently thinned the competitor pool is
      // the one state production forensics cannot reconstruct afterwards:
      // the persisted profile looks identical to "the model found none".
      ctx.logger.warn("product_profile_competitors_dropped", {
        code: "PRODUCT_PROFILE_COMPETITORS_DROPPED",
        droppedCompetitorCount: result.droppedCompetitorCount,
      });
    }
    const persisted = await finalizeReservedInvocation(
      ctx,
      invocationAttempts,
      attempt,
      reservation.id,
      frozen.ledger,
      expectedInvocation,
      result.invocation,
    );
    if (persisted.kind === "outcome_unknown") {
      await terminalizeFailure(
        ctx,
        attempt,
        INVOCATION_OUTCOME_UNKNOWN_CODE,
        INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
      );
      return;
    }
    invocationId = persisted.invocationId;
  } catch (error) {
    if (error instanceof LLMError && error.invocation !== null) {
      const persisted = await finalizeReservedInvocation(
        ctx,
        invocationAttempts,
        attempt,
        reservation.id,
        frozen.ledger,
        expectedInvocation,
        error.invocation,
      );
      if (persisted.kind === "outcome_unknown") {
        await terminalizeFailure(
          ctx,
          attempt,
          INVOCATION_OUTCOME_UNKNOWN_CODE,
          INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
        );
        return;
      }
    } else {
      try {
        await invocationAttempts.markOutcomeUnknown(
          attempt,
          reservation.id,
          PROVIDER_OUTCOME_UNKNOWN,
        );
      } catch {
        // The pre-provider reservation remains authoritative and prevents a
        // replay even when recording the indeterminate outcome is ambiguous.
      }
      await terminalizeFailure(
        ctx,
        attempt,
        INVOCATION_OUTCOME_UNKNOWN_CODE,
        INVOCATION_OUTCOME_UNKNOWN_SUMMARY,
      );
      return;
    }
    if (isTransientProductProfileError(error)) {
      if (await resetForRetry(ctx, runs, attempt, error)) throw error;
      return;
    }
    await terminalizeFailure(ctx, attempt, stableErrorCode(error));
    try {
      ctx.logger.error("product_profile_synthesis_failed", {
        code: stableErrorCode(error),
        type: error instanceof LLMError ? "llm" : "internal",
        // Present only where the client had something structural to say, which
        // today means a rejected candidate naming the schema paths that failed.
        ...(error instanceof LLMError && error.detail !== null
          ? { detail: error.detail }
          : {}),
      });
    } catch {
      // The terminal ledger is authoritative.
    }
    return;
  }

  let profile: ProductProfileDraft;
  try {
    if (
      result.invocation.status !== "succeeded" ||
      result.invocation.outputHash === null ||
      !isDeepStrictEqual(result.pageKeyMap, preflight.pageKeyMap) ||
      sha256Hex(JSON.stringify(result.candidate)) !==
        result.invocation.outputHash
    ) {
      invalidResult();
    }
    const candidate = retainExactlyGroundedCompetitors(
      result.candidate,
      frozen.descriptors,
      result.pageKeyMap,
    );
    const pageEvidence = Object.fromEntries(
      result.pageKeyMap.map((entry) => [
        entry.pageKey,
        frozen.descriptors[entry.inputIndex]!.pageSnapshotId,
      ]),
    );
    const now = dependencies.now?.() ?? new Date();
    if (!Number.isFinite(now.getTime())) invalidResult();
    profile = buildProductProfileDraft({
      base: frozen.base,
      candidate,
      sourceSnapshotId: frozen.snapshot.id,
      analysisInvocationId: invocationId,
      generatedAt: now.toISOString(),
      pageEvidence,
      discoveredCompetitors: frozen.discoveredCompetitors,
    });
  } catch (error) {
    await terminalizeFailure(ctx, attempt, stableErrorCode(error));
    return;
  }

  try {
    const committed = await commitDraft(
      ctx,
      scope,
      attempt,
      claimed,
      frozen,
      profile,
    );
    if (committed) {
      try {
        ctx.logger.info("product_profile_synthesis_completed", {
          status: "completed",
        });
      } catch {
        // The canonical result was already committed.
      }
    }
  } catch (error) {
    if (isTransientProductProfileError(error)) {
      if (await resetForRetry(ctx, runs, attempt, error)) throw error;
      return;
    }
    await terminalizeFailure(
      ctx,
      attempt,
      "PRODUCT_PROFILE_SYNTHESIS_COMMIT_FAILED",
    );
  }
}
