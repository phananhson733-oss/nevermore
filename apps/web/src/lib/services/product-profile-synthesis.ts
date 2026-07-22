import {
  AsyncRunsRepository,
  canonicalize,
  contentHash,
  DataSnapshotsRepository,
  enqueueRunInTx,
  IcpProfilesRepository,
  IdempotencyRepository,
  normalizedUrlHash,
  PageSnapshotsRepository,
  ProductProfileRunsRepository,
  ProjectsRepository,
  sha256Hex,
  SitesRepository,
  type CanonicalValue,
  type WorkspaceScope,
} from "@sf/db";
import {
  CONTRACT_VERSION,
  MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES,
  PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_VERSION,
  ProductProfileDraft,
  ProductProfileSynthesisInputManifest,
  type CreateProductProfileSynthesisRunRequest,
} from "@sf/contracts";
import { PRODUCT_PROFILE_PROMPT_SET_VERSION } from "@sf/artifacts";
import { ProblemError } from "@sf/observability";
import { CRAWL_DATASET_KEY, CRAWL_METHOD_VERSION } from "@sf/sources";
import { getBoss } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { isPostgresUniqueViolation } from "./db-errors";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

const IDEMPOTENCY_SCOPE = "createProductProfileSynthesisRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const PRODUCT_PROFILE_SYNTHESIS_ACTIVE_KEY = "product-profile:synthesis";

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

const CORE_PATH_BUCKETS: readonly ReadonlySet<string>[] = [
  new Set(["product", "products"]),
  new Set(["feature", "features"]),
  new Set(["solution", "solutions"]),
  new Set(["use-case", "use-cases", "usecase", "usecases"]),
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
  readonly baseProfile: ProductProfileSynthesisBaseRow;
  readonly crawlSnapshot: ProductProfileSynthesisSnapshotRow;
  readonly pages: readonly ProductProfileSynthesisPageRow[];
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
): Promise<ProductProfileSynthesisAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
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
        baseProfile,
        crawlSnapshot,
        pages: selectedPages,
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
