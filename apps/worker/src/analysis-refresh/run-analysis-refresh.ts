import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  AnalysisRefreshRunsRepository,
  analysisRefreshPlanHash,
  analysisRefreshPlanManifest,
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  collectionRunParametersHash,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  enqueueAnalysisRefreshContinuationInTx,
  enqueueRunInTx,
  IcpProfilesRepository,
  ObservationsRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  toRunAttempt,
  type AnalysisRefreshRunRow,
  type AnalysisRefreshStepKey,
  type AnalysisRefreshStepRow,
  type AsyncRunRow,
  type CollectionRunKeywordLibraryContext,
  type CollectionRunRow,
  type CanonicalValue,
  type DataSnapshotRow,
  type DbTx,
  type ProjectScope,
  type QueueName,
  type RunAttempt,
  type SiteRow,
  type SourceConnectionRow,
} from "@sf/db";
import {
  CONTRACT_VERSION,
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
  ProductProfileDraft,
} from "@sf/contracts";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import {
  ANALYSIS_REFRESH_COLLECTION_CONFIG,
  dataForSeoSearchLandscapeScopeForSite,
  dataForSeoConnectionConfig,
  dataForSeoLimitation,
  deriveDataForSeoSearchLandscapeSeeds,
  keywordLibraryContextForSite,
} from "./collection-context.ts";
import {
  buildAnalysisRefreshDiagnosticFrozenInput,
  GROWTH_AUDIT_ACTIVE_KEY,
  GROWTH_AUDIT_CAPABILITY_ID,
  GROWTH_AUDIT_CAPABILITY_VERSION,
  GROWTH_AUDIT_PROJECTION_VERSION,
  growthAuditCapabilityManifestHash,
} from "./frozen-input.ts";
import { freezeDiagnosticGovernance } from "./governance.ts";
import {
  parseAnalysisRefreshRequestPayload,
  type AnalysisRefreshRequestPayload,
} from "./payload.ts";

export interface AnalysisRefreshJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly contractVersion?: unknown;
}

export interface AnalysisRefreshRuntime {
  readonly now?: () => Date;
  readonly continuationDelayMs?: number;
}

export const ANALYSIS_REFRESH_CONTINUATION_DELAY_MS = 2_000;

const COLLECTION_STEP_KEYS = [
  "crawl",
  "gsc",
  "ga4",
  "dataforseo",
] as const;
type CollectionStepKey = (typeof COLLECTION_STEP_KEYS)[number];
type OptionalStepKey = Exclude<
  AnalysisRefreshStepKey,
  "crawl" | "growth_audit"
>;

const TERMINAL_STEP_STATES = new Set(["completed", "skipped", "failed"]);
const SUCCESSFUL_CHILD_STATES = new Set(["completed", "partial"]);
const COLLECTION_IDENTITY = {
  crawl: {
    datasetKey: CRAWL_DATASET_KEY,
    methodVersion: CRAWL_METHOD_VERSION,
  },
  gsc: {
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.page_query_daily.v1",
  },
  ga4: {
    datasetKey: "ga4.organic_landing_daily.v1",
    methodVersion: "ga4.organic_landing_daily.v1",
  },
  dataforseo: {
    datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
    methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  },
} as const;

const SAFE_FAILURES = {
  payloadInvalid: {
    code: "ANALYSIS_REFRESH_PAYLOAD_INVALID",
    summary: "The frozen Analysis Refresh command is invalid.",
  },
  projectionInvalid: {
    code: "ANALYSIS_REFRESH_PROJECTION_INVALID",
    summary: "The durable Analysis Refresh plan is invalid.",
  },
  projectArchived: {
    code: "PROJECT_ARCHIVED",
    summary: "The project was archived before Analysis Refresh completed.",
  },
  childInvalid: {
    code: "ANALYSIS_REFRESH_CHILD_INVALID",
    summary: "The Analysis Refresh child run is missing or invalid.",
  },
  snapshotMissing: {
    code: "ANALYSIS_REFRESH_SNAPSHOT_MISSING",
    summary: "The collection child did not produce one exact Snapshot.",
  },
  snapshotInvalid: {
    code: "ANALYSIS_REFRESH_SNAPSHOT_INVALID",
    summary: "The collection child Snapshot has invalid lineage.",
  },
  crawlUnavailable: {
    code: "ANALYSIS_REFRESH_CRAWL_UNAVAILABLE",
    summary: "The required Crawl Snapshot is unavailable.",
  },
  optionalSourceUnavailable: {
    code: "ANALYSIS_REFRESH_SOURCE_UNAVAILABLE",
    summary: "The optional source completed without a usable Snapshot.",
  },
  auditUnusable: {
    code: "ANALYSIS_REFRESH_AUDIT_UNUSABLE",
    summary: "The required Growth Audit result is unusable.",
  },
} as const;

interface ParentContext {
  readonly parent: AnalysisRefreshRunRow;
  readonly payload: AnalysisRefreshRequestPayload;
  readonly claimed: AsyncRunRow;
  readonly attempt: RunAttempt;
  readonly scope: ProjectScope;
  readonly job: AnalysisRefreshJobPayload;
}

interface CollectionChildInput {
  readonly stepKey: CollectionStepKey;
  readonly provider: CollectionStepKey;
  readonly operation: string;
  readonly queue: QueueName;
  readonly methodVersion: string;
  readonly connection: SourceConnectionRow;
  readonly requestPayload: Record<string, unknown>;
  readonly parametersHash: string;
  readonly crawlSeedSitePageId: string | null;
  readonly crawlSeedUrl: string | null;
}

function continuationDate(runtime: AnalysisRefreshRuntime): Date {
  const now = runtime.now?.() ?? new Date();
  const delay =
    runtime.continuationDelayMs ?? ANALYSIS_REFRESH_CONTINUATION_DELAY_MS;
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(delay) ||
    delay < 0
  ) {
    throw new TypeError("Analysis Refresh continuation clock is invalid");
  }
  return new Date(now.getTime() + delay);
}

function terminalStepCount(steps: readonly AnalysisRefreshStepRow[]): number {
  return steps.filter((step) => TERMINAL_STEP_STATES.has(step.state)).length;
}

function progress(
  steps: readonly AnalysisRefreshStepRow[],
  messageKey: string,
): Record<string, unknown> {
  return {
    phase: "analysis_refresh",
    current: terminalStepCount(steps),
    total: 5,
    messageKey,
  };
}

function assertDurablePlan(
  claimed: AsyncRunRow,
  parent: AnalysisRefreshRunRow | null,
  steps: readonly AnalysisRefreshStepRow[],
  payload: AnalysisRefreshRequestPayload,
): asserts parent is AnalysisRefreshRunRow {
  const expectedManifest = analysisRefreshPlanManifest();
  if (
    !parent ||
    claimed.kind !== "analysis_refresh" ||
    claimed.result_type !== "analysis_refresh_run" ||
    claimed.result_id !== claimed.id ||
    parent.id !== claimed.id ||
    parent.workspace_id !== claimed.workspace_id ||
    parent.project_id !== claimed.project_id ||
    parent.site_id !== payload.siteId ||
    parent.icp_profile_id !== payload.icpProfile.id ||
    parent.plan_hash !== analysisRefreshPlanHash(expectedManifest) ||
    !isDeepStrictEqual(parent.plan_manifest, expectedManifest) ||
    steps.length !== expectedManifest.steps.length
  ) {
    throw new Error("Analysis Refresh parent projection is invalid");
  }

  for (const [index, expected] of expectedManifest.steps.entries()) {
    const actual = steps[index];
    if (
      !actual ||
      actual.analysis_refresh_run_id !== parent.id ||
      actual.workspace_id !== parent.workspace_id ||
      actual.project_id !== parent.project_id ||
      actual.ordinal !== expected.ordinal ||
      actual.step_key !== expected.stepKey ||
      actual.required !== expected.required
    ) {
      throw new Error("Analysis Refresh step projection is invalid");
    }
  }
  if (steps.filter((step) => step.state === "running").length > 1) {
    throw new Error("Analysis Refresh has ambiguous running steps");
  }
}

async function lockParentAttempt(
  tx: DbTx,
  attempt: RunAttempt,
): Promise<AsyncRunsRepository> {
  const runs = new AsyncRunsRepository(tx);
  if (!(await runs.lockAttemptForUpdate(attempt))) {
    throw new Error("Analysis Refresh attempt ownership changed");
  }
  return runs;
}

async function lockProject(
  tx: DbTx,
  scope: ProjectScope,
): Promise<
  NonNullable<
    Awaited<ReturnType<ProjectsRepository["findByIdForUpdate"]>>
  >
> {
  const project = await new ProjectsRepository(tx).findByIdForUpdate(
    { workspaceId: scope.workspaceId },
    scope.projectId,
  );
  if (!project) {
    throw new Error("Analysis Refresh project disappeared");
  }
  return project;
}

async function scheduleContinuationInTx(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  messageKey: string,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  const runs = new AsyncRunsRepository(tx);
  if (!(await runs.setProgress(parent.attempt, progress(steps, messageKey)))) {
    throw new Error("Analysis Refresh progress ownership changed");
  }
  if (!(await runs.resetToQueued(parent.attempt))) {
    throw new Error("Analysis Refresh attempt could not return to queued");
  }
  await enqueueAnalysisRefreshContinuationInTx(
    ctx.boss,
    tx,
    {
      runId: parent.job.runId,
      workspaceId: parent.job.workspaceId,
      projectId: parent.job.projectId,
      contractVersion: parent.claimed.contract_version,
    },
    { startAfter: continuationDate(runtime) },
  );
}

async function terminalizeParentInTx(
  tx: DbTx,
  parent: Pick<ParentContext, "attempt" | "job">,
  steps: readonly AnalysisRefreshStepRow[],
  status: "completed" | "partial" | "failed",
  error?: { readonly code: string; readonly summary: string },
): Promise<void> {
  const runs = new AsyncRunsRepository(tx);
  if (
    !(await runs.setProgress(
      parent.attempt,
      progress(steps, `analysisRefresh.${status}`),
    ))
  ) {
    throw new Error("Analysis Refresh terminal progress ownership changed");
  }
  const terminalized = await runs.setTerminal(parent.attempt, {
    status,
    resultType: "analysis_refresh_run",
    resultId: parent.job.runId,
    ...(error
      ? {
          lastErrorCode: error.code,
          lastErrorSummary: error.summary,
        }
      : {}),
  });
  if (!terminalized) {
    throw new Error("Analysis Refresh terminal ownership changed");
  }
}

async function failParent(
  ctx: WorkerContext,
  input: {
    readonly attempt: RunAttempt;
    readonly scope: ProjectScope;
    readonly job: AnalysisRefreshJobPayload;
    readonly error: { readonly code: string; readonly summary: string };
  },
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await lockParentAttempt(tx, input.attempt);
    await lockProject(tx, input.scope);
    const plans = new AnalysisRefreshRunsRepository(tx);
    const steps = await plans.listSteps(input.scope, input.job.runId);
    const running = steps.find((step) => step.state === "running");
    if (running) {
      await plans.failStep(input.scope, input.job.runId, running.step_key, {
        childAsyncRunId: running.child_async_run_id,
        error: input.error,
      });
    }
    const currentSteps = await plans.listSteps(input.scope, input.job.runId);
    await terminalizeParentInTx(
      tx,
      {
        attempt: input.attempt,
        job: input.job,
      },
      currentSteps,
      "failed",
      input.error,
    );
  });
}

function nextUnfinishedStep(
  steps: readonly AnalysisRefreshStepRow[],
): AnalysisRefreshStepRow | null {
  return (
    steps.find((step) => step.state === "pending" || step.state === "running") ??
    null
  );
}

function sourceMatches(
  source: SourceConnectionRow | null,
  parent: ParentContext,
  provider: CollectionStepKey,
): source is SourceConnectionRow {
  return (
    source !== null &&
    source.workspace_id === parent.scope.workspaceId &&
    source.project_id === parent.scope.projectId &&
    source.site_id === parent.payload.siteId &&
    source.provider === provider
  );
}

async function exactFrozenSource(
  tx: DbTx,
  parent: ParentContext,
  provider: "crawl" | "gsc" | "ga4",
  id: string,
): Promise<SourceConnectionRow | null> {
  const source = await new SourceConnectionsRepository(
    tx,
  ).findConnectedByIdForUpdate(parent.scope, id);
  return sourceMatches(source, parent, provider) ? source : null;
}

async function exactCrawlSeed(
  tx: DbTx,
  parent: ParentContext,
): Promise<{
  readonly site: SiteRow;
  readonly sourceConnection: SourceConnectionRow;
  readonly sitePageId: string | null;
  readonly url: string | null;
} | null> {
  const site = await new SitesRepository(tx).findById(
    parent.scope,
    parent.payload.siteId,
  );
  const sourceConnection = await exactFrozenSource(
    tx,
    parent,
    "crawl",
    parent.payload.sourceConnectionIds.crawl,
  );
  const profile = await new IcpProfilesRepository(tx).findById(
    parent.scope,
    parent.payload.icpProfile.id,
  );
  if (
    !site?.is_primary ||
    !sourceConnection ||
    !profile ||
    profile.status !== "complete" ||
    profile.version !== parent.payload.icpProfile.version ||
    profile.content_hash !== parent.payload.icpProfile.contentHash
  ) {
    return null;
  }
  const parsed = ProductProfileDraft.safeParse(profile.profile);
  if (!parsed.success) {
    const schemaVersion = profile.profile["profileSchemaVersion"];
    if (
      typeof schemaVersion === "string" &&
      schemaVersion.startsWith("product-profile.")
    ) {
      return null;
    }
    // Historical complete ICP payloads predate the URL-first Product Profile
    // contract. Canonical Crawl admission keeps them eligible without a deep
    // seed, so Analysis Refresh freezes the primary Site and does the same.
    return {
      site,
      sourceConnection,
      sitePageId: null,
      url: null,
    };
  }
  if (parsed.data.sourceSiteId !== site.id) {
    return null;
  }
  const sourcePage = await new SitePagesRepository(tx).findExactNormalizedUrl(
    parent.scope,
    site.id,
    parsed.data.sourcePageUrl,
  );
  if (!sourcePage) return null;
  return {
    site,
    sourceConnection,
    sitePageId: sourcePage.id,
    url: sourcePage.normalized_url,
  };
}

async function createCollectionChildInTx(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  input: CollectionChildInput,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  const activeKey = `collect:${input.provider}:${input.operation}`;
  const active = await new AsyncRunsRepository(tx).findActive(
    parent.scope,
    activeKey,
  );
  if (active) {
    await scheduleContinuationInTx(
      ctx,
      tx,
      parent,
      steps,
      `analysisRefresh.${input.stepKey}.waitingForActiveRun`,
      runtime,
    );
    return;
  }

  const child = await new AsyncRunsRepository(tx).insertQueued({
    runId: randomUUID(),
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    kind: "collection",
    activeKey,
    initiatedBy: parent.claimed.initiated_by,
    contractVersion: CONTRACT_VERSION,
    requestPayload: input.requestPayload,
  });
  await new CollectionRunsRepository(tx).insertPlaceholder({
    runId: child.id,
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    siteId: parent.payload.siteId,
    sourceConnectionId: input.connection.id,
    provider: input.provider,
    operation: input.operation,
    methodVersion: input.methodVersion,
    parametersHash: input.parametersHash,
    crawlSeedSitePageId: input.crawlSeedSitePageId,
    crawlSeedUrl: input.crawlSeedUrl,
  });
  await enqueueRunInTx(ctx.boss, tx, input.queue, {
    runId: child.id,
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    contractVersion: CONTRACT_VERSION,
  });
  const started = await new AnalysisRefreshRunsRepository(tx).startStep(
    parent.scope,
    parent.job.runId,
    input.stepKey,
    child.id,
  );
  if (!started) {
    throw new Error("Analysis Refresh collection step could not start");
  }
  await new ProjectsRepository(tx).setStage(
    { workspaceId: parent.scope.workspaceId },
    parent.scope.projectId,
    "collecting",
  );
  const currentSteps = await new AnalysisRefreshRunsRepository(tx).listSteps(
    parent.scope,
    parent.job.runId,
  );
  await scheduleContinuationInTx(
    ctx,
    tx,
    parent,
    currentSteps,
    `analysisRefresh.${input.stepKey}.running`,
    runtime,
  );
}

async function skipOptionalStepInTx(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  stepKey: OptionalStepKey,
  reason: string,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  const plans = new AnalysisRefreshRunsRepository(tx);
  if (
    !(await plans.skipStep(
      parent.scope,
      parent.job.runId,
      stepKey,
      reason,
    ))
  ) {
    throw new Error("Analysis Refresh optional step could not skip");
  }
  const steps = await plans.listSteps(parent.scope, parent.job.runId);
  await scheduleContinuationInTx(
    ctx,
    tx,
    parent,
    steps,
    `analysisRefresh.${stepKey}.skipped`,
    runtime,
  );
}

async function failStepInTx(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  step: AnalysisRefreshStepRow,
  error: { readonly code: string; readonly summary: string },
  runtime: AnalysisRefreshRuntime,
  forceParentFailure = false,
): Promise<void> {
  const plans = new AnalysisRefreshRunsRepository(tx);
  if (
    !(await plans.failStep(
      parent.scope,
      parent.job.runId,
      step.step_key,
      {
        childAsyncRunId: step.child_async_run_id,
        error,
      },
    ))
  ) {
    throw new Error("Analysis Refresh step could not fail");
  }
  const steps = await plans.listSteps(parent.scope, parent.job.runId);
  if (step.required || forceParentFailure) {
    await terminalizeParentInTx(tx, parent, steps, "failed", error);
    return;
  }
  await scheduleContinuationInTx(
    ctx,
    tx,
    parent,
    steps,
    `analysisRefresh.${step.step_key}.failed`,
    runtime,
  );
}

async function startCrawlStep(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  step: AnalysisRefreshStepRow,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  const frozen = await exactCrawlSeed(tx, parent);
  if (!frozen) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      {
        code: "ANALYSIS_REFRESH_CRAWL_INPUT_INVALID",
        summary: "The frozen Crawl source or Product Profile seed is invalid.",
      },
      runtime,
    );
    return;
  }
  const config = ANALYSIS_REFRESH_COLLECTION_CONFIG.crawl;
  await createCollectionChildInTx(
    ctx,
    tx,
    parent,
    steps,
    {
      stepKey: "crawl",
      provider: "crawl",
      operation: config.operation,
      queue: config.queue,
      methodVersion: CRAWL_METHOD_VERSION,
      connection: frozen.sourceConnection,
      requestPayload: {
        provider: "crawl",
        operation: config.operation,
        sourceConnectionId: frozen.sourceConnection.id,
      },
      parametersHash: collectionRunParametersHash({
        provider: "crawl",
        operation: config.operation,
        siteId: frozen.site.id,
        crawlSeedSitePageId: frozen.sitePageId,
        crawlSeedUrl: frozen.url,
      }),
      crawlSeedSitePageId: frozen.sitePageId,
      crawlSeedUrl: frozen.url,
    },
    runtime,
  );
}

async function startGoogleStep(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  step: AnalysisRefreshStepRow,
  provider: "gsc" | "ga4",
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  const frozenId = parent.payload.sourceConnectionIds[provider];
  if (frozenId === null) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      provider,
      "source_not_connected",
      runtime,
    );
    return;
  }
  const source = await exactFrozenSource(
    tx,
    parent,
    provider,
    frozenId,
  );
  if (!source) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      {
        code: "ANALYSIS_REFRESH_SOURCE_DISCONNECTED",
        summary: "The frozen optional source is no longer connected.",
      },
      runtime,
    );
    return;
  }
  const site = await new SitesRepository(tx).findById(
    parent.scope,
    parent.payload.siteId,
  );
  if (!site?.is_primary) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      {
        code: "ANALYSIS_REFRESH_SITE_INVALID",
        summary: "The frozen Site is no longer usable for collection.",
      },
      runtime,
    );
    return;
  }
  const config = ANALYSIS_REFRESH_COLLECTION_CONFIG[provider];
  const keywordLibraryContext: CollectionRunKeywordLibraryContext | null =
    provider === "gsc" ? keywordLibraryContextForSite(site) : null;
  await createCollectionChildInTx(
    ctx,
    tx,
    parent,
    steps,
    {
      stepKey: provider,
      provider,
      operation: config.operation,
      queue: config.queue,
      methodVersion: COLLECTION_IDENTITY[provider].methodVersion,
      connection: source,
      requestPayload: {
        provider,
        operation: config.operation,
        sourceConnectionId: source.id,
        ...(keywordLibraryContext ? { keywordLibraryContext } : {}),
      },
      parametersHash: collectionRunParametersHash({
        provider,
        operation: config.operation,
        siteId: site.id,
        crawlSeedSitePageId: null,
        crawlSeedUrl: null,
        keywordLibraryContext,
      }),
      crawlSeedSitePageId: null,
      crawlSeedUrl: null,
    },
    runtime,
  );
}

function dataForSeoRuntimeAvailable(
  ctx: WorkerContext,
  payload: AnalysisRefreshRequestPayload,
): boolean {
  const runtime = ctx.dataForSeo;
  return (
    payload.dataForSeo.enabled &&
    runtime?.enabled === true &&
    typeof runtime.login === "string" &&
    runtime.login.length > 0 &&
    typeof runtime.password === "string" &&
    runtime.password.length > 0 &&
    Number.isSafeInteger(runtime.maxKeywords) &&
    payload.dataForSeo.maxKeywords <= runtime.maxKeywords &&
    Number.isSafeInteger(runtime.maxCompetitors) &&
    payload.dataForSeo.maxCompetitors <= runtime.maxCompetitors
  );
}

async function startDataForSeoStep(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  if (!dataForSeoRuntimeAvailable(ctx, parent.payload)) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      "dataforseo",
      parent.payload.dataForSeo.enabled
        ? "worker_credentials_unavailable"
        : "feature_disabled",
      runtime,
    );
    return;
  }
  const site = await new SitesRepository(tx).findById(
    parent.scope,
    parent.payload.siteId,
  );
  const seedSnapshotIds = steps.flatMap((step) =>
    (step.step_key === "crawl" || step.step_key === "gsc") &&
    step.state === "completed" &&
    step.result_snapshot_id !== null
      ? [step.result_snapshot_id]
      : [],
  );
  const seedObservations = await new ObservationsRepository(tx).listBySnapshotIds(
    parent.scope,
    seedSnapshotIds,
  );
  const confirmedProfile = await new ProjectsRepository(tx).findConfirmedIcpProfile(
    { workspaceId: parent.scope.workspaceId },
    parent.scope.projectId,
  );
  const parsedProfile = confirmedProfile
    ? ProductProfileDraft.safeParse(confirmedProfile.profile)
    : null;
  const seeds = deriveDataForSeoSearchLandscapeSeeds({
    observations: seedObservations,
    productProfile:
      confirmedProfile && parsedProfile?.success
        ? { id: confirmedProfile.id, profile: parsedProfile.data }
        : null,
  });
  const collectionScope =
    site?.is_primary
      ? dataForSeoSearchLandscapeScopeForSite(
          site,
          parent.payload.dataForSeo.maxKeywords,
          parent.payload.dataForSeo.maxCompetitors,
          seeds,
        )
      : null;
  if (!site || !collectionScope) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      "dataforseo",
      "context_incomplete",
      runtime,
    );
    return;
  }
  const config = ANALYSIS_REFRESH_COLLECTION_CONFIG.dataforseo;
  const activeKey = `collect:dataforseo:${config.operation}`;
  if (await new AsyncRunsRepository(tx).findActive(parent.scope, activeKey)) {
    await scheduleContinuationInTx(
      ctx,
      tx,
      parent,
      steps,
      "analysisRefresh.dataforseo.waitingForActiveRun",
      runtime,
    );
    return;
  }

  const sources = new SourceConnectionsRepository(tx);
  let source = await sources.findConnectedByProviderForUpdate(
    parent.scope,
    "dataforseo",
  );
  if (source && !sourceMatches(source, parent, "dataforseo")) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      "dataforseo",
      "connection_scope_mismatch",
      runtime,
    );
    return;
  }
  if (!source) {
    const connectionConfig = dataForSeoConnectionConfig(collectionScope);
    source = await sources.insertConnection({
      workspaceId: parent.scope.workspaceId,
      projectId: parent.scope.projectId,
      siteId: site.id,
      provider: "dataforseo",
      connectionType: "api_key_stub",
      state: "connected",
      externalRef: connectionConfig.target,
      config: { ...connectionConfig },
      limitation: dataForSeoLimitation(connectionConfig),
      connectedAt: true,
      createdBy: parent.claimed.initiated_by,
    });
  }

  await createCollectionChildInTx(
    ctx,
    tx,
    parent,
    steps,
    {
      stepKey: "dataforseo",
      provider: "dataforseo",
      operation: config.operation,
      queue: config.queue,
      methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
      connection: source,
      requestPayload: {
        provider: "dataforseo",
        operation: config.operation,
        sourceConnectionId: source.id,
        collectionScope,
      },
      parametersHash: contentHash({
        provider: "dataforseo",
        operation: config.operation,
        siteId: site.id,
        collectionScope: collectionScope as unknown as CanonicalValue,
      }),
      crawlSeedSitePageId: null,
      crawlSeedUrl: null,
    },
    runtime,
  );
}

function validateExactAuditSnapshots(
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  snapshots: readonly DataSnapshotRow[],
): DataSnapshotRow[] {
  const completedCollectionSteps = steps.filter(
    (
      step,
    ): step is AnalysisRefreshStepRow & {
      step_key: CollectionStepKey;
      result_snapshot_id: string;
    } =>
      COLLECTION_STEP_KEYS.includes(step.step_key as CollectionStepKey) &&
      step.state === "completed" &&
      step.result_snapshot_id !== null,
  );
  if (snapshots.length !== completedCollectionSteps.length) {
    throw new Error("Analysis Refresh exact Snapshot selection is incomplete");
  }
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  if (byId.size !== snapshots.length) {
    throw new Error("Analysis Refresh exact Snapshot selection is ambiguous");
  }

  const ordered = completedCollectionSteps.map((step) => {
    const snapshot = byId.get(step.result_snapshot_id);
    const identity = COLLECTION_IDENTITY[step.step_key];
    if (
      !snapshot ||
      snapshot.workspace_id !== parent.scope.workspaceId ||
      snapshot.project_id !== parent.scope.projectId ||
      snapshot.site_id !== parent.payload.siteId ||
      step.child_async_run_id === null ||
      snapshot.collection_run_id !== step.child_async_run_id ||
      snapshot.provider !== step.step_key ||
      snapshot.dataset_key !== identity.datasetKey ||
      snapshot.method_version !== identity.methodVersion
    ) {
      throw new Error("Analysis Refresh exact Snapshot lineage is invalid");
    }
    return snapshot;
  });
  const crawl = ordered.find((snapshot) => snapshot.provider === "crawl");
  if (
    !crawl ||
    (crawl.availability !== "available" &&
      crawl.availability !== "partial")
  ) {
    throw new Error("Analysis Refresh requires a usable exact Crawl Snapshot");
  }
  return ordered;
}

async function startGrowthAuditStep(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  step: AnalysisRefreshStepRow,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  if (
    await new AsyncRunsRepository(tx).findActive(
      parent.scope,
      GROWTH_AUDIT_ACTIVE_KEY,
    )
  ) {
    await scheduleContinuationInTx(
      ctx,
      tx,
      parent,
      steps,
      "analysisRefresh.growth_audit.waitingForActiveRun",
      runtime,
    );
    return;
  }

  const snapshotIds = steps.flatMap((candidate) =>
    COLLECTION_STEP_KEYS.includes(candidate.step_key as CollectionStepKey) &&
    candidate.state === "completed" &&
    candidate.result_snapshot_id !== null
      ? [candidate.result_snapshot_id]
      : [],
  );
  const rawSnapshots = await new DataSnapshotsRepository(tx).findByIds(
    parent.scope,
    snapshotIds,
  );
  let snapshots: DataSnapshotRow[];
  try {
    snapshots = validateExactAuditSnapshots(parent, steps, rawSnapshots);
  } catch {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      SAFE_FAILURES.auditUnusable,
      runtime,
    );
    return;
  }

  const profile = await new IcpProfilesRepository(tx).findById(
    parent.scope,
    parent.payload.icpProfile.id,
  );
  if (
    !profile ||
    profile.status !== "complete" ||
    profile.version !== parent.payload.icpProfile.version ||
    profile.content_hash !== parent.payload.icpProfile.contentHash
  ) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      SAFE_FAILURES.auditUnusable,
      runtime,
    );
    return;
  }

  const governance = await freezeDiagnosticGovernance(tx, parent.scope);
  const frozen = buildAnalysisRefreshDiagnosticFrozenInput({
    projectId: parent.scope.projectId,
    siteId: parent.payload.siteId,
    icp: parent.payload.icpProfile,
    snapshots,
    outputLocale: parent.payload.outputLocale,
    governance,
  });
  const capabilityHash = growthAuditCapabilityManifestHash({
    projectId: parent.scope.projectId,
    siteId: parent.payload.siteId,
    icpProfileId: parent.payload.icpProfile.id,
    selectedSnapshotIds: snapshots.map((snapshot) => snapshot.id),
    outputLocale: parent.payload.outputLocale,
  });
  const child = await new AsyncRunsRepository(tx).insertQueued({
    runId: randomUUID(),
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    kind: "diagnostic",
    activeKey: GROWTH_AUDIT_ACTIVE_KEY,
    initiatedBy: parent.claimed.initiated_by,
    contractVersion: CONTRACT_VERSION,
    requestPayload: {
      siteId: parent.payload.siteId,
      icpProfileId: parent.payload.icpProfile.id,
      scope: { kind: "site" },
      outputLocale: parent.payload.outputLocale,
      capabilityContractVersion:
        GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
    },
  });
  await new DiagnosticRunsRepository(tx).insert({
    runId: child.id,
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    siteId: parent.payload.siteId,
    icpProfileId: parent.payload.icpProfile.id,
    icpProfileVersion: parent.payload.icpProfile.version,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: parent.payload.outputLocale,
    inputManifest: frozen.manifest,
    inputHash: frozen.inputHash,
  });
  await new CapabilityRunsRepository(tx).create({
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    asyncRunId: child.id,
    capabilityId: GROWTH_AUDIT_CAPABILITY_ID,
    capabilityVersion: GROWTH_AUDIT_CAPABILITY_VERSION,
    inputManifestHash: capabilityHash,
    mode: "production",
    sideEffectClass: "read_only",
  });
  await new AuditRunsRepository(tx).create({
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    diagnosticRunId: child.id,
    capabilityRunId: child.id,
    scopeKind: "site",
    scopeKey: parent.payload.siteId,
    projectionVersion: GROWTH_AUDIT_PROJECTION_VERSION,
  });
  await enqueueRunInTx(ctx.boss, tx, "diagnose", {
    runId: child.id,
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    contractVersion: CONTRACT_VERSION,
  });
  const started = await new AnalysisRefreshRunsRepository(tx).startStep(
    parent.scope,
    parent.job.runId,
    "growth_audit",
    child.id,
  );
  if (!started) {
    throw new Error("Analysis Refresh Growth Audit step could not start");
  }
  await new ProjectsRepository(tx).setStage(
    { workspaceId: parent.scope.workspaceId },
    parent.scope.projectId,
    "diagnosing",
  );
  const currentSteps = await new AnalysisRefreshRunsRepository(tx).listSteps(
    parent.scope,
    parent.job.runId,
  );
  await scheduleContinuationInTx(
    ctx,
    tx,
    parent,
    currentSteps,
    "analysisRefresh.growth_audit.running",
    runtime,
  );
}

async function advancePendingStep(
  ctx: WorkerContext,
  parent: ParentContext,
  stepKey: AnalysisRefreshStepKey,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await lockParentAttempt(tx, parent.attempt);
    const project = await lockProject(tx, parent.scope);
    const plans = new AnalysisRefreshRunsRepository(tx);
    const steps = await plans.listSteps(parent.scope, parent.job.runId);
    const step = steps.find((candidate) => candidate.step_key === stepKey);
    if (!step || step.state !== "pending") {
      throw new Error("Analysis Refresh pending step changed unexpectedly");
    }
    if (project.archived_at) {
      await failStepInTx(
        ctx,
        tx,
        parent,
        step,
        SAFE_FAILURES.projectArchived,
        runtime,
        true,
      );
      return;
    }

    switch (step.step_key) {
      case "crawl":
        await startCrawlStep(ctx, tx, parent, steps, step, runtime);
        return;
      case "gsc":
      case "ga4":
        await startGoogleStep(
          ctx,
          tx,
          parent,
          steps,
          step,
          step.step_key,
          runtime,
        );
        return;
      case "dataforseo":
        await startDataForSeoStep(ctx, tx, parent, steps, runtime);
        return;
      case "growth_audit":
        await startGrowthAuditStep(ctx, tx, parent, steps, step, runtime);
        return;
    }
  });
}

function collectionSnapshotValid(
  parent: ParentContext,
  step: AnalysisRefreshStepRow,
  child: AsyncRunRow,
  collection: CollectionRunRow | null,
  snapshot: DataSnapshotRow | null,
): snapshot is DataSnapshotRow {
  if (!COLLECTION_STEP_KEYS.includes(step.step_key as CollectionStepKey)) {
    return false;
  }
  const stepKey = step.step_key as CollectionStepKey;
  const identity = COLLECTION_IDENTITY[stepKey];
  const config = ANALYSIS_REFRESH_COLLECTION_CONFIG[stepKey];
  return (
    collection !== null &&
    collection.id === child.id &&
    collection.workspace_id === parent.scope.workspaceId &&
    collection.project_id === parent.scope.projectId &&
    collection.site_id === parent.payload.siteId &&
    collection.provider === stepKey &&
    collection.operation === config.operation &&
    collection.method_version === identity.methodVersion &&
    snapshot !== null &&
    snapshot.workspace_id === parent.scope.workspaceId &&
    snapshot.project_id === parent.scope.projectId &&
    snapshot.site_id === parent.payload.siteId &&
    snapshot.collection_run_id === child.id &&
    snapshot.source_connection_id === collection.source_connection_id &&
    snapshot.provider === stepKey &&
    snapshot.dataset_key === identity.datasetKey &&
    snapshot.method_version === identity.methodVersion
  );
}

async function finalStatusInTx(
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  auditChildStatus: string,
): Promise<"completed" | "partial" | "failed"> {
  if (
    steps.some((step) => step.required && step.state !== "completed") ||
    (auditChildStatus !== "completed" && auditChildStatus !== "partial")
  ) {
    return "failed";
  }
  if (
    auditChildStatus === "partial" ||
    steps.some(
      (step) =>
        !step.required &&
        (step.state === "skipped" || step.state === "failed"),
    )
  ) {
    return "partial";
  }
  const snapshotIds = steps.flatMap((step) =>
    step.result_snapshot_id ? [step.result_snapshot_id] : [],
  );
  const snapshots = await new DataSnapshotsRepository(tx).findByIds(
    parent.scope,
    snapshotIds,
  );
  if (
    snapshots.length !== snapshotIds.length ||
    snapshots.some((snapshot) => snapshot.availability !== "available")
  ) {
    return "partial";
  }
  return "completed";
}

async function observeCollectionChildInTx(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  step: AnalysisRefreshStepRow,
  child: AsyncRunRow,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  if (child.status === "queued" || child.status === "running") {
    const steps = await new AnalysisRefreshRunsRepository(tx).listSteps(
      parent.scope,
      parent.job.runId,
    );
    await scheduleContinuationInTx(
      ctx,
      tx,
      parent,
      steps,
      `analysisRefresh.${step.step_key}.waiting`,
      runtime,
    );
    return;
  }
  if (child.status === "failed" || child.status === "cancelled") {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      {
        code: "ANALYSIS_REFRESH_CHILD_FAILED",
        summary: "The Analysis Refresh collection child failed.",
      },
      runtime,
    );
    return;
  }
  if (
    !SUCCESSFUL_CHILD_STATES.has(child.status) ||
    child.kind !== "collection" ||
    child.result_type !== "collection_run" ||
    child.result_id !== child.id
  ) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      SAFE_FAILURES.childInvalid,
      runtime,
    );
    return;
  }

  const collection = await new CollectionRunsRepository(tx).findById(child.id);
  let snapshot: DataSnapshotRow | null;
  try {
    snapshot = await new DataSnapshotsRepository(
      tx,
    ).findByCollectionRunId(parent.scope, child.id);
  } catch {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      SAFE_FAILURES.snapshotInvalid,
      runtime,
    );
    return;
  }
  if (!collectionSnapshotValid(parent, step, child, collection, snapshot)) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      snapshot ? SAFE_FAILURES.snapshotInvalid : SAFE_FAILURES.snapshotMissing,
      runtime,
    );
    return;
  }
  if (snapshot.availability === "unavailable") {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      step.step_key === "crawl"
        ? SAFE_FAILURES.crawlUnavailable
        : SAFE_FAILURES.optionalSourceUnavailable,
      runtime,
    );
    return;
  }

  const plans = new AnalysisRefreshRunsRepository(tx);
  if (
    !(await plans.completeStep(
      parent.scope,
      parent.job.runId,
      step.step_key,
      {
        childAsyncRunId: child.id,
        resultSnapshotId: snapshot.id,
      },
    ))
  ) {
    throw new Error("Analysis Refresh collection step could not complete");
  }
  const steps = await plans.listSteps(parent.scope, parent.job.runId);
  await scheduleContinuationInTx(
    ctx,
    tx,
    parent,
    steps,
    `analysisRefresh.${step.step_key}.completed`,
    runtime,
  );
}

async function observeAuditChildInTx(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  step: AnalysisRefreshStepRow,
  child: AsyncRunRow,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  if (child.status === "queued" || child.status === "running") {
    const steps = await new AnalysisRefreshRunsRepository(tx).listSteps(
      parent.scope,
      parent.job.runId,
    );
    await scheduleContinuationInTx(
      ctx,
      tx,
      parent,
      steps,
      "analysisRefresh.growth_audit.waiting",
      runtime,
    );
    return;
  }
  if (child.status === "failed" || child.status === "cancelled") {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      {
        code: "ANALYSIS_REFRESH_AUDIT_FAILED",
        summary: "The required Growth Audit child failed.",
      },
      runtime,
    );
    return;
  }
  const audit = await new AuditRunsRepository(tx).findByDiagnosticRunId(
    parent.scope,
    child.id,
  );
  if (
    !SUCCESSFUL_CHILD_STATES.has(child.status) ||
    child.kind !== "diagnostic" ||
    child.result_type !== "diagnostic_run" ||
    child.result_id !== child.id ||
    !audit ||
    audit.diagnostic_run_id !== child.id ||
    audit.capability_run_id !== child.id ||
    audit.scope_kind !== "site" ||
    audit.scope_key !== parent.payload.siteId ||
    audit.projection_version !== GROWTH_AUDIT_PROJECTION_VERSION
  ) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      SAFE_FAILURES.auditUnusable,
      runtime,
    );
    return;
  }

  const plans = new AnalysisRefreshRunsRepository(tx);
  if (
    !(await plans.completeStep(
      parent.scope,
      parent.job.runId,
      "growth_audit",
      {
        childAsyncRunId: child.id,
        resultSnapshotId: null,
      },
    ))
  ) {
    throw new Error("Analysis Refresh Growth Audit step could not complete");
  }
  const steps = await plans.listSteps(parent.scope, parent.job.runId);
  const status = await finalStatusInTx(tx, parent, steps, child.status);
  if (status === "failed") {
    await terminalizeParentInTx(
      tx,
      parent,
      steps,
      "failed",
      SAFE_FAILURES.auditUnusable,
    );
    return;
  }
  await terminalizeParentInTx(tx, parent, steps, status);
}

async function observeRunningStep(
  ctx: WorkerContext,
  parent: ParentContext,
  stepKey: AnalysisRefreshStepKey,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await lockParentAttempt(tx, parent.attempt);
    await lockProject(tx, parent.scope);
    const plans = new AnalysisRefreshRunsRepository(tx);
    const steps = await plans.listSteps(parent.scope, parent.job.runId);
    const step = steps.find((candidate) => candidate.step_key === stepKey);
    if (
      !step ||
      step.state !== "running" ||
      step.child_async_run_id === null
    ) {
      throw new Error("Analysis Refresh running step changed unexpectedly");
    }
    const child = await new AsyncRunsRepository(tx).findById(
      parent.scope,
      step.child_async_run_id,
    );
    if (!child) {
      await failStepInTx(
        ctx,
        tx,
        parent,
        step,
        SAFE_FAILURES.childInvalid,
        runtime,
      );
      return;
    }

    if (step.step_key === "growth_audit") {
      await observeAuditChildInTx(
        ctx,
        tx,
        parent,
        step,
        child,
        runtime,
      );
      return;
    }
    await observeCollectionChildInTx(
      ctx,
      tx,
      parent,
      step,
      child,
      runtime,
    );
  });
}

async function finalizeAlreadyTerminalPlan(
  ctx: WorkerContext,
  parent: ParentContext,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await lockParentAttempt(tx, parent.attempt);
    await lockProject(tx, parent.scope);
    const steps = await new AnalysisRefreshRunsRepository(tx).listSteps(
      parent.scope,
      parent.job.runId,
    );
    const requiredFailure = steps.find(
      (step) => step.required && step.state !== "completed",
    );
    if (requiredFailure) {
      await terminalizeParentInTx(
        tx,
        parent,
        steps,
        "failed",
        requiredFailure.error ?? SAFE_FAILURES.projectionInvalid,
      );
      return;
    }
    const auditStep = steps.find(
      (step) => step.step_key === "growth_audit",
    );
    const auditChild =
      auditStep?.child_async_run_id
        ? await new AsyncRunsRepository(tx).findById(
            parent.scope,
            auditStep.child_async_run_id,
          )
        : null;
    const status = await finalStatusInTx(
      tx,
      parent,
      steps,
      auditChild?.status ?? "failed",
    );
    await terminalizeParentInTx(
      tx,
      parent,
      steps,
      status,
      status === "failed" ? SAFE_FAILURES.auditUnusable : undefined,
    );
  });
}

/**
 * Claim one canonical parent attempt and advance exactly one durable state.
 * Waiting never happens synchronously: the parent is atomically returned to
 * queued with progress and a fresh, absolute-time continuation delivery.
 */
export async function runAnalysisRefresh(
  ctx: WorkerContext,
  job: AnalysisRefreshJobPayload,
  runtime: AnalysisRefreshRuntime = {},
): Promise<void> {
  const scope = {
    workspaceId: job.workspaceId,
    projectId: job.projectId,
  };
  const runs = new AsyncRunsRepository(ctx.db);
  const claimed = await runs.claim(scope, job.runId);
  if (!claimed) {
    ctx.logger.info("analysis_refresh_skip_not_queued", {
      code: "CANONICAL_RUN_NOT_QUEUED",
      runId: job.runId,
    });
    return;
  }
  const attempt = toRunAttempt(claimed);

  let payload: AnalysisRefreshRequestPayload;
  try {
    payload = parseAnalysisRefreshRequestPayload(claimed.request_payload);
  } catch {
    await failParent(ctx, {
      attempt,
      scope,
      job,
      error: SAFE_FAILURES.payloadInvalid,
    });
    ctx.logger.warn("analysis_refresh_failed", {
      code: SAFE_FAILURES.payloadInvalid.code,
      runId: job.runId,
    });
    return;
  }

  const plans = new AnalysisRefreshRunsRepository(ctx.db);
  const [parentProjection, steps] = await Promise.all([
    plans.findById(scope, job.runId),
    plans.listSteps(scope, job.runId),
  ]);
  try {
    assertDurablePlan(claimed, parentProjection, steps, payload);
  } catch {
    await failParent(ctx, {
      attempt,
      scope,
      job,
      error: SAFE_FAILURES.projectionInvalid,
    });
    ctx.logger.warn("analysis_refresh_failed", {
      code: SAFE_FAILURES.projectionInvalid.code,
      runId: job.runId,
    });
    return;
  }

  const parent: ParentContext = {
    parent: parentProjection,
    payload,
    claimed,
    attempt,
    scope,
    job,
  };
  const step = nextUnfinishedStep(steps);
  if (!step) {
    await finalizeAlreadyTerminalPlan(ctx, parent);
    return;
  }
  if (step.state === "pending") {
    await advancePendingStep(ctx, parent, step.step_key, runtime);
    return;
  }
  await observeRunningStep(ctx, parent, step.step_key, runtime);
}
