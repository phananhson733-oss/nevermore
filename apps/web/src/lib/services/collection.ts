import {
  AsyncRunsRepository,
  collectionRunParametersHash,
  CollectionRunsRepository,
  contentHash,
  enqueueRunInTx,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type CollectionRunKeywordLibraryContext,
  type QueueName,
  type WorkspaceScope,
} from "@sf/db";
import {
  CONTRACT_VERSION,
  ProductProfileDraft,
  type CreateCollectionRunRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { CRAWL_METHOD_VERSION } from "@sf/sources";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { isPostgresUniqueViolation } from "./db-errors";
import { toAsyncRunDto, runStatusUrl, type AsyncRunDto } from "./runs";

const IDEMPOTENCY_SCOPE = "createCollectionRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ISO 3166-1 alpha-2 assignments. Keep this semantic allow-list here instead
 * of accepting any two letters: `Intl.DisplayNames` also recognizes reserved
 * region identifiers such as ZZ/EU/UN, which are not project market codes.
 */
const ISO_3166_ALPHA2_MARKET_CODES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  ),
);

/** Fixed provider → operation/queue/method wiring (spec §7.5). */
const PROVIDER_CONFIG = {
  crawl: {
    operation: "site_graph",
    queue: "collect.crawl",
    methodVersion: CRAWL_METHOD_VERSION,
  },
  gsc: {
    operation: "search_analytics",
    queue: "collect.gsc",
    methodVersion: "gsc.page_query_daily.v1",
  },
  ga4: {
    operation: "organic_landing",
    queue: "collect.ga4",
    methodVersion: "ga4.organic_landing_daily.v1",
  },
} as const satisfies Record<
  CreateCollectionRunRequest["provider"],
  { operation: string; queue: QueueName; methodVersion: string }
>;

/**
 * `createCollectionRun` is exported inside the Web process and can be invoked
 * without the route's Zod parser. Reject every non-public provider before DB,
 * queue, idempotency, or environment access so an internal provider cannot be
 * smuggled through a cast or another future caller.
 */
function assertCustomerTriggerableProvider(
  body: CreateCollectionRunRequest,
): void {
  const provider = (
    body as { readonly provider?: unknown } | null | undefined
  )?.provider;
  if (
    typeof provider === "string" &&
    Object.hasOwn(PROVIDER_CONFIG, provider)
  ) {
    return;
  }
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Direct collection supports only crawl, gsc, and ga4 providers.",
    {
      errors: [
        {
          pointer: "/provider",
          code: "invalid_value",
          message:
            "Provider must be one of crawl, gsc, or ga4. Run Analysis Refresh for server-owned evidence providers.",
        },
      ],
    },
  );
}

/**
 * Freeze the Site's current Keyword Library identity only when both dimensions
 * are complete and canonicalizable. GSC collection itself remains useful when
 * project context is incomplete; in that case the resulting Snapshot is
 * deliberately ineligible for Keyword Library projection.
 */
export function keywordLibraryContextForSite(site: {
  readonly market_codes: readonly string[];
  readonly language_codes: readonly string[];
}): CollectionRunKeywordLibraryContext | null {
  // The Site model currently stores target sets, not a separately declared
  // primary value. Choosing `[0]` from a multi-value set would invent scope.
  if (site.market_codes.length !== 1 || site.language_codes.length !== 1) {
    return null;
  }
  const marketCode = site.market_codes[0]?.trim().toUpperCase();
  const language = site.language_codes[0]?.trim();
  if (
    !marketCode ||
    !ISO_3166_ALPHA2_MARKET_CODES.has(marketCode) ||
    !language
  ) {
    return null;
  }
  try {
    const languageTag = Intl.getCanonicalLocales(language)[0];
    return languageTag
      ? { basis: "project_context", marketCode, languageTag }
      : null;
  } catch {
    return null;
  }
}

export interface CollectionAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "collection_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

function activeConflict(runId: string, projectId: string): ProblemError {
  const statusUrl = runStatusUrl(projectId, runId);
  return new ProblemError("RUN_ALREADY_ACTIVE", "A collection run is already active.", {
    headers: { Location: statusUrl },
    current: { runId, statusUrl },
  });
}

function replayCollection(
  row: {
    request_hash: string;
    status: string;
    resource_id: string | null;
    response_body: unknown;
  },
  requestHash: string,
): CollectionAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key was already used with a different request body.",
    );
  }
  if (row.status === "completed" && row.resource_id) {
    const body = row.response_body as
      | { run: AsyncRunDto; statusUrl: string; resourceRef: { type: "collection_run"; id: string } }
      | null;
    if (body?.run) {
      return {
        status: 202,
        run: body.run,
        statusUrl: body.statusUrl,
        resourceRef: body.resourceRef,
        location: body.statusUrl,
        replayed: true,
      };
    }
  }
  return null;
}

/**
 * Queue one provider collection (spec §7.5, §13.2). Validates the provider/
 * operation combination, resolves the source connection, and atomically inserts
 * the run + collection placeholder and enqueues the job in ONE transaction. A
 * second active run for the same `collect:{provider}:{operation}` key returns 409
 * RUN_ALREADY_ACTIVE (AC-019). CSV uses the import endpoint. DataForSEO is a
 * server-owned Analysis Refresh provider and is never accepted by this public
 * command, even when this service is invoked without the route parser.
 */
export async function createCollectionRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateCollectionRunRequest,
): Promise<CollectionAcceptedResult> {
  assertCustomerTriggerableProvider(body);
  const projectScope = { workspaceId: scope.workspaceId, projectId };

  const { db } = getDb();
  // Hash the validated wire shape before deriving defaults. Optional members
  // only participate when JSON could have carried them; explicit null remains.
  const requestHash = contentHash({
    projectId,
    provider: body.provider,
    ...(Object.hasOwn(body, "operation") && body.operation !== undefined
      ? { operation: body.operation }
      : {}),
    ...(Object.hasOwn(body, "sourceConnectionId") &&
        body.sourceConnectionId !== undefined
      ? { sourceConnectionId: body.sourceConnectionId }
      : {}),
  });

  // Completed commands replay independently of mutable project/source state.
  // Including projectId in the stable command hash prevents a workspace-level
  // key from replaying a response into another project.
  const idem = new IdempotencyRepository(db);
  const existingKey = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
  if (existingKey) {
    const replay = replayCollection(existingKey, requestHash);
    if (replay) return replay;
  }

  const config = PROVIDER_CONFIG[body.provider];
  const operation = body.operation ?? config.operation;
  if (operation !== config.operation) {
    throw new ProblemError(
      "INVALID_COLLECTION_OPERATION",
      `Provider ${body.provider} only supports operation ${config.operation}.`,
    );
  }
  const activeKey = `collect:${body.provider}:${operation}`;

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) {
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived and read-only.");
  }

  const site = await new SitesRepository(db).findPrimary(projectScope);
  if (!site) throw new ProblemError("NOT_FOUND", "Project has no primary site.");

  // Resolve the source connection: explicit id, else the connected default.
  const sources = new SourceConnectionsRepository(db);
  const connection = body.sourceConnectionId
    ? await sources.findById(projectScope, body.sourceConnectionId)
    : await sources.findConnectedByProvider(projectScope, body.provider);
  if (!connection || connection.provider !== body.provider) {
    throw new ProblemError(
      "SOURCE_NOT_CONNECTED",
      `No connected ${body.provider} source for this project.`,
    );
  }

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const active = await new AsyncRunsRepository(db).findActive(projectScope, activeKey);
  if (active) {
    const now = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
    const replay = now ? replayCollection(now, requestHash) : null;
    if (replay) return replay;
    throw activeConflict(active.id, projectId);
  }

  const boss = await getBoss();
  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
      const txProjects = new ProjectsRepository(tx);
      const txSites = new SitesRepository(tx);
      const txSources = new SourceConnectionsRepository(tx);
      const reserved = await txIdem.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const now = await txIdem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
        const replay = now ? replayCollection(now, requestHash) : null;
        if (replay) return replay;
        throw new ProblemError("IDEMPOTENCY_KEY_REUSED", "Idempotency key is being processed.");
      }

      const currentProject = await txProjects.findByIdForUpdate(scope, projectId);
      if (!currentProject) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }
      if (currentProject.archived_at) {
        throw new ProblemError(
          "PROJECT_ARCHIVED",
          "Project is archived and read-only.",
        );
      }

      const currentSite = await txSites.findPrimary(projectScope);
      if (!currentSite) {
        throw new ProblemError("NOT_FOUND", "Project has no primary site.");
      }

      let crawlSeedSitePageId: string | null = null;
      let crawlSeedUrl: string | null = null;
      if (body.provider === "crawl" && currentProject.current_icp_profile_id) {
        const currentProfile = await new IcpProfilesRepository(tx).findById(
          projectScope,
          currentProject.current_icp_profile_id,
        );
        if (!currentProfile) {
          throw new ProblemError(
            "CONTEXT_INCOMPLETE",
            "The current Product Profile cannot be resolved for this Crawl.",
          );
        }

        const parsedProfile = ProductProfileDraft.safeParse(
          currentProfile.profile,
        );
        if (!parsedProfile.success) {
          const schemaVersion = currentProfile.profile["profileSchemaVersion"];
          if (
            typeof schemaVersion === "string" &&
            schemaVersion.startsWith("product-profile.")
          ) {
            throw new ProblemError(
              "CONTEXT_INCOMPLETE",
              "The current Product Profile is invalid and cannot seed a Crawl.",
            );
          }
          // Historical ICP payloads predate the URL-first Product Profile
          // contract. They remain valid and intentionally carry no deep seed.
        } else {
          if (parsedProfile.data.sourceSiteId !== currentSite.id) {
            throw new ProblemError(
              "CONTEXT_INCOMPLETE",
              "The Product Profile source Site does not match the current project Site.",
            );
          }
          const sourcePage = await new SitePagesRepository(
            tx,
          ).findExactNormalizedUrl(
            projectScope,
            currentSite.id,
            parsedProfile.data.sourcePageUrl,
          );
          if (!sourcePage) {
            throw new ProblemError(
              "CONTEXT_INCOMPLETE",
              "The Product Profile source page is missing from the project's durable URL inventory.",
            );
          }
          crawlSeedSitePageId = sourcePage.id;
          crawlSeedUrl = sourcePage.normalized_url;
        }
      }

      const currentConnection = body.sourceConnectionId
        ? await txSources.findConnectedByIdForUpdate(
            projectScope,
            body.sourceConnectionId,
          )
        : await txSources.findConnectedByProviderForUpdate(
            projectScope,
            body.provider,
          );
      const keywordLibraryContext =
        body.provider === "gsc"
          ? keywordLibraryContextForSite(currentSite)
          : null;
      if (!currentConnection || currentConnection.provider !== body.provider) {
        throw new ProblemError(
          "SOURCE_NOT_CONNECTED",
          `No connected ${body.provider} source for this project.`,
        );
      }

      const parametersHash = collectionRunParametersHash({
        provider: body.provider,
        operation,
        siteId: currentSite.id,
        crawlSeedSitePageId,
        crawlSeedUrl,
        keywordLibraryContext,
      });

      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "collection",
        activeKey,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          provider: body.provider,
          operation,
          sourceConnectionId: currentConnection.id,
          ...(keywordLibraryContext ? { keywordLibraryContext } : {}),
        },
      });
      await new CollectionRunsRepository(tx).insertPlaceholder({
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        siteId: currentSite.id,
        sourceConnectionId: currentConnection.id,
        provider: body.provider,
        operation,
        methodVersion: config.methodVersion,
        parametersHash,
        crawlSeedSitePageId,
        crawlSeedUrl,
      });
      await enqueueRunInTx(boss, tx, config.queue, {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });
      await new ProjectsRepository(tx).setStage(
        scope,
        projectId,
        "collecting",
      );

      const dto = toAsyncRunDto(run);
      const statusUrl = runStatusUrl(projectId, run.id);
      const responseBody = {
        run: dto,
        statusUrl,
        resourceRef: { type: "collection_run" as const, id: run.id },
      };
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody,
        resourceType: "collection_run",
        resourceId: run.id,
      });

      return {
        status: 202,
        run: dto,
        statusUrl,
        resourceRef: { type: "collection_run", id: run.id },
        location: statusUrl,
        replayed: false,
      };
    });
  } catch (error) {
    // Lost the active-key race: the partial unique index aborted the insert.
    if (
      isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")
    ) {
      const winnerKey = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
      const replay = winnerKey ? replayCollection(winnerKey, requestHash) : null;
      if (replay) return replay;
      const existing = await new AsyncRunsRepository(db).findActive(projectScope, activeKey);
      if (existing) throw activeConflict(existing.id, projectId);
      // No run to point at, so no `Location` and no runId. `async_runs_one_
      // active_key_idx` only aborts an insert when a run WAS active, and
      // `findActive` only sees `queued`/`running`: reaching here means the
      // winner left both states between the abort and this read, and our own
      // reservation rolled back with the transaction. `csv-import.ts:612`
      // keeps the same bare case for the same reason -- inventing a runId
      // would be worse than admitting we have none.
      //
      // What the body can carry, and now does, is `activeConflict`'s own shape
      // with both pointers EXPLICITLY null, so a client reads `current.runId`
      // down one code path instead of finding the key absent; plus the
      // contended `activeKey`, which is the one locatable fact that survives.
      // `Problem.current` is `additionalProperties: true` (openapi/mvp.yaml
      // components.schemas.Problem), so none of this changes the contract.
      // The detail stops claiming a run is active, because at this point none
      // is observable and the request is safe to retry.
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A collection run held this provider and operation and is no longer active; retry the request.",
        { current: { runId: null, statusUrl: null, activeKey } },
      );
    }
    throw error;
  }
}
