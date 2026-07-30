import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  contentHash,
  enqueueRunInTx,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type Executor,
  type ProjectRow,
  type WorkspaceScope,
} from "@sf/db";
import {
  CONTRACT_VERSION,
  ProductProfileDraft,
  type CreateAnalysisRefreshRunRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getEnv } from "@/env";
import { getBoss } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { isPostgresUniqueViolation } from "./db-errors";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

const IDEMPOTENCY_SCOPE = "createAnalysisRefreshRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_KEY = "analysis_refresh";

/**
 * Secret-free, immutable parent command payload consumed by the
 * `refresh.analysis` worker. Keep this strict: adding provider credentials,
 * OAuth tokens, or mutable profile content here would persist secrets or make
 * recovery nondeterministic.
 */
export const AnalysisRefreshRequestPayloadSchema = z
  .object({
    siteId: z.uuid(),
    icpProfile: z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    outputLocale: z.string().min(1).max(35),
    sourceConnectionIds: z
      .object({
        crawl: z.uuid(),
        gsc: z.uuid().nullable(),
        ga4: z.uuid().nullable(),
      })
      .strict(),
    dataForSeo: z
      .object({
        enabled: z.boolean(),
        maxKeywords: z.number().int().min(1).max(1_000),
        maxCompetitors: z.number().int().min(1).max(1_000),
      })
      .strict(),
  })
  .strict();

export type AnalysisRefreshRequestPayload = z.infer<
  typeof AnalysisRefreshRequestPayloadSchema
>;

/** Runtime parser shared with orchestration consumers and recovery tests. */
export function parseAnalysisRefreshRequestPayload(
  value: unknown,
): AnalysisRefreshRequestPayload {
  return AnalysisRefreshRequestPayloadSchema.parse(value);
}

export interface AnalysisRefreshAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { readonly type: "analysis_refresh_run"; readonly id: string };
  readonly location: string;
  readonly replayed: boolean;
}

interface FrozenAdmissionInputs {
  readonly project: ProjectRow;
  readonly siteId: string;
  readonly confirmedIcpProfileId: string;
  readonly confirmedIcpProfileVersion: number;
  readonly confirmedIcpProfileContentHash: string;
  readonly crawlConnectionId: string;
  readonly gscConnectionId: string | null;
  readonly ga4ConnectionId: string | null;
}

function assertProjectEligible(
  project: ProjectRow | null,
): asserts project is ProjectRow & { readonly confirmed_icp_profile_id: string } {
  if (!project) {
    throw new ProblemError("NOT_FOUND", "Project not found.");
  }
  if (project.archived_at) {
    throw new ProblemError(
      "PROJECT_ARCHIVED",
      "Project is archived and read-only.",
    );
  }
  if (!project.confirmed_icp_profile_id) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "A confirmed Product Profile is required before refreshing analysis.",
    );
  }
}

/**
 * Validate every mutable command input against one executor. The transactional
 * call happens only after locking the Project, so confirmation, archive,
 * primary Site, and provider disconnect races all fail before the parent exists.
 */
async function loadAdmissionInputs(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  project: ProjectRow | null,
  lockConnections: boolean,
): Promise<FrozenAdmissionInputs> {
  assertProjectEligible(project);
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const profile = await new IcpProfilesRepository(exec).findById(
    projectScope,
    project.confirmed_icp_profile_id,
  );
  if (!profile || profile.status !== "complete") {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The confirmed Product Profile must resolve to a complete immutable version.",
    );
  }

  const site = await new SitesRepository(exec).findPrimary(projectScope);
  if (!site) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "A primary Site is required before refreshing analysis.",
    );
  }
  const currentProductProfile = ProductProfileDraft.safeParse(profile.profile);
  if (currentProductProfile.success) {
    if (currentProductProfile.data.sourceSiteId !== site.id) {
      throw new ProblemError(
        "CONTEXT_INCOMPLETE",
        "The confirmed Product Profile source Site does not match the primary Site.",
      );
    }
  } else {
    const schemaVersion = profile.profile["profileSchemaVersion"];
    if (
      typeof schemaVersion === "string" &&
      schemaVersion.startsWith("product-profile.")
    ) {
      throw new ProblemError(
        "CONTEXT_INCOMPLETE",
        "The confirmed Product Profile is invalid and cannot refresh analysis.",
      );
    }
    // Historical complete ICP payloads predate the URL-first Product Profile
    // contract. They remain eligible and intentionally have no sourceSiteId.
  }

  const sources = new SourceConnectionsRepository(exec);
  const findConnection = (provider: "crawl" | "gsc" | "ga4") =>
    lockConnections
      ? sources.findConnectedByProviderForUpdate(projectScope, provider)
      : sources.findConnectedByProvider(projectScope, provider);
  // Keep the lock order stable across commands: required Crawl, then GSC, GA4.
  const crawlCandidate = await findConnection("crawl");
  const crawl =
    crawlCandidate?.site_id === site.id ? crawlCandidate : null;
  if (!crawl) {
    throw new ProblemError(
      "SOURCE_NOT_CONNECTED",
      "The required Crawl source is not connected for this project.",
    );
  }
  const gscCandidate = await findConnection("gsc");
  const ga4Candidate = await findConnection("ga4");
  // Optional connections from another Site in a future multi-Site project are
  // not valid inputs for this primary-Site plan; record them as unavailable.
  const gsc = gscCandidate?.site_id === site.id ? gscCandidate : null;
  const ga4 = ga4Candidate?.site_id === site.id ? ga4Candidate : null;

  return {
    project,
    siteId: site.id,
    confirmedIcpProfileId: profile.id,
    confirmedIcpProfileVersion: profile.version,
    confirmedIcpProfileContentHash: profile.content_hash,
    crawlConnectionId: crawl.id,
    gscConnectionId: gsc?.id ?? null,
    ga4ConnectionId: ga4?.id ?? null,
  };
}

function replay(
  row: {
    readonly request_hash: string;
    readonly status: string;
    readonly resource_id: string | null;
    readonly response_body: unknown;
  },
  requestHash: string,
): AnalysisRefreshAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key was already used for a different Analysis Refresh command.",
    );
  }
  if (row.status !== "completed" || row.resource_id === null) return null;
  const body = row.response_body as {
    readonly run: AsyncRunDto;
    readonly statusUrl: string;
    readonly resourceRef: {
      readonly type: "analysis_refresh_run";
      readonly id: string;
    };
  } | null;
  if (
    !body?.run ||
    body.resourceRef?.type !== "analysis_refresh_run" ||
    body.resourceRef.id !== row.resource_id
  ) {
    return null;
  }
  return {
    status: 202,
    run: body.run,
    statusUrl: body.statusUrl,
    resourceRef: body.resourceRef,
    location: body.statusUrl,
    replayed: true,
  };
}

function activeConflict(projectId: string, runId: string): ProblemError {
  const statusUrl = runStatusUrl(projectId, runId);
  return new ProblemError(
    "RUN_ALREADY_ACTIVE",
    "An Analysis Refresh run is already active.",
    {
      headers: { Location: statusUrl },
      current: { runId, statusUrl },
    },
  );
}

function frozenPayload(
  inputs: FrozenAdmissionInputs,
  dataForSeo: {
    readonly enabled: boolean;
    readonly maxKeywords: number;
    readonly maxCompetitors: number;
  },
): AnalysisRefreshRequestPayload {
  return parseAnalysisRefreshRequestPayload({
    siteId: inputs.siteId,
    icpProfile: {
      id: inputs.confirmedIcpProfileId,
      version: inputs.confirmedIcpProfileVersion,
      contentHash: inputs.confirmedIcpProfileContentHash,
    },
    outputLocale: inputs.project.default_delivery_locale,
    sourceConnectionIds: {
      crawl: inputs.crawlConnectionId,
      gsc: inputs.gscConnectionId,
      ga4: inputs.ga4ConnectionId,
    },
    dataForSeo: {
      enabled: dataForSeo.enabled,
      maxKeywords: dataForSeo.maxKeywords,
      maxCompetitors: dataForSeo.maxCompetitors,
    },
  });
}

/**
 * Queue the durable server-owned Crawl → optional GSC → optional GA4 →
 * optional DataForSEO → Growth Audit plan. The accepted empty request has no
 * planning authority; all identifiers and feature policy are frozen here.
 */
export async function createAnalysisRefreshRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  _body: CreateAnalysisRefreshRunRequest,
): Promise<AnalysisRefreshAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  // The body is a strict empty object. Project identity must still participate,
  // because Idempotency keys are workspace-scoped rather than project-scoped.
  const requestHash = contentHash({ projectId });
  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(
    scope.workspaceId,
    IDEMPOTENCY_SCOPE,
    idempotencyKey,
  );
  if (existing) {
    const replayed = replay(existing, requestHash);
    if (replayed) return replayed;
  }

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  await loadAdmissionInputs(db, scope, projectId, project, false);

  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    ACTIVE_KEY,
  );
  if (active) {
    const now = await idem.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
    );
    const replayed = now ? replay(now, requestHash) : null;
    if (replayed) return replayed;
    throw activeConflict(projectId, active.id);
  }

  const env = getEnv();
  const dataForSeo = {
    enabled: env.DATAFORSEO_ENABLED === "true",
    maxKeywords: env.DATAFORSEO_MAX_KEYWORDS,
    maxCompetitors: env.DATAFORSEO_MAX_COMPETITORS,
  };
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const boss = await getBoss();

  try {
    return await db.transaction(
      async (tx) => {
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
          const replayed = now ? replay(now, requestHash) : null;
          if (replayed) return replayed;
          throw new ProblemError(
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency key is being processed.",
          );
        }

        const runId = randomUUID();
        const currentProject = await new ProjectsRepository(
          tx,
        ).findByIdForUpdate(scope, projectId);
        const inputs = await loadAdmissionInputs(
          tx,
          scope,
          projectId,
          currentProject,
          true,
        );
        const requestPayload = frozenPayload(inputs, dataForSeo);
        const run = await new AsyncRunsRepository(tx).insertQueued({
          runId,
          workspaceId: scope.workspaceId,
          projectId,
          kind: "analysis_refresh",
          activeKey: ACTIVE_KEY,
          initiatedBy: actorId,
          contractVersion: CONTRACT_VERSION,
          resultType: "analysis_refresh_run",
          resultId: runId,
          requestPayload,
        });
        const plans = new AnalysisRefreshRunsRepository(tx);
        await plans.create({
          runId,
          workspaceId: scope.workspaceId,
          projectId,
          siteId: inputs.siteId,
          icpProfileId: inputs.confirmedIcpProfileId,
        });

        const skip = async (
          step: "gsc" | "ga4" | "dataforseo",
          reason: string,
        ): Promise<void> => {
          const changed = await plans.skipStep(
            projectScope,
            runId,
            step,
            reason,
          );
          if (!changed) {
            throw new Error(`Analysis Refresh could not skip ${step}`);
          }
        };
        if (inputs.gscConnectionId === null) {
          await skip("gsc", "source_not_connected");
        }
        if (inputs.ga4ConnectionId === null) {
          await skip("ga4", "source_not_connected");
        }
        if (!dataForSeo.enabled) {
          await skip("dataforseo", "feature_disabled");
        }

        await enqueueRunInTx(boss, tx, "refresh.analysis", {
          runId,
          workspaceId: scope.workspaceId,
          projectId,
          contractVersion: CONTRACT_VERSION,
        });

        const dto = toAsyncRunDto(run);
        const statusUrl = runStatusUrl(projectId, runId);
        const resourceRef = {
          type: "analysis_refresh_run" as const,
          id: runId,
        };
        await txIdem.complete(reserved.id, {
          responseStatus: 202,
          responseBody: { run: dto, statusUrl, resourceRef },
          resourceType: "analysis_refresh_run",
          resourceId: runId,
        });
        return {
          status: 202 as const,
          run: dto,
          statusUrl,
          resourceRef,
          location: statusUrl,
          replayed: false,
        };
      },
      { isolationLevel: "repeatable read" },
    );
  } catch (error) {
    if (isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")) {
      const winnerKey = await idem.find(
        scope.workspaceId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
      );
      const replayed = winnerKey ? replay(winnerKey, requestHash) : null;
      if (replayed) return replayed;
      const winner = await new AsyncRunsRepository(db).findActive(
        projectScope,
        ACTIVE_KEY,
      );
      if (winner) throw activeConflict(projectId, winner.id);
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "An Analysis Refresh run held this project and is no longer active; retry the request.",
        {
          current: {
            runId: null,
            statusUrl: null,
            activeKey: ACTIVE_KEY,
          },
        },
      );
    }
    throw error;
  }
}
