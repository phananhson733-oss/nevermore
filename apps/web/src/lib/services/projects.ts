import {
  contentHash,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  TelemetryRepository,
  type Db,
  type DbTx,
  type IcpProfileRow,
  type ProjectRow,
  type SiteRow,
  type WorkspaceScope,
} from "@sf/db";
import {
  createInitialProductProfileDraft,
  type CreateProjectWireRequest,
  type LegacyCreateProjectWireRequest,
  type ProductProfileCreateProjectRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import {
  canonicalUrlGuard,
  canonicalizeUrl,
  normalizeSiteOrigin,
  normalizeUrl,
  probeSiteOrigin,
  type SiteOriginProbe,
  type UrlGuardResult,
} from "@sf/sources";
import { getDb } from "@/lib/db";
import { toProjectDto, type ProjectDto } from "./mappers";

const IDEMPOTENCY_SCOPE = "createProject";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const URL_FIRST_DEFAULT_DELIVERY_LOCALE = "en";

/** Injectable URL guard so tests can drive SSRF cases without live DNS. */
export type UrlGuard = (rawUrl: string) => Promise<UrlGuardResult>;

export interface CreateProjectRuntime {
  readonly environment?: string;
  readonly siteOriginProbe?: SiteOriginProbe;
}

export interface CreateProjectResult {
  readonly status: number;
  readonly project: ProjectDto;
  readonly location: string;
  readonly replayed: boolean;
}

function locationFor(projectId: string): string {
  return `/p/${projectId}/overview`;
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
  const { db } = getDb();

  // A completed command is immutable. Replay (or reject a different hash)
  // before DNS/reachability checks whose result can legitimately change after
  // the original 201 was committed.
  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
  if (existing) {
    const replay = await replayOrConflict(db, scope, existing, requestHash);
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
        ? await replayOrConflict(tx, scope, now, requestHash)
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
      ? normalized.host
      : legacyBody!.clientName;

    const project = await projects.insert({
      workspaceId: scope.workspaceId,
      clientName: initialDisplayName,
      projectName: productProfileMode
        ? initialDisplayName
        : legacyBody!.projectName,
      defaultDeliveryLocale: productProfileMode
        ? URL_FIRST_DEFAULT_DELIVERY_LOCALE
        : legacyBody!.defaultDeliveryLocale,
      createdBy: actorId,
    });
    const site = await sites.insertPrimary({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      origin: normalized.origin,
      host: normalized.host,
      marketCodes: productProfileMode ? [] : [...legacyBody!.marketCodes],
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
      });
      initialProfile = await icpProfiles.insertVersion({
        workspaceId: scope.workspaceId,
        projectId: project.id,
        version: 1,
        status: "draft",
        profile,
        contentHash: contentHash({ status: "draft", profile }),
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
        marketCount: productProfileMode ? 0 : legacyBody!.marketCodes.length,
        languageCount: productProfileMode
          ? 0
          : legacyBody!.siteLanguageCodes.length,
        businessHintDeclared:
          productProfileMode && body.businessHint !== undefined,
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

    return { status: 201, project: dto, location: locationFor(project.id), replayed: false };
  });
}

/** Decide replay (same body) vs 409 (different body); null when still in-progress. */
async function replayOrConflict(
  exec: Db | DbTx,
  scope: WorkspaceScope,
  row: { request_hash: string; status: string; resource_id: string | null; response_body: unknown },
  requestHash: string,
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
      location: locationFor(project.id),
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
