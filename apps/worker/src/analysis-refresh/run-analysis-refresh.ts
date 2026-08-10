import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TOPIC_MODEL_PROMPT_SET_VERSION } from "@sf/artifacts";
import {
  AnalysisRefreshRunsRepository,
  analysisRefreshPlanHash,
  analysisRefreshPlanManifest,
  analysisRefreshPlanV2Manifest,
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  canonicalUtcTimestamptz,
  collectionRunParametersHash,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  enqueueAnalysisRefreshContinuationInTx,
  enqueueRunInTx,
  GROWTH_AUDIT_PROJECTION_VERSION,
  IcpProfilesRepository,
  legacyAnalysisRefreshPlanManifest,
  ObservationsRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  TopicModelGenerationRunsRepository,
  TopicModelsRepository,
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
  type ObservationRow,
  type ProjectScope,
  type QueueName,
  type RunAttempt,
  type SitePageRow,
  type SiteRow,
  type SourceConnectionRow,
} from "@sf/db";
import {
  CONTRACT_VERSION,
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
  MAX_TOPIC_MODEL_GENERATION_GROUPS,
  MAX_TOPIC_MODEL_GENERATION_KEYWORDS,
  ProductProfileDraft,
  TOPIC_MODEL_GENERATION_INPUT_SCHEMA_VERSION,
  parseTopicModelGenerationInputManifest,
  type TopicModelGenerationIcpFacts,
  type TopicModelGenerationInputManifest,
  type TopicModelGenerationProductProfileFacts,
  type TopicModelGenerationProviderSearchIntent,
  type TopicModelGenerationSearchIntent,
} from "@sf/contracts";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_BACKLINKS_DATASET_KEY,
  DATAFORSEO_BACKLINKS_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
  METRIC_CSV_KEYWORD_GAP,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import { keywordAutoGovernanceEnabled } from "../env.ts";
import {
  autoKeywordGovernanceFailureReport,
  runAutoKeywordGovernance,
  type AutoKeywordGovernanceReport,
} from "./auto-keyword-governance.ts";
import {
  ANALYSIS_REFRESH_COLLECTION_CONFIG,
  dataForSeoBacklinksConnectionConfig,
  dataForSeoBacklinksLimitation,
  dataForSeoBacklinksScopeForSite,
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
  growthAuditCapabilityManifestHash,
} from "./frozen-input.ts";
import {
  DiagnosticGovernanceCapacityError,
  freezeDiagnosticGovernance,
} from "./governance.ts";
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

/**
 * Poll fallback cadence while a child run is in flight. Child handlers notify
 * the parent directly the moment a child settles (see
 * `notifyAnalysisRefreshParent`), so this poll only covers a lost
 * notification; at 2s it produced 45-61 delivery ticks per run — 45 chances
 * per run to hit a mid-tick failure — for no added freshness.
 */
export const ANALYSIS_REFRESH_CONTINUATION_DELAY_MS = 15_000;

const COLLECTION_STEP_KEYS = [
  "crawl",
  "gsc",
  "ga4",
  "dataforseo",
  "dataforseo_backlinks",
] as const;
type CollectionStepKey = (typeof COLLECTION_STEP_KEYS)[number];
const AUDIT_COLLECTION_STEP_KEYS = [
  "crawl",
  "gsc",
  "ga4",
  "dataforseo",
] as const;
type AuditCollectionStepKey = (typeof AUDIT_COLLECTION_STEP_KEYS)[number];
type CollectionProvider = "crawl" | "gsc" | "ga4" | "dataforseo";
type OptionalStepKey = Exclude<
  AnalysisRefreshStepKey,
  "crawl" | "growth_audit"
>;

const TERMINAL_STEP_STATES = new Set(["completed", "skipped", "failed"]);
const SUCCESSFUL_CHILD_STATES = new Set(["completed", "partial"]);
const TOPIC_MODEL_ACTIVE_KEY = "topic-model:generation";
const TOPIC_MODEL_GENERATION_VERSION = "topic-model-generation.v1" as const;
const TOPIC_MODEL_QUEUE = "topic-model.generate" as const;
const TOPIC_MODEL_OUTCOME_UNKNOWN_CODE =
  "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN";
const TOPIC_MODEL_REPRESENTATIVE_KEYWORD_LIMIT = 12;
const TOPIC_MODEL_URL_LIMIT = 8;
const TOPIC_MODEL_FACT_ITEM_LIMIT = 20;
const TOPIC_MODEL_FACT_CHARACTER_LIMIT = 500;
const TOPIC_MODEL_KEYWORD_CHARACTER_LIMIT = 240;
const TOPIC_MODEL_SEARCH_INTENTS = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const satisfies readonly TopicModelGenerationSearchIntent[];
interface CollectionIdentity {
  readonly provider: CollectionProvider;
  readonly datasetKey: string;
  readonly schemaVersion: string | null;
  readonly methodVersion: string;
}

const COLLECTION_IDENTITY = {
  crawl: {
    provider: "crawl",
    datasetKey: CRAWL_DATASET_KEY,
    schemaVersion: null,
    methodVersion: CRAWL_METHOD_VERSION,
  },
  gsc: {
    provider: "gsc",
    datasetKey: "gsc.page_query_daily.v1",
    schemaVersion: null,
    methodVersion: "gsc.page_query_daily.v1",
  },
  ga4: {
    provider: "ga4",
    datasetKey: "ga4.organic_landing_daily.v1",
    schemaVersion: null,
    methodVersion: "ga4.organic_landing_daily.v1",
  },
  dataforseo: {
    provider: "dataforseo",
    datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
    schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
    methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
  },
  dataforseo_backlinks: {
    provider: "dataforseo",
    datasetKey: DATAFORSEO_BACKLINKS_DATASET_KEY,
    schemaVersion: DATAFORSEO_BACKLINKS_METHOD_VERSION,
    methodVersion: DATAFORSEO_BACKLINKS_METHOD_VERSION,
  },
} as const satisfies Record<CollectionStepKey, CollectionIdentity>;

const LEGACY_DATAFORSEO_SEARCH_LANDSCAPE_IDENTITY = {
  provider: "dataforseo",
  datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
} as const satisfies CollectionIdentity;

const LEGACY_DATAFORSEO_SEARCH_LANDSCAPE_V2_IDENTITY = {
  provider: "dataforseo",
  datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
} as const satisfies CollectionIdentity;

function collectionIdentitiesForStep(
  stepKey: CollectionStepKey,
): readonly CollectionIdentity[] {
  return stepKey === "dataforseo"
    ? [
        LEGACY_DATAFORSEO_SEARCH_LANDSCAPE_IDENTITY,
        LEGACY_DATAFORSEO_SEARCH_LANDSCAPE_V2_IDENTITY,
        COLLECTION_IDENTITY.dataforseo,
      ]
    : [COLLECTION_IDENTITY[stepKey]];
}

function snapshotMatchesIdentity(
  snapshot: DataSnapshotRow,
  identity: CollectionIdentity,
): boolean {
  return (
    snapshot.provider === identity.provider &&
    snapshot.dataset_key === identity.datasetKey &&
    snapshot.method_version === identity.methodVersion &&
    (identity.schemaVersion === null ||
      snapshot.schema_version === identity.schemaVersion)
  );
}

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
  topicInputInvalid: {
    code: "ANALYSIS_REFRESH_TOPIC_MODEL_INPUT_INVALID",
    summary: "The bounded Topic Model generation input is invalid.",
  },
  topicChildFailed: {
    code: "ANALYSIS_REFRESH_TOPIC_MODEL_CHILD_FAILED",
    summary: "The optional Topic Model generation child failed.",
  },
  topicSuperseded: {
    code: "ANALYSIS_REFRESH_TOPIC_MODEL_SUPERSEDED",
    summary:
      "The optional Topic Model generation was superseded by concurrent Topic authority.",
  },
  topicOutcomeUnknown: {
    code: "ANALYSIS_REFRESH_TOPIC_MODEL_OUTCOME_UNKNOWN",
    summary:
      "The optional Topic Model generation provider outcome is unknown.",
  },
  topicResultInvalid: {
    code: "ANALYSIS_REFRESH_TOPIC_MODEL_RESULT_INVALID",
    summary: "The Topic Model generation result has invalid lineage.",
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
  readonly provider: CollectionProvider;
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
    total: steps.length,
    messageKey,
  };
}

function assertDurablePlan(
  claimed: AsyncRunRow,
  parent: AnalysisRefreshRunRow | null,
  steps: readonly AnalysisRefreshStepRow[],
  payload: AnalysisRefreshRequestPayload,
): asserts parent is AnalysisRefreshRunRow {
  const currentManifest = analysisRefreshPlanManifest();
  const v2Manifest = analysisRefreshPlanV2Manifest();
  const legacyManifest = legacyAnalysisRefreshPlanManifest();
  const currentMatches =
    parent?.plan_hash === analysisRefreshPlanHash(currentManifest) &&
    isDeepStrictEqual(parent.plan_manifest, currentManifest);
  const v2Matches =
    parent?.plan_hash === analysisRefreshPlanHash(v2Manifest) &&
    isDeepStrictEqual(parent.plan_manifest, v2Manifest);
  const legacyMatches =
    parent?.plan_hash === analysisRefreshPlanHash(legacyManifest) &&
    isDeepStrictEqual(parent.plan_manifest, legacyManifest);
  const expectedManifest = currentMatches
    ? currentManifest
    : v2Matches
      ? v2Manifest
    : legacyMatches
      ? legacyManifest
      : null;
  if (
    !parent ||
    !expectedManifest ||
    claimed.kind !== "analysis_refresh" ||
    claimed.result_type !== "analysis_refresh_run" ||
    claimed.result_id !== claimed.id ||
    parent.id !== claimed.id ||
    parent.workspace_id !== claimed.workspace_id ||
    parent.project_id !== claimed.project_id ||
    parent.site_id !== payload.siteId ||
    parent.icp_profile_id !== payload.icpProfile.id ||
    steps.length !== expectedManifest.steps.length ||
    ((currentMatches || v2Matches) && payload.dataForSeoBacklinks === undefined)
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
  /**
   * "advance" delivers immediately — the plan just made durable progress and
   * the next tick has work to do. "poll" waits the fallback delay — the plan
   * is blocked on a child run, and child settlement already triggers a direct
   * notification, so the delayed tick is only a safety net.
   */
  pace: "advance" | "poll",
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
    pace === "poll" ? { startAfter: continuationDate(runtime) } : {},
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
  tx: DbTx,
  input: {
    readonly attempt: RunAttempt;
    readonly scope: ProjectScope;
    readonly job: AnalysisRefreshJobPayload;
    readonly error: { readonly code: string; readonly summary: string };
  },
): Promise<void> {
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
  provider: CollectionProvider,
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
      "poll",
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
    "poll",
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
    "advance",
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
    "advance",
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
  const aiCitations = payload.dataForSeo.aiCitations;
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
    payload.dataForSeo.maxCompetitors <= runtime.maxCompetitors &&
    (aiCitations?.state !== "enabled" ||
      (runtime.aiCitationsEnabled === true &&
        runtime.aiCitationModel === aiCitations.requestedModel))
  );
}

function dataForSeoBacklinksRuntimeAvailable(
  ctx: WorkerContext,
  payload: AnalysisRefreshRequestPayload,
): boolean {
  const runtime = ctx.dataForSeo;
  const frozen = payload.dataForSeoBacklinks;
  return (
    payload.dataForSeo.enabled &&
    frozen?.enabled === true &&
    runtime?.enabled === true &&
    runtime.backlinksEnabled === true &&
    typeof runtime.login === "string" &&
    runtime.login.length > 0 &&
    typeof runtime.password === "string" &&
    runtime.password.length > 0 &&
    typeof runtime.maxBacklinks === "number" &&
    Number.isSafeInteger(runtime.maxBacklinks) &&
    frozen.maxBacklinks <= runtime.maxBacklinks &&
    typeof runtime.maxReferringDomains === "number" &&
    Number.isSafeInteger(runtime.maxReferringDomains) &&
    frozen.maxReferringDomains <= runtime.maxReferringDomains &&
    typeof runtime.maxBacklinkPages === "number" &&
    Number.isSafeInteger(runtime.maxBacklinkPages) &&
    frozen.maxBacklinkPages <= runtime.maxBacklinkPages &&
    typeof runtime.maxSourceVerifications === "number" &&
    Number.isSafeInteger(runtime.maxSourceVerifications) &&
    frozen.maxSourceVerifications <= runtime.maxSourceVerifications
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
          parent.payload.dataForSeo.aiCitations,
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
      "poll",
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
      methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
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

async function startDataForSeoBacklinksStep(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  const frozen = parent.payload.dataForSeoBacklinks;
  if (!dataForSeoBacklinksRuntimeAvailable(ctx, parent.payload)) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      "dataforseo_backlinks",
      parent.payload.dataForSeo.enabled && frozen?.enabled
        ? "worker_credentials_unavailable"
        : "feature_disabled",
      runtime,
    );
    return;
  }
  if (!frozen) {
    throw new Error("Analysis Refresh v2 backlink policy disappeared");
  }

  const site = await new SitesRepository(tx).findById(
    parent.scope,
    parent.payload.siteId,
  );
  const collectionScope =
    site?.is_primary
      ? dataForSeoBacklinksScopeForSite(
          site,
          frozen.maxBacklinks,
          frozen.maxReferringDomains,
          frozen.maxBacklinkPages,
          frozen.maxSourceVerifications,
        )
      : null;
  if (!site || !collectionScope) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      "dataforseo_backlinks",
      "context_incomplete",
      runtime,
    );
    return;
  }

  const config = ANALYSIS_REFRESH_COLLECTION_CONFIG.dataforseo_backlinks;
  const activeKey = `collect:dataforseo:${config.operation}`;
  if (await new AsyncRunsRepository(tx).findActive(parent.scope, activeKey)) {
    await scheduleContinuationInTx(
      ctx,
      tx,
      parent,
      steps,
      "analysisRefresh.dataforseo_backlinks.waitingForActiveRun",
      runtime,
      "poll",
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
      "dataforseo_backlinks",
      "connection_scope_mismatch",
      runtime,
    );
    return;
  }
  if (!source) {
    const connectionConfig =
      dataForSeoBacklinksConnectionConfig(collectionScope);
    source = await sources.insertConnection({
      workspaceId: parent.scope.workspaceId,
      projectId: parent.scope.projectId,
      siteId: site.id,
      provider: "dataforseo",
      connectionType: "api_key_stub",
      state: "connected",
      externalRef: connectionConfig.target,
      config: { ...connectionConfig },
      limitation: dataForSeoBacklinksLimitation(connectionConfig),
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
      stepKey: "dataforseo_backlinks",
      provider: "dataforseo",
      operation: config.operation,
      queue: config.queue,
      methodVersion: DATAFORSEO_BACKLINKS_METHOD_VERSION,
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

type TopicKeywordFact = Awaited<
  ReturnType<typeof freezeDiagnosticGovernance>
>["keywordClusters"][number]["keywords"][number];

interface TopicProviderEvidence {
  readonly providerSearchIntent: TopicModelGenerationProviderSearchIntent;
  readonly searchVolume: number | null;
  readonly currentUrl: string | null;
}

interface TopicGenerationGroupSeed {
  readonly groupKey: string;
  readonly sourceClusterKey: string;
  readonly keywords: readonly TopicKeywordFact[];
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedFact(value: string | null): string | null {
  return value !== null &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= TOPIC_MODEL_FACT_CHARACTER_LIMIT
    ? value
    : null;
}

function boundedFacts(values: readonly string[]): string[] {
  return [...new Set(values)]
    .filter(
      (value) =>
        value === value.trim() &&
        value.length >= 1 &&
        value.length <= TOPIC_MODEL_FACT_CHARACTER_LIMIT,
    )
    .slice(0, TOPIC_MODEL_FACT_ITEM_LIMIT);
}

function topicProfileFacts(profileValue: unknown, siteId: string): {
  readonly productProfile: TopicModelGenerationProductProfileFacts | null;
  readonly icp: TopicModelGenerationIcpFacts | null;
} {
  const parsed = ProductProfileDraft.safeParse(profileValue);
  if (!parsed.success) {
    if (
      plainRecord(profileValue) &&
      typeof profileValue["profileSchemaVersion"] === "string" &&
      profileValue["profileSchemaVersion"].startsWith("product-profile.")
    ) {
      throw new Error("Topic Model Product Profile shape is invalid");
    }
    return { productProfile: null, icp: null };
  }
  if (parsed.data.sourceSiteId !== siteId) {
    throw new Error("Topic Model Product Profile Site lineage is invalid");
  }
  const primaryAudience =
    parsed.data.targetAudiences.find(
      (audience) => audience.reviewStatus === "primary",
    ) ?? null;
  return {
    productProfile: {
      productName: boundedFact(parsed.data.productName),
      oneLiner: boundedFact(parsed.data.oneLiner),
      category: boundedFact(parsed.data.category),
      valueProposition: boundedFact(parsed.data.valueProposition),
      coreFeatures: boundedFacts(parsed.data.coreFeatures),
    },
    icp: {
      targetCompanyOrAudience: boundedFact(
        primaryAudience?.targetCompanyOrAudience ?? null,
      ),
      buyerRoles: boundedFacts(primaryAudience?.buyerRoles ?? []),
      userRoles: boundedFacts(primaryAudience?.userRoles ?? []),
      useCases: boundedFacts(primaryAudience?.useCases ?? []),
      pains: boundedFacts(primaryAudience?.pains ?? []),
      outcomes: boundedFacts(primaryAudience?.outcomes ?? []),
    },
  };
}

function exactTopicProviderEvidence(
  parent: ParentContext,
  keyword: TopicKeywordFact,
  sourceClusterKey: string,
  snapshotId: string | null,
  observations: ReadonlyMap<string, ObservationRow>,
): TopicProviderEvidence | null {
  if (snapshotId === null) return null;
  const occurrence = keyword.occurrenceRefs.find(
    (candidate) =>
      candidate.snapshotId === snapshotId && candidate.observationId !== null,
  );
  if (!occurrence?.observationId) return null;
  const observation = observations.get(occurrence.observationId);
  if (!observation) {
    throw new Error("Topic Model provider occurrence is missing");
  }
  if (
    observation.workspace_id !== parent.scope.workspaceId ||
    observation.project_id !== parent.scope.projectId ||
    observation.snapshot_id !== snapshotId ||
    observation.id !== occurrence.observationId ||
    observation.provider !== "dataforseo" ||
    observation.metric_key !== METRIC_CSV_KEYWORD_GAP ||
    observation.subject_type !== "keyword_cluster" ||
    observation.availability !== "available" ||
    !plainRecord(observation.value_json)
  ) {
    throw new Error("Topic Model provider occurrence lineage is invalid");
  }
  const value = observation.value_json;
  if (
    value["keyword"] !== keyword.displayKeyword ||
    value["marketCode"] !== keyword.marketCode ||
    value["languageCode"] !== keyword.languageTag ||
    value["clusterKey"] !== sourceClusterKey ||
    !Object.hasOwn(value, "searchVolume") ||
    !Object.hasOwn(value, "providerSearchIntent") ||
    !Object.hasOwn(value, "currentUrl")
  ) {
    throw new Error("Topic Model provider occurrence value is invalid");
  }
  const searchVolume = value["searchVolume"];
  const providerSearchIntent = value["providerSearchIntent"];
  const currentUrl = value["currentUrl"];
  if (
    (searchVolume !== null &&
      (typeof searchVolume !== "number" ||
        !Number.isSafeInteger(searchVolume) ||
        searchVolume < 0)) ||
    (providerSearchIntent !== null &&
      !TOPIC_MODEL_SEARCH_INTENTS.includes(
        providerSearchIntent as TopicModelGenerationSearchIntent,
      )) ||
    (currentUrl !== null && typeof currentUrl !== "string")
  ) {
    throw new Error("Topic Model provider occurrence metrics are invalid");
  }
  return {
    providerSearchIntent: {
      value:
        providerSearchIntent as TopicModelGenerationSearchIntent | null,
      snapshotId,
      observationId: observation.id,
      observedAt: canonicalUtcTimestamptz(observation.observed_at),
    },
    searchVolume: searchVolume as number | null,
    currentUrl,
  };
}

async function exactTopicProviderObservations(
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
): Promise<{
  readonly snapshotId: string | null;
  readonly observations: ReadonlyMap<string, ObservationRow>;
}> {
  const step = steps.find((candidate) => candidate.step_key === "dataforseo");
  if (step?.state !== "completed") {
    return { snapshotId: null, observations: new Map() };
  }
  if (step.child_async_run_id === null || step.result_snapshot_id === null) {
    throw new Error("Topic Model provider Snapshot lineage is incomplete");
  }
  const snapshots = await new DataSnapshotsRepository(tx).findByIds(
    parent.scope,
    [step.result_snapshot_id],
  );
  const snapshot = snapshots[0];
  if (
    snapshots.length !== 1 ||
    !snapshot ||
    snapshot.workspace_id !== parent.scope.workspaceId ||
    snapshot.project_id !== parent.scope.projectId ||
    snapshot.site_id !== parent.payload.siteId ||
    snapshot.collection_run_id !== step.child_async_run_id ||
    !collectionIdentitiesForStep("dataforseo").some((identity) =>
      snapshotMatchesIdentity(snapshot, identity),
    )
  ) {
    throw new Error("Topic Model provider Snapshot lineage is invalid");
  }
  const rows = await new ObservationsRepository(tx).listBySnapshotIds(
    parent.scope,
    [snapshot.id],
  );
  const observations = new Map<string, ObservationRow>();
  for (const row of rows) {
    if (
      row.workspace_id !== parent.scope.workspaceId ||
      row.project_id !== parent.scope.projectId ||
      row.snapshot_id !== snapshot.id ||
      observations.has(row.id)
    ) {
      throw new Error("Topic Model provider Observation set is invalid");
    }
    observations.set(row.id, row);
  }
  return { snapshotId: snapshot.id, observations };
}

function selectTopicGenerationGroups(
  governance: Awaited<ReturnType<typeof freezeDiagnosticGovernance>>,
): {
  readonly market: string;
  readonly language: string;
  readonly groups: readonly TopicGenerationGroupSeed[];
} | null {
  const localeCounts = new Map<string, {
    readonly market: string;
    readonly language: string;
    count: number;
  }>();
  for (const cluster of governance.keywordClusters) {
    for (const keyword of cluster.keywords) {
      const key = `${keyword.marketCode}\u0000${keyword.languageTag}`;
      const current = localeCounts.get(key) ?? {
        market: keyword.marketCode,
        language: keyword.languageTag,
        count: 0,
      };
      current.count += 1;
      localeCounts.set(key, current);
    }
  }
  const locale = [...localeCounts.values()].sort(
    (left, right) =>
      right.count - left.count ||
      compareAscii(left.market, right.market) ||
      compareAscii(left.language, right.language),
  )[0];
  if (!locale) return null;

  const groups: TopicGenerationGroupSeed[] = [];
  let remaining = MAX_TOPIC_MODEL_GENERATION_KEYWORDS;
  for (const cluster of governance.keywordClusters) {
    if (
      groups.length >= MAX_TOPIC_MODEL_GENERATION_GROUPS ||
      remaining === 0
    ) {
      break;
    }
    const keywords = cluster.keywords
      .filter(
        (keyword) =>
          keyword.marketCode === locale.market &&
          keyword.languageTag === locale.language,
      )
      .slice(0, remaining);
    if (keywords.length === 0) continue;
    groups.push({
      groupKey: `group-${String(groups.length + 1).padStart(3, "0")}`,
      sourceClusterKey: cluster.clusterKey,
      keywords,
    });
    remaining -= keywords.length;
  }
  return groups.length === 0
    ? null
    : { market: locale.market, language: locale.language, groups };
}

async function buildTopicGenerationManifest(
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
): Promise<TopicModelGenerationInputManifest | null> {
  const governance = await freezeDiagnosticGovernance(tx, parent.scope);
  const selected = selectTopicGenerationGroups(governance);
  if (!selected) return null;

  const profile = await new IcpProfilesRepository(tx).findById(
    parent.scope,
    parent.payload.icpProfile.id,
  );
  if (
    !profile ||
    profile.id !== parent.payload.icpProfile.id ||
    profile.workspace_id !== parent.scope.workspaceId ||
    profile.project_id !== parent.scope.projectId ||
    profile.status !== "complete" ||
    profile.version !== parent.payload.icpProfile.version ||
    profile.content_hash !== parent.payload.icpProfile.contentHash
  ) {
    throw new Error("Topic Model Product Profile lineage is invalid");
  }
  const facts = topicProfileFacts(profile.profile, parent.payload.siteId);
  const provider = await exactTopicProviderObservations(
    tx,
    parent,
    steps,
  );
  const providerByKeyword = new Map<string, TopicProviderEvidence | null>();
  for (const group of selected.groups) {
    for (const keyword of group.keywords) {
      providerByKeyword.set(
        keyword.keywordEntityId,
        exactTopicProviderEvidence(
          parent,
          keyword,
          group.sourceClusterKey,
          provider.snapshotId,
          provider.observations,
        ),
      );
    }
  }

  const pageIds = selected.groups.flatMap((group) =>
    group.keywords.flatMap((keyword) =>
      keyword.mappedSitePageId === null ? [] : [keyword.mappedSitePageId],
    ),
  );
  const pages = await new SitePagesRepository(tx).findByIds(
    parent.scope,
    pageIds,
  );
  const pagesById = new Map<string, SitePageRow>();
  for (const page of pages) {
    if (
      page.workspace_id !== parent.scope.workspaceId ||
      page.project_id !== parent.scope.projectId ||
      page.site_id !== parent.payload.siteId ||
      pagesById.has(page.id)
    ) {
      throw new Error("Topic Model mapped page lineage is invalid");
    }
    pagesById.set(page.id, page);
  }
  if ([...new Set(pageIds)].some((id) => !pagesById.has(id))) {
    throw new Error("Topic Model mapped page is missing");
  }

  const groups = selected.groups.map((group) => {
    const representatives = [
      ...new Set(group.keywords.map((keyword) => keyword.displayKeyword)),
    ]
      .filter(
        (keyword) =>
          keyword === keyword.trim() &&
          keyword.length >= 1 &&
          keyword.length <= TOPIC_MODEL_KEYWORD_CHARACTER_LIMIT,
      )
      .slice(0, TOPIC_MODEL_REPRESENTATIVE_KEYWORD_LIMIT);
    const evidence = group.keywords.map(
      (keyword) => providerByKeyword.get(keyword.keywordEntityId) ?? null,
    );
    const volumes = evidence.flatMap((item) =>
      item?.searchVolume === null || item === null ? [] : [item.searchVolume],
    );
    const aggregateSearchVolume =
      volumes.length === 0 ? null : volumes.reduce((sum, value) => sum + value, 0);
    if (
      aggregateSearchVolume !== null &&
      !Number.isSafeInteger(aggregateSearchVolume)
    ) {
      throw new Error("Topic Model aggregate Search Volume is unsafe");
    }
    const providerIntentDistribution = {
      informational: 0,
      navigational: 0,
      commercial: 0,
      transactional: 0,
    } satisfies Record<TopicModelGenerationSearchIntent, number>;
    for (const item of evidence) {
      if (item?.providerSearchIntent.value !== null && item !== null) {
        providerIntentDistribution[item.providerSearchIntent.value] += 1;
      }
    }
    const urls = [
      ...new Set(
        group.keywords.flatMap((keyword) => {
          const mapped =
            keyword.mappedSitePageId === null
              ? null
              : pagesById.get(keyword.mappedSitePageId)?.normalized_url ?? null;
          const ranked = providerByKeyword.get(keyword.keywordEntityId)?.currentUrl ?? null;
          return [mapped, ranked].filter(
            (value): value is string => value !== null,
          );
        }),
      ),
    ]
      .sort(compareAscii)
      .slice(0, TOPIC_MODEL_URL_LIMIT);
    return {
      groupKey: group.groupKey,
      representativeKeywords: representatives,
      keywordCount: group.keywords.length,
      aggregateSearchVolume,
      providerIntentDistribution,
      urls,
    };
  });
  return parseTopicModelGenerationInputManifest({
    schemaVersion: TOPIC_MODEL_GENERATION_INPUT_SCHEMA_VERSION,
    analysisRefreshRunId: parent.job.runId,
    projectId: parent.scope.projectId,
    market: selected.market,
    language: selected.language,
    groups,
    ...facts,
    keywords: selected.groups.flatMap((group) =>
      group.keywords.map((keyword) => ({
        keywordId: keyword.keywordEntityId,
        expectedGovernanceRevision: keyword.revision,
        groupKey: group.groupKey,
        providerSearchIntent:
          providerByKeyword.get(keyword.keywordEntityId)?.providerSearchIntent ??
          null,
      })),
    ),
  });
}

async function startTopicModelStep(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  steps: readonly AnalysisRefreshStepRow[],
  step: AnalysisRefreshStepRow,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
  const topics = new TopicModelsRepository(tx);
  if (await topics.getLatestConfirmed(parent.scope)) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      "topic_model",
      "existing_confirmed_model",
      runtime,
    );
    return;
  }
  if (await topics.getDraft(parent.scope)) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      "topic_model",
      "existing_draft",
      runtime,
    );
    return;
  }
  if (
    await new AsyncRunsRepository(tx).findActive(
      parent.scope,
      TOPIC_MODEL_ACTIVE_KEY,
    )
  ) {
    await scheduleContinuationInTx(
      ctx,
      tx,
      parent,
      steps,
      "analysisRefresh.topic_model.waitingForActiveRun",
      runtime,
      "poll",
    );
    return;
  }

  try {
    await runAutoKeywordGovernance(tx, parent.scope, {
      enabled: keywordAutoGovernanceEnabled(),
    });
  } catch (error) {
    const report = autoKeywordGovernanceFailureReport(error);
    ctx.logger.error("analysis_refresh_topic_auto_keyword_governance_failed", {
      analysisRefreshRunId: parent.job.runId,
      code: report.failure?.code ?? null,
      limitation: report.failure?.summary ?? null,
      error: error instanceof Error ? error.name : "unknown",
    });
  }

  let manifest: TopicModelGenerationInputManifest | null;
  try {
    manifest = await buildTopicGenerationManifest(tx, parent, steps);
  } catch {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      SAFE_FAILURES.topicInputInvalid,
      runtime,
    );
    return;
  }
  if (manifest === null) {
    await skipOptionalStepInTx(
      ctx,
      tx,
      parent,
      "topic_model",
      "insufficient_keyword_evidence",
      runtime,
    );
    return;
  }

  const runId = randomUUID();
  const child = await new AsyncRunsRepository(tx).insertQueued({
    runId,
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    kind: "topic_model_generation",
    activeKey: TOPIC_MODEL_ACTIVE_KEY,
    initiatedBy: parent.claimed.initiated_by,
    contractVersion: CONTRACT_VERSION,
    requestPayload: {
      analysisRefreshRunId: parent.job.runId,
      inputSchemaVersion: TOPIC_MODEL_GENERATION_INPUT_SCHEMA_VERSION,
    },
    resultType: "topic_model_generation_run",
    resultId: runId,
  });
  const inputHash = contentHash(manifest as unknown as CanonicalValue);
  await new TopicModelGenerationRunsRepository(tx).insertPlaceholder({
    runId: child.id,
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    analysisRefreshRunId: parent.job.runId,
    generationVersion: TOPIC_MODEL_GENERATION_VERSION,
    promptSetVersion: TOPIC_MODEL_PROMPT_SET_VERSION,
    inputManifest: manifest,
    inputHash,
  });
  await enqueueRunInTx(ctx.boss, tx, TOPIC_MODEL_QUEUE, {
    runId: child.id,
    workspaceId: parent.scope.workspaceId,
    projectId: parent.scope.projectId,
    contractVersion: CONTRACT_VERSION,
  });
  if (
    !(await new AnalysisRefreshRunsRepository(tx).startStep(
      parent.scope,
      parent.job.runId,
      "topic_model",
      child.id,
    ))
  ) {
    throw new Error("Analysis Refresh Topic Model step could not start");
  }
  const currentSteps = await new AnalysisRefreshRunsRepository(tx).listSteps(
    parent.scope,
    parent.job.runId,
  );
  await scheduleContinuationInTx(
    ctx,
    tx,
    parent,
    currentSteps,
    "analysisRefresh.topic_model.running",
    runtime,
    "poll",
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
      step_key: AuditCollectionStepKey;
      result_snapshot_id: string;
    } =>
      AUDIT_COLLECTION_STEP_KEYS.includes(
        step.step_key as AuditCollectionStepKey,
      ) &&
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
    if (
      !snapshot ||
      snapshot.workspace_id !== parent.scope.workspaceId ||
      snapshot.project_id !== parent.scope.projectId ||
      snapshot.site_id !== parent.payload.siteId ||
      step.child_async_run_id === null ||
      snapshot.collection_run_id !== step.child_async_run_id ||
      !collectionIdentitiesForStep(step.step_key).some((identity) =>
        snapshotMatchesIdentity(snapshot, identity),
      )
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
      "poll",
    );
    return;
  }

  const snapshotIds = steps.flatMap((candidate) =>
    AUDIT_COLLECTION_STEP_KEYS.includes(
      candidate.step_key as AuditCollectionStepKey,
    ) &&
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

  const [profile, site] = await Promise.all([
    new IcpProfilesRepository(tx).findById(
      parent.scope,
      parent.payload.icpProfile.id,
    ),
    new SitesRepository(tx).findById(
      parent.scope,
      parent.payload.siteId,
    ),
  ]);
  if (
    !profile ||
    profile.id !== parent.payload.icpProfile.id ||
    profile.workspace_id !== parent.scope.workspaceId ||
    profile.project_id !== parent.scope.projectId ||
    profile.status !== "complete" ||
    profile.version !== parent.payload.icpProfile.version ||
    profile.content_hash !== parent.payload.icpProfile.contentHash ||
    !site ||
    site.id !== parent.payload.siteId ||
    site.workspace_id !== parent.scope.workspaceId ||
    site.project_id !== parent.scope.projectId
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

  // Turn ingested candidate keywords that already carry immutable provider
  // evidence into diagnostic-eligible facts BEFORE the freeze reads the
  // library, so an Owner never sees an empty Keyword Library for a project the
  // collectors already populated. Every write is an actorless
  // `system_suggestion`; a human decision is never overwritten.
  // Automated governance is a best-effort supplement to the Keyword Library,
  // never a precondition of the diagnostic. It can throw — ledger integrity,
  // batch bounds — and every OTHER known failure in this step already takes the
  // safe `failStepInTx` path, so letting this one escape would be the single
  // way a governance defect destroys an entire Growth Audit. Catch it, report
  // the limitation, and freeze the library exactly as it already stands: an
  // ungoverned library is an existing and truthful state, a lost diagnostic is
  // not. The pass itself runs in a nested transaction, so nothing it half-wrote
  // survives into the freeze.
  let autoGovernance: AutoKeywordGovernanceReport;
  try {
    autoGovernance = await runAutoKeywordGovernance(tx, parent.scope, {
      enabled: keywordAutoGovernanceEnabled(),
    });
  } catch (error) {
    autoGovernance = autoKeywordGovernanceFailureReport(error);
    ctx.logger.error("analysis_refresh_auto_keyword_governance_failed", {
      analysisRefreshRunId: parent.job.runId,
      code: autoGovernance.failure?.code ?? null,
      limitation: autoGovernance.failure?.summary ?? null,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  ctx.logger.info("analysis_refresh_auto_keyword_governance", {
    analysisRefreshRunId: parent.job.runId,
    ...autoGovernance,
  });

  let governance: Awaited<ReturnType<typeof freezeDiagnosticGovernance>>;
  try {
    governance = await freezeDiagnosticGovernance(tx, parent.scope);
  } catch (error) {
    if (!(error instanceof DiagnosticGovernanceCapacityError)) throw error;
    ctx.logger.error("analysis_refresh_governance_projection_unusable", {
      analysisRefreshRunId: parent.job.runId,
      error: error.name,
    });
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
  const frozen = buildAnalysisRefreshDiagnosticFrozenInput({
    projectId: parent.scope.projectId,
    siteId: parent.payload.siteId,
    icp: {
      ...parent.payload.icpProfile,
      profile: profile.profile,
    },
    siteLanguageCodes: site.language_codes,
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
    "poll",
  );
}

async function advancePendingStep(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
  stepKey: AnalysisRefreshStepKey,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
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
    case "dataforseo_backlinks":
      await startDataForSeoBacklinksStep(
        ctx,
        tx,
        parent,
        steps,
        runtime,
      );
      return;
    case "topic_model":
      await startTopicModelStep(ctx, tx, parent, steps, step, runtime);
      return;
    case "growth_audit":
      await startGrowthAuditStep(ctx, tx, parent, steps, step, runtime);
      return;
  }
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
  const config = ANALYSIS_REFRESH_COLLECTION_CONFIG[stepKey];
  return (
    collection !== null &&
    collection.id === child.id &&
    collection.workspace_id === parent.scope.workspaceId &&
    collection.project_id === parent.scope.projectId &&
    collection.site_id === parent.payload.siteId &&
    collection.operation === config.operation &&
    snapshot !== null &&
    snapshot.workspace_id === parent.scope.workspaceId &&
    snapshot.project_id === parent.scope.projectId &&
    snapshot.site_id === parent.payload.siteId &&
    snapshot.collection_run_id === child.id &&
    snapshot.source_connection_id === collection.source_connection_id &&
    collectionIdentitiesForStep(stepKey).some(
      (identity) =>
        collection.provider === identity.provider &&
        collection.method_version === identity.methodVersion &&
        snapshotMatchesIdentity(snapshot, identity),
    )
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
      "poll",
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
    "advance",
  );
}

async function observeTopicModelChildInTx(
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
      "analysisRefresh.topic_model.waiting",
      runtime,
      "poll",
    );
    return;
  }
  if (child.status === "failed" || child.status === "cancelled") {
    const superseded =
      child.status === "cancelled" &&
      child.kind === "topic_model_generation" &&
      child.result_type === "topic_model_generation_run" &&
      child.result_id === child.id &&
      child.last_error_code === "TOPIC_MODEL_GENERATION_SUPERSEDED";
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      superseded
        ? SAFE_FAILURES.topicSuperseded
        : child.last_error_code === TOPIC_MODEL_OUTCOME_UNKNOWN_CODE
        ? SAFE_FAILURES.topicOutcomeUnknown
        : SAFE_FAILURES.topicChildFailed,
      runtime,
    );
    return;
  }
  if (
    child.status !== "completed" ||
    child.kind !== "topic_model_generation" ||
    child.result_type !== "topic_model_generation_run" ||
    child.result_id !== child.id
  ) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      SAFE_FAILURES.topicResultInvalid,
      runtime,
    );
    return;
  }

  const ledger = await new TopicModelGenerationRunsRepository(tx).findById(
    parent.scope,
    child.id,
  );
  let manifest: TopicModelGenerationInputManifest | null = null;
  try {
    manifest = ledger
      ? parseTopicModelGenerationInputManifest(ledger.input_manifest)
      : null;
  } catch {
    manifest = null;
  }
  if (
    !ledger ||
    !manifest ||
    ledger.id !== child.id ||
    ledger.workspace_id !== parent.scope.workspaceId ||
    ledger.project_id !== parent.scope.projectId ||
    ledger.analysis_refresh_run_id !== parent.job.runId ||
    ledger.generation_version !== TOPIC_MODEL_GENERATION_VERSION ||
    ledger.prompt_set_version !== TOPIC_MODEL_PROMPT_SET_VERSION ||
    manifest.analysisRefreshRunId !== parent.job.runId ||
    manifest.projectId !== parent.scope.projectId ||
    contentHash(manifest as unknown as CanonicalValue) !== ledger.input_hash ||
    ledger.result_topic_model_revision_id === null
  ) {
    await failStepInTx(
      ctx,
      tx,
      parent,
      step,
      SAFE_FAILURES.topicResultInvalid,
      runtime,
    );
    return;
  }

  const plans = new AnalysisRefreshRunsRepository(tx);
  if (
    !(await plans.completeStep(
      parent.scope,
      parent.job.runId,
      "topic_model",
      {
        childAsyncRunId: child.id,
        resultSnapshotId: null,
      },
    ))
  ) {
    throw new Error("Analysis Refresh Topic Model step could not complete");
  }
  const steps = await plans.listSteps(parent.scope, parent.job.runId);
  await scheduleContinuationInTx(
    ctx,
    tx,
    parent,
    steps,
    "analysisRefresh.topic_model.completed",
    runtime,
    "advance",
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
      "poll",
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
  tx: DbTx,
  parent: ParentContext,
  stepKey: AnalysisRefreshStepKey,
  runtime: AnalysisRefreshRuntime,
): Promise<void> {
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
  if (step.step_key === "topic_model") {
    await observeTopicModelChildInTx(
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
}

async function finalizeAlreadyTerminalPlan(
  ctx: WorkerContext,
  tx: DbTx,
  parent: ParentContext,
): Promise<void> {
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
  // One transaction per delivery, with the claim as its first write. The claim
  // used to autocommit before this transaction existed; a tick that then died
  // waiting on the project row lock (held by a child's terminalization
  // transaction) left the parent pinned `running` with no live job — and
  // `prepareDelivery`'s attempt_count <= retryCount rescue clause can never
  // match a continuation chain (attempt counts tick deliveries, not retries),
  // so the pg-boss redelivery was swallowed and the whole run was orphaned.
  // Inside the transaction any death rolls the claim back to `queued`, and the
  // redelivery replays the tick from the start.
  await ctx.db.transaction(async (tx) => {
    const runs = new AsyncRunsRepository(tx);
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
      await failParent(ctx, tx, {
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

    const plans = new AnalysisRefreshRunsRepository(tx);
    const parentProjection = await plans.findById(scope, job.runId);
    const steps = await plans.listSteps(scope, job.runId);
    try {
      assertDurablePlan(claimed, parentProjection, steps, payload);
    } catch {
      await failParent(ctx, tx, {
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
      await finalizeAlreadyTerminalPlan(ctx, tx, parent);
      return;
    }
    if (step.state === "pending") {
      await advancePendingStep(ctx, tx, parent, step.step_key, runtime);
      return;
    }
    await observeRunningStep(ctx, tx, parent, step.step_key, runtime);
  });
}
