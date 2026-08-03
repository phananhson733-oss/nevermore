import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  contentHash,
  enqueueRunInTx,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  TelemetryRepository,
  type CanonicalValue,
  type Db,
  type DbTx,
  type IcpProfileRow,
  type ProjectRow,
  type SiteRow,
  type WorkspaceScope,
} from "@sf/db";
import {
  Bcp47Locale,
  CONTRACT_VERSION,
  createInitialProductProfileDraft,
  type CreateProjectWireRequest,
  type LegacyCreateProjectWireRequest,
  type ProductProfileCreateProjectRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import {
  canonicalUrlGuard,
  canonicalizeUrl,
  createDataForSeoSearchLandscapeV2Scope,
  DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  normalizeSiteOrigin,
  normalizeUrl,
  probeSiteOrigin,
  resolveDataForSeoMarket,
  type SiteOriginProbe,
  type UrlGuardResult,
} from "@sf/sources";
import { getEnv } from "@/env";
import { getBoss } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { toProjectDto, type ProjectDto } from "./mappers";

const IDEMPOTENCY_SCOPE = "createProject";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const URL_FIRST_DEFAULT_DELIVERY_LOCALE = "en";
const PRODUCT_PROFILE_DATAFORSEO_ACTIVE_KEY =
  "collect:dataforseo:search_landscape";

/** Injectable URL guard so tests can drive SSRF cases without live DNS. */
export type UrlGuard = (rawUrl: string) => Promise<UrlGuardResult>;

export interface CreateProjectRuntime {
  readonly environment?: string;
  readonly siteOriginProbe?: SiteOriginProbe;
  readonly defaultDeliveryLocale?: string;
  readonly dataForSeoDiscovery?: {
    readonly enabled: boolean;
    readonly maxKeywords: number;
    readonly maxCompetitors: number;
  };
}

export interface CreateProjectResult {
  readonly status: number;
  readonly project: ProjectDto;
  readonly location: string;
  readonly replayed: boolean;
}

function locationFor(
  projectId: string,
  productProfileMode: boolean,
): string {
  return `/p/${projectId}/${productProfileMode ? "context" : "overview"}`;
}

function isProductProfileCreate(
  body: CreateProjectWireRequest,
): body is ProductProfileCreateProjectRequest {
  return "mode" in body && body.mode === "product_profile";
}

function createProjectRequestHash(body: CreateProjectWireRequest): string {
  if (isProductProfileCreate(body)) {
    return contentHash({
      mode: body.mode,
      productUrl: body.productUrl,
      businessHint: body.businessHint ?? null,
      ...(body.productName === undefined
        ? {}
        : { productName: body.productName }),
      ...(body.customerModel === undefined
        ? {}
        : { customerModel: body.customerModel }),
      ...(body.primaryMarket === undefined
        ? {}
        : { primaryMarket: body.primaryMarket }),
      ...(body.growthObjectives === undefined
        ? {}
        : { growthObjectives: [...body.growthObjectives] }),
    });
  }
  return contentHash({
    clientName: body.clientName,
    projectName: body.projectName,
    siteUrl: body.siteUrl,
    marketCodes: [...body.marketCodes],
    siteLanguageCodes: [...body.siteLanguageCodes],
    defaultDeliveryLocale: body.defaultDeliveryLocale,
  });
}

/**
 * Create a project, its primary site, and the default Crawl source in ONE
 * transaction, then emit `project_created` (spec §6.1). URL is normalized and
 * SSRF-checked first; private/metadata/illegal URLs are rejected 422 (AC-007).
 * Idempotency-Key replays the original 201 for the same body, 409s on reuse.
 */
export async function createProject(
  scope: WorkspaceScope,
  actorId: string,
  idempotencyKey: string,
  body: CreateProjectWireRequest,
  guard: UrlGuard = canonicalUrlGuard,
  runtime: CreateProjectRuntime = {},
): Promise<CreateProjectResult> {
  const requestHash = createProjectRequestHash(body);
  const productProfileMode = isProductProfileCreate(body);
  const productProfileDeliveryLocale = productProfileMode
    ? Bcp47Locale.parse(
        runtime.defaultDeliveryLocale ?? URL_FIRST_DEFAULT_DELIVERY_LOCALE,
      )
    : null;
  const { db } = getDb();

  // A completed command is immutable. Replay (or reject a different hash)
  // before DNS/reachability checks whose result can legitimately change after
  // the original 201 was committed.
  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
  if (existing) {
    const replay = await replayOrConflict(
      db,
      scope,
      existing,
      requestHash,
      productProfileMode,
    );
    if (replay) return replay;
  }

  // 1. The legacy command remains origin-only. URL-first profile creation
  // derives the Site origin but preserves its deep page as a separate identity.
  let submittedProductUrl: URL | null = null;
  if (productProfileMode) {
    const parsed = normalizeUrl(body.productUrl);
    if (!parsed || parsed.url.hash !== "") {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "productUrl must be a public http(s) URL.",
        {
          errors: [{
            pointer: "/productUrl",
            code: "invalid_url",
            message: "Use a public http(s) page URL without credentials or a fragment.",
          }],
        },
      );
    }
    submittedProductUrl = parsed.url;
  }
  const submittedOrigin = normalizeSiteOrigin(
    productProfileMode ? submittedProductUrl!.origin : body.siteUrl,
  );
  if (!submittedOrigin) {
    const pointer = productProfileMode ? "/productUrl" : "/siteUrl";
    throw new ProblemError(
      "VALIDATION_ERROR",
      `${pointer.slice(1)} is invalid.`,
      {
        errors: [{
          pointer,
          code: "invalid_url",
          message: productProfileMode
            ? "Use a public http(s) page URL."
            : "Use an http(s) origin without a path, query, or fragment.",
        }],
      },
    );
  }
  // 2. Production canonicalizes submitted HTTP origins to HTTPS only after a
  // DNS-pinned, bounded reachability request proves the secure origin exists.
  // Local/test environments keep explicit HTTP origins for offline fixtures.
  let normalized = submittedOrigin;
  let verdict: UrlGuardResult | null = null;
  if (
    (runtime.environment ?? process.env["NODE_ENV"]) === "production" &&
    submittedOrigin.origin.startsWith("http://")
  ) {
    const secureUrl = new URL(submittedOrigin.origin);
    secureUrl.protocol = "https:";
    const secureOrigin = normalizeSiteOrigin(secureUrl.origin);
    if (!secureOrigin) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        `${productProfileMode ? "productUrl" : "siteUrl"} could not be normalized to a secure origin.`,
        {
          errors: [{
            pointer: productProfileMode ? "/productUrl" : "/siteUrl",
            code: "invalid_url",
            message: "The secure site origin is invalid.",
          }],
        },
      );
    }
    if (submittedProductUrl) submittedProductUrl.protocol = "https:";
    const secureProductPage = submittedProductUrl
      ? canonicalizeUrl(submittedProductUrl.toString())
      : null;
    if (productProfileMode && !secureProductPage) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "productUrl could not be canonicalized.",
        {
          errors: [{
            pointer: "/productUrl",
            code: "invalid_url",
            message: "The product page URL is invalid.",
          }],
        },
      );
    }
    const secureVerdict = await guard(
      secureProductPage?.fetchUrl ?? secureOrigin.origin,
    );
    verdict = secureVerdict;
    const probe = runtime.siteOriginProbe ?? probeSiteOrigin;
    const reachable =
      secureVerdict.safe &&
      secureVerdict.pinnedIp !== null &&
      (await probe({
        origin: secureOrigin.origin,
        pinnedIp: secureVerdict.pinnedIp,
      }));
    if (!reachable) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "The HTTPS site origin could not be reached safely.",
        {
          errors: [{
            pointer: productProfileMode ? "/productUrl" : "/siteUrl",
            code: "https_unreachable",
            message: "Confirm that the HTTPS origin is publicly reachable.",
          }],
        },
      );
    }
    normalized = secureOrigin;
  }

  const canonicalProductPage = submittedProductUrl
    ? canonicalizeUrl(submittedProductUrl.toString())
    : null;
  if (productProfileMode && !canonicalProductPage) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "productUrl could not be canonicalized.",
      {
        errors: [{
          pointer: "/productUrl",
          code: "invalid_url",
          message: "The product page URL is invalid.",
        }],
      },
    );
  }

  // 3. SSRF guard: reject localhost, private, link-local, metadata. The HTTPS
  // upgrade branch already guarded the exact page/origin before probing.
  verdict ??= await guard(canonicalProductPage?.fetchUrl ?? normalized.origin);
  if (!verdict.safe) {
    throw new ProblemError("VALIDATION_ERROR", "The submitted URL is not an allowed public address.", {
      errors: [
        {
          pointer: productProfileMode ? "/productUrl" : "/siteUrl",
          code: "blocked_url",
          message: "Use a public URL on a standard HTTP(S) port.",
        },
      ],
    });
  }

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const dataForSeoDiscovery = productProfileMode
    ? (runtime.dataForSeoDiscovery ??
      (process.env["DATAFORSEO_ENABLED"] === "true"
        ? {
            enabled: getEnv().DATAFORSEO_ENABLED === "true",
            maxKeywords: getEnv().DATAFORSEO_MAX_KEYWORDS,
            maxCompetitors: getEnv().DATAFORSEO_MAX_COMPETITORS,
          }
        : { enabled: false, maxKeywords: 200, maxCompetitors: 100 }))
    : null;
  const discoveryEnabled =
    productProfileMode &&
    dataForSeoDiscovery?.enabled === true &&
    body.primaryMarket !== undefined;
  const discoveryBoss = discoveryEnabled ? await getBoss() : null;

  return db.transaction(async (tx) => {
    const txIdem = new IdempotencyRepository(tx);
    const reserved = await txIdem.begin({
      workspaceId: scope.workspaceId,
      scope: IDEMPOTENCY_SCOPE,
      key: idempotencyKey,
      requestHash,
      expiresAt,
    });
    if (!reserved) {
      // Another transaction won the key between the fast-path read and here.
      const now = await txIdem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
      const replay = now
        ? await replayOrConflict(
            tx,
            scope,
            now,
            requestHash,
            productProfileMode,
          )
        : null;
      if (replay) return replay;
      throw new ProblemError("IDEMPOTENCY_KEY_REUSED", "Idempotency key is being processed.");
    }

    const projects = new ProjectsRepository(tx);
    const sites = new SitesRepository(tx);
    const sitePages = new SitePagesRepository(tx);
    const icpProfiles = new IcpProfilesRepository(tx);
    const sources = new SourceConnectionsRepository(tx);
    const telemetry = new TelemetryRepository(tx);

    const legacyBody: LegacyCreateProjectWireRequest | null = productProfileMode
      ? null
      : body;
    // Before evidence-backed synthesis, the hostname is the only honest
    // display identity available. It is replaceable after profile review and
    // is not an inferred company or product name.
    const initialDisplayName = productProfileMode
      ? (body.productName ?? normalized.host)
      : legacyBody!.clientName;

    const project = await projects.insert({
      workspaceId: scope.workspaceId,
      clientName: initialDisplayName,
      projectName: productProfileMode
        ? initialDisplayName
        : legacyBody!.projectName,
      defaultDeliveryLocale: productProfileMode
        ? productProfileDeliveryLocale!
        : legacyBody!.defaultDeliveryLocale,
      createdBy: actorId,
    });
    const site = await sites.insertPrimary({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      origin: normalized.origin,
      host: normalized.host,
      marketCodes: productProfileMode
        ? body.primaryMarket === undefined
          ? []
          : [body.primaryMarket]
        : [...legacyBody!.marketCodes],
      languageCodes: productProfileMode
        ? []
        : [...legacyBody!.siteLanguageCodes],
    });
    await sources.insertDefaultCrawl({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      siteId: site.id,
      createdBy: actorId,
    });

    let competitorDiscoveryQueued = false;
    if (
      discoveryEnabled &&
      discoveryBoss &&
      dataForSeoDiscovery &&
      body.primaryMarket !== undefined
    ) {
      // The search language belongs to the market, never to the delivery
      // locale the customer reads the report in. DataForSEO Labs serves a
      // closed language set per country and rejects anything else with task
      // status 40501; it also serves only a subset of countries, which resolve
      // to null here so the landscape is skipped instead of being enqueued as
      // work that could only fail.
      const market = resolveDataForSeoMarket(body.primaryMarket);
      const collectionScope = market
        ? createDataForSeoSearchLandscapeV2Scope({
            target: normalized.host,
            marketCode: body.primaryMarket,
            locationCode: market.locationCode,
            languageTag: market.languageCode,
            rankedKeywordsLimit: dataForSeoDiscovery.maxKeywords,
            competitorsDomainLimit: dataForSeoDiscovery.maxCompetitors,
            serpCompetitorsLimit: dataForSeoDiscovery.maxCompetitors,
            seeds: [],
          })
        : null;
      if (collectionScope && market) {
        const connection = await sources.insertConnection({
          workspaceId: scope.workspaceId,
          projectId: project.id,
          siteId: site.id,
          provider: "dataforseo",
          connectionType: "api_key_stub",
          state: "connected",
          externalRef: collectionScope.target,
          config: {
            target: collectionScope.target,
            marketCode: collectionScope.marketCode,
            locationCode: market.locationCode,
            locationName: market.locationName,
            languageCode: collectionScope.providerLanguageCode,
            maxKeywords: collectionScope.rankedKeywords.limit,
            maxCompetitors: collectionScope.competitorsDomain.limit,
          },
          limitation: `Initial DataForSEO search landscape for ${collectionScope.target} in ${market.locationName} (location ${market.locationCode}), search language ${collectionScope.providerLanguageCode} — chosen from the market, not the report language. Positions 1–100, ranked keywords capped at ${collectionScope.rankedKeywords.limit}, and competitor domains at ${collectionScope.competitorsDomain.limit}. Product Profile seeds are added by the follow-up synthesis flow if domain overlap is empty.`,
          connectedAt: true,
          createdBy: actorId,
        });
        const run = await new AsyncRunsRepository(tx).insertQueued({
          workspaceId: scope.workspaceId,
          projectId: project.id,
          kind: "collection",
          activeKey: PRODUCT_PROFILE_DATAFORSEO_ACTIVE_KEY,
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
          projectId: project.id,
          siteId: site.id,
          sourceConnectionId: connection.id,
          provider: "dataforseo",
          operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
          parametersHash: contentHash({
            provider: "dataforseo",
            operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
            siteId: site.id,
            collectionScope: collectionScope as unknown as CanonicalValue,
          } as CanonicalValue),
        });
        await enqueueRunInTx(discoveryBoss, tx, "collect.dataforseo", {
          runId: run.id,
          workspaceId: scope.workspaceId,
          projectId: project.id,
          contractVersion: CONTRACT_VERSION,
        });
        competitorDiscoveryQueued = true;
      }
    }

    let initialProfile: IcpProfileRow | null = null;
    if (productProfileMode && canonicalProductPage) {
      // Product-page identity is a fetch identity, not an aggregation key.
      // Preserve path slash semantics and hash the exact value we persist.
      const productPageUrl = canonicalProductPage.fetchUrl;
      await sitePages.upsertNormalizedUrl({
        workspaceId: scope.workspaceId,
        projectId: project.id,
        siteId: site.id,
        normalizedUrl: productPageUrl,
        templateKey: null,
      });
      const profile = createInitialProductProfileDraft({
        sourceSiteId: site.id,
        sourcePageUrl: productPageUrl,
        ...(body.businessHint === undefined
          ? {}
          : { businessHint: body.businessHint }),
        ...(body.productName === undefined
          ? {}
          : { productName: body.productName }),
        ...(body.customerModel === undefined
          ? {}
          : { customerModel: body.customerModel }),
        ...(body.primaryMarket === undefined
          ? {}
          : { primaryMarket: body.primaryMarket }),
        ...(body.growthObjectives === undefined
          ? {}
          : { growthObjectives: body.growthObjectives }),
      });
      initialProfile = await icpProfiles.insertVersion({
        workspaceId: scope.workspaceId,
        projectId: project.id,
        version: 1,
        status: "draft",
        profile,
        contentHash: contentHash({
          status: "draft",
          profile: profile as unknown as CanonicalValue,
        }),
        createdBy: actorId,
      });
      await projects.setCurrentIcpProfile(
        scope,
        project.id,
        initialProfile.id,
      );
    }
    await telemetry.emit({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      eventName: "project_created",
      actorId,
      properties: {
        createMode: productProfileMode ? "product_profile" : "legacy",
        marketCount: productProfileMode
          ? body.primaryMarket === undefined
            ? 0
            : 1
          : legacyBody!.marketCodes.length,
        languageCount: productProfileMode
          ? 0
          : legacyBody!.siteLanguageCodes.length,
        businessHintDeclared:
          productProfileMode && body.businessHint !== undefined,
        productNameDeclared:
          productProfileMode && body.productName !== undefined,
        customerModelDeclared:
          productProfileMode && body.customerModel !== undefined,
        growthObjectiveCount:
          productProfileMode && body.growthObjectives !== undefined
            ? body.growthObjectives.length
            : 0,
        competitorDiscoveryQueued,
      },
    });

    const dto = toProjectDto(project, site, initialProfile);
    const responseBody = { data: dto };
    await txIdem.complete(reserved.id, {
      responseStatus: 201,
      responseBody,
      resourceType: "project",
      resourceId: project.id,
    });

    return {
      status: 201,
      project: dto,
      location: locationFor(project.id, productProfileMode),
      replayed: false,
    };
  });
}

/** Decide replay (same body) vs 409 (different body); null when still in-progress. */
async function replayOrConflict(
  exec: Db | DbTx,
  scope: WorkspaceScope,
  row: { request_hash: string; status: string; resource_id: string | null; response_body: unknown },
  requestHash: string,
  productProfileMode: boolean,
): Promise<CreateProjectResult | null> {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key was already used with a different request body.",
    );
  }
  if (row.status === "completed") {
    // `response_body` is an immutable historical envelope. Its DTO shape may
    // predate the current API contract, so it must never be cast and returned
    // directly. The stable resource id is the replay identity; rehydrate that
    // project through the current scoped mapper instead.
    if (!row.resource_id) {
      throw new ProblemError(
        "NOT_FOUND",
        "Idempotent project replay target not found.",
      );
    }
    const project = await new ProjectsRepository(exec).findById(
      scope,
      row.resource_id,
    );
    if (!project) {
      throw new ProblemError(
        "NOT_FOUND",
        "Idempotent project replay target not found.",
      );
    }
    return {
      status: 201,
      project: await loadAggregate(exec, scope, project),
      location: locationFor(project.id, productProfileMode),
      replayed: true,
    };
  }
  return null;
}

/** Fetch the full project aggregate (project + primary site + current ICP). */
async function loadAggregate(
  exec: Db | DbTx,
  scope: WorkspaceScope,
  project: ProjectRow,
): Promise<ProjectDto> {
  const sites = new SitesRepository(exec);
  const icps = new IcpProfilesRepository(exec);
  const site = await sites.findPrimary({ workspaceId: scope.workspaceId, projectId: project.id });
  if (!site) {
    throw new ProblemError("NOT_FOUND", "Project has no primary site.");
  }
  const currentIcp: IcpProfileRow | null = project.current_icp_profile_id
    ? await icps.findById(
        { workspaceId: scope.workspaceId, projectId: project.id },
        project.current_icp_profile_id,
      )
    : null;
  const confirmedIcp: IcpProfileRow | null = project.confirmed_icp_profile_id
    ? project.confirmed_icp_profile_id === currentIcp?.id
      ? currentIcp
      : await icps.findById(
          { workspaceId: scope.workspaceId, projectId: project.id },
          project.confirmed_icp_profile_id,
        )
    : null;
  return toProjectDto(project, site as SiteRow, currentIcp, confirmedIcp);
}

/** `GET /projects/{projectId}` — 404 (not 403) when foreign/absent (AC-005, AC-010). */
export async function getProject(
  scope: WorkspaceScope,
  projectId: string,
  exec?: Db | DbTx,
): Promise<ProjectDto> {
  const db = exec ?? getDb().db;
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  return loadAggregate(db, scope, project);
}

/**
 * `DELETE /projects/{projectId}` — archive rather than physically erase.
 *
 * The row lock serializes this lifecycle boundary with every mutation that
 * re-checks the project under `FOR UPDATE`. Repeating DELETE for the same
 * scoped archived project is intentionally idempotent; foreign and absent ids
 * remain indistinguishable as 404.
 */
export async function archiveProject(
  scope: WorkspaceScope,
  projectId: string,
): Promise<void> {
  const { db } = getDb();
  await db.transaction(async (tx) => {
    const projects = new ProjectsRepository(tx);
    const project = await projects.findByIdForUpdate(scope, projectId);
    if (!project) {
      throw new ProblemError("NOT_FOUND", "Project not found.");
    }
    if (project.archived_at !== null) return;

    const archived = await projects.archive(scope, projectId);
    if (!archived) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "Project could not be archived after acquiring its lifecycle lock.",
      );
    }
  });
}

export interface ProjectListResult {
  readonly data: ProjectDto[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

/** `GET /projects` — keyset page of the workspace's projects (spec §11.1). */
export async function listProjects(
  scope: WorkspaceScope,
  opts: { limit: number; cursor: string | null; archived: boolean },
): Promise<ProjectListResult> {
  const { db } = getDb();
  const page = await new ProjectsRepository(db).listByWorkspace(scope, opts);
  const sitesRepo = new SitesRepository(db);
  const icpsRepo = new IcpProfilesRepository(db);

  const projectIds = page.rows.map((r) => r.id);
  const siteByProject = await sitesRepo.mapPrimariesByProjects(scope, projectIds);
  const icpIds = page.rows
    .flatMap((r) => [
      r.current_icp_profile_id,
      r.confirmed_icp_profile_id,
    ])
    .filter((id): id is string => id !== null);
  const icpById = await icpsRepo.mapByIds(scope, icpIds);

  const data = page.rows.map((project) => {
    const site = siteByProject.get(project.id);
    if (!site) throw new ProblemError("NOT_FOUND", "Project has no primary site.");
    const icp = project.current_icp_profile_id
      ? (icpById.get(project.current_icp_profile_id) ?? null)
      : null;
    const confirmedIcp = project.confirmed_icp_profile_id
      ? (icpById.get(project.confirmed_icp_profile_id) ?? null)
      : null;
    return toProjectDto(project, site, icp, confirmedIcp);
  });

  return { data, nextCursor: page.nextCursor, limit: opts.limit };
}
